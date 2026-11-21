//! Adapter SERPRO — transmissão da FNRH oficial ao governo.
//!
//! Credenciais por env (composition root decide se instancia):
//! `SERPRO_FNRH_URL` (endpoint do webservice do meio de hospedagem),
//! `SERPRO_FNRH_USUARIO` + `SERPRO_FNRH_SENHA` e `SERPRO_FNRH_CNPJ`
//! (identificação do estabelecimento junto ao FNRH).
//! Sem URL o serviço sobe sem provider — as transmissões ficam
//! 'pendente' e o painel orienta a exportação SNE/CSV manual.

use reqwest::Client;

use clarituz_domain::entities::Fnrh;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{FnrhSerproRetorno, ProvedorFnrh};
use serde_json::Value as JsonValue;

const TIMEOUT_S: u64 = 30;

fn http() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_S))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn erro_http(e: reqwest::Error) -> DomainError {
    let classe = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "indisponível"
    } else {
        "falha de transporte"
    };
    DomainError::regra(format!("serpro: {classe}"))
}

pub struct SerproFnrh {
    url: String,
    usuario: String,
    senha: String,
    cnpj: String,
}

impl SerproFnrh {
    pub fn new(url: &str, usuario: &str, senha: &str, cnpj: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').into(),
            usuario: usuario.into(),
            senha: senha.into(),
            cnpj: cnpj.chars().filter(char::is_ascii_digit).collect(),
        }
    }
}

#[async_trait::async_trait]
impl ProvedorFnrh for SerproFnrh {
    async fn transmitir(
        &self,
        ficha: &Fnrh,
        estabelecimento: &JsonValue,
    ) -> Result<FnrhSerproRetorno, DomainError> {
        // Envelope oficial da via pública — espelha o que o formulário
        // FNRH coleta: meio de hospedagem + hóspede + estadia + acompanhantes.
        let corpo = serde_json::json!({
            "meio_hospedagem": {
                "cnpj": self.cnpj,
                "razao_social": estabelecimento["razao_social"],
            },
            "ficha": {
                "id": ficha.id,
                "emitida_em": ficha.emitida_em,
                "motivo_viagem": ficha.motivo_viagem,
                "placa_veiculo": ficha.placa_veiculo,
                "hospede": ficha.dados["hospede"],
                "reserva": ficha.dados["reserva"],
                "acompanhantes": ficha.dados["acompanhantes"],
                "pre_ficha": ficha.dados["pre_ficha"],
            },
        });
        let r = http()
            .post(&self.url)
            .basic_auth(&self.usuario, Some(&self.senha))
            .json(&corpo)
            .send()
            .await
            .map_err(erro_http)?;
        if !r.status().is_success() {
            let st = r.status().as_u16();
            let detalhe = r
                .json::<JsonValue>()
                .await
                .ok()
                .and_then(|v| {
                    v["message"]
                        .as_str()
                        .or_else(|| v["erro"].as_str())
                        .map(String::from)
                })
                .unwrap_or_else(|| "sem detalhe".into());
            return Err(DomainError::regra(format!("serpro http {st}: {detalhe}")));
        }
        let v: JsonValue = r.json().await.unwrap_or_default();
        Ok(FnrhSerproRetorno {
            protocolo: v["protocolo"]
                .as_str()
                .or_else(|| v["numero"].as_str())
                .map(String::from),
            mensagem: v["mensagem"].as_str().map(String::from),
        })
    }
}
