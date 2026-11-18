//! Monitor de falhas operacionais — varredura periódica que transforma
//! falhas terminais da outbox (`fila_envio`) e do fiscal
//! (`fiscal_documento`) em alertas internos para a equipe.
//!
//! Sem o monitor, uma falha de WhatsApp ou uma NFS-e rejeitada ficava
//! só registrada no banco — ninguém era avisado. O canal de entrega é
//! o próprio EventBus: o `Aviso` vira linha em `notificacao` (sino do
//! admin) e chega via SSE a todas as réplicas.
//!
//! Dedup é durável (`alerta_operacional`), não watermark em memória:
//! restart e réplicas concorrentes não re-alertam nem perdem itens —
//! quem já disparou nunca repete; falha tardia (retry longo da outbox)
//! entra na janela normalmente.

use std::sync::Arc;

use chrono::{Duration, Utc};
use clarituz_domain::entities::{FiscalDocumento, ItemFila, StatusFiscal};
use clarituz_domain::enums::{CanalEnvio, StatusEnvio};
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    AlertaOperacionalRepository, EventoPublisher, FilaEnvioRepository, FiscalRepository, NovoAlerta,
};

use crate::error::AppResult;

/// Janela de detecção — falhas mais antigas prescindem de alerta
/// retroativo (o item já nasceu visto para a operação).
const JANELA_DIAS: i64 = 7;
/// Teto por varredura e por origem — o que sobrar entra no próximo tick.
const LIMITE_LOTE: i64 = 100;
/// Erros de provedor vêm inteiros em `ultimo_erro` — a mensagem ao
/// staff fica com o trecho útil, não o stack completo.
const MOTIVO_MAX: usize = 200;
const DESTINO_MAX: usize = 60;

pub struct AlertaFalhaService {
    fila: Arc<dyn FilaEnvioRepository>,
    fiscal: Arc<dyn FiscalRepository>,
    alertas: Arc<dyn AlertaOperacionalRepository>,
    eventos: Arc<dyn EventoPublisher>,
}

impl AlertaFalhaService {
    pub fn new(
        fila: Arc<dyn FilaEnvioRepository>,
        fiscal: Arc<dyn FiscalRepository>,
        alertas: Arc<dyn AlertaOperacionalRepository>,
        eventos: Arc<dyn EventoPublisher>,
    ) -> Self {
        Self {
            fila,
            fiscal,
            alertas,
            eventos,
        }
    }

    /// Varredura periódica (worker, 15 min) — devolve quantos alertas
    /// novos foram disparados nesta rodada.
    pub async fn varrer(&self) -> AppResult<u32> {
        let desde = Utc::now() - Duration::days(JANELA_DIAS);
        let mut emitidos = 0u32;
        for item in self.fila.falhas(desde, LIMITE_LOTE).await? {
            if self.alertar_envio(&item).await? {
                emitidos += 1;
            }
        }
        for doc in self.fiscal.falhas(desde, LIMITE_LOTE).await? {
            if self.alertar_fiscal(&doc).await? {
                emitidos += 1;
            }
        }
        Ok(emitidos)
    }

    /// Alerta um item da fila de envio — dedup por (item, status): a
    /// transição terminal acontece uma única vez na vida do item
    /// (reenvio manual gera item novo, com id novo).
    async fn alertar_envio(&self, item: &ItemFila) -> AppResult<bool> {
        let status = match item.status {
            StatusEnvio::Falhou => "falhou",
            StatusEnvio::Desconhecido => "desconhecido",
            _ => return Ok(false),
        };
        let (titulo, mensagem) = mensagem_envio(item);
        let novo = self
            .alertas
            .registrar(&NovoAlerta {
                dedup_key: format!("fila_envio:{}:{status}", item.id),
                origem: "fila_envio".into(),
                id_origem: item.id,
                titulo: titulo.clone(),
                mensagem: mensagem.clone(),
            })
            .await?;
        if !novo {
            return Ok(false);
        }
        // Recepção resolve — contato alternativo com o hóspede.
        self.eventos.avisar(
            Aviso::novo(TipoAviso::Alerta, titulo, mensagem).dados(serde_json::json!({
                "fila_envio": item.id,
                "idreserva": item.idreserva,
            })),
        );
        tracing::warn!(fila_envio = item.id, status, "monitor: falha de envio alertada");
        Ok(true)
    }

    /// Alerta um documento fiscal — dedup por (documento, status,
    /// minuto da transição): nova falha após reprocessamento manual
    /// alerta de novo; o reagendar+transição do worker (mesma escrita
    /// lógica em dois UPDATEs) colapsa no mesmo minuto.
    async fn alertar_fiscal(&self, doc: &FiscalDocumento) -> AppResult<bool> {
        let (titulo, mensagem) = mensagem_fiscal(doc);
        let novo = self
            .alertas
            .registrar(&NovoAlerta {
                dedup_key: dedup_fiscal(doc),
                origem: "fiscal_documento".into(),
                id_origem: doc.id,
                titulo: titulo.clone(),
                mensagem: mensagem.clone(),
            })
            .await?;
        if !novo {
            return Ok(false);
        }
        // Financeiro/gerência resolve — correção de dados e reprocesso.
        let mut aviso = Aviso::novo(TipoAviso::Alerta, titulo, mensagem).dados(serde_json::json!({
            "fiscal_documento": doc.id,
            "idreserva": doc.idreserva,
        }));
        aviso.ate_nivel = 2;
        self.eventos.avisar(aviso);
        tracing::warn!(
            fiscal_documento = doc.id,
            status = doc.status.as_str(),
            "monitor: falha fiscal alertada"
        );
        Ok(true)
    }
}

/// Texto do alerta de envio — canal, reserva e motivo legíveis.
fn mensagem_envio(item: &ItemFila) -> (String, String) {
    let canal = match item.canal {
        CanalEnvio::Whatsapp => "WhatsApp",
        CanalEnvio::Email => "E-mail",
        CanalEnvio::Push => "Push",
        CanalEnvio::Inbox => "Mensagem interna",
    };
    let alvo = item
        .idreserva
        .map_or_else(|| format!("item #{}", item.id), |r| format!("reserva #{r}"));
    let destino: String = item.destino.chars().take(DESTINO_MAX).collect();
    let motivo = motivo_curto(item.ultimo_erro.as_deref());
    match item.status {
        StatusEnvio::Desconhecido => (
            format!("{canal} com resultado incerto — {alvo}"),
            format!(
                "'{}' para {destino} ficou sem resposta do provedor — \
                 pode ter sido entregue. Reconcilie antes de reenviar ({motivo}).",
                item.template
            ),
        ),
        _ => (
            format!("{canal} não entregue — {alvo}"),
            format!(
                "Envio de '{}' para {destino} falhou após {} tentativa(s) — {motivo}.",
                item.template, item.tentativas
            ),
        ),
    }
}

/// Texto do alerta fiscal — modelo, reserva e detalhe do provedor.
fn mensagem_fiscal(doc: &FiscalDocumento) -> (String, String) {
    let alvo = doc
        .idreserva
        .map_or_else(|| format!("documento #{}", doc.id), |r| format!("reserva #{r}"));
    // Rejeição: o motivo vem do provedor (processing_detail); falha
    // técnica: o erro local é o mais fresco (processing_detail pode ser
    // de uma transição remota anterior, preservado por COALESCE).
    let motivo = match doc.status {
        StatusFiscal::Rejeitada => motivo_curto(
            doc.processing_detail
                .as_deref()
                .or(doc.ultimo_erro.as_deref()),
        ),
        _ => motivo_curto(
            doc.ultimo_erro
                .as_deref()
                .or(doc.processing_detail.as_deref()),
        ),
    };
    match doc.status {
        StatusFiscal::Rejeitada => (
            format!("NFS-e rejeitada — {alvo}"),
            format!(
                "Nota rejeitada pelo provedor (ref {}) — {motivo}. \
                 Corrija os dados e reprocesse o documento #{}.",
                doc.integration_id, doc.id
            ),
        ),
        _ => (
            format!("NFS-e com falha — {alvo}"),
            format!(
                "Emissão da nota parou na fila após {} tentativa(s) — {motivo} \
                 (documento #{}, ref {}).",
                doc.tentativas, doc.id, doc.integration_id
            ),
        ),
    }
}

/// Chave de dedup fiscal — a ocorrência é (documento, status, minuto da
/// transição): `atualizado_em` muda a cada `registrar_transicao`, então
/// reprocessamento que volta a falhar alerta de novo.
fn dedup_fiscal(doc: &FiscalDocumento) -> String {
    let minuto = doc.atualizado_em.timestamp().div_euclid(60);
    format!("fiscal_documento:{}:{}:{minuto}", doc.id, doc.status.as_str())
}

/// Erro legível para o staff — recorta o trecho útil do erro técnico.
fn motivo_curto(erro: Option<&str>) -> String {
    erro.map(str::trim)
        .filter(|m| !m.is_empty())
        .map_or_else(
            || "sem detalhe registrado".into(),
            |m| m.chars().take(MOTIVO_MAX).collect::<String>(),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use rust_decimal::Decimal;

    fn item_whatsapp(status: StatusEnvio, idreserva: Option<i64>) -> ItemFila {
        ItemFila {
            id: 42,
            canal: CanalEnvio::Whatsapp,
            destino: "+5547999990000".into(),
            template: "reserva_confirmada".into(),
            payload: serde_json::json!({}),
            idreserva,
            idcliente: Some(1),
            idfuncionario: None,
            agendado_para: Utc::now(),
            tentativas: 8,
            ultimo_erro: Some("Z-API HTTP 500".into()),
            provider_msg_id: None,
            provedor: Some("zapi".into()),
            idintegracao: Some(1),
            status,
            dedup_key: Some("r7:w:conf".into()),
            template_versao: 1,
            criado_em: Utc::now(),
            enviado_em: None,
            entregue_em: None,
            lido_em: None,
        }
    }

    fn doc_fiscal(status: StatusFiscal, idreserva: Option<i64>) -> FiscalDocumento {
        FiscalDocumento {
            id: 7,
            idintegracao: 1,
            idreserva,
            modelo: "nfse".into(),
            integration_id: "nfse-res7-v1".into(),
            remote_id: Some("rem-1".into()),
            status,
            status_remoto: Some("rejected".into()),
            processing_detail: Some("tomador com CNPJ inválido".into()),
            tomador: serde_json::json!({}),
            payload: serde_json::json!({}),
            valor_total: Decimal::new(700, 2),
            descricao: None,
            competencia: None,
            motivo_cancelamento: None,
            numero_nota: None,
            url_consulta: None,
            ultimo_erro: None,
            tentativas: 5,
            proxima_tentativa: None,
            criado_por: None,
            atualizado_por: None,
            transmitido_em: None,
            autorizado_em: None,
            cancelado_em: None,
            criado_em: Utc::now(),
            atualizado_em: Utc.with_ymd_and_hms(2025, 1, 10, 12, 30, 0).unwrap(),
        }
    }

    #[test]
    fn whatsapp_falhou_nomeia_reserva_e_motivo() {
        let (titulo, mensagem) = mensagem_envio(&item_whatsapp(StatusEnvio::Falhou, Some(7)));
        assert_eq!(titulo, "WhatsApp não entregue — reserva #7");
        assert!(mensagem.contains("reserva_confirmada"));
        assert!(mensagem.contains("Z-API HTTP 500"));
        assert!(mensagem.contains("8 tentativa(s)"));
    }

    #[test]
    fn desconhecido_pede_reconciliacao() {
        let (titulo, mensagem) = mensagem_envio(&item_whatsapp(StatusEnvio::Desconhecido, Some(3)));
        assert_eq!(titulo, "WhatsApp com resultado incerto — reserva #3");
        assert!(mensagem.contains("Reconcilie antes de reenviar"));
    }

    #[test]
    fn fiscal_rejeitada_usa_detalhe_do_provedor() {
        let (titulo, mensagem) = mensagem_fiscal(&doc_fiscal(StatusFiscal::Rejeitada, Some(7)));
        assert_eq!(titulo, "NFS-e rejeitada — reserva #7");
        assert!(mensagem.contains("tomador com CNPJ inválido"));
        assert!(mensagem.contains("nfse-res7-v1"));
    }

    #[test]
    fn dedup_fiscal_distingue_ocorrencias() {
        let a = doc_fiscal(StatusFiscal::Falha, Some(7));
        // Mesmo documento reprocessado falha em outro minuto — nova
        // ocorrência, novo alerta; mesma transição, mesma chave.
        let mut b = a.clone();
        b.atualizado_em += Duration::minutes(3);
        assert_ne!(dedup_fiscal(&a), dedup_fiscal(&b));
        assert_eq!(dedup_fiscal(&a), dedup_fiscal(&a.clone()));
        assert!(dedup_fiscal(&a).starts_with("fiscal_documento:7:falha:"));
    }

    #[test]
    fn motivo_recorta_erro_longo() {
        let longo = "x".repeat(500);
        assert_eq!(motivo_curto(Some(&longo)).chars().count(), MOTIVO_MAX);
        assert_eq!(motivo_curto(Some("  ")), "sem detalhe registrado");
        assert_eq!(motivo_curto(None), "sem detalhe registrado");
    }
}
