//! `CredentialVault` — selagem AES-256-GCM dos segredos de integração.
//!
//! Envelope persistido: `versao(1) ‖ nonce(12) ‖ ciphertext ‖ tag(16)`.
//! O `contexto` entra como AAD (`provedor|ambiente|campo|idintegracao`) —
//! um envelope não abre fora do seu campo/integração, e mover o blob no
//! banco é detectado, não decodificado.
//!
//! A chave-mestra vem de `INTEGRACOES_MASTER_KEY` (64 chars hex → 32 bytes).
//! Sem ela o vault falha explícito — nunca cifra com chave derivada de
//! outro segredo nem salva em claro.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key};
use clarituz_domain::ports::CredentialVault;
use clarituz_domain::DomainError;

const ENVELOPE_VERSAO: u8 = 1;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

pub struct AesCredentialVault {
    chave: [u8; 32],
}

impl AesCredentialVault {
    /// `key_hex`: 64 caracteres hexadecimais (32 bytes).
    pub fn new(key_hex: &str) -> Result<Self, DomainError> {
        let bytes = hex::decode(key_hex.trim()).map_err(|_| {
            DomainError::regra("INTEGRACOES_MASTER_KEY inválida — esperado hex de 64 chars.")
        })?;
        let chave: [u8; 32] = bytes.try_into().map_err(|_| {
            DomainError::regra("INTEGRACOES_MASTER_KEY inválida — esperado 32 bytes (64 hex).")
        })?;
        Ok(Self { chave })
    }

    #[cfg(test)]
    pub fn para_teste() -> Self {
        Self { chave: [7u8; 32] }
    }
}

impl CredentialVault for AesCredentialVault {
    fn selar(&self, contexto: &str, claro: &str) -> Result<Vec<u8>, DomainError> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.chave));
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = cipher
            .encrypt(
                &nonce,
                aes_gcm::aead::Payload {
                    msg: claro.as_bytes(),
                    aad: contexto.as_bytes(),
                },
            )
            .map_err(|_| DomainError::Infra)?;
        let mut out = Vec::with_capacity(1 + NONCE_LEN + ct.len());
        out.push(ENVELOPE_VERSAO);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    fn abrir(&self, contexto: &str, envelope: &[u8]) -> Result<String, DomainError> {
        if envelope.len() < 1 + NONCE_LEN + TAG_LEN || envelope[0] != ENVELOPE_VERSAO {
            return Err(DomainError::regra("Envelope de segredo inválido."));
        }
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.chave));
        let nonce = aes_gcm::Nonce::from_slice(&envelope[1..=NONCE_LEN]);
        let claro = cipher
            .decrypt(
                nonce,
                aes_gcm::aead::Payload {
                    msg: &envelope[1 + NONCE_LEN..],
                    aad: contexto.as_bytes(),
                },
            )
            .map_err(|_| DomainError::regra("Segredo não pôde ser decifrado neste contexto."))?;
        String::from_utf8(claro).map_err(|_| DomainError::Infra)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selar_e_abrir_roundtrip() {
        let v = AesCredentialVault::para_teste();
        let env = v
            .selar("stripe|producao|secret_key|1", "sk_test_123")
            .unwrap();
        assert_eq!(
            v.abrir("stripe|producao|secret_key|1", &env).unwrap(),
            "sk_test_123"
        );
    }

    #[test]
    fn contexto_errado_falha() {
        let v = AesCredentialVault::para_teste();
        let env = v.selar("stripe|producao|secret_key|1", "segredo").unwrap();
        assert!(v.abrir("stripe|producao|webhook_secret|1", &env).is_err());
        assert!(v.abrir("pagbank|producao|secret_key|1", &env).is_err());
    }

    #[test]
    fn envelope_corrompido_falha() {
        let v = AesCredentialVault::para_teste();
        let mut env = v.selar("ctx", "x").unwrap();
        let last = env.len() - 1;
        env[last] ^= 0xFF;
        assert!(v.abrir("ctx", &env).is_err());
    }

    #[test]
    fn chave_invalida_rejeitada() {
        assert!(AesCredentialVault::new("curto").is_err());
        assert!(AesCredentialVault::new(&"z".repeat(64)).is_err());
        assert!(AesCredentialVault::new(&"a".repeat(64)).is_ok());
    }
}
