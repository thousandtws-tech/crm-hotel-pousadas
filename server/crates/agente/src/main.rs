use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::time::timeout;

const PORTAS_IMPRESSORA: [u16; 3] = [9100, 631, 515];
const TIMEOUT_TCP: Duration = Duration::from_millis(250);
const TIMEOUT_HTTP: Duration = Duration::from_millis(700);
const CONCORRENCIA: usize = 128;

#[derive(Debug, Serialize)]
struct Descoberta {
    tipo: &'static str,
    endereco: String,
    porta: Option<u16>,
    modelo: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResp {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct Job {
    id: i64,
    host: String,
    porta: i32,
    payload: Vec<u8>,
    #[serde(default = "modo_escpos")]
    modo: String,
}

fn modo_escpos() -> String {
    "escpos".into()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let cfg = Cfg::de_args();

    let api = cfg.api.trim_end_matches('/').to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let token = if let Some(t) = &cfg.token {
        t.clone()
    } else {
        let t = login(&client, &api, &cfg).await?;
        tracing::info!("autenticado em {api}");
        t
    };

    if cfg.intervalo == 0 {
        ciclo_descoberta(&client, &api, &token).await;
        processar_jobs(&client, &api, &token).await;
        return Ok(());
    }
    loop {
        ciclo_descoberta(&client, &api, &token).await;
        let fim = tokio::time::Instant::now() + Duration::from_secs(cfg.intervalo);
        while tokio::time::Instant::now() < fim {
            processar_jobs(&client, &api, &token).await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}

struct Cfg {
    api: String,
    login: String,
    senha: String,
    token: Option<String>,
    intervalo: u64,
}

impl Cfg {
    fn de_args() -> Self {
        let arg = |nome: &str| -> Option<String> {
            let args: Vec<String> = std::env::args().collect();
            args.iter()
                .position(|a| a == nome)
                .and_then(|i| args.get(i + 1))
                .cloned()
        };
        let env_or = |flag: &str, env: &str, padrao: &str| {
            arg(flag)
                .or_else(|| std::env::var(env).ok())
                .unwrap_or_else(|| padrao.to_string())
        };
        Self {
            api: env_or("--api", "AGENTE_API", "http://localhost:8080/api/v1"),
            login: env_or("--login", "AGENTE_LOGIN", ""),
            senha: env_or("--senha", "AGENTE_SENHA", ""),
            token: arg("--token").or_else(|| std::env::var("AGENTE_TOKEN").ok()),
            intervalo: env_or("--intervalo", "AGENTE_INTERVALO", "0")
                .parse()
                .unwrap_or(0),
        }
    }
}

async fn login(
    client: &reqwest::Client,
    api: &str,
    cfg: &Cfg,
) -> Result<String, Box<dyn std::error::Error>> {
    let r: TokenResp = client
        .post(format!("{api}/auth/login"))
        .json(&serde_json::json!({"login": cfg.login, "senha": cfg.senha}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(r.access_token)
}

async fn push(
    client: &reqwest::Client,
    api: &str,
    token: &str,
    desc: &[Descoberta],
) -> Result<usize, Box<dyn std::error::Error>> {
    #[derive(Deserialize)]
    struct R {
        registradas: usize,
    }
    let host = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "agente".into());
    let r: R = client
        .post(format!("{api}/impressoras/descobertas"))
        .bearer_auth(token)
        .json(&serde_json::json!({"origem": host, "descobertas": desc}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(r.registradas)
}

async fn ciclo_descoberta(client: &reqwest::Client, api: &str, token: &str) {
    let mut desc = descobrir_rede().await;
    desc.extend(descobrir_usb());
    tracing::info!("{} dispositivo(s) encontrados", desc.len());
    match push(client, api, token, &desc).await {
        Ok(n) => tracing::info!("{n} descoberta(s) registradas na API"),
        Err(e) => tracing::warn!("falha ao reportar: {e}"),
    }
}

async fn processar_jobs(client: &reqwest::Client, api: &str, token: &str) {
    let jobs: Vec<Job> = match client
        .get(format!("{api}/impressoras/jobs/pendentes"))
        .bearer_auth(token)
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or_default(),
        Err(e) => {
            tracing::warn!("falha ao buscar jobs: {e}");
            return;
        }
    };
    for j in jobs {
        let resultado = entregar(&j).await;
        let (sucesso, erro) = match &resultado {
            Ok(()) => (true, None),
            Err(e) => (false, Some(e.to_string())),
        };
        if sucesso {
            tracing::info!("job {} impresso em {}:{}", j.id, j.host, j.porta);
        } else {
            tracing::warn!(
                "job {} falhou em {}:{} — {}",
                j.id,
                j.host,
                j.porta,
                erro.as_deref().unwrap_or("?")
            );
        }
        let _ = client
            .post(format!("{api}/impressoras/jobs/{}/resultado", j.id))
            .bearer_auth(token)
            .json(&serde_json::json!({"sucesso": sucesso, "erro": erro}))
            .send()
            .await;
    }
}

async fn entregar(j: &Job) -> Result<(), Box<dyn std::error::Error>> {
    use tokio::io::AsyncWriteExt;

    if let Some(fila) = j.host.strip_prefix("usb:") {
        if j.modo == "texto" {
            return imprimir_texto(fila, &j.payload);
        }
        return imprimir_usb(fila, &j.payload);
    }
    let mut s = timeout(
        Duration::from_secs(5),
        TcpStream::connect((j.host.as_str(), j.porta as u16)),
    )
    .await??;
    s.write_all(&j.payload).await?;
    s.flush().await?;
    Ok(())
}

#[cfg(windows)]
fn imprimir_usb(fila: &str, dados: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Graphics::Printing::*;
    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }
    unsafe {
        let mut h = std::mem::zeroed();
        if OpenPrinterW(wide(fila).as_ptr().cast_mut(), &raw mut h, std::ptr::null()) == 0 {
            return Err(format!("fila '{fila}' não encontrada/acessível").into());
        }
        let nome = wide("clarituz job");
        let raw = wide("RAW");
        let info = DOC_INFO_1W {
            pDocName: nome.as_ptr().cast_mut(),
            pOutputFile: std::ptr::null_mut(),
            pDatatype: raw.as_ptr().cast_mut(),
        };
        let doc = StartDocPrinterW(h, 1, std::ptr::from_ref(&info).cast_mut());
        let mut escrito = 0u32;
        let ok = doc != 0
            && StartPagePrinter(h) != 0
            && WritePrinter(
                h,
                dados.as_ptr().cast(),
                dados.len() as u32,
                &raw mut escrito,
            ) != 0
            && EndPagePrinter(h) != 0
            && EndDocPrinter(h) != 0;
        ClosePrinter(h);
        if ok && escrito == dados.len() as u32 {
            Ok(())
        } else {
            Err(format!(
                "falha no spooler para '{fila}' ({escrito}/{} bytes)",
                dados.len()
            )
            .into())
        }
    }
}

#[cfg(not(windows))]
fn imprimir_usb(fila: &str, dados: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    let tmp = std::env::temp_dir().join(format!("clarituz-{}.bin", std::process::id()));
    std::fs::File::create(&tmp)?.write_all(dados)?;
    let st = std::process::Command::new("lp")
        .args(["-d", fila, "-o", "raw"])
        .arg(&tmp)
        .status()?;
    let _ = std::fs::remove_file(&tmp);
    if st.success() {
        Ok(())
    } else {
        Err(format!("lp falhou para '{fila}'").into())
    }
}

#[cfg(windows)]
fn imprimir_texto(fila: &str, dados: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let txt = std::env::temp_dir().join(format!("clarituz-etq-{}.txt", std::process::id()));
    std::fs::write(&txt, dados)?;
    let script = r"
Add-Type -AssemblyName System.Drawing
$p = $args[0]; $t = [IO.File]::ReadAllText($args[1])
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $p
$doc.add_PrintPage({ param($s,$e)
  $f = New-Object System.Drawing.Font('Segoe UI', 10)
  $e.Graphics.DrawString($t, $f, [System.Drawing.Brushes]::Black, 4, 4)
  $e.HasMorePages = $false
})
$doc.Print()
";
    let ps = std::env::temp_dir().join(format!("clarituz-etq-{}.ps1", std::process::id()));
    std::fs::write(&ps, script)?;
    let st = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&ps)
        .arg(fila)
        .arg(&txt)
        .status()?;
    let _ = std::fs::remove_file(&ps);
    let _ = std::fs::remove_file(&txt);
    if st.success() {
        Ok(())
    } else {
        Err(format!("impressão de texto falhou para '{fila}'").into())
    }
}

#[cfg(not(windows))]
fn imprimir_texto(fila: &str, dados: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    let tmp = std::env::temp_dir().join(format!("clarituz-etq-{}.txt", std::process::id()));
    std::fs::File::create(&tmp)?.write_all(dados)?;
    let st = std::process::Command::new("lp")
        .args(["-d", fila])
        .arg(&tmp)
        .status()?;
    let _ = std::fs::remove_file(&tmp);
    if st.success() {
        Ok(())
    } else {
        Err(format!("lp (texto) falhou para '{fila}'").into())
    }
}

async fn descobrir_rede() -> Vec<Descoberta> {
    let mut redes: Vec<Ipv4Addr> = Vec::new();
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            if let if_addrs::IfAddr::V4(v4) = a.addr {
                let ip = v4.ip;
                if !ip.is_loopback() && !redes.iter().any(|r| base24(*r) == base24(ip)) {
                    redes.push(ip);
                }
            }
        }
    }
    if redes.is_empty() {
        tracing::warn!("nenhuma interface de rede IPv4 encontrada");
        return Vec::new();
    }

    let sem = Arc::new(Semaphore::new(CONCORRENCIA));
    let mut jobs = Vec::new();
    for ip in redes {
        let base = base24(ip);
        for ult in 1..=254u8 {
            for porta in PORTAS_IMPRESSORA {
                let alvo = Ipv4Addr::new(base[0], base[1], base[2], ult);
                let sem = sem.clone();
                jobs.push(tokio::spawn(async move {
                    let _p = sem.acquire().await.ok()?;
                    let ok = timeout(TIMEOUT_TCP, TcpStream::connect((alvo, porta)))
                        .await
                        .ok()?
                        .is_ok();
                    ok.then_some((alvo, porta))
                }));
            }
        }
    }
    let mut hits: Vec<(Ipv4Addr, u16)> = Vec::new();
    for j in jobs {
        if let Ok(Some(h)) = j.await {
            hits.push(h);
        }
    }
    hits.sort();
    hits.dedup();

    let mut out = Vec::with_capacity(hits.len());
    for (ip, porta) in hits {
        let modelo = modelo_http(ip).await;
        out.push(Descoberta {
            tipo: "rede",
            endereco: ip.to_string(),
            porta: Some(porta),
            modelo,
        });
    }
    out
}

fn base24(ip: Ipv4Addr) -> [u8; 3] {
    let o = ip.octets();
    [o[0], o[1], o[2]]
}

async fn modelo_http(ip: Ipv4Addr) -> Option<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    for porta in [80u16, 631] {
        let s = timeout(TIMEOUT_HTTP, TcpStream::connect((ip, porta)))
            .await
            .ok()?
            .ok();
        let Some(mut s) = s else { continue };
        let req = format!("GET / HTTP/1.0\r\nHost: {ip}\r\n\r\n");
        if s.write_all(req.as_bytes()).await.is_err() {
            continue;
        }
        let mut buf = vec![0u8; 8192];
        let _ = timeout(TIMEOUT_HTTP, s.read(&mut buf)).await;
        let texto = String::from_utf8_lossy(&buf);
        if let Some(m) = extrair_modelo(&texto) {
            return Some(m);
        }
    }
    None
}

fn extrair_modelo(http: &str) -> Option<String> {
    let low = http.to_lowercase();
    for tag in ["<title>", "server:"] {
        if let Some(i) = low.find(tag) {
            let ini = i + tag.len();
            let fim = low[ini..]
                .find(['<', '\r', '\n'])
                .map_or(http.len().min(ini + 60), |f| ini + f);
            let t = http[ini..fim].trim().trim_end_matches("</title>");
            if t.len() >= 3 && t.len() <= 60 {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn descobrir_usb() -> Vec<Descoberta> {
    let nomes: Vec<String> = if cfg!(windows) {
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-Printer | Where-Object {$_.PortName -match 'USB'} | Select-Object -ExpandProperty Name",
            ])
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        std::process::Command::new("lpstat")
            .arg("-v")
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter_map(|l| {
                        l.strip_prefix("device for ")
                            .and_then(|r| r.split(':').next())
                            .map(|n| n.trim().to_string())
                    })
                    .filter(|n| !n.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };
    nomes
        .into_iter()
        .map(|nome| Descoberta {
            tipo: "usb",
            endereco: nome.clone(),
            porta: None,
            modelo: Some(nome),
        })
        .collect()
}
