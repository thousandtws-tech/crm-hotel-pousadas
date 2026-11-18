use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::entities::*;
use crate::enums::{CanalEnvio, StatusAvaliacao};
use crate::error::DomainError;

#[async_trait]
pub trait FilaEnvioRepository: Send + Sync {
    async fn enfileirar(&self, novo: NovoEnvio) -> Result<i64, DomainError>;
    async fn proximos(
        &self,
        agora: DateTime<Utc>,
        limite: i64,
    ) -> Result<Vec<ItemFila>, DomainError>;
    async fn marcar_enviado(
        &self,
        id: i64,
        provider_msg_id: Option<String>,
    ) -> Result<(), DomainError>;
    async fn vincular_provedor(
        &self,
        id: i64,
        provedor: &str,
        idintegracao: Option<i64>,
    ) -> Result<(), DomainError>;
    async fn marcar_entrega(
        &self,
        provedor: &str,
        provider_msg_id: &str,
    ) -> Result<u64, DomainError>;
    async fn marcar_lido(&self, provedor: &str, provider_msg_id: &str) -> Result<u64, DomainError>;
    async fn marcar_falha(
        &self,
        id: i64,
        erro: &str,
        backoff_segundos: i64,
    ) -> Result<(), DomainError>;
    async fn cancelar(&self, id: i64) -> Result<(), DomainError>;
    async fn listar(&self, limite: i64) -> Result<Vec<ItemFila>, DomainError>;

    // -- pós-reserva: dedup, supressão, resultado ambíguo e histórico ---------

    /// Enfileira com chave idempotente — `None` quando a intenção já
    /// existe (refresh, double-click, evento repetido ou worker concorrente).
    async fn enfileirar_dedup(
        &self,
        novo: &NovoEnvio,
        dedup_key: &str,
        template_versao: i32,
    ) -> Result<Option<i64>, DomainError>;
    /// Itens da reserva (mais antigo → mais novo) — seção "Comunicações".
    async fn por_reserva(&self, idreserva: i64) -> Result<Vec<ItemFila>, DomainError>;
    async fn buscar(&self, id: i64) -> Result<Option<ItemFila>, DomainError>;
    /// Suprime itens ainda pendentes de um conjunto de templates —
    /// transição posterior tornou a intenção obsoleta (ex.: confirmação
    /// após pendência). Devolve quantos foram suprimidos.
    async fn suprimir_pendentes(
        &self,
        idreserva: i64,
        templates: &[&str],
        motivo: &str,
    ) -> Result<u64, DomainError>;
    /// Marca item individual como suprimido (verificação pré-envio).
    async fn marcar_suprimido(&self, id: i64, motivo: &str) -> Result<(), DomainError>;
    /// Sem resposta do provedor — resultado ambíguo, não reenvia cego.
    async fn marcar_desconhecido(&self, id: i64, erro: &str) -> Result<(), DomainError>;
    /// Reenvios manuais recentes da reserva — rate limit do reenvio.
    async fn reenvios_recentes(&self, idreserva: i64, janela_seg: i64) -> Result<i64, DomainError>;

    async fn email_suprimido(&self, email: &str) -> Result<bool, DomainError>;
    async fn suprimir_email(&self, email: &str, motivo: &str) -> Result<(), DomainError>;

    async fn regras_do_evento(&self, evento: &str) -> Result<Vec<RegraMatriz>, DomainError>;
    async fn listar_matriz(&self) -> Result<Vec<RegraMatriz>, DomainError>;
    async fn gravar_regra(&self, regra: &RegraMatriz) -> Result<(), DomainError>;
}

#[async_trait]
pub trait Emissor: Send + Sync {
    fn canal(&self) -> CanalEnvio;
    fn provedor(&self) -> &'static str;
    async fn enviar(
        &self,
        destino: &str,
        template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError>;
}

pub struct EmissorResolvido {
    pub provedor: String,
    pub idintegracao: Option<i64>,
    pub emissor: std::sync::Arc<dyn Emissor>,
}

pub struct CredenciaisZApi {
    pub idintegracao: i64,
    pub instance_id: String,
    pub instance_token: String,
    pub client_token: String,
}

pub struct ZApiStatusView {
    pub conectado: bool,
    pub smartphone_conectado: bool,
    pub telefone: Option<String>,
    pub detalhe: Option<String>,
}

pub enum ZApiQrView {
    Imagem(String),
    Assistido(String),
}

#[async_trait]
pub trait ComunicacaoResolver: Send + Sync {
    async fn whatsapp(&self, provedor: Option<&str>) -> Result<EmissorResolvido, DomainError>;
    /// Integração zapi persistida (config + estado) — webhooks/admin.
    async fn integracao_zapi(&self) -> Result<Option<crate::entities::Integracao>, DomainError>;
    /// Segredo aberto por campo — `webhook_segredo` valida callbacks.
    async fn segredo_zapi(&self, campo: &str) -> Result<Option<String>, DomainError>;
    /// Credenciais completas — operações admin (QR, webhooks, teste).
    async fn credenciais_zapi_abertas(&self) -> Result<Option<CredenciaisZApi>, DomainError>;

    /// `GET /status` +`/device` — teste de conexão sem mensagens.
    async fn zapi_status(&self) -> Result<Option<ZApiStatusView>, DomainError>;
    /// `GET /qr-code/image` — imagem ou fluxo assistido (challenge).
    async fn zapi_qr(&self) -> Result<ZApiQrView, DomainError>;
    /// Registra os callbacks no `callback_base` (com segredo no path) —
    /// devolve quantos endpoints foram configurados.
    async fn zapi_configurar_webhooks(&self, callback_base: &str) -> Result<usize, DomainError>;
    async fn zapi_desconectar(&self) -> Result<(), DomainError>;
    async fn zapi_enviar_direto(
        &self,
        telefone: &str,
        mensagem: &str,
    ) -> Result<Option<String>, DomainError>;
}

#[async_trait]
pub trait ComunicacaoEventoRepository: Send + Sync {
    async fn inbox(
        &self,
        provedor: &str,
        event_id: &str,
        tipo: &str,
        payload: &serde_json::Value,
        idintegracao: Option<i64>,
    ) -> Result<Option<i64>, DomainError>;
    async fn marcar_processado(&self, id: i64) -> Result<(), DomainError>;
    async fn marcar_falha(&self, id: i64, erro: &str) -> Result<(), DomainError>;
    async fn descartar(&self, id: i64) -> Result<(), DomainError>;
    async fn pendentes(&self, limite: i64) -> Result<Vec<ComunicacaoEvento>, DomainError>;
    async fn da_integracao(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<ComunicacaoEvento>, DomainError>;
}

#[async_trait]
pub trait PushRepository: Send + Sync {
    async fn gravar(&self, sub: &PushSubscription) -> Result<(), DomainError>;
    async fn remover(&self, endpoint: &str) -> Result<(), DomainError>;
    async fn por_papel(&self, papel: i16) -> Result<Vec<PushSubscription>, DomainError>;
}

#[async_trait]
pub trait AvaliacaoRepository: Send + Sync {
    async fn criar(
        &self,
        idreserva: i64,
        idcliente: i64,
        plataforma: &str,
    ) -> Result<Avaliacao, DomainError>;
    async fn por_token(&self, token: uuid::Uuid) -> Result<Avaliacao, DomainError>;
    async fn por_reserva(&self, idreserva: i64) -> Result<Option<Avaliacao>, DomainError>;
    async fn marcar_enviada(&self, id: i64) -> Result<(), DomainError>;
    async fn marcar_lembrete(&self, id: i64) -> Result<(), DomainError>;
    async fn gravar_resposta_hospede(
        &self,
        id: i64,
        r: &RespostaAvaliacao,
    ) -> Result<(), DomainError>;
    async fn responder(
        &self,
        id: i64,
        resposta: &str,
        idfuncionario: i64,
    ) -> Result<(), DomainError>;
    async fn listar(
        &self,
        status: Option<StatusAvaliacao>,
        limite: i64,
    ) -> Result<Vec<Avaliacao>, DomainError>;
    async fn pendentes_lembrete(&self, ate: DateTime<Utc>) -> Result<Vec<Avaliacao>, DomainError>;
    async fn pendentes_expirar(&self, ate: DateTime<Utc>) -> Result<Vec<Avaliacao>, DomainError>;
    async fn expirar(&self, id: i64) -> Result<(), DomainError>;
}

#[async_trait]
pub trait FidelidadeRepository: Send + Sync {
    async fn niveis(&self) -> Result<Vec<NivelFidelidade>, DomainError>;
    async fn gravar_nivel(&self, nivel: &NivelFidelidade) -> Result<i64, DomainError>;
    async fn remover_nivel(&self, id: i64) -> Result<(), DomainError>;
    async fn do_cliente(&self, idcliente: i64) -> Result<Option<FidelidadeCliente>, DomainError>;
    async fn recomputar(&self, idcliente: i64) -> Result<(), DomainError>;
    async fn kpis_cliente(&self, idcliente: i64) -> Result<serde_json::Value, DomainError>;
}

#[async_trait]
pub trait AutomacaoRepository: Send + Sync {
    async fn checkins_sem_fnrh(
        &self,
        data: chrono::NaiveDate,
    ) -> Result<Vec<ReservaAuto>, DomainError>;
    async fn checkouts_do_dia(
        &self,
        data: chrono::NaiveDate,
    ) -> Result<Vec<ReservaAuto>, DomainError>;
    async fn finalizadas_sem_avaliacao(
        &self,
        desde: DateTime<Utc>,
    ) -> Result<Vec<ReservaAuto>, DomainError>;
    async fn existe_envio(
        &self,
        idreserva: i64,
        template: &str,
        canal: CanalEnvio,
    ) -> Result<bool, DomainError>;
    async fn reserva_por_id(&self, idreserva: i64) -> Result<Option<ReservaAuto>, DomainError>;
    /// Snapshot completo para mensagens transacionais pós-reserva —
    /// inclui consentimento WhatsApp e situação de pagamento agregada.
    async fn reserva_pos_reserva(
        &self,
        idreserva: i64,
    ) -> Result<Option<ReservaPosReserva>, DomainError>;
    async fn reserva_publica_por_token(
        &self,
        token: uuid::Uuid,
    ) -> Result<Option<ReservaAuto>, DomainError>;
    async fn reserva_por_telefone(&self, finais: &str) -> Result<Option<ReservaAuto>, DomainError>;
    async fn gravar_pre_ficha(
        &self,
        idreserva: i64,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError>;
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct ReservaAuto {
    pub idreserva: i64,
    pub idcliente: i64,
    pub cliente_nome: String,
    pub cliente_email: Option<String>,
    pub cliente_telefone: Option<String>,
    pub entradaprevista: chrono::NaiveDate,
    pub saidaprevista: chrono::NaiveDate,
    pub acomodacao_nome: Option<String>,
    pub token_publico: Option<uuid::Uuid>,
    #[sqlx(default)]
    pub fnrh_assinatura: bool,
    /// Consentimento transacional de WhatsApp — templates automáticos
    /// (FNRH, checkout, pesquisa) só vão ao WhatsApp com opt-in.
    #[sqlx(default)]
    pub whatsapp_optin: bool,
}

/// Snapshot da reserva para os templates pós-reserva — dados do hóspede,
/// estadia, status, consentimento WhatsApp e pagamento agregado.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ReservaPosReserva {
    pub idreserva: i64,
    pub idcliente: i64,
    pub cliente_nome: String,
    pub cliente_email: Option<String>,
    pub cliente_telefone: Option<String>,
    #[sqlx(default)]
    pub whatsapp_optin: bool,
    pub acomodacao_nome: Option<String>,
    pub quantidade_hospedes: i32,
    pub entradaprevista: chrono::NaiveDate,
    pub saidaprevista: chrono::NaiveDate,
    pub status: crate::enums::StatusReserva,
    pub valor_total: rust_decimal::Decimal,
    #[sqlx(default)]
    pub pago_centavos: i64,
    #[sqlx(default)]
    pub pendente_centavos: i64,
    pub token_publico: Option<uuid::Uuid>,
    pub expira_em: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct InnaMensagem {
    pub id: i64,
    pub idreserva: i64,
    pub canal: String,
    pub origem: String,
    pub texto: String,
    pub criado_em: DateTime<Utc>,
}

#[async_trait]
pub trait InnaRepository: Send + Sync {
    /// Grava mensagem; `provider_id` (wamid Meta) deduplica o webhook —
    /// devolve `None` quando o id já existia (mensagem repetida).
    async fn gravar_mensagem(
        &self,
        idreserva: i64,
        canal: &str,
        origem: &str,
        texto: &str,
        provider_id: Option<&str>,
    ) -> Result<Option<i64>, DomainError>;
    /// Últimas mensagens da reserva, mais antiga → mais nova.
    async fn historico(
        &self,
        idreserva: i64,
        limite: i64,
    ) -> Result<Vec<InnaMensagem>, DomainError>;
}

/// Resposta do serviço de IA — `escalar` sinaliza que um humano deve
/// assumir (pedido fora do escopo, reclamação grave, solicitação explícita).
pub struct ConciergeResposta {
    pub texto: String,
    pub escalar: bool,
    pub motivo: Option<String>,
}

/// Port do serviço Inná (HTTP) — a aplicação monta o contexto seguro da
/// reserva e recebe texto + flag de escalada. Ausente → degradação segura.
#[async_trait]
pub trait ConciergeIa: Send + Sync {
    async fn responder(
        &self,
        contexto: &serde_json::Value,
        mensagem: &str,
        historico: &[InnaMensagem],
    ) -> Result<ConciergeResposta, DomainError>;
}

// ---------------------------------------------------------------------------
// LGPD — solicitações do titular, opt-out, anonimização e aceite de termos.
// Campos do cliente vivem aqui (repo dedicado) para não inflar o entity
// `Cliente` usado em dezenas de consultas.
// ---------------------------------------------------------------------------

/// Solicitação do titular (LGPD art. 18) — aberta pelo portal do hóspede
/// ou registrada pela recepção; ciclo aberta → respondida → executada.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct LgpdSolicitacao {
    pub id: i64,
    pub idcliente: Option<i64>,
    pub idreserva: Option<i64>,
    pub tipo: String,
    pub detalhe: Option<String>,
    pub canal: String,
    pub status: String,
    pub resposta: Option<String>,
    pub respondida_em: Option<chrono::DateTime<chrono::Utc>>,
    pub respondida_por: Option<i64>,
    pub criado_em: chrono::DateTime<chrono::Utc>,
    pub atualizado_em: chrono::DateTime<chrono::Utc>,
}

#[async_trait]
pub trait LgpdRepository: Send + Sync {
    /// Marca opt-out por telefone (comando "sair" no bot) ou por idcliente
    /// (link descadastrar). Retorna quantos clientes foram atualizados.
    async fn opt_out_telefone(
        &self,
        telefone_digitos: &str,
        canal: &str,
    ) -> Result<u64, DomainError>;
    async fn opt_out_cliente(&self, idcliente: i64, canal: &str) -> Result<(), DomainError>;
    /// true → não enviar mensagens não-transacionais a este cliente.
    async fn cliente_opt_out(&self, idcliente: i64) -> Result<bool, DomainError>;
    /// Registra consentimento de marketing (checkbox no FNRH/site).
    async fn registrar_consent(&self, idcliente: i64) -> Result<(), DomainError>;
    /// Aceite CDC/LGPD na reserva — data + IP do titular.
    async fn marcar_termos(&self, idreserva: i64, ip: &str) -> Result<(), DomainError>;
    /// ECA: referência da autorização dos pais p/ menor desacompanhado.
    async fn marcar_autorizacao_menor(&self, idreserva: i64, doc: &str) -> Result<(), DomainError>;
    async fn autorizacao_menor(&self, idreserva: i64) -> Result<Option<String>, DomainError>;
    /// Todos os dados pessoais do cliente (LGPD art. 18, acesso).
    async fn exportar_cliente(&self, idcliente: i64) -> Result<serde_json::Value, DomainError>;
    /// Apaga PII mantendo trilha fiscal/FNRH exigida por lei.
    async fn anonimizar_cliente(&self, idcliente: i64) -> Result<(), DomainError>;
    /// Retenção — anonimiza clientes cujo último check-out supera o prazo.
    async fn anonimizar_vencidos(&self, anos: i32) -> Result<u64, DomainError>;

    async fn criar_solicitacao(
        &self,
        idcliente: Option<i64>,
        idreserva: Option<i64>,
        tipo: &str,
        detalhe: Option<&str>,
        canal: &str,
    ) -> Result<i64, DomainError>;
    async fn listar_solicitacoes(
        &self,
        status: Option<&str>,
    ) -> Result<Vec<LgpdSolicitacao>, DomainError>;
    async fn responder_solicitacao(
        &self,
        id: i64,
        resposta: &str,
        idfuncionario: i64,
    ) -> Result<(), DomainError>;
    /// Solicitações 'aberta' há mais de `dias` — SLA legal do art. 19
    /// (15 dias). O worker diário usa pra alertar a equipe.
    async fn solicitacoes_vencidas(&self, dias: i32) -> Result<Vec<LgpdSolicitacao>, DomainError>;

    // -- Incidentes de segurança (art. 48) ------------------------------------
    async fn criar_incidente(
        &self,
        novo: &NovoIncidente,
        criado_por: i64,
    ) -> Result<i64, DomainError>;
    async fn listar_incidentes(&self) -> Result<Vec<LgpdIncidente>, DomainError>;
    /// Marca a comunicação do incidente — `destino` = 'anpd' | 'titulares'.
    async fn marcar_comunicacao_incidente(&self, id: i64, destino: &str)
        -> Result<(), DomainError>;
}

/// Registro de incidente de segurança — LGPD art. 48. Documenta o fato,
/// o risco e as comunicações à ANPD e aos titulares.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct LgpdIncidente {
    pub id: i64,
    pub descricao: String,
    pub tipos_dados: Option<String>,
    pub titulares_estimados: Option<i32>,
    pub risco: String,
    pub medidas: Option<String>,
    pub status: String,
    pub comunicado_anpd_em: Option<chrono::DateTime<chrono::Utc>>,
    pub comunicado_titulares_em: Option<chrono::DateTime<chrono::Utc>>,
    pub criado_por: Option<i64>,
    pub criado_em: chrono::DateTime<chrono::Utc>,
    pub atualizado_em: chrono::DateTime<chrono::Utc>,
}

/// Entrada de novo incidente — também é o DTO do POST admin
/// (`Deserialize`) e o payload do repositório.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct NovoIncidente {
    pub descricao: String,
    pub tipos_dados: Option<String>,
    pub titulares_estimados: Option<i32>,
    /// 'baixo' | 'medio' | 'alto' — validado no serviço.
    pub risco: Option<String>,
    pub medidas: Option<String>,
}

// ---------------------------------------------------------------------------
// Pré-reserva via WhatsApp — máquina de estados por telefone.
// ---------------------------------------------------------------------------

/// Estado da conversa de pré-reserva — expira sozinho.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PreReserva {
    pub telefone: String,
    /// 'datas' → 'nome' → 'confirmacao'.
    pub etapa: String,
    pub dados: serde_json::Value,
    pub expira_em: chrono::DateTime<chrono::Utc>,
}

#[async_trait]
pub trait PreReservaRepository: Send + Sync {
    /// Estado vigente (não expirado) do telefone.
    async fn pre_reserva_obter(&self, telefone: &str) -> Result<Option<PreReserva>, DomainError>;
    async fn pre_reserva_salvar(
        &self,
        telefone: &str,
        etapa: &str,
        dados: &serde_json::Value,
        expira_em: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), DomainError>;
    async fn pre_reserva_remover(&self, telefone: &str) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Atendimento — protocolos por setor com SLA e escalonamento.
// ---------------------------------------------------------------------------

/// Protocolo de atendimento humano — aberto pela escalada da Inná ou
/// pela recepção, roteado por setor, escalado no vencimento do SLA.
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct Atendimento {
    pub id: i64,
    /// `A-000123` — referência falável pro hóspede e pro staff.
    pub protocolo: String,
    /// 'whatsapp' | 'portal' | 'interno'.
    pub origem: String,
    /// 'recepcao' | 'governanca' | 'manutencao' | 'gerencia'.
    pub setor: String,
    /// 'normal' | 'urgente' — urgente alerta recepção+gerência na hora.
    pub prioridade: String,
    /// 'aberto' | 'em_atendimento' | 'escalado' | 'resolvido' | 'encerrado'.
    pub status: String,
    pub telefone: Option<String>,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub assunto: String,
    pub ultima_msg: Option<String>,
    pub motivo: Option<String>,
    pub idfuncionario: Option<i64>,
    /// SLA de aceite — worker escala quando vence.
    pub prazo_aceite: chrono::DateTime<chrono::Utc>,
    pub criado_em: chrono::DateTime<chrono::Utc>,
    pub atribuido_em: Option<chrono::DateTime<chrono::Utc>>,
    pub escalado_em: Option<chrono::DateTime<chrono::Utc>>,
    pub resolvido_em: Option<chrono::DateTime<chrono::Utc>>,
}

/// Campos de abertura — protocolo/status/prazos derivados pelo repo/service.
pub struct NovoAtendimento {
    pub origem: String,
    pub setor: String,
    pub prioridade: String,
    pub telefone: Option<String>,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub assunto: String,
    pub ultima_msg: Option<String>,
    pub motivo: Option<String>,
    pub prazo_aceite: chrono::DateTime<chrono::Utc>,
}

#[async_trait]
pub trait AtendimentoRepository: Send + Sync {
    /// Insere e devolve o protocolo criado (sequencial `A-%06d` do id).
    async fn atendimento_abrir(&self, a: &NovoAtendimento) -> Result<Atendimento, DomainError>;
    /// Fila por status; `setor=None` lista tudo (gerência).
    async fn atendimento_fila(
        &self,
        status: &str,
        setor: Option<&str>,
    ) -> Result<Vec<Atendimento>, DomainError>;
    /// Assume o protocolo: aberto/escalado → em_atendimento.
    async fn atendimento_aceitar(
        &self,
        id: i64,
        idfuncionario: i64,
    ) -> Result<Atendimento, DomainError>;
    async fn atendimento_resolver(
        &self,
        id: i64,
        idfuncionario: i64,
    ) -> Result<Atendimento, DomainError>;
    /// Abertos/escalados com prazo de aceite vencido — o worker escala.
    async fn atendimento_vencidos(&self) -> Result<Vec<Atendimento>, DomainError>;
    async fn atendimento_escalar(&self, id: i64) -> Result<Atendimento, DomainError>;
}
