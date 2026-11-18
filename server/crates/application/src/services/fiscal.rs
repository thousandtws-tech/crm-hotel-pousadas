//! Serviço fiscal — NFS-e via Spedy.
//!
//! Orquestra: configuração/verificação da integração, preparação e
//! confirmação da emissão (rascunho durável → fila), transmissão em
//! segundo plano com `integrationId` estável (idempotência), acompanhamento
//! por consulta e por webhook assinado, cancelamento com justificativa e
//! download dos documentos oficiais (XML/PDF).
//!
//! Regras observadas:
//! - 2xx do POST ≠ nota autorizada — a autorização vem de consulta/webhook.
//! - `status_remoto` é sempre preservado cru; o mapeamento é explícito.
//! - Rejeição de dados não é retry — correção exige ação humana.
//! - Cancelamento/reserva/pagamento são operações independentes.
//! - Sem valores fiscais inventados: códigos/alíquotas vêm da `config`
//!   da integração, parametrizada pelo responsável fiscal.

use std::sync::Arc;

use chrono::{Duration, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use tracing::{info, warn};

use clarituz_domain::entities::{
    integration_id, AmbienteIntegracao, Integracao, ProvedorIntegracao, StatusFiscal,
};
use clarituz_domain::ports::{
    ClienteRepository, CredentialVault, EstabelecimentoRepository, FiltroDocumentos,
    FiscalEventoRegistro, FiscalRepository, IntegracaoRepository, NovoDocumentoFiscal,
    ReservaRepository,
};
use clarituz_domain::DomainError;

use crate::actor::Ator;
use crate::error::AppResult;

/// Fábrica do cliente Spedy — a application não conhece reqwest; a
/// infra injeta uma closure que constrói `Arc<dyn ProvedorFiscal>` a
/// partir da chave aberta + ambiente.
pub type SpedyFactory = Arc<
    dyn Fn(String, AmbienteIntegracao) -> Arc<dyn clarituz_domain::ports::ProvedorFiscal>
        + Send
        + Sync,
>;

#[derive(Debug, Serialize)]
pub struct SpedyEmpresaView {
    pub id: String,
    pub cnpj: Option<String>,
    pub razao_social: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FiscalDocumentoView {
    #[serde(flatten)]
    pub doc: clarituz_domain::entities::FiscalDocumento,
    pub reserva: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct PreparaNfse {
    pub iddocumento: i64,
    pub tomador: serde_json::Value,
    pub valor_total: Decimal,
    pub descricao: String,
    pub competencia: chrono::NaiveDate,
    pub aviso: String,
    pub pendencias: Vec<String>,
}

pub struct FiscalService {
    repo: Arc<dyn FiscalRepository>,
    integracoes: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    reservas: Arc<dyn ReservaRepository>,
    clientes: Arc<dyn ClienteRepository>,
    estabelecimento: Arc<dyn EstabelecimentoRepository>,
    factory: SpedyFactory,
}

impl FiscalService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        repo: Arc<dyn FiscalRepository>,
        integracoes: Arc<dyn IntegracaoRepository>,
        vault: Arc<dyn CredentialVault>,
        reservas: Arc<dyn ReservaRepository>,
        clientes: Arc<dyn ClienteRepository>,
        estabelecimento: Arc<dyn EstabelecimentoRepository>,
        factory: SpedyFactory,
    ) -> Self {
        Self {
            repo,
            integracoes,
            vault,
            reservas,
            clientes,
            estabelecimento,
            factory,
        }
    }

    // -- resolução da integração + cliente autenticado --------------------

    async fn integracao(&self, ambiente: AmbienteIntegracao) -> AppResult<Integracao> {
        self.integracoes
            .buscar(ProvedorIntegracao::Spedy, ambiente)
            .await?
            .ok_or_else(|| DomainError::regra("Spedy não configurada neste ambiente.").into())
    }

    fn segredo_aberto(
        &self,
        integ: &Integracao,
        campo: &str,
        envelopes: &std::collections::HashMap<String, Vec<u8>>,
    ) -> AppResult<Option<String>> {
        match envelopes.get(campo) {
            Some(env) => Ok(Some(self.vault.abrir(
                &contexto_aad(integ.provedor, integ.ambiente, campo, integ.id),
                env,
            )?)),
            None => Ok(None),
        }
    }

    /// Cliente autenticado a partir da `api_key` cifrada. `exigir_habilitada`
    /// bloqueia novas emissões quando a integração está desativada —
    /// reconciliação de notas já transmitidas continua possível com `false`.
    async fn cliente(
        &self,
        ambiente: AmbienteIntegracao,
        exigir_habilitada: bool,
    ) -> AppResult<(Integracao, Arc<dyn clarituz_domain::ports::ProvedorFiscal>)> {
        let integ = self.integracao(ambiente).await?;
        if exigir_habilitada && !integ.habilitado {
            return Err(DomainError::regra(
                "Integração Spedy desativada — novas emissões bloqueadas.",
            )
            .into());
        }
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        let Some(api_key) = self.segredo_aberto(&integ, "api_key", &enc)? else {
            return Err(DomainError::regra("Spedy sem chave de API configurada.").into());
        };
        Ok((integ, (self.factory)(api_key, ambiente)))
    }

    async fn segredo_webhook(&self, integ: &Integracao) -> AppResult<Option<String>> {
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        self.segredo_aberto(integ, "webhook_secret", &enc)
    }

    /// Cliente autenticado no ambiente DA INTEGRAÇÃO do documento —
    /// consultas/reconciliações de documentos já transmitidos não
    /// dependem da integração estar habilitada para novas emissões.
    async fn cliente_do_doc(
        &self,
        doc: &clarituz_domain::entities::FiscalDocumento,
    ) -> AppResult<(Integracao, Arc<dyn clarituz_domain::ports::ProvedorFiscal>)> {
        let integ = self
            .integracoes
            .buscar_por_id(doc.idintegracao)
            .await?
            .ok_or_else(|| DomainError::regra("Integração do documento removida."))?;
        let (_, cli) = self.cliente(integ.ambiente, false).await?;
        Ok((integ, cli))
    }

    /// Aplica a visão remota ao documento — mapeamento explícito, com
    /// o cru sempre preservado em `status_remoto`.
    async fn aplicar_remoto(
        &self,
        iddoc: i64,
        nota: &clarituz_domain::ports::NotaRemota,
        atualizado_por: Option<i64>,
    ) -> AppResult<()> {
        let status = StatusFiscal::do_remoto(&nota.status).unwrap_or(StatusFiscal::Processando);
        self.repo
            .registrar_transicao(
                iddoc,
                status,
                Some(&nota.status),
                nota.processing_detail.as_deref(),
                Some(&nota.id),
                nota.number.as_deref(),
                nota.url.as_deref(),
                None,
                atualizado_por,
            )
            .await?;
        Ok(())
    }

    // -- configuração -----------------------------------------------------

    /// Teste de conexão — apenas leitura (empresa atual); nunca emite.
    pub async fn testar(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<SpedyEmpresaView> {
        ator.exigir_admin()?;
        let (_, cli) = self.cliente(ambiente, false).await?;
        let emp = cli.empresa().await?;
        Ok(SpedyEmpresaView {
            id: emp.id,
            cnpj: emp.cnpj,
            razao_social: emp.razao_social,
        })
    }

    /// Vincula a empresa remota à config local — confere CNPJ do
    /// estabelecimento antes, e grava divergência explícita na config.
    pub async fn vincular_empresa(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<SpedyEmpresaView> {
        ator.exigir_admin()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let emp = cli.empresa().await?;

        let est = self.estabelecimento.obter().await?;
        let cnpj_local = est
            .and_then(|e| e.cnpj)
            .map(|c| c.chars().filter(char::is_ascii_digit).collect::<String>());
        let cnpj_remoto = emp
            .cnpj
            .as_ref()
            .map(|c| c.chars().filter(char::is_ascii_digit).collect::<String>());
        let divergente = match (&cnpj_local, &cnpj_remoto) {
            (Some(l), Some(r)) => l != r,
            _ => false,
        };

        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({
                    "empresa_id": emp.id,
                    "empresa_cnpj": cnpj_remoto,
                    "empresa_razao": emp.razao_social,
                    "empresa_cnpj_divergente": divergente,
                }),
            )
            .await?;
        Ok(SpedyEmpresaView {
            id: emp.id,
            cnpj: emp.cnpj,
            razao_social: emp.razao_social,
        })
    }

    /// Configurações de emissão do município (IBGE) — provedores,
    /// regimes, métodos e campos exigidos. Município não atendido → 404
    /// do provedor vira pendência explícita.
    pub async fn municipio_settings(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        ibge: &str,
    ) -> AppResult<serde_json::Value> {
        ator.exigir_admin()?;
        if ibge.len() != 7 || !ibge.chars().all(|c| c.is_ascii_digit()) {
            return Err(DomainError::validacao("código IBGE do município inválido").into());
        }
        let (_, cli) = self.cliente(ambiente, false).await?;
        let v = cli.municipio_settings(ibge).await?;
        let integ = self.integracao(ambiente).await?;
        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({
                    "municipio_codigo": v["code"],
                    "municipio_nome": v["name"],
                    "municipio_provedores": v["providers"],
                }),
            )
            .await?;
        Ok(v)
    }

    /// Configurações remotas da empresa (blocos general/serviceInvoice…) —
    /// expõe ambiente fiscal, numeração e pendências do emissor.
    pub async fn empresa_settings(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<serde_json::Value> {
        ator.exigir_admin()?;
        let (_, cli) = self.cliente(ambiente, false).await?;
        cli.empresa_settings().await.map_err(Into::into)
    }

    /// Registra o webhook `invoice.status_changed` na conta e captura o
    /// segredo `whsec_` — armazenado cifrado como `webhook_secret`.
    pub async fn configurar_webhook(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        base_publica: &str,
    ) -> AppResult<String> {
        ator.exigir_admin()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let url = format!(
            "{}/api/v1/webhooks/spedy/{}",
            base_publica.trim_end_matches('/'),
            ambiente.as_str()
        );
        cli.configurar_webhook(&url).await?;
        let segredo = cli.segredo_webhook().await?;
        let enc = self.vault.selar(
            &contexto_aad(integ.provedor, integ.ambiente, "webhook_secret", integ.id),
            &segredo,
        )?;
        let mut mapa = std::collections::HashMap::new();
        mapa.insert("webhook_secret".to_string(), enc);
        self.integracoes
            .salvar(
                integ.id,
                integ.versao,
                &clarituz_domain::ports::AtualizacaoIntegracao {
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
            .mesclar_config(integ.id, &serde_json::json!({"webhook_registrado": true}))
            .await?;
        Ok(url)
    }

    // -- emissão a partir da reserva --------------------------------------

    /// Prepara o rascunho durável vinculado à reserva — valida tomador e
    /// configuração fiscal e devolve a prévia (sem validade fiscal).
    /// A confirmação é uma chamada separada e explícita.
    pub async fn preparar_nfse(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        idreserva: i64,
        input: PrepararNfseInput,
    ) -> AppResult<PreparaNfse> {
        ator.exigir_financeiro()?;
        let (integ, _cli) = self.cliente(ambiente, true).await?;

        // Proteção do modelo fiscal: host sandbox com o modelo remoto em
        // produção emitiria nota REAL — bloqueado antes de qualquer POST.
        let cfg = &integ.config;
        if ambiente == AmbienteIntegracao::Teste
            && cfg["fiscal_ambiente"].as_str() == Some("producao")
        {
            return Err(DomainError::regra(
                "Ambiente do modelo fiscal em produção com API sandbox — \
                 emissão geraria documento real. Ajuste a parametrização \
                 ou use a integração de produção.",
            )
            .into());
        }

        // Um documento ativo por reserva — duplo clique/navegação não
        // gera rascunhos paralelos (corrigir = reprocessar o existente).
        let ativos = self.repo.listar_por_reserva(idreserva).await?;
        if ativos.iter().any(|d| {
            matches!(
                d.status,
                StatusFiscal::Rascunho
                    | StatusFiscal::Enfileirada
                    | StatusFiscal::Processando
                    | StatusFiscal::Autorizada
                    | StatusFiscal::CancelamentoSolicitado
            )
        }) {
            return Err(DomainError::conflito(
                "Já existe documento fiscal ativo para esta reserva — \
                 acompanhe ou corrija o existente.",
            )
            .into());
        }

        let det = self
            .reservas
            .buscar_detalhe(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        let cliente = self
            .clientes
            .buscar(det.idcliente)
            .await?
            .ok_or_else(|| DomainError::regra("Reserva sem hóspede titular."))?;

        // Valor fiscal = diárias da reserva (valor * noites). Emissão não
        // cria receita nem duplica cobrança — é só o documento.
        let noites = (det.saidaprevista - det.entradaprevista).num_days().max(1);
        let valor = det.valordiaria * Decimal::from(noites);
        if valor <= Decimal::ZERO {
            return Err(DomainError::regra("Reserva sem valor faturável.").into());
        }

        // Tomador: hóspede por padrão; empresa (CNPJ) quando informada.
        let doc_tomador = input
            .tomador_documento
            .clone()
            .unwrap_or_else(|| cliente.cpf.clone());
        let doc_digits: String = doc_tomador.chars().filter(char::is_ascii_digit).collect();
        if !(doc_digits.len() == 11 || doc_digits.len() == 14) {
            return Err(DomainError::validacao(
                "Tomador precisa de CPF (11) ou CNPJ (14) — estrangeiros exigem tratamento próprio.",
            )
            .into());
        }
        let nome_tomador = input.tomador_nome.unwrap_or(cliente.nome);

        // Configuração fiscal obrigatória — nunca inventa códigos/alíquota.
        let mut pendencias: Vec<String> = Vec::new();
        for (campo, rotulo) in [
            (
                "fiscal_service_code",
                "código de serviço (municipal/federal)",
            ),
            (
                "fiscal_taxation_type",
                "natureza da tributação (taxationType)",
            ),
        ] {
            if cfg[campo].as_str().is_none_or(str::is_empty) {
                pendencias.push(rotulo.to_string());
            }
        }
        let iss = cfg["fiscal_iss_rate"].as_f64();
        if iss.is_none() {
            pendencias.push("alíquota de ISS".to_string());
        }
        if cfg["municipio_codigo"].as_u64().is_none() {
            pendencias.push("município de emissão (IBGE)".to_string());
        }
        if !pendencias.is_empty() {
            return Err(DomainError::regra(format!(
                "Parametrização fiscal incompleta: {}.",
                pendencias.join(", ")
            ))
            .into());
        }

        let descricao = cfg["fiscal_descricao"]
            .as_str()
            .map(|s| {
                s.replace("{reserva}", &idreserva.to_string())
                    .replace("{acomodacao}", &det.acomodacao_nome)
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("Serviço de hospedagem — reserva {idreserva}"));
        let competencia = input.competencia.unwrap_or_else(|| Utc::now().date_naive());

        let seq = self.repo.proxima_sequencia(integ.id).await?;
        let iid = integration_id("nfse", Some(idreserva), seq);
        let tomador = serde_json::json!({
            "name": nome_tomador,
            "federalTaxNumber": doc_digits,
            "email": input.tomador_email.or(cliente.email),
            "address": {
                "street": cliente.logradouro,
                "number": cliente.numero,
                "district": cliente.bairro,
                "postalCode": cliente.cep,
                "city": {"name": cliente.cidade, "state": cliente.estado},
            }
        });
        let mut payload = serde_json::json!({
            "description": descricao,
            "effectiveDate": format!("{competencia}T12:00:00Z"),
            "receiver": tomador,
            "taxationType": cfg["fiscal_taxation_type"],
            "total": {
                "invoiceAmount": valor,
                "issRate": cfg["fiscal_iss_rate"],
            }
        });
        // Códigos fiscais presentes na config — cada município exige um
        // conjunto diferente; só enviamos o que foi parametrizado.
        for (cfg_key, api_key) in [
            ("fiscal_service_code", "federalServiceCode"),
            ("fiscal_city_service_code", "cityServiceCode"),
            ("fiscal_cnae", "cnaeCode"),
            ("fiscal_nbs", "nbsCode"),
            ("fiscal_national_taxation_code", "nationalTaxationCode"),
        ] {
            if let Some(v) = cfg[cfg_key].as_str().filter(|s| !s.is_empty()) {
                payload[api_key] = serde_json::Value::String(v.to_string());
            }
        }

        let doc = self
            .repo
            .criar(&NovoDocumentoFiscal {
                idintegracao: integ.id,
                idreserva: Some(idreserva),
                modelo: "nfse".into(),
                integration_id: iid,
                tomador,
                payload,
                valor_total: valor,
                descricao: Some(descricao.clone()),
                competencia: Some(competencia),
                criado_por: Some(ator.id),
            })
            .await?;
        info!(doc = doc.id, reserva = idreserva, ator = %ator.login, "nfs-e preparada");
        Ok(PreparaNfse {
            iddocumento: doc.id,
            tomador: doc.tomador,
            valor_total: valor,
            descricao,
            competencia,
            aviso: "Prévia sem validade fiscal — a nota só é transmitida após confirmação.".into(),
            pendencias: Vec::new(),
        })
    }

    /// Confirmação explícita — o documento vira intenção durável na fila;
    /// a transmissão real acontece no worker (não nesta chamada).
    pub async fn confirmar(&self, ator: &Ator, iddoc: i64) -> AppResult<()> {
        ator.exigir_financeiro()?;
        let doc = self.doc(iddoc).await?;
        if doc.status != StatusFiscal::Rascunho {
            return Err(
                DomainError::conflito("Documento já confirmado ou em processamento.").into(),
            );
        }
        self.repo
            .registrar_transicao(
                iddoc,
                StatusFiscal::Enfileirada,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(ator.id),
            )
            .await?;
        info!(doc = iddoc, ator = %ator.login, "nfs-e enfileirada para transmissão");
        Ok(())
    }

    async fn doc(&self, id: i64) -> AppResult<clarituz_domain::entities::FiscalDocumento> {
        Ok(self
            .repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Documento fiscal não encontrado."))?)
    }

    // -- fila / worker -----------------------------------------------------

    /// Drena a fila de emissão — idempotente e seguro para réplicas:
    /// cada documento é reivindicado com SKIP LOCKED e o `integrationId`
    /// é estável, então repetição não gera nota duplicada no provedor.
    pub async fn drenar_fila(&self) -> AppResult<usize> {
        let docs = self.repo.reivindicar_fila(10).await?;
        let mut ok = 0usize;
        for doc in docs {
            match self.transmitir(&doc).await {
                Ok(()) => ok += 1,
                Err(e) => {
                    warn!(doc = doc.id, erro = %e, "fila fiscal: transmissão falhou");
                    // Erros transitórios → backoff com jitter; rejeição de
                    // dados já chega como erro do provedor e NÃO é retry.
                    let transitorio = {
                        let msg = e.to_string();
                        msg.contains("timeout")
                            || msg.contains("indispon")
                            || msg.contains("transporte")
                            || msg.contains("HTTP 429")
                            || msg.contains("HTTP 5")
                    };
                    let backoff =
                        Duration::seconds(60 * (1i64 << doc.tentativas.min(4)) + (doc.id % 30));
                    let proxima = if transitorio {
                        Utc::now() + backoff
                    } else {
                        // Não-transitório: para a fila imediatamente.
                        Utc::now() + Duration::days(3650)
                    };
                    let _ = self
                        .repo
                        .reagendar(doc.id, doc.tentativas + 1, proxima, &e.to_string())
                        .await;
                    if !transitorio {
                        let _ = self
                            .repo
                            .registrar_transicao(
                                doc.id,
                                StatusFiscal::Falha,
                                None,
                                None,
                                None,
                                None,
                                None,
                                Some(&e.to_string()),
                                None,
                            )
                            .await;
                    }
                }
            }
        }
        Ok(ok)
    }

    async fn transmitir(
        &self,
        doc: &clarituz_domain::entities::FiscalDocumento,
    ) -> Result<(), DomainError> {
        let Some(integ) = self.integracoes.buscar_por_id(doc.idintegracao).await? else {
            return Err(DomainError::regra("integração do documento removida"));
        };
        if !integ.habilitado {
            return Err(DomainError::regra("spedy: integração desativada"));
        }
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        let api_key = enc
            .get("api_key")
            .map(|e| {
                self.vault.abrir(
                    &contexto_aad(integ.provedor, integ.ambiente, "api_key", integ.id),
                    e,
                )
            })
            .transpose()?
            .ok_or_else(|| DomainError::regra("spedy: sem api_key"))?;
        let cli = (self.factory)(api_key, integ.ambiente);

        // Mesmo `integration_id` + mesmo `payload` — o provedor deduplica;
        // timeout após aceitação não gera segunda nota.
        let nota = cli.emitir(&doc.integration_id, &doc.payload).await?;
        let status = StatusFiscal::do_remoto(&nota.status).unwrap_or(StatusFiscal::Processando);
        self.repo
            .registrar_transicao(
                doc.id,
                status,
                Some(&nota.status),
                nota.processing_detail.as_deref(),
                Some(&nota.id),
                nota.number.as_deref(),
                nota.url.as_deref(),
                None,
                None,
            )
            .await?;
        Ok(())
    }

    // -- acompanhamento -----------------------------------------------------

    pub async fn listar(
        &self,
        ator: &Ator,
        filtro: FiltroDocumentos,
    ) -> AppResult<(Vec<FiscalDocumentoView>, i64)> {
        ator.exigir_financeiro()?;
        let (docs, total) = self.repo.listar(&filtro).await?;
        Ok((
            docs.into_iter()
                .map(|d| FiscalDocumentoView {
                    reserva: d.idreserva,
                    doc: d,
                })
                .collect(),
            total,
        ))
    }

    pub async fn por_reserva(
        &self,
        ator: &Ator,
        idreserva: i64,
    ) -> AppResult<Vec<FiscalDocumentoView>> {
        ator.exigir_financeiro()?;
        Ok(self
            .repo
            .listar_por_reserva(idreserva)
            .await?
            .into_iter()
            .map(|d| FiscalDocumentoView {
                reserva: d.idreserva,
                doc: d,
            })
            .collect())
    }

    pub async fn detalhe(&self, ator: &Ator, id: i64) -> AppResult<FiscalDocumentoView> {
        ator.exigir_financeiro()?;
        let d = self.doc(id).await?;
        Ok(FiscalDocumentoView {
            reserva: d.idreserva,
            doc: d,
        })
    }

    /// Consulta normal por GET — atualiza o status local pelo remoto.
    pub async fn sincronizar(&self, ator: &Ator, id: i64) -> AppResult<FiscalDocumentoView> {
        ator.exigir_financeiro()?;
        let doc = self.doc(id).await?;
        let Some(remote) = doc.remote_id.clone() else {
            return Err(DomainError::regra("Documento ainda não transmitido.").into());
        };
        let integ = self
            .integracoes
            .buscar_por_id(doc.idintegracao)
            .await?
            .ok_or_else(|| DomainError::regra("Integração do documento removida."))?;
        let (_, cli) = self.cliente(integ.ambiente, false).await?;
        let nota = cli.consultar(&remote).await?;
        self.aplicar_remoto(doc.id, &nota, Some(ator.id)).await?;
        self.detalhe(ator, id).await
    }

    /// Reconciliação com a autoridade — para divergências, não para
    /// acelerar a fila.
    pub async fn reconciliar(&self, ator: &Ator, id: i64) -> AppResult<FiscalDocumentoView> {
        ator.exigir_financeiro()?;
        let doc = self.doc(id).await?;
        let Some(remote) = doc.remote_id.clone() else {
            return Err(DomainError::regra("Documento ainda não transmitido.").into());
        };
        let (_, cli) = self.cliente_do_doc(&doc).await?;
        let nota = cli.reconciliar(&remote).await?;
        self.aplicar_remoto(doc.id, &nota, Some(ator.id)).await?;
        self.detalhe(ator, id).await
    }

    /// Reprocessa a emissão existente — para nota rejeitada/falha já
    /// transmitida; payload novo exige NOVA preparação (auditoria).
    pub async fn reprocessar(&self, ator: &Ator, id: i64) -> AppResult<FiscalDocumentoView> {
        ator.exigir_financeiro()?;
        let doc = self.doc(id).await?;
        if !doc.status.reprocessavel() {
            return Err(DomainError::conflito(format!(
                "Documento em status '{}' não é reprocessável.",
                doc.status.as_str()
            ))
            .into());
        }
        // Já aceita no provedor → POST /issue.
        if let Some(remote) = doc.remote_id.clone() {
            let (_, cli) = self.cliente_do_doc(&doc).await?;
            let nota = cli.reprocessar(&remote).await?;
            self.aplicar_remoto(doc.id, &nota, Some(ator.id)).await?;
        } else {
            // Nunca transmitida → volta para a fila com o mesmo
            // integration_id (payload inalterado).
            self.repo
                .registrar_transicao(
                    doc.id,
                    StatusFiscal::Enfileirada,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(ator.id),
                )
                .await?;
            self.repo
                .reagendar(doc.id, 0, Utc::now(), "reprocessamento manual")
                .await?;
        }
        self.detalhe(ator, id).await
    }

    // -- cancelamento e documentos ------------------------------------------

    /// Solicita cancelamento com justificativa — preserva `autorizada`
    /// até o resultado confirmado; reserva e pagamento não são tocados.
    pub async fn cancelar(
        &self,
        ator: &Ator,
        id: i64,
        motivo: &str,
    ) -> AppResult<FiscalDocumentoView> {
        ator.exigir_financeiro()?;
        let doc = self.doc(id).await?;
        if !doc.status.cancelavel() {
            return Err(DomainError::conflito(format!(
                "Só é possível cancelar nota autorizada — status atual '{}'.",
                doc.status.as_str()
            ))
            .into());
        }
        if motivo.trim().len() < 5 {
            return Err(DomainError::validacao(
                "Justificativa de cancelamento obrigatória (mín. 5 caracteres).",
            )
            .into());
        }
        let remote = doc
            .remote_id
            .clone()
            .ok_or_else(|| DomainError::regra("Documento sem identificador remoto."))?;
        let (_, cli) = self.cliente_do_doc(&doc).await?;
        let nota = cli.cancelar(&remote, motivo.trim()).await?;
        // O DELETE responde a nota atualizada — o status remoto manda;
        // se continuar autorizada no remoto, registramos a solicitação.
        let mapeado =
            StatusFiscal::do_remoto(&nota.status).unwrap_or(StatusFiscal::CancelamentoSolicitado);
        self.repo
            .registrar_transicao(
                doc.id,
                mapeado,
                Some(&nota.status),
                nota.processing_detail.as_deref(),
                None,
                nota.number.as_deref(),
                nota.url.as_deref(),
                None,
                Some(ator.id),
            )
            .await?;
        self.repo
            .registrar_motivo_cancelamento(doc.id, motivo.trim())
            .await?;
        self.detalhe(ator, id).await
    }

    /// Binário oficial (pdf/xml) — só de nota autorizada.
    pub async fn arquivo(&self, ator: &Ator, id: i64, tipo: &str) -> AppResult<(Vec<u8>, String)> {
        ator.exigir_financeiro()?;
        let doc = self.doc(id).await?;
        if doc.status != StatusFiscal::Autorizada && doc.status != StatusFiscal::Cancelada {
            return Err(DomainError::regra(
                "XML/PDF oficiais só existem após autorização da nota.",
            )
            .into());
        }
        let remote = doc
            .remote_id
            .clone()
            .ok_or_else(|| DomainError::regra("Documento sem identificador remoto."))?;
        let (_, cli) = self.cliente_do_doc(&doc).await?;
        let bytes = cli.arquivo(&remote, tipo).await?;
        let nome = format!("nfse-{}-{}.{}", doc.id, remote, tipo);
        Ok((bytes, nome))
    }

    // -- webhook --------------------------------------------------------------

    /// Abre o segredo `whsec_` da integração para a rota verificar a
    /// assinatura (a verificação HMAC é função da infraestrutura).
    pub async fn webhook_secret(&self, ambiente: AmbienteIntegracao) -> AppResult<Option<String>> {
        let integ = self.integracao(ambiente).await?;
        self.segredo_webhook(&integ).await
    }

    /// Registra e processa um evento JÁ autenticado pela rota
    /// (assinatura Standard Webhooks válida). Dedup por event_id — a
    /// duplicata é reconhecida sem repetir efeitos.
    pub async fn webhook_receber(
        &self,
        ambiente: AmbienteIntegracao,
        event_id: &str,
        payload: serde_json::Value,
    ) -> AppResult<WebhookResultado> {
        let integ = self.integracao(ambiente).await?;
        if event_id.is_empty() {
            return Err(DomainError::validacao("webhook sem identificador").into());
        }
        let tipo = payload["type"]
            .as_str()
            .or_else(|| payload["event"].as_str())
            .unwrap_or("desconhecido")
            .to_string();
        match self
            .repo
            .registrar_evento(Some(integ.id), event_id, &tipo, &payload, true)
            .await?
        {
            FiscalEventoRegistro::Duplicado => Ok(WebhookResultado::Duplicado),
            FiscalEventoRegistro::Inserido(evid) => {
                match self.processar_evento(&payload, integ.id).await {
                    Ok(()) => {
                        let _ = self.repo.marcar_evento(evid, "processado", None).await;
                        Ok(WebhookResultado::Processado)
                    }
                    Err(e) => {
                        let _ = self
                            .repo
                            .marcar_evento(evid, "falhou", Some(&e.to_string()))
                            .await;
                        // O 500 da rota faz o provedor reentregar — falha
                        // interna é recuperável.
                        Err(e.into())
                    }
                }
            }
        }
    }

    /// Aplica o evento ao documento — confirma empresa/documento antes
    /// de associar (um evento de outro CNPJ não altera reserva alguma).
    async fn processar_evento(
        &self,
        payload: &serde_json::Value,
        _idintegracao: i64,
    ) -> Result<(), DomainError> {
        let obj = &payload["data"];
        let remote_id = obj["id"]
            .as_str()
            .or_else(|| payload["invoice"]["id"].as_str())
            .or_else(|| payload["id"].as_str());
        let Some(remote_id) = remote_id else {
            return Ok(()); // evento sem documento identificável — só auditado
        };
        let Some(doc) = self.repo.buscar_por_remote_id(remote_id).await? else {
            // Documento desconhecido — pode ser de outro ambiente/empresa;
            // auditado como descartado sem efeitos.
            return Ok(());
        };
        if doc.status.terminal() {
            return Ok(()); // cancelada não volta a autorizada por evento antigo
        }
        let status_remoto = obj["status"]
            .as_str()
            .or_else(|| payload["status"].as_str())
            .unwrap_or_default();
        let Some(status) = StatusFiscal::do_remoto(status_remoto) else {
            return Ok(()); // status desconhecido — preservado no evento cru
        };
        // Nunca regride: autorizada→processando etc. é ignorado.
        if !superior(status, doc.status) {
            return Ok(());
        }
        self.repo
            .registrar_transicao(
                doc.id,
                status,
                Some(status_remoto),
                obj["processingDetail"].as_str(),
                None,
                obj["number"].as_str(),
                obj["url"].as_str(),
                None,
                None,
            )
            .await
    }
}

/// Ordem de progresso para tolerar entregas fora de ordem.
fn superior(novo: StatusFiscal, atual: StatusFiscal) -> bool {
    fn ordem(s: StatusFiscal) -> u8 {
        match s {
            StatusFiscal::Rascunho => 0,
            StatusFiscal::Enfileirada | StatusFiscal::Falha => 1,
            StatusFiscal::Processando => 2,
            StatusFiscal::Autorizada | StatusFiscal::Rejeitada => 3,
            StatusFiscal::CancelamentoSolicitado => 4,
            StatusFiscal::Cancelada => 5,
        }
    }
    ordem(novo) > ordem(atual)
}

/// Resultado do webhook para a rota traduzir em HTTP (sem axum aqui).
pub enum WebhookResultado {
    Processado,
    Duplicado,
}

fn contexto_aad(p: ProvedorIntegracao, a: AmbienteIntegracao, campo: &str, id: i64) -> String {
    format!("{}|{}|{campo}|{id}", p.as_str(), a.as_str())
}

/// Entrada da preparação — o tomador pode ser sobrescrito (empresa
/// contratante) ou herdado do hóspede.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepararNfseInput {
    pub tomador_nome: Option<String>,
    pub tomador_documento: Option<String>,
    pub tomador_email: Option<String>,
    pub competencia: Option<chrono::NaiveDate>,
}
