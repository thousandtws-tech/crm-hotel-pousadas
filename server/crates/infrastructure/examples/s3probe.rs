//! Probe de verificação S3/MinIO — lista buckets, cria o bucket de mídia
//! se necessário e exercita put/get/delete.
//!
//! Uso:
//!   S3_ENDPOINT=https://bucket-production-e66fc.up.railway.app \
//!   S3_ACCESS_KEY=... S3_SECRET_KEY=... S3_BUCKET=midias \
//!   cargo run -p clarituz-infrastructure --example s3probe

use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::region::Region;

fn creds() -> Credentials {
    Credentials::new(
        Some(&std::env::var("S3_ACCESS_KEY").expect("S3_ACCESS_KEY")),
        Some(&std::env::var("S3_SECRET_KEY").expect("S3_SECRET_KEY")),
        None,
        None,
        None,
    )
    .expect("credentials")
}

fn region() -> Region {
    Region::Custom {
        region: std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into()),
        endpoint: std::env::var("S3_ENDPOINT")
            .expect("S3_ENDPOINT")
            .trim_end_matches('/')
            .to_string(),
    }
}

#[tokio::main]
async fn main() {
    let name = std::env::var("S3_BUCKET").unwrap_or_else(|_| "midias".into());
    let creds = creds();
    let region = region();

    // buckets existentes
    match Bucket::list_buckets(region.clone(), creds.clone()).await {
        Ok(list) => {
            let names: Vec<_> = list.buckets.bucket.iter().map(|b| b.name.clone()).collect();
            println!("buckets: {names:?}");
        }
        Err(e) => println!("list_buckets falhou: {e}"),
    }

    let bucket = Bucket::new(&name, region.clone(), creds.clone())
        .expect("bucket")
        .with_path_style();

    match bucket.exists().await {
        Ok(true) => println!("bucket `{name}` existe"),
        Ok(false) => {
            println!("bucket `{name}` não existe — criando");
            match Bucket::create_with_path_style(
                &name,
                region.clone(),
                creds.clone(),
                s3::BucketConfiguration::default(),
            )
            .await
            {
                Ok(r) => println!("criado: {}", r.response_text),
                Err(e) => {
                    println!("create falhou: {e}");
                    std::process::exit(2);
                }
            }
        }
        Err(e) => {
            println!("exists falhou: {e}");
            std::process::exit(2);
        }
    }

    // put → get → delete round-trip
    let key = "_probe/hello.txt";
    let payload = b"ola-minio";
    bucket
        .put_object_with_content_type(key, payload, "text/plain")
        .await
        .expect("put");
    println!("put {key} ok");

    let got = bucket.get_object(key).await.expect("get");
    assert_eq!(got.bytes(), &payload[..]);
    println!("get {key} ok ({} bytes)", got.bytes().len());

    bucket.delete_object(key).await.expect("delete");
    println!("delete {key} ok");

    match bucket.get_object(key).await {
        Ok(r) if r.status_code() == 404 => println!("pós-delete get → 404 (esperado)"),
        Ok(r) => println!(
            "ERRO: status {} — objeto deveria ter sumido",
            r.status_code()
        ),
        Err(e) => println!("pós-delete get → {e} (esperado)"),
    }

    // lista objetos sob prefixos da aplicação (evidência no bucket)
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
}
