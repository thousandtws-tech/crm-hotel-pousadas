//! Cliente (hóspede titular da reserva).

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Cliente {
    pub id: i64,
    pub nome: String,
    pub cpf: String,
    pub data_nascimento: NaiveDate,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub estado: Option<String>,
    pub cidade: Option<String>,
    // -- dados complementares da FNRH (ficha de registro de hóspedes) -------
    pub nacionalidade: Option<String>,
    /// Cidade/UF de nascimento.
    pub naturalidade: Option<String>,
    pub profissao: Option<String>,
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cep: Option<String>,
    pub pais: Option<String>,
    pub ativo: bool,
    /// Derivada de `foto IS NOT NULL` — expõe só a existência, nunca o caminho.
    pub tem_foto: bool,
    /// Concorrência otimista — incrementada pelo trigger `bump_version`.
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Cliente {
    /// Regra do legado: titular precisa ser maior de idade.
    pub fn maior_de_idade(data_nascimento: NaiveDate, hoje: NaiveDate) -> bool {
        data_nascimento
            .checked_add_months(chrono::Months::new(18 * 12))
            .is_some_and(|maioridade| maioridade <= hoje)
    }
}
