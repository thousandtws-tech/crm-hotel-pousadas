use clarituz_domain::ports::TokenIssuer;
use clarituz_domain::{DomainError, TokenClaims};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};

pub struct JwtIssuer {
    enc: EncodingKey,
    dec: DecodingKey,
    validation: Validation,
}

impl JwtIssuer {
    pub fn new(secret: &str) -> Self {
        let mut validation = Validation::default();
        validation.set_issuer(&["clarituz-api"]);
        validation.set_required_spec_claims(&["exp", "sub", "iss"]);
        Self {
            enc: EncodingKey::from_secret(secret.as_bytes()),
            dec: DecodingKey::from_secret(secret.as_bytes()),
            validation,
        }
    }
}

impl TokenIssuer for JwtIssuer {
    fn emitir(&self, claims: &TokenClaims) -> Result<String, DomainError> {
        encode(&Header::default(), claims, &self.enc).map_err(|e| {
            tracing::error!(erro = %e, "falha ao emitir JWT");
            DomainError::Infra
        })
    }

    fn validar(&self, token: &str) -> Result<TokenClaims, DomainError> {
        decode::<TokenClaims>(token, &self.dec, &self.validation)
            .map(|d| d.claims)
            .map_err(|e| {
                tracing::debug!(erro = %e, "token rejeitado");
                DomainError::nao_autenticado("Token inválido ou expirado.")
            })
    }
}
