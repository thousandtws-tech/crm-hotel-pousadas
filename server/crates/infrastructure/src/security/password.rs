use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher as _, SaltString};
use argon2::{Argon2, PasswordVerifier};
use clarituz_domain::ports::PasswordHasher;
use clarituz_domain::DomainError;

pub struct Argon2Hasher {
    ctx: Argon2<'static>,
}

impl Default for Argon2Hasher {
    fn default() -> Self {
        Self::new()
    }
}

impl Argon2Hasher {
    pub fn new() -> Self {
        Self {
            ctx: Argon2::default(),
        }
    }
}

impl PasswordHasher for Argon2Hasher {
    fn hash(&self, senha: &str) -> Result<String, DomainError> {
        let salt = SaltString::generate(&mut OsRng);
        self.ctx
            .hash_password(senha.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| {
                tracing::error!(erro = %e, "falha no hash de senha");
                DomainError::Infra
            })
    }

    fn verify(&self, senha: &str, hash: &str) -> Result<bool, DomainError> {
        let parsed = PasswordHash::new(hash).map_err(|e| {
            tracing::warn!(erro = %e, "hash de senha malformado no banco");
            DomainError::Infra
        })?;
        Ok(self.ctx.verify_password(senha.as_bytes(), &parsed).is_ok())
    }
}
