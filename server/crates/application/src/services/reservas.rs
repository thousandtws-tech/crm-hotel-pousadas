//! Casos de uso do agregado Reserva — ciclo de vida completo:
//! criação, check-in, check-out, cancelamento, consumo e disponibilidade.
//!
//! O faturamento é **server-authoritative**: o cliente informa forma de
//! pagamento, desconto e adicionais; o servidor calcula `valor_final` a
//! partir dos dados persistidos — nunca confia em totais do cliente.

use crate::actor::Ator;
use crate::dto::{
    AcompanhanteInput, AdicionalInput, CancelamentoResponse, CancelarReservaRequest,
    CheckoutRequest, DisponibilidadeResponse, FnrhEmitRequest, GrupoInput, ItemConsumidoRequest,
    ReservaInput, ReservaPublicaInput, ReservaPublicaOutput,
};
use crate::error::AppResult;
use crate::services::AuthService;
use chrono::{Duration, NaiveDate, Utc};
use clarituz_domain::entities::{
    Acompanhante, AdicionalConsumo, Bloqueio, Cliente, Consumo, Fnrh, Grupo, GrupoUnidadeView,
    ItemConsumido, NovoLog, Reserva,
};
use clarituz_domain::enums::StatusReserva;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    AcomodacaoRepository, AcompanhanteRepository, ClienteRepository, ComandoCheckout,
    ContratoRepository, EstabelecimentoRepository, EventoPublisher, FilaEnvioRepository,
    FiltroReserva, FnrhRepository, FormaPagamentoRepository, ImpressoraGateway,
    ImpressoraRepository, LgpdRepository, LinhaRecibo, NovaFnrh, NovaReserva, NovoAcompanhante,
    NovoAdicional, NovoClienteSite, NovoItemConsumido, ReservaRepository,
};
use clarituz_domain::queries::{ComprovanteResumo, MapaQuarto, ReservaDetalhe, ReservaResumo};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{ids, money, time, Page, PageParams};
use rust_decimal::Decimal;
use serde_json::json;
use std::fmt::Write as _;
use std::sync::Arc;
use tracing::instrument;

/// Dependências do serviço de reservas — agrupadas para manter o
/// construtor enxuto conforme novos ports são adicionados.
pub struct ReservaDeps {
    pub reservas: Arc<dyn ReservaRepository>,
    pub acomodacoes: Arc<dyn AcomodacaoRepository>,
    pub clientes: Arc<dyn ClienteRepository>,
    pub pagamentos: Arc<dyn FormaPagamentoRepository>,
    pub estabelecimentos: Arc<dyn EstabelecimentoRepository>,
    pub impressoras: Arc<dyn ImpressoraRepository>,
    pub impressora: Arc<dyn ImpressoraGateway>,
    pub auth: Arc<AuthService>,
    /// Motor realtime — avisos semânticos (toast dos outros usuários).
    pub eventos: Arc<dyn EventoPublisher>,
    pub acompanhantes: Arc<dyn AcompanhanteRepository>,
    pub fnrh: Arc<dyn FnrhRepository>,
    /// ECA/LGPD — autorização de menor + aceite de termos.
    pub lgpd: Arc<dyn LgpdRepository>,
    /// Fila de envio — relatório de fechamento por e-mail.
    pub fila: Arc<dyn FilaEnvioRepository>,
    /// Contratos corporativos — desconto por código no motor público.
    pub contratos: Arc<dyn ContratoRepository>,
    /// Minutos do hold de pagamento nas reservas criadas pelo site.
    pub hold_minutos: i64,
    /// Distribuição (Channex) — notifica mudança de estoque pós-commit.
    pub dist: Option<Arc<crate::services::channex::ChannexService>>,
}

pub struct ReservaService {
    reservas: Arc<dyn ReservaRepository>,
    acomodacoes: Arc<dyn AcomodacaoRepository>,
    clientes: Arc<dyn ClienteRepository>,
    pagamentos: Arc<dyn FormaPagamentoRepository>,
    estabelecimentos: Arc<dyn EstabelecimentoRepository>,
    impressoras: Arc<dyn ImpressoraRepository>,
    impressora: Arc<dyn ImpressoraGateway>,
    auth: Arc<AuthService>,
    eventos: Arc<dyn EventoPublisher>,
    acompanhantes: Arc<dyn AcompanhanteRepository>,
    fnrh: Arc<dyn FnrhRepository>,
    lgpd: Arc<dyn LgpdRepository>,
    fila: Arc<dyn FilaEnvioRepository>,
    contratos: Arc<dyn ContratoRepository>,
    hold_minutos: i64,
    dist: Option<Arc<crate::services::channex::ChannexService>>,
}

impl ReservaService {
    pub fn new(d: ReservaDeps) -> Self {
        Self {
            eventos: d.eventos,
            reservas: d.reservas,
            acomodacoes: d.acomodacoes,
            clientes: d.clientes,
            pagamentos: d.pagamentos,
            estabelecimentos: d.estabelecimentos,
            impressoras: d.impressoras,
            impressora: d.impressora,
            auth: d.auth,
            acompanhantes: d.acompanhantes,
            fnrh: d.fnrh,
            lgpd: d.lgpd,
            fila: d.fila,
            contratos: d.contratos,
            hold_minutos: d.hold_minutos,
            dist: d.dist,
        }
    }

    /// Enfileira a mudança de estoque na outbox da distribuição —
    /// melhor esforço pós-commit; falha nunca desfaz a reserva.
    async fn notificar_distribuicao(
        &self,
        idacomodacao: i64,
        ini: chrono::NaiveDate,
        fim: chrono::NaiveDate,
        motivo: &str,
    ) {
        if let Some(d) = &self.dist {
            d.notificar_estoque(idacomodacao, ini, fim, motivo).await;
        }
    }

    pub async fn buscar(&self, id: i64) -> AppResult<Reserva> {
        self.reservas
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada.").into())
    }

    pub async fn detalhe(&self, id: i64) -> AppResult<ReservaDetalhe> {
        self.reservas
            .buscar_detalhe(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada.").into())
    }

    /// Comprovantes de reservas finalizadas (página Pagamentos do legado).
    pub async fn comprovantes(&self) -> AppResult<Vec<ComprovanteResumo>> {
        self.reservas.comprovantes().await.map_err(Into::into)
    }

    /// Recibo em texto puro gerado a partir dos dados persistidos —
    /// substitui o PDF estático do legado (sempre consistente com a conta).
    /// Retorna `(nome_do_arquivo, conteúdo)`.
    pub async fn comprovante_texto(&self, id: i64) -> AppResult<(String, String)> {
        use std::fmt::Write as _;

        let det = self.detalhe(id).await?;
        let consumo = det
            .consumo
            .ok_or_else(|| DomainError::regra("Reserva sem conta de consumo."))?;

        let arquivo = consumo
            .comprovante
            .clone()
            .unwrap_or_else(|| format!("comprovante_{id}.txt"));

        let itens = self
            .reservas
            .listar_itens_consumidos(consumo.id)
            .await
            .unwrap_or_default();
        let adicionais = self
            .reservas
            .listar_adicionais(consumo.id)
            .await
            .unwrap_or_default();

        let mut s = String::new();
        let linha = |s: &mut String| s.push_str("----------------------------------------\n");
        linha(&mut s);
        s.push_str("          COMPROVANTE DE PAGAMENTO\n");
        linha(&mut s);
        let _ = writeln!(s, "Reserva Nº: {}", det.id);
        let _ = writeln!(s, "Cliente:    {}", det.cliente_nome);
        let _ = writeln!(
            s,
            "Acomodação: {} (Nº {})",
            det.acomodacao_nome, det.acomodacao_numero
        );
        let _ = writeln!(
            s,
            "Período:    {} a {}",
            det.entradaprevista.format("%d/%m/%Y"),
            det.saidaprevista.format("%d/%m/%Y")
        );
        linha(&mut s);
        let _ = writeln!(
            s,
            "Estadia ({} diária(s) x R$ {}): R$ {}",
            time::diarias(det.entradaprevista, det.saidaprevista),
            det.valordiaria,
            consumo.valor_estadia
        );
        for i in &itens {
            let _ = writeln!(
                s,
                "  {} x{} ............ R$ {}",
                i.nome, i.quantidade, i.valor_total
            );
        }
        if !itens.is_empty() {
            let total_itens = money::sum(itens.iter().map(|i| &i.valor_total));
            let _ = writeln!(s, "Itens: R$ {total_itens}");
        }
        for a in &adicionais {
            let _ = writeln!(s, "  {} ............. R$ {}", a.motivo, a.valor);
        }
        if consumo.total_desconto > Decimal::ZERO {
            let _ = writeln!(s, "Desconto: -R$ {}", consumo.total_desconto);
        }
        linha(&mut s);
        let _ = writeln!(
            s,
            "TOTAL PAGO: R$ {}",
            consumo.valor_final.unwrap_or_default()
        );
        if let Some(fp) = &consumo.forma_pagamento {
            let _ = writeln!(s, "Forma de pagamento: {fp}");
        }
        if let Some(f) = consumo.fechado_em {
            let _ = writeln!(s, "Fechado em: {}", f.format("%d/%m/%Y %H:%M"));
        }
        linha(&mut s);
        Ok((arquivo, s))
    }

    /// Imprime o comprovante na térmica ESC/POS.
    /// Resolução da impressora: `impressora_id` explícita → impressora
    /// `padrao` cadastrada → fallback nos campos legados do estabelecimento.
    pub async fn imprimir_comprovante(&self, id: i64, impressora_id: Option<i64>) -> AppResult<()> {
        let det = self.detalhe(id).await?;
        let consumo = det
            .consumo
            .ok_or_else(|| DomainError::regra("Reserva sem conta de consumo."))?;

        let est = self
            .estabelecimentos
            .obter()
            .await?
            .ok_or_else(|| DomainError::regra("Cadastre os dados do estabelecimento."))?;

        let (host, porta) = self.resolve_impressora(impressora_id, &est).await?;

        let itens = self
            .reservas
            .listar_itens_consumidos(consumo.id)
            .await
            .unwrap_or_default();
        let adicionais = self
            .reservas
            .listar_adicionais(consumo.id)
            .await
            .unwrap_or_default();

        let mut l = vec![
            LinhaRecibo::Titulo(est.razao_social.unwrap_or_else(|| "COMPROVANTE".into())),
            LinhaRecibo::Centro("COMPROVANTE DE PAGAMENTO".into()),
            LinhaRecibo::Separador,
            LinhaRecibo::Par {
                texto: "Reserva".into(),
                valor: format!("Nº {}", det.id),
            },
            LinhaRecibo::Texto(format!("Cliente: {}", det.cliente_nome)),
            LinhaRecibo::Texto(format!(
                "Acomod.: {} Nº {}",
                det.acomodacao_nome, det.acomodacao_numero
            )),
            LinhaRecibo::Texto(format!(
                "Período: {} a {}",
                det.entradaprevista.format("%d/%m/%y"),
                det.saidaprevista.format("%d/%m/%y")
            )),
            LinhaRecibo::Separador,
            LinhaRecibo::Par {
                texto: format!(
                    "Estadia ({}d x R$ {})",
                    time::diarias(det.entradaprevista, det.saidaprevista),
                    det.valordiaria
                ),
                valor: format!("R$ {}", consumo.valor_estadia),
            },
        ];
        for i in &itens {
            l.push(LinhaRecibo::Par {
                texto: format!("{} x{}", i.nome, i.quantidade),
                valor: format!("R$ {}", i.valor_total),
            });
        }
        for a in &adicionais {
            l.push(LinhaRecibo::Par {
                texto: a.motivo.clone(),
                valor: format!("R$ {}", a.valor),
            });
        }
        if consumo.total_desconto > Decimal::ZERO {
            l.push(LinhaRecibo::Par {
                texto: "Desconto".into(),
                valor: format!("-R$ {}", consumo.total_desconto),
            });
        }
        l.push(LinhaRecibo::Separador);
        l.push(LinhaRecibo::Titulo(format!(
            "TOTAL R$ {}",
            consumo.valor_final.unwrap_or_default()
        )));
        if let Some(fp) = &consumo.forma_pagamento {
            l.push(LinhaRecibo::Centro(format!("Pagamento: {fp}")));
        }
        if let Some(f) = consumo.fechado_em {
            l.push(LinhaRecibo::Centro(format!(
                "{}",
                f.format("%d/%m/%Y %H:%M")
            )));
        }
        l.push(LinhaRecibo::Separador);
        l.push(LinhaRecibo::Centro("Obrigado pela preferência!".into()));
        l.push(LinhaRecibo::Avanco(2));

        self.impressora.imprimir(&host, porta, &l).await?;
        Ok(())
    }

    /// Resolve o destino do comprovante: impressora explícita → padrão
    /// cadastrada → campos legados `impressora_*` do estabelecimento.
    async fn resolve_impressora(
        &self,
        impressora_id: Option<i64>,
        est: &clarituz_domain::entities::Estabelecimento,
    ) -> AppResult<(String, u16)> {
        if let Some(imp) = match impressora_id {
            Some(id) => self.impressoras.por_id(id).await?,
            None => self.impressoras.padrao().await?,
        } {
            if !imp.ativa {
                return Err(
                    DomainError::regra(format!("Impressora '{}' está inativa.", imp.nome)).into(),
                );
            }
            return Ok((imp.ip.trim().to_string(), imp.porta as u16));
        }
        if impressora_id.is_some() {
            return Err(DomainError::nao_encontrado("Impressora não encontrada.").into());
        }
        // fallback legado — campos impressora_* do estabelecimento
        if !est.impressora_ativa {
            return Err(DomainError::regra(
                "Nenhuma impressora padrão cadastrada. Configure em Pousada/Hotel.",
            )
            .into());
        }
        let ip = est
            .impressora_ip
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| DomainError::regra("IP da impressora não configurado."))?;
        Ok((ip.trim().to_string(), est.impressora_porta as u16))
    }

    /// Reimprime os tickets de produção (KOT) do consumo da reserva —
    /// agrupa os itens pela impressora do setor (categoria) e envia um
    /// ticket por impressora. Retorna quantos tickets foram enviados.
    pub async fn imprimir_producao(&self, idreserva: i64) -> AppResult<i32> {
        let det = self.detalhe(idreserva).await?;
        let consumo_id = det
            .consumo
            .as_ref()
            .ok_or_else(|| DomainError::regra("Reserva sem conta de consumo."))?
            .id;
        let itens = self.impressoras.itens_producao(consumo_id).await?;
        self.despachar_producao(&det, &itens).await
    }

    /// Agrupa itens por impressora e envia um ticket por setor.
    async fn despachar_producao(
        &self,
        det: &ReservaDetalhe,
        itens: &[clarituz_domain::ports::ItemProducao],
    ) -> AppResult<i32> {
        use std::collections::BTreeMap;
        // agrupa por impressora (itens sem destino não geram ticket)
        struct Destino {
            nome: String,
            ip: String,
            porta: u16,
            itens: Vec<(String, i32)>,
        }
        let mut grupos: BTreeMap<i64, Destino> = BTreeMap::new();
        for it in itens {
            if let Some(imp) = &it.impressora {
                let g = grupos.entry(imp.id).or_insert_with(|| Destino {
                    nome: imp.nome.clone(),
                    ip: imp.ip.trim().to_string(),
                    porta: imp.porta as u16,
                    itens: Vec::new(),
                });
                g.itens.push((it.nome.clone(), it.quantidade));
            }
        }
        if grupos.is_empty() {
            return Err(DomainError::regra(
                "Nenhum item desta conta tem setor de impressão configurado.",
            )
            .into());
        }
        let mut enviados = 0;
        let mut falhas = Vec::new();
        for (_id, d) in grupos {
            let Destino {
                nome,
                ip,
                porta,
                itens,
            } = d;
            let mut l = vec![
                LinhaRecibo::Titulo(format!("PEDIDO — {}", nome.to_uppercase())),
                LinhaRecibo::Separador,
                LinhaRecibo::Par {
                    texto: "Reserva".into(),
                    valor: format!("Nº {}", det.id),
                },
                LinhaRecibo::Texto(format!("Cliente: {}", det.cliente_nome)),
                LinhaRecibo::Texto(format!(
                    "Acomod.: {} Nº {}",
                    det.acomodacao_nome, det.acomodacao_numero
                )),
                LinhaRecibo::Separador,
            ];
            for (nome_item, qtd) in &itens {
                l.push(LinhaRecibo::Par {
                    texto: nome_item.clone(),
                    valor: format!("x{qtd}"),
                });
            }
            l.push(LinhaRecibo::Separador);
            l.push(LinhaRecibo::Centro(
                chrono::Utc::now().format("%d/%m/%Y %H:%M").to_string(),
            ));
            l.push(LinhaRecibo::Avanco(2));
            match self.impressora.imprimir(&ip, porta, &l).await {
                Ok(()) => enviados += 1,
                Err(e) => {
                    tracing::warn!(impressora = %nome, erro = %e, "falha no ticket de produção");
                    falhas.push(nome);
                }
            }
        }
        if enviados == 0 {
            return Err(
                DomainError::regra(format!("Falha ao imprimir em: {}", falhas.join(", "))).into(),
            );
        }
        Ok(enviados)
    }

    pub async fn listar(
        &self,
        filtro: FiltroReserva,
        page: PageParams,
    ) -> AppResult<Page<ReservaResumo>> {
        self.reservas
            .listar(&filtro, page)
            .await
            .map_err(Into::into)
    }

    pub async fn eventos(&self, periodo: Option<PeriodoEstadia>) -> AppResult<Vec<ReservaResumo>> {
        self.reservas
            .listar_eventos(periodo)
            .await
            .map_err(Into::into)
    }

    pub async fn contar_por_acomodacao(
        &self,
        periodo: Option<PeriodoEstadia>,
    ) -> AppResult<Vec<(String, i64)>> {
        self.reservas
            .contar_por_acomodacao(periodo)
            .await
            .map_err(Into::into)
    }

    /// Consulta de disponibilidade (legado: `api/disponibilidade.php`).
    /// `hospedes` reprecifica `valor` pela faixa de ocupação do tipo.
    pub async fn disponibilidade(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
        idacomodacao: Option<i64>,
        excluir_reserva: Option<i64>,
        hospedes: Option<i32>,
    ) -> AppResult<DisponibilidadeResponse> {
        let periodo = PeriodoEstadia::new(inicio, fim)?;
        let acomodacoes = self
            .reservas
            .disponibilidade(periodo, hospedes, idacomodacao, excluir_reserva)
            .await?;

        Ok(DisponibilidadeResponse {
            disponivel: !acomodacoes.is_empty(),
            quantidade: acomodacoes.len(),
            diarias: time::diarias(inicio, fim),
            inicio,
            fim,
            acomodacoes,
        })
    }

    /// Diária efetiva: faixa de ocupação do tipo (maior faixa <= hóspedes,
    /// senão a menor) ou o valor-base da acomodação quando o tipo não tem
    /// faixas — mesma regra no balcão, no site e na pré-reserva do WhatsApp.
    /// Diária da acomodação para N hóspedes — faixa de ocupação por tipo
    /// ou valor base. Pública para reuso pela extranet (tarifa net).
    pub async fn diaria_para(
        &self,
        acomodacao: &clarituz_domain::entities::Acomodacao,
        hospedes: i32,
    ) -> AppResult<Decimal> {
        match acomodacao.idtipo_acomodacao {
            Some(tipo) => Ok(self
                .acomodacoes
                .diaria_para_ocupacao(tipo, hospedes)
                .await?
                .unwrap_or(acomodacao.valor)),
            None => Ok(acomodacao.valor),
        }
    }

    /// Taxas early check-in / late checkout: validam disponibilidade do
    /// dia adjacente (early → véspera livre, late → dia seguinte livre) e
    /// retornam o acréscimo a somar no total da estadia — mesma regra no
    /// site e na operação; o sinal 30% incide sobre o total já com taxas.
    async fn taxas_horario(
        &self,
        idacomodacao: i64,
        periodo: &PeriodoEstadia,
        early: bool,
        late: bool,
    ) -> AppResult<Decimal> {
        if !early && !late {
            return Ok(Decimal::ZERO);
        }
        let est = self.estabelecimentos.obter().await?.ok_or_else(|| {
            DomainError::regra(
                "Configure as taxas de early/late em Dados da Pousada antes de ofertar.",
            )
        })?;
        let mut extra = Decimal::ZERO;
        if early {
            let vespera = periodo.entrada - Duration::days(1);
            let livre = self
                .reservas
                .disponibilidade(
                    PeriodoEstadia::new(vespera, vespera)?,
                    None,
                    Some(idacomodacao),
                    None,
                )
                .await?;
            if livre.is_empty() {
                return Err(DomainError::regra(
                    "Early check-in indisponível: acomodação ocupada na véspera da entrada.",
                )
                .into());
            }
            extra += est.taxa_early;
        }
        if late {
            let depois = periodo.saida + Duration::days(1);
            let livre = self
                .reservas
                .disponibilidade(
                    PeriodoEstadia::new(depois, depois)?,
                    None,
                    Some(idacomodacao),
                    None,
                )
                .await?;
            if livre.is_empty() {
                return Err(DomainError::regra(
                    "Late checkout indisponível: acomodação reservada no dia seguinte.",
                )
                .into());
            }
            extra += est.taxa_late;
        }
        Ok(extra)
    }

    /// Cria reserva em status `pendente` com conta de consumo aberta.
    ///
    /// Concorrência: a exclusão `daterange` no Postgres garante que duas
    /// requisições simultâneas jamais produzam overbooking — o segundo
    /// INSERT falha com 23P01 → `Conflito` (o legado usava `GET_LOCK`).
    #[instrument(skip(self, ator, input), fields(ator = %ator.login))]
    pub async fn criar(&self, ator: &Ator, input: ReservaInput) -> AppResult<Reserva> {
        let periodo = PeriodoEstadia::new(input.entradaprevista, input.saidaprevista)?;

        if input.idacomodacao <= 0 || input.idcliente <= 0 {
            return Err(DomainError::validacao("Acomodação e cliente são obrigatórios.").into());
        }
        if input.quantidade_hospedes <= 0 {
            return Err(DomainError::validacao("Informe a quantidade de hóspedes.").into());
        }

        let acomodacao = self
            .acomodacoes
            .buscar(input.idacomodacao)
            .await?
            .filter(|a| a.ativo)
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada."))?;

        self.clientes
            .buscar(input.idcliente)
            .await?
            .filter(|c| c.ativo)
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;

        if input.quantidade_hospedes > acomodacao.capacidade {
            return Err(DomainError::regra(format!(
                "Acomodação comporta {} hóspede(s); informado {}.",
                acomodacao.capacidade, input.quantidade_hospedes
            ))
            .into());
        }

        // Diária: a informada, a faixa de ocupação do tipo ou a tarifa base.
        let valordiaria = match input.valordiaria.filter(|v| *v > Decimal::ZERO) {
            Some(v) => v,
            None => {
                self.diaria_para(&acomodacao, input.quantidade_hospedes)
                    .await?
            }
        };
        let diarias = Decimal::from(time::diarias(periodo.entrada, periodo.saida));
        let early = input.early_checkin.unwrap_or(false);
        let late = input.late_checkout.unwrap_or(false);
        let taxas = self
            .taxas_horario(input.idacomodacao, &periodo, early, late)
            .await?;
        let valor_total = money::round2(valordiaria * diarias + taxas);

        let nova = NovaReserva {
            idacomodacao: input.idacomodacao,
            idcliente: input.idcliente,
            quantidade_hospedes: input.quantidade_hospedes,
            periodo,
            obs: input
                .obs
                .map(|o| o.trim().to_string())
                .filter(|o| !o.is_empty()),
            valordiaria: money::round2(valordiaria),
            valor_total,
            early_checkin: early,
            late_checkout: late,
            expira_em: None,
            idoperadora: input.idoperadora,
            idcontrato: input.idcontrato,
        };

        let log = ator.log(
            "cadastro",
            format!(
                "Reservou a acomodação Nº{} de {} até {}",
                nova.idacomodacao, nova.periodo.entrada, nova.periodo.saida
            ),
            "reserva",
            0,
            Some(serde_json::json!({
                "idacomodacao": nova.idacomodacao,
                "idcliente": nova.idcliente,
                "entrada": nova.periodo.entrada,
                "saida": nova.periodo.saida,
            })),
        );

        let reserva = self.reservas.criar(&nova, log).await?;
        self.notificar_distribuicao(
            nova.idacomodacao,
            nova.periodo.entrada,
            nova.periodo.saida,
            "reserva_criada",
        )
        .await;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Info,
                "Nova reserva",
                format!(
                    "{} reservou a acomodação Nº{} ({} → {}).",
                    ator.nome, nova.idacomodacao, nova.periodo.entrada, nova.periodo.saida
                ),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": reserva.id})),
        );
        Ok(reserva)
    }

    /// Reserva online vinda do site público — mesmo agregado de `criar`,
    /// sem `Ator`: valida o formulário, faz find-or-create do cliente e
    /// cria a reserva pendente ('p'). Período ocupado devolve
    /// `status="consulta_registrada"` e avisa a recepção em tempo real —
    /// o visitante vira lead em vez de erro 409.
    pub async fn criar_reserva_site(
        &self,
        input: ReservaPublicaInput,
        ip: Option<&str>,
    ) -> AppResult<ReservaPublicaOutput> {
        let nome = input.nome.trim().to_string();
        let email = input.email.trim().to_lowercase();
        let telefone = input.telefone.trim().to_string();
        if nome.is_empty() || email.is_empty() || telefone.is_empty() {
            return Err(DomainError::validacao("Informe nome, e-mail e telefone.").into());
        }
        // CDC — a política de cancelamento precisa de aceite registrado.
        if !input.aceito_termos {
            return Err(DomainError::validacao(
                "É preciso aceitar a política de cancelamento e a política de privacidade.",
            )
            .into());
        }
        if input.check_out < input.check_in {
            return Err(DomainError::validacao(
                "A data de check-out deve ser igual ou posterior ao check-in.",
            )
            .into());
        }

        // id explícito → slug do CMS → primeira acomodação ativa.
        let acomodacao = if let Some(id) = input.idacomodacao {
            self.acomodacoes.buscar(id).await?.filter(|a| a.ativo)
        } else if let Some(slug) = input
            .slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            self.acomodacoes.buscar_ativa_por_slug(slug).await?
        } else {
            None
        };
        let acomodacao = match acomodacao {
            Some(a) => a,
            None => self.acomodacoes.primeira_ativa().await?.ok_or_else(|| {
                DomainError::nao_encontrado("Nenhuma acomodação ativa encontrada.")
            })?,
        };

        let hospedes = input.hospedes.clamp(1, acomodacao.capacidade.max(1));

        // CPF limpo localiza o cadastro; sem CPF válido gera `SITE-…`
        // para satisfazer a coluna NOT NULL até o check-in completar a ficha.
        let cpf_limpo = input
            .cpf
            .as_deref()
            .map(|c| c.chars().filter(char::is_ascii_digit).collect::<String>())
            .filter(|c| c.len() >= 11);
        let cpf = cpf_limpo.clone().unwrap_or_else(|| {
            let digitos: String = telefone.chars().filter(char::is_ascii_digit).collect();
            format!("SITE-{digitos}-{}", &ids::simples()[..6])
        });
        let idcliente = self
            .clientes
            .site_upsert(&NovoClienteSite {
                nome: nome.clone(),
                cpf,
                cpf_busca: cpf_limpo,
                email: email.clone(),
                telefone: telefone.clone(),
            })
            .await?;

        let obs = match input
            .observacoes
            .as_deref()
            .map(str::trim)
            .filter(|o| !o.is_empty())
        {
            Some(o) => format!("[Site] Tel: {telefone} | E-mail: {email} | Obs: {o}"),
            None => format!("[Reserva pelo Site] Tel: {telefone} | E-mail: {email}"),
        };
        let periodo = PeriodoEstadia::new(input.check_in, input.check_out)?;
        let diarias = Decimal::from(time::diarias(periodo.entrada, periodo.saida));
        let early = input.early_checkin.unwrap_or(false);
        let late = input.late_checkout.unwrap_or(false);
        let taxas = self
            .taxas_horario(acomodacao.id, &periodo, early, late)
            .await?;
        let diaria = self.diaria_para(&acomodacao, hospedes).await?;

        // Contrato corporativo — código público aplica o desconto negociado
        // na diária cobrada. Inválido/expirado não gera erro (não vaza a
        // existência do contrato) — a reserva segue na tarifa balcão.
        let contrato = match input
            .codigo_corporativo
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            Some(codigo) => self
                .contratos
                .por_codigo(codigo)
                .await?
                .filter(|c| c.vigente(Utc::now().date_naive())),
            None => None,
        };
        let (diaria, idcontrato) = match &contrato {
            Some(c) => (
                money::round2(diaria * (Decimal::ONE - c.desconto_pct / Decimal::from(100))),
                Some(c.id),
            ),
            None => (diaria, None),
        };

        let nova = NovaReserva {
            idacomodacao: acomodacao.id,
            idcliente,
            quantidade_hospedes: hospedes,
            periodo,
            obs: Some(obs),
            valordiaria: money::round2(diaria),
            valor_total: money::round2(diaria * diarias + taxas),
            early_checkin: early,
            late_checkout: late,
            // Reserva do site segura a acomodação por `hold_minutos`
            // aguardando o pagamento; expirada, o sweeper a cancela.
            expira_em: Some(Utc::now() + Duration::minutes(self.hold_minutos)),
            idoperadora: None,
            idcontrato,
        };
        let log = NovoLog {
            idfuncionario: None,
            acao: "cadastro".into(),
            obs: format!("Reserva pelo site — {nome} ({telefone})"),
            tabela: "reserva",
            idtabela: 0,
            dados: Some(json!({
                "idcliente": idcliente,
                "idacomodacao": acomodacao.id,
                "origem": "site",
            })),
        };

        match self.reservas.criar(&nova, log).await {
            Ok(reserva) => {
                self.notificar_distribuicao(
                    nova.idacomodacao,
                    nova.periodo.entrada,
                    nova.periodo.saida,
                    "reserva_site",
                )
                .await;
                // CDC/LGPD — aceite com IP; consentimento de marketing separado.
                self.lgpd
                    .marcar_termos(reserva.id, ip.unwrap_or("desconhecido"))
                    .await?;
                if input.aceito_marketing {
                    let _ = self.lgpd.registrar_consent(idcliente).await;
                }
                self.eventos.avisar(
                    Aviso::novo(
                        TipoAviso::Sucesso,
                        format!(
                            "Nova reserva pelo site — #{} {}",
                            acomodacao.numero, acomodacao.nome
                        ),
                        format!(
                            "{nome} ({telefone}) reservou de {} a {} para {hospedes} hóspede(s).",
                            periodo.entrada.format("%d/%m/%Y"),
                            periodo.saida.format("%d/%m/%Y"),
                        ),
                    )
                    .dados(json!({
                        "idreserva": reserva.id,
                        "idcliente": idcliente,
                        "idacomodacao": acomodacao.id,
                        "origem": "site",
                    })),
                );
                Ok(ReservaPublicaOutput {
                    ok: true,
                    status: "reserva_criada",
                    idreserva: Some(reserva.id),
                    idcliente,
                    token_publico: Some(reserva.token_publico),
                    mensagem: format!(
                        "Reserva Nº #{} registrada com sucesso! Nossa recepção já foi notificada em tempo real.",
                        reserva.id
                    ),
                })
            }
            // Período ocupado: lead para a recepção, não erro para o visitante.
            Err(DomainError::Conflito(_)) => {
                self.eventos.avisar(
                    Aviso::novo(
                        TipoAviso::Alerta,
                        format!(
                            "Consulta pelo site (período ocupado) — #{} {}",
                            acomodacao.numero, acomodacao.nome
                        ),
                        format!(
                            "{nome} ({telefone} / {email}) pediu {} a {} ({hospedes} hóspede(s)) — quarto já possui reserva no período.",
                            periodo.entrada.format("%d/%m/%Y"),
                            periodo.saida.format("%d/%m/%Y"),
                        ),
                    )
                    .dados(json!({
                        "idcliente": idcliente,
                        "idacomodacao": acomodacao.id,
                        "origem": "site_conflito",
                    })),
                );
                Ok(ReservaPublicaOutput {
                    ok: true,
                    status: "consulta_registrada",
                    idreserva: None,
                    idcliente,
                    token_publico: None,
                    mensagem: "Sua solicitação foi enviada em tempo real para a recepção! Como este quarto já possui bloqueio em parte das datas escolhidas, nossa equipe entrará em contato para confirmar a melhor opção.".into(),
                })
            }
            Err(e) => Err(e.into()),
        }
    }

    #[instrument(skip(self, ator))]
    pub async fn checkin(
        &self,
        ator: &Ator,
        id: i64,
        em: chrono::DateTime<chrono::Utc>,
    ) -> AppResult<Reserva> {
        let log = ator.log(
            "checkin",
            format!("Realizou o check-in na reserva Nº{id}"),
            "reserva",
            id,
            Some(serde_json::json!({"idreserva": id, "acao": "check-in"})),
        );
        // ECA (art. 82): menor só se hospeda acompanhado dos pais/responsável
        // ou com autorização documentada. Sem adulto na reserva e sem
        // autorização registrada → check-in bloqueado.
        let reserva_atual = self.buscar(id).await?;
        let hoje = em.date_naive();
        let titular_adulto = self
            .clientes
            .buscar(reserva_atual.idcliente)
            .await?
            .is_none_or(|c| Cliente::maior_de_idade(c.data_nascimento, hoje));
        let acompanhantes = self.acompanhantes.listar(id).await?;
        let adulto_acomp = acompanhantes.iter().any(|a| {
            a.data_nascimento
                .is_none_or(|d| Cliente::maior_de_idade(d, hoje))
        });
        let tem_menor = !titular_adulto
            || acompanhantes.iter().any(|a| {
                a.data_nascimento
                    .is_some_and(|d| !Cliente::maior_de_idade(d, hoje))
            });
        if tem_menor && !titular_adulto && !adulto_acomp {
            let aut = self.lgpd.autorizacao_menor(id).await?;
            if aut.as_deref().map_or_default(str::trim).is_empty() {
                return Err(DomainError::regra(
                    "Menor desacompanhado (ECA art. 82): registre a autorização \
                     dos pais ou responsável legal antes do check-in.",
                )
                .into());
            }
        }

        let reserva = self.reservas.checkin(id, em, log).await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Sucesso,
                "Check-in realizado",
                format!("Reserva Nº{id} em estadia — por {}.", ator.nome),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": id})),
        );
        Ok(reserva)
    }

    /// Fecha a conta: adicionais + desconto + forma de pagamento.
    /// `valor_final` é calculado aqui — o banco só persiste.
    #[instrument(skip(self, ator, req))]
    pub async fn checkout(
        &self,
        ator: &Ator,
        id: i64,
        req: CheckoutRequest,
    ) -> AppResult<(Reserva, Consumo)> {
        let reserva = self.buscar(id).await?;
        if !reserva.status.permite_checkout() {
            return match reserva.status {
                StatusReserva::Cancelada => Err(DomainError::conflito(
                    "Reserva cancelada. Não é possível fazer check-out.",
                )
                .into()),
                StatusReserva::Finalizada => {
                    Err(DomainError::conflito("Check-out já realizado.").into())
                }
                _ => Err(DomainError::regra(
                    "É necessário realizar o check-in antes do check-out.",
                )
                .into()),
            };
        }

        let consumo = self
            .reservas
            .consumo_da_reserva(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;
        if !consumo.status.aberto() {
            return Err(
                DomainError::conflito("Consumo da reserva já foi concluído ou cancelado.").into(),
            );
        }

        let pagamento = self
            .pagamentos
            .buscar(req.idforma_pagamento)
            .await?
            .filter(|p| p.ativo)
            .ok_or_else(|| DomainError::validacao("Forma de pagamento inválida."))?;

        let desconto = req.total_desconto.unwrap_or(Decimal::ZERO);
        if desconto < Decimal::ZERO {
            return Err(DomainError::validacao("Desconto não pode ser negativo.").into());
        }

        // adicionais válidos (motivo + valor positivo)
        let adicionais: Vec<NovoAdicional> = req
            .adicionais
            .into_iter()
            .filter_map(|a| {
                let motivo = a.motivo.trim().to_string();
                if motivo.is_empty() || a.valor <= Decimal::ZERO {
                    None
                } else {
                    Some(NovoAdicional {
                        motivo,
                        valor: money::round2(a.valor),
                    })
                }
            })
            .collect();
        let total_adicionais = money::sum(adicionais.iter().map(|a| &a.valor));

        let valor_final = money::round2(
            consumo.valor_estadia
                + consumo.valor_itens
                + consumo.valor_adicional
                + total_adicionais
                - desconto,
        );
        if valor_final < Decimal::ZERO {
            return Err(DomainError::validacao("Desconto maior que o total da conta.").into());
        }

        let comprovante = format!(
            "comprovante_{}_{:08x}.txt",
            id,
            uuid::Uuid::new_v4().as_u128() as u64
        );

        let cmd = ComandoCheckout {
            idreserva: id,
            idforma_pagamento: pagamento.id,
            valor_estadia: consumo.valor_estadia,
            total_desconto: money::round2(desconto),
            valor_final,
            adicionais,
            comprovante: Some(comprovante),
        };

        let log = ator.log(
            "checkout",
            format!("Realizou o check-out da reserva Nº{id} no valor de R$ {valor_final}"),
            "reserva",
            id,
            Some(serde_json::json!({
                "idreserva": id,
                "acao": "check-out",
                "valor_final": valor_final,
            })),
        );

        let out = self.reservas.checkout(&cmd, time::agora(), log).await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Sucesso,
                "Check-out realizado",
                format!(
                    "Reserva Nº{id} finalizada — R$ {valor_final} — por {}.",
                    ator.nome
                ),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": id, "valor_final": valor_final})),
        );
        Ok(out)
    }

    /// Cancelamento com compensação financeira.
    ///
    /// Reserva `iniciada` exige nível administrativo — direto ou via
    /// credenciais de admin no corpo (paridade com `aCancelarReservaAdm.php`).
    #[instrument(skip(self, ator, req))]
    pub async fn cancelar(
        &self,
        ator: &Ator,
        id: i64,
        req: CancelarReservaRequest,
    ) -> AppResult<CancelamentoResponse> {
        let reserva = self.buscar(id).await?;

        if reserva.status == StatusReserva::Iniciada && !ator.is_admin() {
            let (login, senha) = match (&req.login_admin, &req.senha_admin) {
                (Some(l), Some(s)) => (l.as_str(), s.as_str()),
                _ => {
                    return Err(DomainError::proibido(
                        "Cancelar reserva em estadia exige credenciais de administrador.",
                    )
                    .into())
                }
            };
            if !self.auth.autenticar_admin(login, senha).await? {
                return Err(
                    DomainError::proibido("Credenciais de administrador inválidas.").into(),
                );
            }
        }

        let motivo = req
            .motivo
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty());
        let log = ator.log(
            "cancelar",
            format!(
                "Cancelou a reserva Nº{id}{}",
                motivo.map_or_default(|m| format!(" (motivo: {m})"))
            ),
            "reserva",
            id,
            Some(serde_json::json!({"idreserva": id, "motivo": motivo})),
        );

        let out = self
            .reservas
            .cancelar(id, motivo, Some(ator.id), log)
            .await?;
        self.notificar_distribuicao(
            reserva.idacomodacao,
            reserva.entradaprevista,
            reserva.saidaprevista,
            "reserva_cancelada",
        )
        .await;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Alerta,
                "Reserva cancelada",
                format!("Reserva Nº{id} cancelada por {}.", ator.nome),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": id})),
        );
        Ok(CancelamentoResponse {
            reserva: out.reserva,
            reembolso: out.reembolso,
        })
    }

    /// Venda de item do frigobar para a conta da reserva.
    /// Preço calculado no servidor: `quantidade × valor_unitario` do estoque.
    pub async fn registrar_item_consumido(
        &self,
        ator: &Ator,
        idreserva: i64,
        req: ItemConsumidoRequest,
    ) -> AppResult<ItemConsumido> {
        let reserva = self.buscar(idreserva).await?;
        if reserva.status != StatusReserva::Iniciada {
            return Err(DomainError::regra(
                "Consumo só pode ser lançado com a reserva em estadia (check-in realizado).",
            )
            .into());
        }
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .filter(|c| c.status.aberto())
            .ok_or_else(|| DomainError::conflito("Conta de consumo não está aberta."))?;

        if req.quantidade <= 0 || req.iditem_frigobar <= 0 {
            return Err(DomainError::validacao("Item e quantidade são obrigatórios.").into());
        }

        let novo = NovoItemConsumido {
            idconsumo: consumo.id,
            iditem_frigobar: req.iditem_frigobar,
            quantidade: req.quantidade,
            // recalculado na infra com o preço real do item
            valor_total: Decimal::ZERO,
        };

        let log = ator.log(
            "consumo",
            format!(
                "Lançou {} item(ns) do frigobar no consumo Nº{}",
                req.quantidade, consumo.id
            ),
            "itensconsumidos",
            0,
            Some(serde_json::json!({"idconsumo": consumo.id, "quantidade": req.quantidade})),
        );

        let item = self
            .reservas
            .registrar_item_consumido(&novo, ator.id, log)
            .await?;

        // ticket de produção (KOT) — best-effort: falha de impressão não
        // derruba o lançamento; o ticket pode ser reimpresso depois.
        if let Ok(Some(imp)) = self.impressoras.por_item_estoque(item.iditem).await {
            let l = vec![
                LinhaRecibo::Titulo(format!("PEDIDO — {}", imp.nome.to_uppercase())),
                LinhaRecibo::Separador,
                LinhaRecibo::Par {
                    texto: "Reserva".into(),
                    valor: format!("Nº {idreserva}"),
                },
                LinhaRecibo::Separador,
                LinhaRecibo::Par {
                    texto: item.nome.clone(),
                    valor: format!("x{}", item.quantidade),
                },
                LinhaRecibo::Separador,
                LinhaRecibo::Avanco(2),
            ];
            if let Err(e) = self
                .impressora
                .imprimir(imp.ip.trim(), imp.porta as u16, &l)
                .await
            {
                tracing::warn!(impressora = %imp.nome, erro = %e, "auto-KOT falhou");
            }
        }
        Ok(item)
    }

    pub async fn itens_consumidos(&self, idreserva: i64) -> AppResult<Vec<ItemConsumido>> {
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;
        self.reservas
            .listar_itens_consumidos(consumo.id)
            .await
            .map_err(Into::into)
    }

    pub async fn adicionais(&self, idreserva: i64) -> AppResult<Vec<AdicionalConsumo>> {
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;
        self.reservas
            .listar_adicionais(consumo.id)
            .await
            .map_err(Into::into)
    }

    /// Lançamento avulso na conta durante a estadia (consumo adicional
    /// do legado) — exige reserva em estadia com conta aberta.
    pub async fn lancar_adicional(
        &self,
        ator: &Ator,
        idreserva: i64,
        req: AdicionalInput,
    ) -> AppResult<AdicionalConsumo> {
        let reserva = self.buscar(idreserva).await?;
        if reserva.status != StatusReserva::Iniciada {
            return Err(DomainError::regra(
                "Adicional só pode ser lançado com a reserva em estadia.",
            )
            .into());
        }
        if req.motivo.trim().is_empty() || req.valor <= Decimal::ZERO {
            return Err(DomainError::validacao("Descrição e valor são obrigatórios.").into());
        }
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .filter(|c| c.status.aberto())
            .ok_or_else(|| DomainError::conflito("Conta de consumo não está aberta."))?;

        let novo = NovoAdicional {
            motivo: req.motivo.trim().to_string(),
            valor: req.valor,
        };
        let log = ator.log(
            "consumo",
            format!(
                "Lançou adicional de R$ {} no consumo Nº{}",
                novo.valor, consumo.id
            ),
            "adicionalconsumo",
            0,
            Some(serde_json::json!({"idconsumo": consumo.id})),
        );
        Ok(self
            .reservas
            .lancar_adicional(consumo.id, &novo, log)
            .await?)
    }

    // -----------------------------------------------------------------------
    // acompanhantes (demais ocupantes da reserva)
    // -----------------------------------------------------------------------

    pub async fn listar_acompanhantes(&self, idreserva: i64) -> AppResult<Vec<Acompanhante>> {
        self.buscar(idreserva).await?;
        Ok(self.acompanhantes.listar(idreserva).await?)
    }

    /// Registra acompanhante — permitido enquanto a reserva ocupa
    /// a acomodação (pendente ou em estadia).
    pub async fn adicionar_acompanhante(
        &self,
        ator: &Ator,
        idreserva: i64,
        input: AcompanhanteInput,
    ) -> AppResult<Acompanhante> {
        let reserva = self.buscar(idreserva).await?;
        if !reserva.status.ocupa() {
            return Err(DomainError::regra(
                "Acompanhantes só podem ser incluídos em reservas ativas.",
            )
            .into());
        }
        if input.nome.trim().is_empty() {
            return Err(DomainError::validacao("Nome do acompanhante é obrigatório.").into());
        }

        let novo = NovoAcompanhante {
            nome: input.nome.trim().to_string(),
            data_nascimento: input.data_nascimento,
            parentesco: opt_str(input.parentesco),
            doc_tipo: opt_str(input.doc_tipo).map(|t| t.to_lowercase()),
            doc_numero: opt_str(input.doc_numero),
        };
        let log = ator.log(
            "acompanhante",
            format!(
                "Incluiu o acompanhante {} na reserva Nº{idreserva}",
                novo.nome
            ),
            "reserva_acompanhante",
            idreserva,
            None,
        );
        Ok(self.acompanhantes.criar(idreserva, &novo, log).await?)
    }

    pub async fn remover_acompanhante(&self, ator: &Ator, id: i64) -> AppResult<()> {
        let log = ator.log(
            "acompanhante",
            format!("Removeu o acompanhante Nº{id}"),
            "reserva_acompanhante",
            id,
            None,
        );
        Ok(self.acompanhantes.remover(id, log).await?)
    }

    // -----------------------------------------------------------------------
    // FNRH — ficha de registro de hóspedes (arquivo digital imutável)
    // -----------------------------------------------------------------------

    /// Fichas emitidas para a reserva, mais recente primeiro.
    pub async fn listar_fnrh(&self, idreserva: i64) -> AppResult<Vec<Fnrh>> {
        self.buscar(idreserva).await?;
        Ok(self.fnrh.listar_por_reserva(idreserva).await?)
    }

    /// Arquivo digital do hóspede — fichas de todas as estadias.
    pub async fn listar_fnrh_cliente(&self, idcliente: i64) -> AppResult<Vec<Fnrh>> {
        self.clientes
            .buscar(idcliente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;
        Ok(self.fnrh.listar_por_cliente(idcliente).await?)
    }

    /// Exportação SNE/CSV das fichas emitidas no período — envio manual ao MTur.
    pub async fn exportar_fnrh_csv(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> AppResult<String> {
        if fim < inicio {
            return Err(DomainError::validacao("Período inválido.").into());
        }
        let fichas = self.fnrh.listar_periodo(inicio, fim).await?;
        let mut csv = String::from(
            "ficha;reserva;emitida_em;nome;cpf;nascimento;nacionalidade;email;telefone;cidade;uf;motivo_viagem;placa;acomodacao;entrada;saida\n",
        );
        let cell = |v: &serde_json::Value| {
            v.as_str()
                .unwrap_or("")
                .replace(';', ",")
                .replace(['\r', '\n'], " ")
        };
        for f in fichas {
            let h = &f.dados["hospede"];
            let r = &f.dados["reserva"];
            let _ = writeln!(
                csv,
                "{};{};{};{};{};{};{};{};{};{};{};{};{};{};{};{}",
                f.id,
                f.idreserva,
                f.emitida_em.format("%d/%m/%Y %H:%M"),
                cell(&h["nome"]),
                cell(&h["cpf"]),
                cell(&h["data_nascimento"]),
                cell(&h["nacionalidade"]),
                cell(&h["email"]),
                cell(&h["telefone"]),
                cell(&h["cidade"]),
                cell(&h["estado"]),
                cell(&serde_json::json!(f.motivo_viagem)),
                cell(&serde_json::json!(f.placa_veiculo)),
                cell(&r["acomodacao"]),
                cell(&r["entradaprevista"]),
                cell(&r["saidaprevista"]),
            );
        }
        Ok(csv)
    }

    // ------------------------------------------------------------------
    // fechamento do dia — pendências, no-show autorizado por PIN, relatório
    // ------------------------------------------------------------------

    pub async fn pendencias_fechamento(
        &self,
    ) -> AppResult<clarituz_domain::queries::PendenciasFechamento> {
        Ok(self.reservas.pendencias_fechamento().await?)
    }

    /// Marca a reserva como no-show (cancelamento sem reembolso) — exige o
    /// PIN gerencial configurado no estabelecimento, além do usuário logado.
    pub async fn marcar_no_show(&self, ator: &Ator, id: i64, pin: &str) -> AppResult<()> {
        let e = self
            .estabelecimentos
            .obter()
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Estabelecimento não configurado."))?;
        let esperado = e.pin_fechamento.as_deref().unwrap_or_default();
        if esperado.is_empty() {
            return Err(DomainError::regra(
                "Configure o PIN de fechamento em Dados da Pousada antes de marcar no-show.",
            )
            .into());
        }
        if pin.trim() != esperado {
            return Err(DomainError::validacao("PIN incorreto.").into());
        }
        let reserva = self.buscar(id).await?;
        if reserva.status != StatusReserva::Pendente {
            return Err(DomainError::regra(
                "Só é possível marcar no-show em reserva confirmada ainda não iniciada.",
            )
            .into());
        }
        self.reservas
            .cancelar(
                id,
                Some("no-show — decisão autorizada por PIN no fechamento"),
                Some(ator.id),
                ator.log(
                    "no-show",
                    format!("Marcou no-show da reserva Nº{id} no fechamento"),
                    "reserva",
                    id,
                    None,
                ),
            )
            .await?;
        Ok(())
    }

    /// Envia o relatório determinístico do fechamento para o e-mail da pousada.
    pub async fn enviar_relatorio_fechamento(&self, ator: &Ator) -> AppResult<()> {
        let e = self
            .estabelecimentos
            .obter()
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Estabelecimento não configurado."))?;
        let destino = e.email.clone().ok_or_else(|| {
            DomainError::regra("Configure o e-mail do estabelecimento para receber o relatório.")
        })?;
        let p = self.reservas.pendencias_fechamento().await?;
        let mut corpo = String::from("Fechamento do dia\n\n");
        let _ = writeln!(
            corpo,
            "Contas abertas: {} (total R$ {})",
            p.contas_abertas, p.contas_total
        );
        let _ = writeln!(
            corpo,
            "Check-outs pendentes: {}",
            p.checkouts_pendentes.len()
        );
        for c in &p.checkouts_pendentes {
            let _ = writeln!(
                corpo,
                "  - {} · {} · saída prevista {}",
                c.acomodacao_nome, c.cliente_nome, c.saidaprevista
            );
        }
        let _ = writeln!(corpo, "No-shows: {}", p.no_shows.len());
        for n in &p.no_shows {
            let _ = writeln!(
                corpo,
                "  - {} · {} · entrada prevista {} ({}d de atraso)",
                n.acomodacao_nome, n.cliente_nome, n.entradaprevista, n.dias_atraso
            );
        }
        let _ = writeln!(corpo, "\nGerado por {}.", ator.nome);
        self.fila
            .enfileirar(clarituz_domain::entities::NovoEnvio {
                canal: clarituz_domain::enums::CanalEnvio::Email,
                destino,
                template: "relatorio_fechamento".into(),
                payload: serde_json::json!({"corpo": corpo}),
                idreserva: None,
                idcliente: None,
                idfuncionario: Some(ator.id),
                agendado_para: chrono::Utc::now(),
            })
            .await?;
        Ok(())
    }

    /// Emite a FNRH: monta o snapshot completo (cliente + reserva +
    /// acompanhantes + emissor) e o persiste de forma imutável.
    pub async fn emitir_fnrh(
        &self,
        ator: &Ator,
        idreserva: i64,
        input: FnrhEmitRequest,
    ) -> AppResult<Fnrh> {
        let reserva = self
            .reservas
            .buscar_detalhe(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        if reserva.status == StatusReserva::Cancelada {
            return Err(
                DomainError::regra("Não é possível emitir FNRH de reserva cancelada.").into(),
            );
        }
        let cliente = self
            .clientes
            .buscar(reserva.idcliente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;
        let acompanhantes = self.acompanhantes.listar(idreserva).await?;

        let motivo_viagem = input
            .motivo_viagem
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty());
        let placa_veiculo = input
            .placa_veiculo
            .map(|p| p.trim().to_uppercase())
            .filter(|p| !p.is_empty());

        let dados = json!({
            "hospede": {
                "nome": cliente.nome,
                "cpf": cliente.cpf,
                "data_nascimento": cliente.data_nascimento,
                "nacionalidade": cliente.nacionalidade,
                "naturalidade": cliente.naturalidade,
                "profissao": cliente.profissao,
                "email": cliente.email,
                "telefone": cliente.telefone,
                "logradouro": cliente.logradouro,
                "numero": cliente.numero,
                "complemento": cliente.complemento,
                "bairro": cliente.bairro,
                "cidade": cliente.cidade,
                "estado": cliente.estado,
                "cep": cliente.cep,
                "pais": cliente.pais,
                "tem_foto": cliente.tem_foto,
            },
            "reserva": {
                "id": reserva.id,
                "acomodacao": reserva.acomodacao_nome,
                "acomodacao_numero": reserva.acomodacao_numero,
                "quarto": reserva.quarto_numero,
                "entradaprevista": reserva.entradaprevista,
                "saidaprevista": reserva.saidaprevista,
                "checkin_em": reserva.checkin_em,
                "quantidade_hospedes": reserva.quantidade_hospedes,
            },
            "acompanhantes": acompanhantes,
            // Pré-ficha pública do hóspede: aceite + assinatura desenhada
            // (quando a pousada liga `fnrh_assinatura`), integra a via oficial.
            "pre_ficha": reserva.fnrh_hospede,
            "emitida_por": ator.nome,
        });

        let nova = NovaFnrh {
            idreserva,
            idcliente: reserva.idcliente,
            motivo_viagem: motivo_viagem.clone(),
            placa_veiculo,
            dados,
            emitida_por: Some(ator.id),
        };
        let log = ator.log(
            "fnrh",
            format!("Emitiu a FNRH da reserva Nº{idreserva}"),
            "fnrh",
            0,
            Some(json!({"idreserva": idreserva})),
        );
        Ok(self.fnrh.emitir(&nova, log).await?)
    }

    /// Exclui em definitivo uma reserva pendente ou cancelada junto com a
    /// conta de consumo — iniciadas/finalizadas devem ser canceladas antes.
    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Excluiu a reserva Nº{id}"),
            "reserva",
            id,
            None,
        );
        Ok(self.reservas.remover(id, log).await?)
    }

    // ------------------------------------------------------------------
    // mapa por andar + bloqueio formal
    // ------------------------------------------------------------------

    /// Mapa de ocupação por pavimento — recepção e governança leem a
    /// mesma foto: reserva do dia, bloqueio, limpeza e manutenção.
    pub async fn mapa_quartos(&self) -> AppResult<Vec<MapaQuarto>> {
        Ok(self.reservas.mapa_quartos().await?)
    }

    /// Bloqueio formal — tira a unidade de toda disponibilidade (motor,
    /// recepção, pré-reserva WhatsApp). Valida período e motivo.
    pub async fn bloquear(
        &self,
        ator: &Ator,
        idacomodacao: i64,
        inicio: NaiveDate,
        fim: NaiveDate,
        motivo: &str,
    ) -> AppResult<Bloqueio> {
        let motivo = motivo.trim();
        if motivo.len() < 3 {
            return Err(DomainError::validacao("Informe o motivo do bloqueio.").into());
        }
        PeriodoEstadia::new(inicio, fim)?;
        let bloqueio = self
            .reservas
            .bloqueio_criar(idacomodacao, inicio, fim, motivo, ator.id)
            .await?;
        self.notificar_distribuicao(idacomodacao, inicio, fim, "bloqueio_criado")
            .await;
        Ok(bloqueio)
    }

    pub async fn bloqueios(&self) -> AppResult<Vec<Bloqueio>> {
        Ok(self.reservas.bloqueio_listar().await?)
    }

    pub async fn desbloquear(&self, _ator: &Ator, id: i64) -> AppResult<()> {
        // Intervalo do bloqueio precisa sair da janela — a remoção devolve o bloqueio.
        let bloqueios = self.reservas.bloqueio_listar().await?;
        let b = bloqueios.iter().find(|b| b.id == id).cloned();
        self.reservas.bloqueio_remover(id).await?;
        if let Some(b) = b {
            self.notificar_distribuicao(b.idacomodacao, b.inicio, b.fim, "bloqueio_removido")
                .await;
        }
        Ok(())
    }

    // -- grupos / eventos -----------------------------------------------------

    /// Cria grupo + rooming list; `bloquear=true` tira as unidades de venda
    /// no período (visível no mapa como bloqueio 'Grupo …').
    pub async fn criar_grupo(&self, ator: &Ator, input: GrupoInput) -> AppResult<Grupo> {
        let nome = input.nome.trim();
        if nome.len() < 3 {
            return Err(DomainError::validacao("Informe o nome do grupo.").into());
        }
        if input.unidades.is_empty() {
            return Err(
                DomainError::validacao("Selecione ao menos uma unidade (rooming list).").into(),
            );
        }
        PeriodoEstadia::new(input.inicio, input.fim)?;
        Ok(self
            .reservas
            .grupo_criar(
                nome,
                opt_str(input.contato).as_deref(),
                opt_str(input.obs).as_deref(),
                input.inicio,
                input.fim,
                &input.unidades,
                input.bloquear.unwrap_or(true),
                ator.id,
            )
            .await?)
    }

    pub async fn grupos(&self) -> AppResult<Vec<Grupo>> {
        Ok(self.reservas.grupo_listar().await?)
    }

    pub async fn grupo_unidades(&self, idgrupo: i64) -> AppResult<Vec<GrupoUnidadeView>> {
        Ok(self.reservas.grupo_unidades(idgrupo).await?)
    }

    /// Remove o grupo — libera os bloqueios vinculados em cascata e
    /// desvincula reservas (`ON DELETE SET NULL`); as reservas permanecem.
    pub async fn remover_grupo(&self, _ator: &Ator, id: i64) -> AppResult<()> {
        Ok(self.reservas.grupo_remover(id).await?)
    }

    /// Vincula/desvincula uma reserva ao grupo (rooming list mostra o hóspede).
    pub async fn vincular_reserva_grupo(
        &self,
        _ator: &Ator,
        idreserva: i64,
        idgrupo: Option<i64>,
    ) -> AppResult<()> {
        Ok(self
            .reservas
            .reserva_vincular_grupo(idreserva, idgrupo)
            .await?)
    }
}

/// `Some(t)` → `None` quando vazio após trim.
fn opt_str(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
