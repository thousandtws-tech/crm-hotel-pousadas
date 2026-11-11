//! Contratos corporativos — desconto negociado por código público no
//! motor de reservas. Vigência define a janela; fora dela o código não
//! desconta e não revela que existe.

use std::sync::Arc;

use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;

use clarituz_domain::entities::ContratoCorporativo;
use clarituz_domain::ports::{ContratoRepository, NovoContrato};
use clarituz_domain::DomainError;

use crate::actor::Ator;
use crate::error::AppResult;

#[derive(Debug, Deserialize)]
pub struct ContratoInput {
    pub empresa: String,
    pub codigo: String,
    #[serde(default)]
    pub desconto_pct: Decimal,
    pub vigente_de: NaiveDate,
    pub vigente_ate: NaiveDate,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub notas: Option<String>,
}

/// Resposta pública da validação de código — não vaza nome/empresa de
/// contrato inválido ou expirado (mesmo `{valido: false}`).
#[derive(Debug, serde::Serialize)]
pub struct ContratoCodigoView {
    pub valido: bool,
    pub desconto_pct: Option<Decimal>,
}

pub struct ContratoService {
    contratos: Arc<dyn ContratoRepository>,
}

impl ContratoService {
    pub fn new(contratos: Arc<dyn ContratoRepository>) -> Self {
        Self { contratos }
    }

    fn validar(input: &ContratoInput) -> Result<NovoContrato, DomainError> {
        let empresa = input.empresa.trim().to_string();
        let codigo = input.codigo.trim().to_uppercase();
        if empresa.len() < 3 {
            return Err(DomainError::validacao("Informe o nome da empresa."));
        }
        if codigo.len() < 4 {
            return Err(DomainError::validacao(
                "Código deve ter ao menos 4 caracteres.",
            ));
        }
        if input.desconto_pct <= Decimal::ZERO || input.desconto_pct > Decimal::from(100) {
            return Err(DomainError::validacao(
                "Desconto deve estar entre 0 e 100%.",
            ));
        }
        if input.vigente_ate < input.vigente_de {
            return Err(DomainError::validacao("Vigência final anterior à inicial."));
        }
        Ok(NovoContrato {
            empresa,
            codigo,
            desconto_pct: input.desconto_pct,
            vigente_de: input.vigente_de,
            vigente_ate: input.vigente_ate,
            contato: input.contato.clone(),
            email: input.email.clone(),
            notas: input.notas.clone(),
        })
    }

    pub async fn listar(&self, _ator: &Ator) -> AppResult<Vec<ContratoCorporativo>> {
        Ok(self.contratos.listar().await?)
    }

    pub async fn criar(&self, ator: &Ator, input: ContratoInput) -> AppResult<ContratoCorporativo> {
        let novo = Self::validar(&input)?;
        let log = ator.log(
            "cadastro",
            format!("Cadastrou o contrato '{}'", novo.empresa),
            "contrato_corporativo",
            0,
            None,
        );
        Ok(self.contratos.criar(&novo, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: ContratoInput,
    ) -> AppResult<ContratoCorporativo> {
        let dados = Self::validar(&input)?;
        let log = ator.log(
            "edição",
            format!("Editou o contrato #{id}"),
            "contrato_corporativo",
            id,
            None,
        );
        self.contratos
            .atualizar(id, &dados, log)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Contrato não encontrado.").into())
    }

    pub async fn definir_ativo(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<ContratoCorporativo> {
        let log = ator.log(
            "edição",
            format!(
                "{} o contrato #{id}",
                if ativo { "Reativou" } else { "Desativou" }
            ),
            "contrato_corporativo",
            id,
            None,
        );
        self.contratos
            .definir_ativo(id, ativo, log)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Contrato não encontrado.").into())
    }

    /// Validação pública do código — o motor mostra o desconto sem
    /// revelar se o código existe quando inválido/expirado.
    pub async fn resolver_codigo(&self, codigo: &str) -> AppResult<ContratoCodigoView> {
        let contrato = self
            .contratos
            .por_codigo(codigo.trim())
            .await?
            .filter(|c| c.vigente(Utc::now().date_naive()));
        Ok(match contrato {
            Some(c) => ContratoCodigoView {
                valido: true,
                desconto_pct: Some(c.desconto_pct),
            },
            None => ContratoCodigoView {
                valido: false,
                desconto_pct: None,
            },
        })
    }
}
