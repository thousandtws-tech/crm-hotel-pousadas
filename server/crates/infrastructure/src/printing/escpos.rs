//! Adapter ESC/POS — converte `LinhaRecibo` em bytes do protocolo Epson
//! ESC/POS e envia à impressora térmica via RAW TCP (padrão porta 9100).
//!
//! Sem dependência externa: o subconjunto usado (init, codepage,
//! alinhamento, negrito, feed, corte) são ~10 bytes de comando.

use clarituz_domain::ports::ImpressoraGateway;
use clarituz_domain::ports::LinhaRecibo;
use clarituz_domain::DomainError;
use sqlx::PgPool;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;
const LF: u8 = 0x0A;

/// Colunas do cupom de 80 mm na fonte A (58 mm ≈ 32).
const COLUNAS: usize = 42;

const TIMEOUT: Duration = Duration::from_secs(5);

/// UTF-8 → Windows-1252 — codepage 16 (`ESC t 16`) das térmicas BR.
/// Acentos pt-BR (áçãõéê…) vivem em U+00A0..=U+00FF, mapeamento direto.
fn cp1252(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c as u32 {
            0x00..=0x7F | 0xA0..=0xFF => c as u8,
            // tipográficos comuns caem para o equivalente ASCII
            0x2018 | 0x2019 => b'\'',
            0x201C | 0x201D => b'"',
            0x2013 | 0x2014 => b'-',
            _ => b'?',
        })
        .collect()
}

/// "texto .............. valor" — esquerda/direita na mesma linha de 42 col.
fn par(texto: &str, valor: &str) -> String {
    let espacos = COLUNAS.saturating_sub(texto.len() + valor.len());
    format!("{texto}{}{valor}", " ".repeat(espacos.max(1)))
}

/// Monta o byte-stream completo do recibo.
pub(crate) fn montar(linhas: &[LinhaRecibo]) -> Vec<u8> {
    let mut b = Vec::with_capacity(2048);
    // init + codepage WPC1252 (acentos pt-BR)
    b.extend([ESC, b'@', ESC, b't', 16]);

    for l in linhas {
        match l {
            LinhaRecibo::Texto(t) => {
                b.extend([ESC, b'a', 0]);
                b.extend(cp1252(t));
                b.push(LF);
            }
            LinhaRecibo::Centro(t) => {
                b.extend([ESC, b'a', 1]);
                b.extend(cp1252(t));
                b.push(LF);
            }
            LinhaRecibo::Titulo(t) => {
                b.extend([ESC, b'E', 1, ESC, b'a', 1]);
                b.extend(cp1252(t));
                b.extend([LF, ESC, b'E', 0, ESC, b'a', 0]);
            }
            LinhaRecibo::Par { texto, valor } => {
                b.extend([ESC, b'a', 0]);
                b.extend(cp1252(&par(texto, valor)));
                b.push(LF);
            }
            LinhaRecibo::Separador => {
                b.extend(cp1252(&"-".repeat(COLUNAS)));
                b.push(LF);
            }
            LinhaRecibo::Avanco(n) => {
                b.extend(std::iter::repeat_n(LF, *n as usize));
            }
        }
    }
    // feed + corte parcial (GS V A 0) — suportado por praticamente todas
    b.extend([LF, LF, LF, GS, b'V', b'A', 0]);
    b
}

/// Impressora térmica de rede — um job = uma conexão (o protocolo é
/// unidirecional; não há sessão persistente na porta 9100).
pub struct TcpImpressora;

#[async_trait::async_trait]
impl ImpressoraGateway for TcpImpressora {
    async fn imprimir(
        &self,
        host: &str,
        porta: u16,
        linhas: &[LinhaRecibo],
    ) -> Result<(), DomainError> {
        let bytes = montar(linhas);
        let io = async {
            let mut s = TcpStream::connect((host, porta)).await?;
            s.write_all(&bytes).await?;
            s.flush().await?;
            Ok::<_, std::io::Error>(())
        };
        tokio::time::timeout(TIMEOUT, io)
            .await
            .map_err(|_| {
                tracing::warn!(host, porta, "timeout ao conectar na impressora");
                DomainError::regra(format!("Impressora {host}:{porta} não respondeu."))
            })?
            .map_err(|e| {
                tracing::warn!(host, porta, error = %e, "falha na impressão");
                DomainError::regra(format!(
                    "Falha ao imprimir em {host}:{porta}. Verifique a impressora."
                ))
            })
    }

    async fn etiqueta(&self, _host: &str, _porta: u16, _texto: &str) -> Result<(), DomainError> {
        Err(DomainError::regra("Etiquetas requerem o agente local."))
    }
}

/// Impressão via fila local — entrega real é feita pelo agente na LAN do
/// hotel. Impressoras `usb:*` e IPs inalcançáveis da cloud viram jobs;
/// rede alcançável imprime direto (fallback = enfileira mesmo assim).
pub struct SpoolImpressora {
    pool: PgPool,
}

impl SpoolImpressora {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn enfileirar(
        &self,
        host: &str,
        porta: u16,
        bytes: &[u8],
        modo: &str,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO impressao_job (host, porta, payload, modo) VALUES ($1, $2, $3, $4)",
        )
        .bind(host)
        .bind(porta as i32)
        .bind(bytes)
        .bind(modo)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            tracing::warn!(host, error = %e, "falha ao enfileirar job de impressão");
            DomainError::regra("Falha ao enfileirar impressão.")
        })?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl ImpressoraGateway for SpoolImpressora {
    async fn imprimir(
        &self,
        host: &str,
        porta: u16,
        linhas: &[LinhaRecibo],
    ) -> Result<(), DomainError> {
        let bytes = montar(linhas);
        // USB só existe na máquina do agente — sempre vai para a fila.
        if !host.starts_with("usb:") {
            let io = async {
                let mut s = TcpStream::connect((host, porta)).await?;
                s.write_all(&bytes).await?;
                s.flush().await?;
                Ok::<_, std::io::Error>(())
            };
            if let Ok(Ok(())) = tokio::time::timeout(Duration::from_millis(800), io).await {
                return Ok(());
            }
            tracing::info!(
                host,
                porta,
                "impressora inalcançável — job enfileirado p/ agente"
            );
        }
        self.enfileirar(host, porta, &bytes, "escpos").await
    }

    /// Etiqueta → job modo 'texto': o agente entrega via driver do SO
    /// (qualquer modelo de etiqueteira/impressora comum).
    async fn etiqueta(&self, host: &str, porta: u16, texto: &str) -> Result<(), DomainError> {
        self.enfileirar(host, porta, texto.as_bytes(), "texto")
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn par_alinha_em_42_colunas() {
        let s = par("Estadia", "R$ 500.00");
        assert_eq!(s.len(), 42);
        assert!(s.starts_with("Estadia "));
        assert!(s.ends_with("R$ 500.00"));
    }

    #[test]
    fn cp1252_preserva_acentos() {
        assert_eq!(cp1252("Acomodação"), b"Acomoda\xe7\xe3o".as_slice());
        assert_eq!(cp1252("José"), b"Jos\xe9".as_slice());
    }

    #[test]
    fn montar_termina_com_corte() {
        let b = montar(&[LinhaRecibo::Titulo("TESTE".into())]);
        assert_eq!(&b[..4], &[ESC, b'@', ESC, b't']);
        assert_eq!(&b[b.len() - 4..], &[GS, b'V', b'A', 0]);
    }
}
