use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ProvedorIntegracao {
    Stripe,
    Pagbank,
    Mercadopago,
    Zapi,
}

impl ProvedorIntegracao {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stripe => "stripe",
            Self::Pagbank => "pagbank",
            Self::Mercadopago => "mercadopago",
            Self::Zapi => "zapi",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "stripe" => Some(Self::Stripe),
            "pagbank" => Some(Self::Pagbank),
            "mercadopago" => Some(Self::Mercadopago),
            "zapi" => Some(Self::Zapi),
            _ => None,
        }
    }

    pub fn categoria(&self) -> &'static str {
        match self {
            Self::Zapi => "comunicacao",
            _ => "pagamento",
        }
    }

    pub fn ambientes(&self) -> &'static [AmbienteIntegracao] {
        match self {
            Self::Zapi => &[AmbienteIntegracao::Producao],
            _ => &[AmbienteIntegracao::Teste, AmbienteIntegracao::Producao],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum AmbienteIntegracao {
    Teste,
    Producao,
}

impl AmbienteIntegracao {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Teste => "teste",
            Self::Producao => "producao",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "teste" => Some(Self::Teste),
            "producao" => Some(Self::Producao),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusIntegracao {
    Ativa,
    Pendente,
    Falha,
    Desativada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusVerificacao {
    Ok,
    Falha,
    ValidacaoLocal,
}

impl StatusVerificacao {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Falha => "falha",
            Self::ValidacaoLocal => "validacao_local",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "ok" => Self::Ok,
            "validacao_local" => Self::ValidacaoLocal,
            _ => Self::Falha,
        }
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Integracao {
    pub id: i64,
    #[sqlx(try_from = "String")]
    #[serde(serialize_with = "ser_provedor")]
    pub provedor: ProvedorIntegracao,
    pub categoria: String,
    #[sqlx(try_from = "String")]
    #[serde(serialize_with = "ser_ambiente")]
    pub ambiente: AmbienteIntegracao,
    pub nome_conta: Option<String>,
    #[sqlx(try_from = "String")]
    #[serde(serialize_with = "ser_status")]
    pub status: StatusIntegracao,
    pub habilitado: bool,
    pub capabilities: serde_json::Value,
    pub config: serde_json::Value,
    pub webhook_url: Option<String>,
    pub ultima_verificacao_em: Option<chrono::DateTime<chrono::Utc>>,
    pub verificacao_status: Option<String>,
    pub verificacao_erro: Option<String>,
    pub versao: i32,
    pub criado_por: Option<i64>,
    pub atualizado_por: Option<i64>,
    pub criado_em: chrono::DateTime<chrono::Utc>,
    pub atualizado_em: chrono::DateTime<chrono::Utc>,
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serialize_with exige &T
fn ser_provedor<S: serde::Serializer>(p: &ProvedorIntegracao, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(p.as_str())
}
#[allow(clippy::trivially_copy_pass_by_ref)]
fn ser_ambiente<S: serde::Serializer>(a: &AmbienteIntegracao, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(a.as_str())
}
#[allow(clippy::trivially_copy_pass_by_ref)]
fn ser_status<S: serde::Serializer>(st: &StatusIntegracao, s: S) -> Result<S::Ok, S::Error> {
    let v = match st {
        StatusIntegracao::Ativa => "ativa",
        StatusIntegracao::Pendente => "pendente",
        StatusIntegracao::Falha => "falha",
        StatusIntegracao::Desativada => "desativada",
    };
    s.serialize_str(v)
}

impl From<String> for ProvedorIntegracao {
    fn from(s: String) -> Self {
        Self::parse(&s).unwrap_or(Self::Stripe)
    }
}
impl From<String> for AmbienteIntegracao {
    fn from(s: String) -> Self {
        Self::parse(&s).unwrap_or(Self::Producao)
    }
}
impl From<String> for StatusIntegracao {
    fn from(s: String) -> Self {
        match s.as_str() {
            "ativa" => Self::Ativa,
            "falha" => Self::Falha,
            "desativada" => Self::Desativada,
            _ => Self::Pendente,
        }
    }
}
