//! Adapter SERPRO — transmissão da FNRH oficial ao governo (API v2).
//!
//! Documentação: MTur "Documento de Integração" v2 — REST/JSON.
//! Produção:    https://fnrh.turismo.serpro.gov.br/FNRH_API/rest/v2
//! Homologação: https://hom-lowcode.serpro.gov.br/FNRH_API/rest/v2
//!
//! Credenciais por env (composition root decide se instancia):
//! `SERPRO_FNRH_URL` (base da API — produção ou homologação),
//! `SERPRO_FNRH_USUARIO` + `SERPRO_FNRH_SENHA` (chaves de API geradas
//! no portal FNRH — login Gov.br do responsável no Cadastur) e
//! `SERPRO_FNRH_CPF_SOLICITANTE` (CPF do responsável que registra —
//! header obrigatório `cpf_solicitante`).
//! Sem URL o serviço sobe sem provider — as transmissões ficam
//! 'pendente' e o painel orienta a exportação SNE/CSV manual.

use reqwest::Client;

use clarituz_domain::entities::Fnrh;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{FnrhSerproRetorno, ProvedorFnrh};
use serde_json::{json, Value as JsonValue};

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

/// CPF/dígitos puros — a API rejeita máscara.
fn digitos(s: &str) -> String {
    s.chars().filter(char::is_ascii_digit).collect()
}

/// Campo de texto com fallback: pré-ficha (hóspede preencheu, mais fresco)
/// primeiro; cadastro do cliente depois.
fn campo<'a>(pre: &'a JsonValue, hosp: &'a JsonValue, chave: &str) -> Option<&'a str> {
    pre[chave]
        .as_str()
        .or_else(|| hosp[chave].as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

/// (codigo_ibge_pais, sigla_pais) — Brasil é o caso dominante; demais
/// nacionalidades saem como texto e a homologação indica o ajuste fino
/// (a API valida campo a campo e o erro fica visível no painel).
fn pais_ids(nacionalidade: Option<&str>, pais: Option<&str>) -> (&'static str, &'static str) {
    let br = |s: Option<&str>| {
        s.map(|v| v.to_lowercase())
            .is_none_or(|v| v.contains("brasil"))
    };
    if br(nacionalidade) && br(pais) {
        ("105", "BRA")
    } else {
        // Estrangeiro — sem mapa IBGE completo: passamos a sigla ISO que
        // a documentação pede; casos reais se ajustam na homologação.
        ("", "")
    }
}

/// `documento` do hóspede no formato da API: CPF ou PASSAPORTE.
/// Hóspede nacional usa o CPF da pré-ficha/cadastro; estrangeiro usa o
/// passaporte (`doc_tipo`/`doc_numero` da pré-ficha).
fn documento_json(pre: &JsonValue, hosp: &JsonValue) -> Option<JsonValue> {
    let cpf = digitos(campo(pre, hosp, "cpf").unwrap_or(""));
    if cpf.len() == 11 {
        return Some(json!({"tipo": "CPF", "numero": cpf}));
    }
    let numero = campo(pre, hosp, "doc_numero")?;
    // Estrangeiro: RNE/CNH vão como passaporte-equivalente na v2.
    Some(json!({"tipo": "PASSAPORTE", "numero": numero}))
}

/// Monta o hóspede titular do array `hospedes` da API a partir do snapshot
/// da ficha. `responsavel` é passado quando o hóspede não tem documento
/// (dependente menor).
fn hospede_json(
    dados: &JsonValue,
    responsavel: Option<&JsonValue>,
    situacao: &str,
    checkin_em: Option<&str>,
) -> JsonValue {
    let pre = &dados["pre_ficha"];
    let hosp = &dados["hospede"];

    let nacionalidade = campo(pre, hosp, "nacionalidade");
    let pais = campo(pre, hosp, "pais");
    let (cod_pais, sigla_pais) = pais_ids(nacionalidade, pais);
    let uf = campo(pre, hosp, "uf")
        .or_else(|| campo(pre, hosp, "estado"))
        .unwrap_or("");

    let mut h = json!({
        "nome": campo(pre, hosp, "nome").unwrap_or(""),
        "situacao_hospede": situacao,
        "data_nascimento": campo(pre, hosp, "nascimento")
            .or_else(|| campo(pre, hosp, "data_nascimento")),
        "nacionalidade": cod_pais,
        "PaisNacionalidade_id": sigla_pais,
        "PaisResidencia_id": sigla_pais,
        "estado_id": uf,
        "email": campo(pre, hosp, "email"),
        "telefone": campo(pre, hosp, "telefone"),
    });
    match documento_json(pre, hosp) {
        Some(doc) => h["documento"] = doc,
        None => {
            if let Some(r) = responsavel {
                h["responsavel"] = r.clone();
            }
        }
    }
    // dados_ficha — obrigatório em CHECKIN_REALIZADO/CHECKOUT_REALIZADO:
    // espelha a FNRH de papel (endereço, profissão, motivo, transporte).
    if situacao != "PRECHECKIN_PENDENTE" && situacao != "NOSHOW" {
        h["dados_ficha"] = json!({
            "motivo_viagem": campo(pre, hosp, "motivo")
                .or_else(|| dados["motivo_viagem"].as_str()),
            "profissao": campo(pre, hosp, "profissao"),
            "meio_transporte": campo(pre, hosp, "transporte"),
            "placa_veiculo": dados["placa_veiculo"].as_str(),
            "endereco": {
                "logradouro": campo(pre, hosp, "logradouro"),
                "numero": campo(pre, hosp, "numero"),
                "complemento": campo(pre, hosp, "complemento"),
                "bairro": campo(pre, hosp, "bairro"),
                "cidade": campo(pre, hosp, "cidade"),
                "uf": uf,
                "cep": campo(pre, hosp, "cep").map(digitos),
            },
        });
        if let Some(c) = checkin_em {
            h["checkin_em"] = json!(c);
        }
    }
    h
}

pub struct SerproFnrh {
    url: String,
    usuario: String,
    senha: String,
    cpf_solicitante: String,
}

impl SerproFnrh {
    pub fn new(url: &str, usuario: &str, senha: &str, cpf_solicitante: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').into(),
            usuario: usuario.into(),
            senha: senha.into(),
            cpf_solicitante: digitos(cpf_solicitante),
        }
    }
}

#[async_trait::async_trait]
impl ProvedorFnrh for SerproFnrh {
    /// `POST /hospedagem/registrar` — reserva + todos os hóspedes numa
    /// única chamada, como pede o manual v2.
    async fn transmitir(
        &self,
        ficha: &Fnrh,
        _estabelecimento: &JsonValue,
    ) -> Result<FnrhSerproRetorno, DomainError> {
        let res = &ficha.dados["reserva"];
        let checkin_em = res["checkin_em"].as_str();
        let situacao = if checkin_em.is_some() {
            "CHECKIN_REALIZADO"
        } else {
            "PRECHECKIN_PENDENTE"
        };

        // Documento do titular — base do `responsavel` dos dependentes.
        let titular_doc = documento_json(&ficha.dados["pre_ficha"], &ficha.dados["hospede"]);

        let mut hospedes: Vec<JsonValue> =
            vec![hospede_json(&ficha.dados, None, situacao, checkin_em)];
        // Acompanhantes cadastrados pela recepção (nome/doc/nascimento).
        // Dependente sem documento vai com `responsavel` = titular.
        if let Some(lista) = ficha.dados["acompanhantes"].as_array() {
            for a in lista {
                let mut ah = json!({
                    "nome": a["nome"].as_str().unwrap_or(""),
                    "situacao_hospede": situacao,
                    "data_nascimento": a["data_nascimento"].as_str(),
                });
                let doc_num = a["doc_numero"].as_str().map(digitos);
                let doc_ok = doc_num.as_deref().is_some_and(|n| n.len() >= 4);
                match (a["doc_tipo"].as_str(), doc_num.filter(|_| doc_ok)) {
                    (Some(t), Some(n)) if t.to_lowercase().contains("cpf") && n.len() == 11 => {
                        ah["documento"] = json!({"tipo": "CPF", "numero": n});
                    }
                    (Some(t), Some(n)) if t.to_lowercase().contains("pass") => {
                        ah["documento"] = json!({"tipo": "PASSAPORTE", "numero": n});
                    }
                    (Some(_), Some(n)) => {
                        ah["documento"] = json!({"tipo": "PASSAPORTE", "numero": n});
                    }
                    _ => {
                        if let Some(r) = &titular_doc {
                            ah["responsavel"] = r.clone();
                        }
                    }
                }
                if situacao != "PRECHECKIN_PENDENTE" && situacao != "NOSHOW" {
                    ah["dados_ficha"] = json!({});
                }
                hospedes.push(ah);
            }
        }

        let total = res["quantidade_hospedes"].as_i64().unwrap_or(1).max(1);
        let menores = ficha.dados["acompanhantes"]
            .as_array()
            .map(|l| {
                l.iter()
                    .filter(|a| {
                        a["data_nascimento"]
                            .as_str()
                            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                            .is_some_and(|n| {
                                chrono::Utc::now().date_naive().years_since(n).unwrap_or(18) < 18
                            })
                    })
                    .count() as i64
            })
            .unwrap_or(0);

        let corpo = json!({
            "reserva": {
                "numero_reserva": format!("RES-{:06}", res["id"].as_i64().unwrap_or(ficha.idreserva)),
                "data_entrada": res["entradaprevista"].as_str(),
                "data_saida": res["saidaprevista"].as_str(),
                "quantidade_hospede_adulto": (total - menores).max(1),
                "quantidade_hospede_menor": menores,
                "origem_reserva_id": "MEIOHOSPEDAGEM",
            },
            "hospedes": hospedes,
        });

        let r = http()
            .post(format!("{}/hospedagem/registrar", self.url))
            .basic_auth(&self.usuario, Some(&self.senha))
            .header("cpf_solicitante", &self.cpf_solicitante)
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
                        .or_else(|| v["mensagem"].as_str())
                        .map(String::from)
                })
                .unwrap_or_else(|| "sem detalhe".into());
            return Err(DomainError::regra(format!("serpro http {st}: {detalhe}")));
        }
        let v: JsonValue = r.json().await.unwrap_or_default();
        let protocolo = v["protocolo"]
            .as_str()
            .or_else(|| v["id"].as_str())
            .or_else(|| v["numero"].as_str())
            .map(String::from)
            .or_else(|| v["reserva_id"].as_i64().map(|i| i.to_string()));
        Ok(FnrhSerproRetorno {
            protocolo,
            mensagem: v["mensagem"].as_str().map(String::from),
        })
    }
}
