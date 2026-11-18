//! Base URL da conta Infobip — política de fronteira única, usada na
//! gravação da integração (application) e na montagem do cliente HTTP
//! (infrastructure): https + host oficial `*.infobip.com`, sem IP, sem
//! localhost, sem credencial embutida — a API key nunca sai do host de
//! origem.
use std::net::IpAddr;

use crate::error::DomainError;

/// Normaliza e valida a Base URL: devolve `https://{host}` (sem path,
/// query ou barra final) ou erro de validação com mensagem ao operador.
pub fn validar_base_url(raw: &str) -> Result<String, DomainError> {
    let url =
        url::Url::parse(raw.trim()).map_err(|_| DomainError::validacao("Base URL inválida."))?;
    if url.scheme() != "https" {
        return Err(DomainError::validacao("Base URL deve ser https."));
    }
    let host = url
        .host_str()
        .ok_or_else(|| DomainError::validacao("Base URL sem host."))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(DomainError::validacao(
            "Base URL não pode levar credenciais.",
        ));
    }
    if host.parse::<IpAddr>().is_ok() {
        return Err(DomainError::validacao(
            "Base URL deve ser um hostname, não IP.",
        ));
    }
    let h = host.to_ascii_lowercase();
    if !(h == "infobip.com" || h.ends_with(".infobip.com")) {
        return Err(DomainError::validacao(
            "Base URL deve ser o host oficial da conta (*.infobip.com).",
        ));
    }
    Ok(format!("https://{host}"))
}

#[cfg(test)]
mod tests {
    use super::validar_base_url;

    #[test]
    fn base_url_oficial_aceita() {
        assert_eq!(
            validar_base_url("https://k2p4m9.api.infobip.com/").unwrap(),
            "https://k2p4m9.api.infobip.com"
        );
        assert!(validar_base_url("https://api.infobip.com").is_ok());
        assert!(validar_base_url("https://xxxxx.api.infobip.com/path?x=1").is_ok());
    }

    #[test]
    fn rejeita_http_ip_localhost_e_credencial() {
        assert!(validar_base_url("http://k2p4m9.api.infobip.com").is_err());
        assert!(validar_base_url("https://127.0.0.1:9000").is_err());
        assert!(validar_base_url("https://localhost").is_err());
        assert!(validar_base_url("https://user:pw@x.api.infobip.com").is_err());
        assert!(validar_base_url("https://infobip.evil.com").is_err());
        assert!(validar_base_url("https://api.infobip.com.evil.com").is_err());
        assert!(validar_base_url("não-é-url").is_err());
    }
}
