//! Verificação de identidade (KYC) de funcionários via sessão hospedada
//! Didit — documento + liveness + face match + análise de IP.
//!
//! O `status` interno é o mapeamento estável; o valor exato devolvido pelo
//! provedor fica preservado em `status_remoto` e nunca é interpretado duas
//! vezes (status desconhecido ⇒ `Desconhecido`, nunca "aprovada").

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusVerificacaoIdentidade {
    NaoIniciada,
    EmAndamento,
    AguardandoUsuario,
    EmRevisao,
    Reenviada,
    Aprovada,
    Recusada,
    Expirada,
    Abandonada,
    KycExpirada,
    Desconhecido,
}

impl StatusVerificacaoIdentidade {
    /// Strings exatas do envelope Didit — case-sensitive ("Kyc Expired").
    pub fn do_remoto(remoto: &str) -> Option<Self> {
        Some(match remoto {
            "Not Started" => Self::NaoIniciada,
            "In Progress" => Self::EmAndamento,
            "Awaiting User" => Self::AguardandoUsuario,
            "In Review" => Self::EmRevisao,
            "Resubmitted" => Self::Reenviada,
            "Approved" => Self::Aprovada,
            "Declined" => Self::Recusada,
            "Expired" => Self::Expirada,
            "Abandoned" => Self::Abandonada,
            "Kyc Expired" => Self::KycExpirada,
            _ => return None,
        })
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NaoIniciada => "nao_iniciada",
            Self::EmAndamento => "em_andamento",
            Self::AguardandoUsuario => "aguardando_usuario",
            Self::EmRevisao => "em_revisao",
            Self::Reenviada => "reenviada",
            Self::Aprovada => "aprovada",
            Self::Recusada => "recusada",
            Self::Expirada => "expirada",
            Self::Abandonada => "abandonada",
            Self::KycExpirada => "kyc_expirada",
            Self::Desconhecido => "desconhecido",
        }
    }

    pub fn de_str(s: &str) -> Option<Self> {
        Some(match s {
            "nao_iniciada" => Self::NaoIniciada,
            "em_andamento" => Self::EmAndamento,
            "aguardando_usuario" => Self::AguardandoUsuario,
            "em_revisao" => Self::EmRevisao,
            "reenviada" => Self::Reenviada,
            "aprovada" => Self::Aprovada,
            "recusada" => Self::Recusada,
            "expirada" => Self::Expirada,
            "abandonada" => Self::Abandonada,
            "kyc_expirada" => Self::KycExpirada,
            "desconhecido" => Self::Desconhecido,
            _ => return None,
        })
    }

    /// Terminal = a sessão fechou; uma nova tentativa pode ser aberta.
    pub fn terminal(&self) -> bool {
        matches!(
            self,
            Self::Aprovada | Self::Recusada | Self::Expirada | Self::Abandonada | Self::KycExpirada
        )
    }

    pub fn aprovada(&self) -> bool {
        *self == Self::Aprovada
    }

    pub fn rotulo(&self) -> &'static str {
        match self {
            Self::NaoIniciada => "Não iniciada",
            Self::EmAndamento => "Em andamento",
            Self::AguardandoUsuario => "Aguardando usuário",
            Self::EmRevisao => "Em revisão",
            Self::Reenviada => "Reenviada",
            Self::Aprovada => "Verificado",
            Self::Recusada => "Recusada",
            Self::Expirada => "Expirada",
            Self::Abandonada => "Abandonada",
            Self::KycExpirada => "KYC expirado",
            Self::Desconhecido => "Status desconhecido",
        }
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct VerificacaoIdentidade {
    pub id: Uuid,
    pub integracao_id: i64,
    pub funcionario_id: i64,
    pub session_id: String,
    pub url: String,
    pub vendor_data: String,
    pub status: String,
    pub status_remoto: Option<String>,
    pub resumo: serde_json::Value,
    pub decidido_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl VerificacaoIdentidade {
    pub fn status_enum(&self) -> StatusVerificacaoIdentidade {
        StatusVerificacaoIdentidade::de_str(&self.status)
            .unwrap_or(StatusVerificacaoIdentidade::Desconhecido)
    }
}

/// Linha da listagem administrativa — verificação + quem é o funcionário.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct VerificacaoListItem {
    #[sqlx(flatten)]
    pub verificacao: VerificacaoIdentidade,
    pub funcionario_nome: String,
    pub funcionario_nivel: i16,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapeia_strings_exatas_didit() {
        assert_eq!(
            StatusVerificacaoIdentidade::do_remoto("Kyc Expired"),
            Some(StatusVerificacaoIdentidade::KycExpirada)
        );
        assert_eq!(
            StatusVerificacaoIdentidade::do_remoto("KYC Expired"),
            None,
            "case divergente não pode passar por status conhecido"
        );
        assert_eq!(StatusVerificacaoIdentidade::do_remoto("whatever"), None);
    }

    #[test]
    fn terminais_abrem_espaco_para_nova_tentativa() {
        assert!(StatusVerificacaoIdentidade::Aprovada.terminal());
        assert!(StatusVerificacaoIdentidade::Recusada.terminal());
        assert!(!StatusVerificacaoIdentidade::EmAndamento.terminal());
        assert!(!StatusVerificacaoIdentidade::Desconhecido.terminal());
    }
}
