use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::entities::*;
use crate::enums::{CanalEnvio, StatusAvaliacao};
use crate::error::DomainError;

/// Outbox persistente + resolução da matriz. Implementada sobre Postgres;
/// o worker drena `proximos` e marca o resultado.
#[async_trait]
pub trait FilaEnvioRepository: Send + Sync {
    async fn enfileirar(&self, novo: NovoEnvio) -> Result<i64, DomainError>;
    /// Itens vencidos (agendado_para <= agora) com status pendente — o
    /// worker pega um lote por rodada.
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
    async fn marcar_falha(
        &self,
        id: i64,
        erro: &str,
        backoff_segundos: i64,
    ) -> Result<(), DomainError>;
    async fn cancelar(&self, id: i64) -> Result<(), DomainError>;
    /// Monitor administrativo.
    async fn listar(&self, limite: i64) -> Result<Vec<ItemFila>, DomainError>;

    async fn email_suprimido(&self, email: &str) -> Result<bool, DomainError>;
    async fn suprimir_email(&self, email: &str, motivo: &str) -> Result<(), DomainError>;

    /// Regras ativas da matriz para um evento.
    async fn regras_do_evento(&self, evento: &str) -> Result<Vec<RegraMatriz>, DomainError>;
    async fn listar_matriz(&self) -> Result<Vec<RegraMatriz>, DomainError>;
    async fn gravar_regra(&self, regra: &RegraMatriz) -> Result<(), DomainError>;
}

/// Sender externo plugável — Resend, Meta Cloud API, VAPID. Devolve o id
/// da mensagem no provedor quando disponível. A aplicação decide o canal;
/// o emissor só transporta.
#[async_trait]
pub trait Emissor: Send + Sync {
    fn canal(&self) -> CanalEnvio;
    /// `destino`: e-mail | telefone | endpoint push (serializado no tickle).
    async fn enviar(
        &self,
        destino: &str,
        template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError>;
}

#[async_trait]
pub trait PushRepository: Send + Sync {
    async fn gravar(&self, sub: &PushSubscription) -> Result<(), DomainError>;
    async fn remover(&self, endpoint: &str) -> Result<(), DomainError>;
    /// Assinaturas dos funcionários com `nivel <= papel` (matriz: papel alvo).
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
    /// Pendentes cujo envio inicial já ocorreu e que levam lembrete +3d.
    async fn pendentes_lembrete(&self, ate: DateTime<Utc>) -> Result<Vec<Avaliacao>, DomainError>;
    /// Pendentes além do prazo de resposta — o sweeper expira.
    async fn pendentes_expirar(&self, ate: DateTime<Utc>) -> Result<Vec<Avaliacao>, DomainError>;
    async fn expirar(&self, id: i64) -> Result<(), DomainError>;
}

#[async_trait]
pub trait FidelidadeRepository: Send + Sync {
    async fn niveis(&self) -> Result<Vec<NivelFidelidade>, DomainError>;
    async fn gravar_nivel(&self, nivel: &NivelFidelidade) -> Result<i64, DomainError>;
    async fn remover_nivel(&self, id: i64) -> Result<(), DomainError>;
    async fn do_cliente(&self, idcliente: i64) -> Result<Option<FidelidadeCliente>, DomainError>;
    /// Recomputa diárias + gasto do cliente (pós-checkout / batch) e
    /// promove/rebaixa o nível conforme `fidelidade_nivel.min_diarias`.
    async fn recomputar(&self, idcliente: i64) -> Result<(), DomainError>;
    /// KPIs agregados do perfil 360: total de estadias, LTV (centavos),
    /// ticket médio, diárias acumuladas — tudo numa consulta.
    async fn kpis_cliente(&self, idcliente: i64) -> Result<serde_json::Value, DomainError>;
}

/// Consultas de reserva usadas pelas automações (crons de lembretes e
/// pesquisa). Filtra no SQL — o worker nunca varre a tabela.
#[async_trait]
pub trait AutomacaoRepository: Send + Sync {
    /// Check-in `data` (geralmente amanhã), reserva ativa, pré-ficha não
    /// preenchida — alvos do lembrete FNRH.
    async fn checkins_sem_fnrh(
        &self,
        data: chrono::NaiveDate,
    ) -> Result<Vec<ReservaAuto>, DomainError>;
    /// Check-out `data` (hoje), reserva iniciada — lembrete de saída.
    async fn checkouts_do_dia(
        &self,
        data: chrono::NaiveDate,
    ) -> Result<Vec<ReservaAuto>, DomainError>;
    /// Finalizadas desde `desde` sem linha em `avaliacao` — pesquisa nova.
    async fn finalizadas_sem_avaliacao(
        &self,
        desde: DateTime<Utc>,
    ) -> Result<Vec<ReservaAuto>, DomainError>;
    /// Já existe item desta reserva+template+canal na fila (dedup do cron).
    async fn existe_envio(
        &self,
        idreserva: i64,
        template: &str,
        canal: CanalEnvio,
    ) -> Result<bool, DomainError>;
    /// Reserva enxuta por id (lembrete +3d — a avaliação já traz idreserva).
    async fn reserva_por_id(&self, idreserva: i64) -> Result<Option<ReservaAuto>, DomainError>;
    /// Reserva + hóspede numa linha pro payload da mensagem.
    async fn reserva_publica_por_token(
        &self,
        token: uuid::Uuid,
    ) -> Result<Option<ReservaAuto>, DomainError>;
    /// Reserva ativa do hóspede identificado por telefone (WhatsApp inbound)
    /// — `finais` são os últimos dígitos do número que chegou; o SQL
    /// normaliza os telefones gravados e compara pelo sufixo.
    async fn reserva_por_telefone(&self, finais: &str) -> Result<Option<ReservaAuto>, DomainError>;
    /// Pré-ficha enviada pelo hóspede via link público.
    async fn gravar_pre_ficha(
        &self,
        idreserva: i64,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError>;
}

/// Linha enxuta de reserva para automações — sem carregar o detalhe completo.
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
}

// ---------------------------------------------------------------------------
// Inná Concierge — histórico hóspede↔IA e a chamada ao serviço de LLM
// ---------------------------------------------------------------------------

/// Mensagem trocada entre hóspede e Inná (portal ou WhatsApp) — vive no
/// banco pra contexto de conversa e auditoria do que a IA respondeu.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct InnaMensagem {
    pub id: i64,
    pub idreserva: i64,
    /// `portal` | `whatsapp`
    pub canal: String,
    /// `hospede` | `inna`
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
}
