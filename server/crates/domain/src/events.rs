//! Eventos do motor realtime.
//!
//! Duas lanes, inspiradas no modelo Supabase Realtime / Linear:
//!
//! * `Delta`  — mudança de dados propagada pelo PostgreSQL via
//!   `LISTEN/NOTIFY` (trigger `notify_delta`). O frontend usa para
//!   recarregar listas sem refresh manual.
//! * `Aviso`  — evento semântico publicado pelos services
//!   (check-in, check-out, reserva criada…). O frontend exibe como toast.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

/// Mudança de dados emitida pelos triggers do PostgreSQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    /// Tabela alterada (`reserva`, `cliente`, `item_consumido`…).
    pub tabela: String,
    /// `insert` | `update` | `delete`.
    pub acao: String,
    /// PK do registro afetado — `None` em tabelas de PK composta
    /// (ex.: `notificacao_lida`), que ainda assim emitem delta.
    pub id: Option<i64>,
}

/// Severidade do aviso — mapeia para o tipo do toast no frontend.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TipoAviso {
    Info,
    Sucesso,
    Alerta,
}

/// Aviso semântico de domínio publicado pelos services.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aviso {
    pub tipo: TipoAviso,
    pub titulo: String,
    pub mensagem: String,
    /// Maior nível de acesso que visualiza (1=admin … 3=recepção).
    /// `ate_nivel = 3` → todos; `1` → só admin.
    pub ate_nivel: i16,
    /// Quem disparou — o frontend suprime o toast para o próprio autor.
    pub autor_id: Option<i64>,
    pub autor_nome: Option<String>,
    /// Contexto opcional (idreserva etc.) para deep-link futuro.
    pub dados: Option<JsonValue>,
}

impl Aviso {
    pub fn novo(tipo: TipoAviso, titulo: impl Into<String>, mensagem: impl Into<String>) -> Self {
        Self {
            tipo,
            titulo: titulo.into(),
            mensagem: mensagem.into(),
            ate_nivel: 3,
            autor_id: None,
            autor_nome: None,
            dados: None,
        }
    }

    #[must_use]
    pub fn de_ator(mut self, id: i64, nome: &str) -> Self {
        self.autor_id = Some(id);
        self.autor_nome = Some(nome.to_string());
        self
    }

    #[must_use]
    pub fn so_admin(mut self) -> Self {
        self.ate_nivel = 1;
        self
    }

    #[must_use]
    pub fn dados(mut self, dados: JsonValue) -> Self {
        self.dados = Some(dados);
        self
    }
}

/// Envelope único do barramento interno.
#[derive(Debug, Clone)]
pub enum EventoApp {
    Delta(Delta),
    /// Aviso publicado localmente por um service — entrada do persister.
    /// Não vai direto ao SSE: a entrega aos clientes acontece quando o
    /// `INSERT` em `notificacao` dispara `clarituz_aviso` e o relay PG
    /// republica como `AvisoPropagado` — assim todas as réplicas da API
    /// entregam o aviso exatamente uma vez.
    Aviso(Aviso),
    /// Aviso já persistido, vindo do relay `LISTEN clarituz_aviso` —
    /// só entrega realtime (SSE); nunca é repersistido.
    AvisoPropagado(Aviso),
}
