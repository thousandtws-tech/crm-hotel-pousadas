//! Port de armazenamento de objetos — fotos, vídeos, scans e logos.
//! Implementações: `FsStore` (filesystem local/dev) e `S3Store` (MinIO/S3).

use crate::error::DomainError;
use async_trait::async_trait;

#[async_trait]
pub trait ObjectStore: Send + Sync {
    /// Bytes do objeto — `None` quando a chave não existe.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, DomainError>;
    /// Grava o objeto (`key` relativa, ex.: `cms/3/abc.png`).
    async fn put(&self, key: &str, bytes: &[u8], mime: &str) -> Result<(), DomainError>;
    /// Remove o objeto se existir.
    async fn delete(&self, key: &str) -> Result<(), DomainError>;
}
