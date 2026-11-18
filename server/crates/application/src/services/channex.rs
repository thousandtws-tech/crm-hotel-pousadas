//! Distribuição por canal — Channex (PMS → Channex → OTAs).
//!
//! Orquestra o ciclo completo:
//! - **Configuração**: vínculo da propriedade remota, mapeamento
//!   acomodação → room type + rate plan, webhook assinado, iframe.
//! - **ARI outbound**: mutações locais enfileiram outbox; o worker
//!   coalesce por acomodação e envia o estado RECALCULADO — um job
//!   velho nunca sobrescreve um estado mais novo. HTTP 200 com
//!   `meta.warnings` = aceite parcial, registrado e visível.
//! - **Reservas inbound**: feed (pull) + webhook (push, sinal) gravam
//!   a revisão antes de aplicar — dedup por revision_id; o ACK remoto
//!   só acontece depois do commit local e é recuperável (dedup-hit
//!   reenvia ACK pendente).
//! - **Conflitos e lacunas**: reserva OTA sem mapeamento ou competindo
//!   com reserva local nunca é descartada nem adivinhada — vira
//!   pendência operacional explícita.
//!
//! Pagamentos ficam no fluxo existente — OTA nunca cria pagamento.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use tracing::{info, warn};

use clarituz_domain::entities::{
    Acomodacao, AmbienteIntegracao, EnvioDistribuicao, Integracao, MapaDistribuicaoView, NovoLog,
    NovoOutboxAri, PendenciaDistribuicao, ProvedorIntegracao, ResumoDistribuicao,
    RevisaoDistribuicao,
};
use clarituz_domain::enums::StatusReserva;
use clarituz_domain::ports::{
    AcomodacaoRepository, AtualizacaoIntegracao, ClienteRepository, CredentialVault,
    DisponibilidadeValor, DistribuicaoRepository, ErroDistribuicao, IntegracaoRepository,
    NovoClienteSite, PropriedadeRemota, ProvedorDistribuicao, RatePlanRemota, ReservaRepository,
    RestricaoValor, RevisaoRemota, RoomTypeRemota, TokenCanal,
};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;

use crate::actor::Ator;
use crate::error::AppResult;

/// Fábrica do cliente Channex — a application não conhece reqwest.
pub type ChannexFactory =
    Arc<dyn Fn(String, AmbienteIntegracao) -> Arc<dyn ProvedorDistribuicao> + Send + Sync>;

/// Janela máxima de publicação ARI — a Channex recomenda ~1 ano.
const JANELA_MAX_DIAS: i64 = 370;
/// Retentativas máximas de um item de outbox antes de virar pendência.
const RETRY_MAX: u32 = 10;

#[derive(Debug)]
pub enum ResultadoRevisao {
    Aplicada,
    Duplicada,
    Pendente,
}

#[derive(Debug, Serialize)]
pub struct OpcoesDistribuicao {
    pub room_types: Vec<RoomTypeRemota>,
    pub rate_plans: Vec<RatePlanRemota>,
    /// Acomodações locais ativas — lado esquerdo do mapeamento.
    pub acomodacoes: Vec<serde_json::Value>,
    /// Mapeamentos já gravados — pré-seleciona a grade.
    pub mapeamentos: Vec<MapaDistribuicaoView>,
    /// Propriedade vinculada — o mapeamento só existe dentro dela.
    pub property_id: Option<String>,
    pub publicacao_pausada: bool,
}

pub struct ChannexService {
    repo: Arc<dyn DistribuicaoRepository>,
    integracoes: Arc<dyn IntegracaoRepository>,
    reservas: Arc<dyn ReservaRepository>,
    acomodacoes: Arc<dyn AcomodacaoRepository>,
    clientes: Arc<dyn ClienteRepository>,
    vault: Arc<dyn CredentialVault>,
    factory: ChannexFactory,
}

impl ChannexService {
    pub fn new(
        repo: Arc<dyn DistribuicaoRepository>,
        integracoes: Arc<dyn IntegracaoRepository>,
        reservas: Arc<dyn ReservaRepository>,
        acomodacoes: Arc<dyn AcomodacaoRepository>,
        clientes: Arc<dyn ClienteRepository>,
        vault: Arc<dyn CredentialVault>,
        factory: ChannexFactory,
    ) -> Self {
        Self {
            repo,
            integracoes,
            reservas,
            acomodacoes,
            clientes,
            vault,
            factory,
        }
    }

    // -- resolução da integração + cliente autenticado -------------------

    async fn integracao(&self, ambiente: AmbienteIntegracao) -> AppResult<Integracao> {
        self.integracoes
            .buscar(ProvedorIntegracao::Channex, ambiente)
            .await?
            .ok_or_else(|| DomainError::regra("Channex não configurada neste ambiente.").into())
    }

    fn cfg<'a>(integ: &'a Integracao, campo: &str) -> Option<&'a str> {
        integ.config[campo].as_str().filter(|s| !s.is_empty())
    }

    fn pausada(integ: &Integracao) -> bool {
        integ.config["publicacao_pausada"]
            .as_bool()
            .unwrap_or(false)
    }

    fn segredo_aberto(
        &self,
        integ: &Integracao,
        campo: &str,
        envelopes: &HashMap<String, Vec<u8>>,
    ) -> AppResult<Option<String>> {
        match envelopes.get(campo) {
            Some(env) => Ok(Some(self.vault.abrir(
                &contexto_aad(integ.provedor, integ.ambiente, campo, integ.id),
                env,
            )?)),
            None => Ok(None),
        }
    }

    async fn cliente(
        &self,
        ambiente: AmbienteIntegracao,
        exigir_habilitada: bool,
    ) -> AppResult<(Integracao, Arc<dyn ProvedorDistribuicao>)> {
        let integ = self.integracao(ambiente).await?;
        if exigir_habilitada && !integ.habilitado {
            return Err(DomainError::regra(
                "Integração Channex desativada — habilite para publicar.",
            )
            .into());
        }
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        let Some(api_key) = self.segredo_aberto(&integ, "api_key", &enc)? else {
            return Err(DomainError::regra("Channex sem chave de API configurada.").into());
        };
        Ok((integ, (self.factory)(api_key, ambiente)))
    }

    async fn cliente_habilitado_por_id(
        &self,
        idintegracao: i64,
    ) -> AppResult<Option<(Integracao, Arc<dyn ProvedorDistribuicao>)>> {
        let Some(integ) = self.integracoes.buscar_por_id(idintegracao).await? else {
            return Ok(None);
        };
        if !integ.habilitado {
            return Ok(None);
        }
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        let Some(api_key) = self.segredo_aberto(&integ, "api_key", &enc)? else {
            return Ok(None);
        };
        Ok(Some((
            integ.clone(),
            (self.factory)(api_key, integ.ambiente),
        )))
    }

    /// Teste de conexão do card — leitura autenticada sem efeito lateral.
    pub async fn testar(&self, ambiente: AmbienteIntegracao) -> AppResult<String> {
        let (_, cli) = self.cliente(ambiente, false).await?;
        Ok(cli.testar().await?)
    }

    // -- configuração -----------------------------------------------------

    /// Propriedades remotas da conta — o operador escolhe a qual vincular.
    pub async fn propriedades(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Vec<PropriedadeRemota>> {
        ator.exigir_admin()?;
        let (_, cli) = self.cliente(ambiente, false).await?;
        Ok(cli.propriedades().await?)
    }

    /// Vincula a propriedade remota à integração — valida que ela existe
    /// na conta (lê remotamente) antes de gravar o vínculo.
    pub async fn vincular_propriedade(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        property_id: &str,
    ) -> AppResult<()> {
        ator.exigir_admin()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let props = cli.propriedades().await?;
        let prop = props.iter().find(|p| p.id == property_id).ok_or_else(|| {
            DomainError::validacao("Propriedade não encontrada na conta Channex deste ambiente.")
        })?;
        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({
                    "property_id": prop.id,
                    "property_title": prop.title,
                }),
            )
            .await?;
        info!(integracao = integ.id, property = %prop.id, "channex: propriedade vinculada");
        Ok(())
    }

    /// Opções do mapeamento: lado remoto (room types + rate plans da
    /// propriedade) + lado local (acomodações ativas) + grade atual.
    pub async fn opcoes(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<OpcoesDistribuicao> {
        ator.exigir_gerencial()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let property_id = Self::cfg(&integ, "property_id").map(str::to_string);

        let (room_types, rate_plans) = match &property_id {
            Some(pid) => {
                let rt = cli.room_types(pid).await.unwrap_or_default();
                let rp = cli.rate_plans(pid).await.unwrap_or_default();
                (rt, rp)
            }
            None => (vec![], vec![]),
        };
        let acoms = self
            .acomodacoes
            .listar(true, clarituz_shared::PageParams::default())
            .await?;
        let mapeamentos = self.repo.mapa_listar(integ.id).await?;
        Ok(OpcoesDistribuicao {
            room_types,
            rate_plans,
            acomodacoes: acoms
                .items
                .iter()
                .map(|a| {
                    serde_json::json!({
                        "id": a.id, "nome": a.nome, "numero": a.numero,
                        "capacidade": a.capacidade, "valor": a.valor,
                    })
                })
                .collect(),
            mapeamentos,
            property_id,
            publicacao_pausada: Self::pausada(&integ),
        })
    }

    /// Grade de mapeamento — visão da tela de canais.
    pub async fn mapeamentos(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Vec<MapaDistribuicaoView>> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        Ok(self.repo.mapa_listar(integ.id).await?)
    }

    /// Mapeia acomodação → room type + rate plan — valida que o par
    /// pertence à propriedade vinculada e que o rate plan é do room type.
    pub async fn mapear(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        idacomodacao: i64,
        room_type_id: &str,
        rate_plan_id: &str,
    ) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let property_id = Self::cfg(&integ, "property_id")
            .ok_or_else(|| DomainError::regra("Vincule a propriedade Channex antes de mapear."))?;

        // Validação remota — nunca grava um par que a Channex desconhece.
        let room_types = cli.room_types(property_id).await?;
        if !room_types
            .iter()
            .any(|r| r.id == room_type_id && r.property_id == property_id)
        {
            return Err(
                DomainError::validacao("Room type não pertence à propriedade vinculada.").into(),
            );
        }
        let rate_plans = cli.rate_plans(property_id).await?;
        if !rate_plans
            .iter()
            .any(|r| r.id == rate_plan_id && r.room_type_id == room_type_id)
        {
            return Err(
                DomainError::validacao("Rate plan não pertence ao room type escolhido.").into(),
            );
        }
        let acom = self
            .acomodacoes
            .buscar(idacomodacao)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada."))?;
        if !acom.ativo {
            return Err(DomainError::regra("Acomodação inativa.").into());
        }

        self.repo
            .mapa_salvar(integ.id, idacomodacao, room_type_id, rate_plan_id)
            .await?;
        // Mapeou → publica o estado atual da unidade na janela inteira.
        let hoje = Utc::now().date_naive();
        self.repo
            .outbox_enfileirar(&[NovoOutboxAri {
                idintegracao: integ.id,
                idacomodacao,
                inicio: hoje,
                fim: hoje + chrono::Duration::days(JANELA_MAX_DIAS),
                motivo: "mapeamento".into(),
            }])
            .await?;
        Ok(())
    }

    /// Desmapeia — a unidade para de publicar; reservas já recebidas
    /// continuam vinculadas (histórico nunca é apagado).
    pub async fn desmapear(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        id: i64,
    ) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        // Garante que o mapa é desta integração antes de desativar.
        let mapas = self.repo.mapa_listar(integ.id).await?;
        if !mapas.iter().any(|m| m.id == id) {
            return Err(DomainError::nao_encontrado("Mapeamento não encontrado.").into());
        }
        Ok(self.repo.mapa_desativar(id).await?)
    }

    // -- publicação ARI -----------------------------------------------------

    /// Notificação pós-commit — chamada pelos serviços que alteram
    /// estoque (reserva criada/cancelada, bloqueio). Enfileira só se a
    /// acomodação estiver mapeada em alguma integração habilitada.
    pub async fn notificar_estoque(
        &self,
        idacomodacao: i64,
        inicio: NaiveDate,
        fim: NaiveDate,
        motivo: &str,
    ) {
        let res: AppResult<()> = async {
            for amb in [AmbienteIntegracao::Producao, AmbienteIntegracao::Teste] {
                let Some(integ) = self
                    .integracoes
                    .buscar(ProvedorIntegracao::Channex, amb)
                    .await?
                else {
                    continue;
                };
                if !integ.habilitado {
                    continue;
                }
                if self
                    .repo
                    .mapa_por_acomodacao(integ.id, idacomodacao)
                    .await?
                    .map(|m| m.ativo)
                    .unwrap_or(false)
                {
                    self.repo
                        .outbox_enfileirar(&[NovoOutboxAri {
                            idintegracao: integ.id,
                            idacomodacao,
                            inicio,
                            fim,
                            motivo: motivo.to_string(),
                        }])
                        .await?;
                }
            }
            Ok(())
        }
        .await;
        if let Err(e) = res {
            warn!(erro = %e, idacomodacao, "channex: falha ao enfileirar outbox");
        }
    }

    /// Sincronização manual de um período — enfileira todas as
    /// acomodações mapeadas e drena em seguida.
    pub async fn sincronizar(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> AppResult<u32> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        if fim <= inicio || (fim - inicio).num_days() > JANELA_MAX_DIAS {
            return Err(DomainError::validacao("Período inválido — máximo de 370 dias.").into());
        }
        let mapas = self.repo.mapa_ativos(integ.id).await?;
        let itens: Vec<NovoOutboxAri> = mapas
            .iter()
            .map(|m| NovoOutboxAri {
                idintegracao: integ.id,
                idacomodacao: m.idacomodacao,
                inicio,
                fim,
                motivo: "sincronizacao_manual".into(),
            })
            .collect();
        let n = itens.len() as u32;
        self.repo.outbox_enfileirar(&itens).await?;
        Ok(n)
    }

    /// Pausa/retoma a publicação — **não** fecha vendas nas OTAs nem
    /// interrompe o recebimento (feed segue importando). Retomar deve
    /// ser seguido de `reconciliar` pra republicar o estado atual.
    pub async fn pausar_publicacao(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        pausada: bool,
    ) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({ "publicacao_pausada": pausada }),
            )
            .await?;
        Ok(())
    }

    /// Reconciliação: enfileira a janela inteira + puxa o feed —
    /// usada ao retomar de pausa ou quando se suspeita de perda.
    pub async fn reconciliar(&self, ator: &Ator, ambiente: AmbienteIntegracao) -> AppResult<u32> {
        let hoje = Utc::now().date_naive();
        let n = self
            .sincronizar(
                ator,
                ambiente,
                hoje,
                hoje + chrono::Duration::days(JANELA_MAX_DIAS),
            )
            .await?;
        // Feed — traz o que o webhook perdeu.
        let _ = self.poll_feed().await;
        Ok(n)
    }

    /// Drena o outbox (worker + pós-sync): recalcula estado atual e
    /// envia availability + restrictions por acomodação.
    pub async fn drenar_outbox(&self) -> AppResult<u32> {
        let itens = self.repo.outbox_drenar(20).await?;
        let mut enviados = 0u32;
        // Agrupa por integração — um cliente por ambiente.
        let mut por_integ: HashMap<i64, Vec<NovoOutboxAri>> = HashMap::new();
        for i in itens {
            por_integ.entry(i.idintegracao).or_default().push(i);
        }
        for (idint, lote) in por_integ {
            let Some((integ, cli)) = self.cliente_habilitado_por_id(idint).await? else {
                continue; // integração removida/desabilitada — descarta lote
            };
            if Self::pausada(&integ) {
                // Publicação pausada — descarta: o estado republica na
                // reconciliação do retomo (regrava a janela inteira).
                continue;
            }
            let Some(property_id) = Self::cfg(&integ, "property_id").map(str::to_string) else {
                continue;
            };

            for item in lote {
                match self
                    .enviar_ari(
                        &integ,
                        &cli,
                        &property_id,
                        item.idacomodacao,
                        item.inicio,
                        item.fim,
                    )
                    .await
                {
                    Ok(_) => enviados += 1,
                    Err(ErroDistribuicao::RateLimit { .. })
                    | Err(ErroDistribuicao::Transiente(_)) => {
                        // Transiente → reenfileira com contador; estourou
                        // o limite → pendência (não gira pra sempre).
                        let tentativas = retry_de(&item.motivo) + 1;
                        if tentativas >= RETRY_MAX {
                            self.falhou_envio(
                                &integ,
                                &format!(
                                    "envio ARI excedeu retentativas ({} tentativas)",
                                    tentativas
                                ),
                                &item,
                            )
                            .await?;
                        } else {
                            let mut item = item;
                            item.motivo =
                                format!("retry:{tentativas} · {}", motivo_base(&item.motivo));
                            self.repo.outbox_enfileirar(&[item]).await?;
                        }
                    }
                    Err(e) => {
                        self.falhou_envio(&integ, &e.to_string(), &item).await?;
                    }
                }
            }
        }
        Ok(enviados)
    }

    async fn falhou_envio(
        &self,
        integ: &Integracao,
        erro: &str,
        item: &NovoOutboxAri,
    ) -> AppResult<()> {
        warn!(integracao = integ.id, erro, "channex: envio ARI falhou");
        self.repo
            .pendencia(
                integ.id,
                "envio_falhou",
                &format!(
                    "Falha ao publicar acomodação {}: {}",
                    item.idacomodacao, erro
                ),
                None,
                &serde_json::json!({
                    "idacomodacao": item.idacomodacao,
                    "inicio": item.inicio, "fim": item.fim,
                    "motivo": item.motivo, "erro": erro,
                }),
            )
            .await?;
        Ok(())
    }

    /// Computa e envia ARI de UMA acomodação numa janela:
    /// - `availability` 0/1 por dia (reservas 'p'/'i' + bloqueios);
    /// - `restrictions` com a tarifa da acomodação (per-room) ou a
    ///   escada por ocupação (rate plan per_occupancy).
    async fn enviar_ari(
        &self,
        integ: &Integracao,
        cli: &Arc<dyn ProvedorDistribuicao>,
        property_id: &str,
        idacomodacao: i64,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> Result<(), ErroDistribuicao> {
        let mapa = self
            .repo
            .mapa_por_acomodacao(integ.id, idacomodacao)
            .await
            .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?;
        let Some(mapa) = mapa.filter(|m| m.ativo) else {
            return Ok(()); // desmapeada — nada a publicar
        };
        let acom = self
            .acomodacoes
            .buscar(idacomodacao)
            .await
            .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?
            .ok_or_else(|| ErroDistribuicao::Definitivo("acomodação removida".into()))?;

        // Disponibilidade por dia — dias ocupados vêm do banco.
        let ocupados: std::collections::HashSet<NaiveDate> = self
            .repo
            .ocupacao_dias(idacomodacao, inicio, fim)
            .await
            .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?
            .into_iter()
            .collect();

        // Agrupa em janelas contíguas do mesmo valor — 1 value por run.
        let mut valores_av: Vec<DisponibilidadeValor> = Vec::new();
        let mut d = inicio;
        while d <= fim {
            let disponivel = !ocupados.contains(&d) && acom.ativo;
            let ini_run = d;
            while d <= fim && (!ocupados.contains(&d) && acom.ativo) == disponivel {
                d += chrono::Duration::days(1);
            }
            valores_av.push(DisponibilidadeValor {
                property_id: property_id.to_string(),
                room_type_id: mapa.room_type_id.clone(),
                date_from: ini_run,
                date_to: d - chrono::Duration::days(1),
                availability: if disponivel { 1 } else { 0 },
            });
        }
        // Envia em fatias — um POST por room type já é um lote grande.
        for fatia in valores_av.chunks(50) {
            let resp = cli.enviar_disponibilidade(fatia).await?;
            self.repo
                .envio_registrar(
                    integ.id,
                    "availability",
                    &serde_json::to_value(fatia).unwrap_or_default(),
                    &serde_json::to_value(&resp.data).unwrap_or_default(),
                    &serde_json::to_value(&resp.meta.warnings).unwrap_or_default(),
                )
                .await
                .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?;
            if !resp.meta.warnings.is_empty() {
                self.repo
                    .pendencia(
                        integ.id,
                        "envio_parcial",
                        &format!(
                            "Aceite parcial em availability da acomodação {}: {} aviso(s)",
                            idacomodacao,
                            resp.meta.warnings.len()
                        ),
                        None,
                        &serde_json::to_value(&resp.meta.warnings).unwrap_or_default(),
                    )
                    .await
                    .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?;
            }
        }

        // Tarifa — diária da ocupação cheia do tipo; senão, valor base.
        let rate = diaria_acomodacao(&self.acomodacoes, &acom).await;
        let restricao = RestricaoValor {
            property_id: property_id.to_string(),
            rate_plan_id: mapa.rate_plan_id.clone(),
            date_from: inicio,
            date_to: fim,
            rate: Some(rate),
            rates: None,
            min_stay_through: None,
            closed_to_arrival: None,
            closed_to_departure: None,
            stop_sell: None,
        };
        let resp = cli.enviar_restricoes(&[restricao.clone()]).await?;
        self.repo
            .envio_registrar(
                integ.id,
                "restrictions",
                &serde_json::to_value(&[restricao]).unwrap_or_default(),
                &serde_json::to_value(&resp.data).unwrap_or_default(),
                &serde_json::to_value(&resp.meta.warnings).unwrap_or_default(),
            )
            .await
            .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?;
        if !resp.meta.warnings.is_empty() {
            self.repo
                .pendencia(
                    integ.id,
                    "envio_parcial",
                    &format!(
                        "Aceite parcial em restrictions da acomodação {}: {} aviso(s)",
                        idacomodacao,
                        resp.meta.warnings.len()
                    ),
                    None,
                    &serde_json::to_value(&resp.meta.warnings).unwrap_or_default(),
                )
                .await
                .map_err(|e| ErroDistribuicao::Definitivo(e.to_string()))?;
        }
        Ok(())
    }

    // -- inbound: feed + webhook + aplicação de revisões -----------------

    /// Poll do feed — fonte primária: traz revisões não-ACK e aplica.
    /// Roda em worker e na reconciliação manual.
    pub async fn poll_feed(&self) -> AppResult<u32> {
        let mut importadas = 0u32;
        for amb in [AmbienteIntegracao::Producao, AmbienteIntegracao::Teste] {
            let Ok((integ, cli)) = self.cliente(amb, true).await else {
                continue; // não configurada/desabilitada — próximo ambiente
            };
            let Some(property_id) = Self::cfg(&integ, "property_id").map(str::to_string) else {
                continue;
            };
            let revisoes = match cli.feed_revisoes(&property_id).await {
                Ok(r) => r,
                Err(e) => {
                    warn!(ambiente = amb.as_str(), erro = %e, "channex: feed falhou");
                    continue;
                }
            };
            for rev in revisoes {
                match self.ingerir(&integ, &cli, rev).await {
                    Ok(ResultadoRevisao::Aplicada) => importadas += 1,
                    Ok(_) => {}
                    Err(e) => warn!(erro = %e, "channex: ingestão falhou"),
                }
            }
        }
        Ok(importadas)
    }

    /// Webhook recebido — o evento carrega só o id; sempre lê a revisão
    /// autenticada (entrega é sinal, nunca verdade — doc. oficial).
    pub async fn webhook_receber(
        &self,
        ambiente: AmbienteIntegracao,
        payload: &serde_json::Value,
    ) -> AppResult<ResultadoRevisao> {
        if payload["event"].as_str() != Some("booking_revision") {
            return Ok(ResultadoRevisao::Duplicada); // evento não-reativo — ignora
        }
        let (integ, cli) = self.cliente(ambiente, true).await?;
        // property_id do envelope deve bater com o da integração —
        // entrega de propriedade alheia é descartada sem efeito.
        let prop_envelope = payload["property_id"].as_str().unwrap_or_default();
        let prop_cfg = Self::cfg(&integ, "property_id").unwrap_or_default();
        if !prop_cfg.is_empty() && prop_envelope != prop_cfg {
            warn!(
                envelope = prop_envelope,
                "channex: webhook de propriedade divergente"
            );
            return Ok(ResultadoRevisao::Duplicada);
        }
        let revision_id = payload["payload"]["id"]
            .as_str()
            .or_else(|| payload["payload"]["booking_revision_id"].as_str())
            .ok_or_else(|| DomainError::validacao("webhook sem revision id"))?;
        let rev = cli.revisao(revision_id).await?;
        self.ingerir(&integ, &cli, rev).await
    }

    /// Persiste → aplica → confirma. Dedup torna feed+webhook e retry
    /// seguros; um dedup-hit com ACK pendente reenvia o ACK (falha após
    /// o commit local nunca reimporta nem duplica reserva).
    async fn ingerir(
        &self,
        integ: &Integracao,
        cli: &Arc<dyn ProvedorDistribuicao>,
        rev: RevisaoRemota,
    ) -> AppResult<ResultadoRevisao> {
        let nova = self.repo.revisao_inserir(integ.id, &rev).await?;
        if !nova {
            // Já vista — recupera ACK pendente se aplicada e não-acked.
            if let Some(existente) = self.repo.revisao_por_id_remoto(integ.id, &rev.id).await? {
                if existente.aplicada && !existente.ack {
                    if cli.ack_revisao(&rev.id).await.is_ok() {
                        self.repo.revisao_marcar_ack(existente.id).await?;
                    }
                }
            }
            return Ok(ResultadoRevisao::Duplicada);
        }

        // Property divergente (webhook global) — grava e pendencia.
        let prop_cfg = Self::cfg(integ, "property_id").unwrap_or_default();
        if !prop_cfg.is_empty() && rev.property_id != prop_cfg {
            self.marcar_pendente(
                integ.id,
                &rev,
                "propriedade_desconhecida",
                "Revisão de propriedade que não é a vinculada.",
            )
            .await?;
            return Ok(ResultadoRevisao::Pendente);
        }

        // Stale: revisão mais antiga que a última aplicada do booking —
        // nunca regride estado.
        if let Some(booking_id) = &rev.booking_id {
            if let Some(ultima) = self
                .repo
                .revisao_mais_recente_do_booking(integ.id, booking_id)
                .await?
            {
                let stale = match (rev.inserted_at, ultima.inserted_at) {
                    (Some(novo), Some(ant)) => novo < ant,
                    _ => false,
                };
                if stale {
                    let local = self
                        .repo
                        .revisao_por_id_remoto(integ.id, &rev.id)
                        .await?
                        .ok_or_else(|| DomainError::regra("revisão sumiu"))?;
                    self.repo
                        .revisao_marcar(local.id, true, Some("revisão obsoleta — superseded"))
                        .await?;
                    if cli.ack_revisao(&rev.id).await.is_ok() {
                        self.repo.revisao_marcar_ack(local.id).await?;
                    }
                    return Ok(ResultadoRevisao::Duplicada);
                }
            }
        }

        let resultado = self.aplicar_revisao(integ, &rev).await;
        let local = self
            .repo
            .revisao_por_id_remoto(integ.id, &rev.id)
            .await?
            .ok_or_else(|| DomainError::regra("revisão sumiu"))?;
        match resultado {
            Ok(()) => {
                self.repo.revisao_marcar(local.id, true, None).await?;
                if cli.ack_revisao(&rev.id).await.is_ok() {
                    self.repo.revisao_marcar_ack(local.id).await?;
                } else {
                    // ACK falhou — dedup-hit do próximo poll reenvia.
                    warn!(revision = %rev.id, "channex: ack falhou após commit");
                }
                Ok(ResultadoRevisao::Aplicada)
            }
            Err(e) => {
                self.repo
                    .revisao_marcar(local.id, false, Some(&e.to_string()))
                    .await?;
                Err(e)
            }
        }
    }

    async fn marcar_pendente(
        &self,
        idintegracao: i64,
        rev: &RevisaoRemota,
        tipo: &str,
        descricao: &str,
    ) -> AppResult<()> {
        let local = self
            .repo
            .revisao_por_id_remoto(idintegracao, &rev.id)
            .await?;
        if let Some(l) = &local {
            self.repo
                .revisao_marcar(l.id, false, Some(descricao))
                .await?;
        }
        self.repo
            .pendencia(idintegracao, tipo, descricao, Some(&rev.id), &rev.raw)
            .await?;
        Ok(())
    }

    /// Aplica a revisão ao inventário — new/modified/cancelled.
    async fn aplicar_revisao(&self, integ: &Integracao, rev: &RevisaoRemota) -> AppResult<()> {
        match rev.status.as_str() {
            "new" | "modified" => self.importar_reservas(integ, rev).await,
            "cancelled" => self.cancelar_reservas(integ, rev).await,
            outro => {
                Err(DomainError::regra(format!("status de revisão desconhecido: {outro}")).into())
            }
        }
    }

    /// Importa/atualiza: `new` cria; `modified` cancela os itens
    /// vinculados e reimporta (categoria/datas/quantidade podem mudar —
    /// recriar é a única forma consistente com a constraint de overlap).
    async fn importar_reservas(&self, integ: &Integracao, rev: &RevisaoRemota) -> AppResult<()> {
        let booking_id = rev
            .booking_id
            .clone()
            .or_else(|| rev.unique_id.clone())
            .unwrap_or_else(|| rev.id.clone());

        // modified → cancela os vínculos anteriores antes de reimportar.
        if rev.status == "modified" {
            self.cancelar_vinculos(integ, &booking_id, "revisão modified")
                .await?;
        }

        if rev.rooms.is_empty() {
            return Err(DomainError::regra("revisão sem quartos").into());
        }
        let idcliente = self.cliente_ota(rev).await?;

        let mut erros: Vec<String> = Vec::new();
        for room in &rev.rooms {
            let Some(mapa) = self
                .repo
                .mapa_por_room_type(integ.id, room.room_type_id.as_deref().unwrap_or_default())
                .await?
            else {
                erros.push(format!(
                    "room_type {} sem mapeamento",
                    room.room_type_id.as_deref().unwrap_or("?")
                ));
                continue;
            };

            let noites = (room.checkout_date - room.checkin_date).num_days().max(1);
            // Diária média da OTA (dias variáveis preservados no vínculo).
            let total_quarto = room
                .amount
                .or_else(|| {
                    let s: Decimal = room.days.values().copied().sum();
                    (s > Decimal::ZERO).then_some(s)
                })
                .unwrap_or(Decimal::ZERO);
            let diaria = if total_quarto > Decimal::ZERO {
                total_quarto / Decimal::from(noites)
            } else {
                self.acomodacoes
                    .buscar(mapa.idacomodacao)
                    .await?
                    .map(|a| a.valor)
                    .unwrap_or(Decimal::ZERO)
            };
            let hospedes = room
                .occupancy
                .as_ref()
                .map(|o| o.adults + o.children + o.infants)
                .unwrap_or(1)
                .max(1);

            let nova = clarituz_domain::ports::NovaReserva {
                idacomodacao: mapa.idacomodacao,
                idcliente,
                quantidade_hospedes: hospedes,
                periodo: PeriodoEstadia::new(room.checkin_date, room.checkout_date)?,
                obs: Some(format!(
                    "OTA {} · reserva {} · {}",
                    rev.ota_name.as_deref().unwrap_or("OTA"),
                    rev.ota_reservation_code.as_deref().unwrap_or("-"),
                    rev.notes.as_deref().unwrap_or_default()
                )),
                valordiaria: diaria,
                valor_total: total_quarto.max(diaria * Decimal::from(noites)),
                early_checkin: false,
                late_checkout: false,
                expira_em: None,
                idoperadora: None,
                idcontrato: None,
            };
            let log = NovoLog {
                idfuncionario: None,
                acao: "reserva_ota".into(),
                obs: format!(
                    "reserva {} via {} (revisão {})",
                    booking_id,
                    rev.ota_name.as_deref().unwrap_or("OTA"),
                    rev.id
                ),
                tabela: "reserva",
                idtabela: 0,
                dados: Some(rev.raw.clone()),
            };
            match self.reservas.criar(&nova, log).await {
                Ok(reserva) => {
                    self.repo
                        .reserva_vincular(
                            integ.id,
                            reserva.id,
                            &booking_id,
                            rev.ota_name.as_deref(),
                            rev.ota_reservation_code.as_deref(),
                            &serde_json::json!({
                                "revision_id": rev.id,
                                "room_type_id": room.room_type_id,
                                "rate_plan_id": room.rate_plan_id,
                                "days": room.days,
                                "amount": room.amount,
                                "currency": rev.currency,
                                "payment_collect": rev.payment_collect,
                                "payment_type": rev.payment_type,
                                "occupancy": room.occupancy,
                                "arrival_hour": rev.raw["arrival_hour"],
                            }),
                        )
                        .await?;
                }
                Err(e) => erros.push(format!("acom {}: {e}", mapa.idacomodacao)),
            }
        }

        if !erros.is_empty() {
            // Conflito explícito — nunca silêncio: pendência descreve
            // cada quarto que não entrou (o operador realoca ou aciona
            // a OTA). Revisão fica sem ACK → feed reprocessa quando
            // o mapeamento/estoque for corrigido.
            let desc = erros.join("; ");
            self.repo
                .pendencia(
                    integ.id,
                    "importacao_incompleta",
                    &format!("Revisão {} parcialmente importada: {}", rev.id, desc),
                    Some(&rev.id),
                    &serde_json::json!({ "booking_id": booking_id, "erros": erros }),
                )
                .await?;
            return Err(DomainError::regra(format!("importação parcial — {desc}")).into());
        }
        info!(booking = %booking_id, revisao = %rev.id, "channex: revisão aplicada");
        Ok(())
    }

    /// Cancela os vínculos do booking — o cancelamento OTA nunca gera
    /// compensação financeira (a conta está 'pendente' sem pagamento).
    async fn cancelar_reservas(&self, integ: &Integracao, rev: &RevisaoRemota) -> AppResult<()> {
        let booking_id = rev
            .booking_id
            .clone()
            .or_else(|| rev.unique_id.clone())
            .unwrap_or_else(|| rev.id.clone());
        self.cancelar_vinculos(integ, &booking_id, "cancelado na OTA")
            .await
    }

    async fn cancelar_vinculos(
        &self,
        integ: &Integracao,
        booking_id: &str,
        motivo: &str,
    ) -> AppResult<()> {
        let vinculos = self.repo.reserva_vinculo(integ.id, booking_id).await?;
        for v in vinculos {
            let Some(r) = self.reservas.buscar(v.idreserva).await? else {
                continue;
            };
            // 'pendente' cancela; 'iniciada' (hóspede na casa) não é
            // desfeita pela OTA — pendência operacional decide.
            match r.status {
                StatusReserva::Pendente => {
                    let log = NovoLog {
                        idfuncionario: None,
                        acao: "cancelamento_ota".into(),
                        obs: format!("booking {booking_id} — {motivo}"),
                        tabela: "reserva",
                        idtabela: r.id,
                        dados: None,
                    };
                    self.reservas
                        .cancelar(r.id, Some(motivo), None, log)
                        .await?;
                }
                StatusReserva::Iniciada => {
                    self.repo
                        .pendencia(
                            integ.id,
                            "cancelamento_em_estadia",
                            &format!(
                                "Reserva {} (booking {}) em estadia recebeu {} — decidir na recepção.",
                                r.id, booking_id, motivo
                            ),
                            None,
                            &serde_json::json!({ "idreserva": r.id, "booking_id": booking_id }),
                        )
                        .await?;
                }
                _ => {} // já cancelada/finalizada — idempotente
            }
        }
        Ok(())
    }

    /// Hóspede da OTA → cliente local. CPF é desconhecido — a chave de
    /// dedup é o e-mail (mesma regra do site); o `cpf` gravado é um
    /// placeholder `OTA-{reserva}` único por booking.
    async fn cliente_ota(&self, rev: &RevisaoRemota) -> AppResult<i64> {
        let (nome, email, telefone) = match &rev.customer {
            Some(c) => (
                format!(
                    "{} {}",
                    c["name"].as_str().unwrap_or_default(),
                    c["surname"].as_str().unwrap_or_default()
                )
                .trim()
                .to_string(),
                c["mail"].as_str().unwrap_or_default().to_string(),
                c["phone"].as_str().unwrap_or_default().to_string(),
            ),
            None => (String::new(), String::new(), String::new()),
        };
        let cpf = format!(
            "OTA-{}",
            rev.ota_reservation_code
                .as_deref()
                .unwrap_or(&rev.id)
                .chars()
                .take(20)
                .collect::<String>()
        );
        Ok(self
            .clientes
            .site_upsert(&NovoClienteSite {
                nome: if nome.is_empty() {
                    format!("Hóspede {}", rev.ota_name.as_deref().unwrap_or("OTA"))
                } else {
                    nome
                },
                cpf,
                cpf_busca: None,
                email,
                telefone,
            })
            .await?)
    }

    // -- leituras operacionais ----------------------------------------------

    pub async fn revisoes(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Vec<RevisaoDistribuicao>> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        Ok(self.repo.revisao_listar(integ.id, 100).await?)
    }

    pub async fn pendencias(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        abertas: bool,
    ) -> AppResult<Vec<PendenciaDistribuicao>> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        Ok(self.repo.pendencias(integ.id, abertas).await?)
    }

    pub async fn resolver_pendencia(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        Ok(self.repo.pendencia_resolver(id).await?)
    }

    pub async fn envios(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Vec<EnvioDistribuicao>> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        Ok(self.repo.envio_listar(integ.id, 50).await?)
    }

    pub async fn resumo(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<ResumoDistribuicao> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        Ok(self.repo.resumo(integ.id).await?)
    }

    /// Reprocessa uma revisão gravada — usado pelo operador depois de
    /// corrigir mapeamento/estoque. Aplica do payload persistido e,
    /// quando aplicada, ack remoto.
    pub async fn reprocessar_revisao(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        revision_id: &str,
    ) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let local = self
            .repo
            .revisao_por_id_remoto(integ.id, revision_id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Revisão não encontrada."))?;
        if local.aplicada {
            return Err(DomainError::regra("Revisão já aplicada.").into());
        }
        let rev: RevisaoRemota = serde_json::from_value(local.payload.clone())
            .map_err(|e| DomainError::regra(format!("payload ilegível: {e}")))?;
        self.aplicar_revisao(&integ, &rev).await?;
        self.repo.revisao_marcar(local.id, true, None).await?;
        if !local.ack && cli.ack_revisao(revision_id).await.is_ok() {
            self.repo.revisao_marcar_ack(local.id).await?;
        }
        Ok(())
    }

    // -- webhook + iframe --------------------------------------------------

    /// Segredo HMAC da assinatura — rota pública verifica antes de
    /// qualquer efeito no CRM.
    pub async fn webhook_secret(&self, ambiente: AmbienteIntegracao) -> AppResult<Option<String>> {
        let integ = self.integracao(ambiente).await?;
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        self.segredo_aberto(&integ, "webhook_secret", &enc)
    }

    /// Registra o webhook assinado na Channex e guarda o segredo no
    /// cofre (a signing key só é exibida uma vez).
    pub async fn registrar_webhook(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        base_publica: &str,
    ) -> AppResult<String> {
        ator.exigir_admin()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let property_id = Self::cfg(&integ, "property_id").ok_or_else(|| {
            DomainError::regra("Vincule a propriedade antes de registrar o webhook.")
        })?;
        let url = format!(
            "{}/api/v1/webhooks/channex/{}",
            base_publica.trim_end_matches('/'),
            ambiente.as_str()
        );
        let (webhook_id, secret) = cli.registrar_webhook(property_id, &url).await?;

        let mut mapa = HashMap::new();
        if let Some(sec) = &secret {
            mapa.insert(
                "webhook_secret".to_string(),
                self.vault.selar(
                    &contexto_aad(integ.provedor, integ.ambiente, "webhook_secret", integ.id),
                    sec,
                )?,
            );
        }
        self.integracoes
            .salvar(
                integ.id,
                integ.versao,
                &AtualizacaoIntegracao {
                    segredos: None,
                    nome_conta: None,
                    webhook_url: Some(url.clone()),
                    config: None,
                },
                &mapa,
                Some(ator.id),
            )
            .await?;
        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({
                    "webhook_registrado": true,
                    "webhook_id": webhook_id,
                    "webhook_assinado": secret.is_some(),
                }),
            )
            .await?;
        if secret.is_none() {
            self.repo
                .pendencia(
                    integ.id,
                    "webhook_sem_assinatura",
                    "Webhook criado sem signing key — crie a chave na conta Channex \
                     e cole o segredo em 'Webhook signing secret' para validação HMAC.",
                    None,
                    &serde_json::json!({ "webhook_id": webhook_id }),
                )
                .await?;
        }
        info!(integracao = integ.id, "channex: webhook registrado");
        Ok(url)
    }

    /// Token do Channel IFrame — temporário, nunca a API key; só chega
    /// ao frontend depois de validar admin + propriedade no backend.
    pub async fn token_iframe(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<TokenCanal> {
        ator.exigir_gerencial()?;
        let (integ, cli) = self.cliente(ambiente, true).await?;
        let property_id = Self::cfg(&integ, "property_id").ok_or_else(|| {
            DomainError::regra("Vincule a propriedade antes de gerenciar canais.")
        })?;
        Ok(cli.token_iframe(property_id).await?)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn contexto_aad(p: ProvedorIntegracao, a: AmbienteIntegracao, campo: &str, id: i64) -> String {
    format!("{}|{}|{campo}|{id}", p.as_str(), a.as_str())
}

/// `retry:N · motivo` → N. Motivo sem prefixo → 0.
fn retry_de(motivo: &str) -> u32 {
    motivo
        .strip_prefix("retry:")
        .and_then(|r| r.split(' ').next())
        .and_then(|n| n.trim_end_matches('·').trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// Motivo sem o prefixo `retry:N ·`.
fn motivo_base(motivo: &str) -> &str {
    motivo
        .split_once('·')
        .map(|(_, resto)| resto.trim())
        .unwrap_or(motivo)
}

/// Tarifa da acomodação: escada `tarifa_ocupacao` na capacidade cheia;
/// fallback `acomodacao.valor`.
async fn diaria_acomodacao(acoms: &Arc<dyn AcomodacaoRepository>, acom: &Acomodacao) -> Decimal {
    if let Some(idtipo) = acom.idtipo_acomodacao {
        if let Ok(Some(v)) = acoms.diaria_para_ocupacao(idtipo, acom.capacidade).await {
            return v;
        }
    }
    acom.valor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_counter() {
        assert_eq!(retry_de("mapeamento"), 0);
        assert_eq!(retry_de("retry:3 · reserva_ota"), 3);
        assert_eq!(motivo_base("retry:3 · reserva_ota"), "reserva_ota");
        assert_eq!(motivo_base("mapeamento"), "mapeamento");
    }
}
