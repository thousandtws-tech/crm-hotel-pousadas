//! Adapter de armazenamento de objetos — `FsStore` (filesystem local/dev) ou
//! `S3Store` (MinIO/S3, escolhido quando `S3_*` estiver configurado).

use async_trait::async_trait;
use clarituz_domain::ports::ObjectStore;
use clarituz_domain::DomainError;
use clarituz_shared::Settings;
use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::region::Region;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Filesystem — chaves relativas vão para `root/`; chaves absolutas
/// (caminhos legados gravados antes do store) passam direto.
pub struct FsStore {
    root: PathBuf,
}

impl FsStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn resolve(&self, key: &str) -> PathBuf {
        let p = Path::new(key);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            self.root.join(p)
        }
    }
}

#[async_trait]
impl ObjectStore for FsStore {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, DomainError> {
        match std::fs::read(self.resolve(key)) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(DomainError::Infra),
        }
    }

    async fn put(&self, key: &str, bytes: &[u8], _mime: &str) -> Result<(), DomainError> {
        let path = self.resolve(key);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|_| DomainError::Infra)?;
        }
        std::fs::write(path, bytes).map_err(|_| DomainError::Infra)
    }

    async fn delete(&self, key: &str) -> Result<(), DomainError> {
        match std::fs::remove_file(self.resolve(key)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(DomainError::Infra),
        }
    }
}

/// MinIO/S3 — path-style (exigido por MinIO atrás de domínio próprio).
pub struct S3Store {
    bucket: Box<Bucket>,
}

#[async_trait]
impl ObjectStore for S3Store {
    /// rust-s3 (sem `fail-on-err`) devolve `Ok` mesmo em 4xx — o status
    /// HTTP precisa ser inspecionado no `ResponseData`.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, DomainError> {
        match self.bucket.get_object(key).await {
            Ok(r) if (200..300).contains(&r.status_code()) => Ok(Some(r.bytes().to_vec())),
            Ok(r) if r.status_code() == 404 => Ok(None),
            Ok(r) => {
                tracing::error!(%key, status = r.status_code(), "S3 get: status inesperado");
                Err(DomainError::Infra)
            }
            Err(e) if e.to_string().contains("404") || e.to_string().contains("NoSuchKey") => {
                Ok(None)
            }
            Err(e) => {
                tracing::error!(%key, erro = %e, "S3 get falhou");
                Err(DomainError::Infra)
            }
        }
    }

    async fn put(&self, key: &str, bytes: &[u8], mime: &str) -> Result<(), DomainError> {
        match self
            .bucket
            .put_object_with_content_type(key, bytes, mime)
            .await
        {
            Ok(r) if (200..300).contains(&r.status_code()) => Ok(()),
            Ok(r) => {
                tracing::error!(%key, status = r.status_code(), "S3 put: status inesperado");
                Err(DomainError::Infra)
            }
            Err(e) => {
                tracing::error!(%key, erro = %e, "S3 put falhou");
                Err(DomainError::Infra)
            }
        }
    }

    async fn delete(&self, key: &str) -> Result<(), DomainError> {
        match self.bucket.delete_object(key).await {
            Ok(r) if (200..300).contains(&r.status_code()) || r.status_code() == 404 => Ok(()),
            Ok(r) => {
                tracing::error!(%key, status = r.status_code(), "S3 delete: status inesperado");
                Err(DomainError::Infra)
            }
            Err(e) if e.to_string().contains("404") || e.to_string().contains("NoSuchKey") => {
                Ok(())
            }
            Err(e) => {
                tracing::error!(%key, erro = %e, "S3 delete falhou");
                Err(DomainError::Infra)
            }
        }
    }
}

/// Configuração S3 resolvida — `None` quando `S3_*` está incompleto.
/// Compartilhada entre `build_store` e o probe `clarituz-api s3-probe`.
pub(crate) fn s3_parts(settings: &Settings) -> Option<(Region, Credentials, String)> {
    let (Some(endpoint), Some(bucket), Some(access), Some(secret)) = (
        &settings.s3_endpoint,
        &settings.s3_bucket,
        &settings.s3_access_key,
        &settings.s3_secret_key,
    ) else {
        return None;
    };
    let region = Region::Custom {
        region: settings.s3_region.clone(),
        endpoint: endpoint.trim_end_matches('/').to_string(),
    };
    let creds = Credentials::new(Some(access), Some(secret), None, None, None).ok()?;
    Some((region, creds, bucket.clone()))
}

/// Monta o store conforme `S3_*` configurado; sem config completo → filesystem.
pub fn build_store(settings: &Settings) -> Result<Arc<dyn ObjectStore>, DomainError> {
    if let Some((region, creds, bucket_name)) = s3_parts(settings) {
        let endpoint = settings
            .s3_endpoint
            .as_deref()
            .unwrap_or_default()
            .to_string();
        let bucket = Bucket::new(&bucket_name, region, creds)
            .map_err(|_| DomainError::Infra)?
            .with_path_style();
        tracing::info!(endpoint, bucket = bucket_name, "object store: S3/MinIO");
        Ok(Arc::new(S3Store { bucket }))
    } else {
        tracing::info!(dir = %settings.storage_dir, "object store: filesystem");
        Ok(Arc::new(FsStore::new(&settings.storage_dir)))
    }
}
