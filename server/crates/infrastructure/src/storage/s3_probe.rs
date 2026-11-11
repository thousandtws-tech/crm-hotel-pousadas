//! Probe de verificação S3/MinIO — `clarituz-api s3-probe`.
//!
//! Lista buckets, garante o bucket de mídia e exercita put/get/delete.
//! Roda dentro do container de produção (o Docker só shipa o binário
//! `clarituz-api`) — é o caminho de diagnóstico do object store no
//! Railway sem precisar de build local.
//!
//! Falhas parciais são reportadas e o probe segue — é diagnóstico,
//! não verificação de deploy (essa é a `/readyz`).

use super::object_store::s3_parts;
use clarituz_domain::DomainError;
use clarituz_shared::Settings;
use s3::bucket::Bucket;
use s3::BucketConfiguration;

/// Executa o probe. Não depende de banco — pode rodar com o Postgres fora.
pub async fn run(settings: &Settings) -> Result<(), DomainError> {
    let (region, creds, name) = s3_parts(settings).ok_or_else(|| {
        tracing::error!(
            "S3_* incompleto — exige S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY"
        );
        DomainError::Infra
    })?;

    match Bucket::list_buckets(region.clone(), creds.clone()).await {
        Ok(list) => {
            let names: Vec<_> = list.buckets.bucket.iter().map(|b| b.name.clone()).collect();
            println!("buckets: {names:?}");
        }
        Err(e) => println!("list_buckets falhou: {e}"),
    }

    let bucket = Bucket::new(&name, region.clone(), creds.clone())
        .map_err(|_| DomainError::Infra)?
        .with_path_style();

    match bucket.exists().await {
        Ok(true) => println!("bucket `{name}` existe"),
        Ok(false) => {
            println!("bucket `{name}` não existe — criando");
            match Bucket::create_with_path_style(
                &name,
                region,
                creds,
                BucketConfiguration::default(),
            )
            .await
            {
                Ok(r) => println!("criado: {}", r.response_text),
                Err(e) => {
                    println!("create falhou: {e}");
                    return Err(DomainError::Infra);
                }
            }
        }
        Err(e) => {
            println!("exists falhou: {e}");
            return Err(DomainError::Infra);
        }
    }

    // put → get → delete round-trip
    let key = "_probe/hello.txt";
    let payload = b"ola-minio";
    bucket
        .put_object_with_content_type(key, payload, "text/plain")
        .await
        .map_err(|e| {
            println!("put falhou: {e}");
            DomainError::Infra
        })?;
    println!("put {key} ok");

    let got = bucket.get_object(key).await.map_err(|e| {
        println!("get falhou: {e}");
        DomainError::Infra
    })?;
    if got.bytes() != &payload[..] {
        println!("ERRO: conteúdo divergente no get");
        return Err(DomainError::Infra);
    }
    println!("get {key} ok ({} bytes)", got.bytes().len());

    bucket.delete_object(key).await.map_err(|e| {
        println!("delete falhou: {e}");
        DomainError::Infra
    })?;
    println!("delete {key} ok");

    match bucket.get_object(key).await {
        Ok(r) if r.status_code() == 404 => println!("pós-delete get → 404 (esperado)"),
        Ok(r) => println!(
            "ERRO: status {} — objeto deveria ter sumido",
            r.status_code()
        ),
        Err(e) => println!("pós-delete get → {e} (esperado)"),
    }

    // objetos sob prefixos da aplicação (evidência no bucket)
    for prefix in ["cms/", "clientes/", "documentos/", "logo/", "_probe/"] {
        match bucket.list(prefix.to_string(), None).await {
            Ok(pages) => {
                let keys: Vec<String> = pages
                    .iter()
                    .flat_map(|p| p.contents.iter().map(|o| o.key.clone()))
                    .collect();
                println!("prefix `{prefix}`: {keys:?}");
            }
            Err(e) => println!("list `{prefix}` falhou: {e}"),
        }
    }
    println!("PROBE OK");
    Ok(())
}
