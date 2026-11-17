//! E2E de pagamentos online — Postgres real + `FakeGateway` (nunca
//! cobrança real: a porta `PaymentGateway` é substituída por um fake que
//! emula as respostas do provedor).
//!
//! Cobre: criação de checkout (integral/sinal/saldo), confirmação via
//! webhook, idempotência de evento duplicado, expiração de hold,
//! reembolso parcial/integral e a permissão `financeiro`.

mod common;

use async_trait::async_trait;
use chrono::Utc;
use clarituz_application::dto::{CheckoutPublicoInput, ReembolsarPagamentoInput};
use clarituz_application::services::PagamentosOnlineService;
use clarituz_domain::enums::{StatusProcWebhook, TipoPagamento};
use clarituz_domain::ports::{
    ConsultaPagamento, NovaCheckout, NovoEventoWebhook, PagamentoRepository, PaymentGateway,
    SessaoCheckout, StatusPi,
};
use clarituz_domain::DomainError;
use clarituz_infrastructure::repositories::{PgPagamentoRepository, PgReservaRepository};
use clarituz_infrastructure::EventBus;
use common::{cenario, input_reserva};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

/// Gateway falso — sessão determinística e consulta sempre "paga" quando
/// o teste pede; sem rede, sem cobrança.
struct FakeGateway {
    pi_status: StatusPi,
}

#[async_trait]
impl PaymentGateway for FakeGateway {
    fn provedor(&self) -> &'static str {
        "stripe"
    }

    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError> {
        Ok(SessaoCheckout {
            session_id: format!("cs_fake_{}", nova.idpagamento),
            url: format!("https://checkout.fake/pay/{}", nova.idpagamento),
            expires_em: nova.expires_em,
            pi_id: Some(format!("pi_fake_{}", nova.idpagamento)),
        })
    }

    async fn consultar_pagamento(&self, ref_id: &str) -> Result<ConsultaPagamento, DomainError> {
        Ok(ConsultaPagamento {
            status: self.pi_status,
            referencia: Some(ref_id.to_string()),
            id_provedor: Some(ref_id.to_string()),
            metodo: Some("card".into()),
        })
    }

    async fn reembolsar(
        &self,
        _pi_id: &str,
        _valor_centavos: i64,
        _motivo: Option<&str>,
        _key: Uuid,
    ) -> Result<String, DomainError> {
        Ok(format!("re_fake_{}", Uuid::new_v4().simple()))
    }

    async fn expirar_sessao(&self, _session_id: &str) -> Result<(), DomainError> {
        Ok(())
    }

    async fn testar_conexao(&self) -> Result<String, DomainError> {
        Ok("acct_fake".into())
    }
}

fn service(pool: &PgPool) -> PagamentosOnlineService {
    PagamentosOnlineService::new(
        Arc::new(PgPagamentoRepository::new(pool.clone())),
        Arc::new(PgReservaRepository::new(pool.clone())),
        Some(Arc::new(FakeGateway {
            pi_status: StatusPi::Pago,
        })),
        None, // resolver — sem integração persistida, cai no gateway_env
        None, // integracoes
        Arc::new(EventBus::new()),
        30,
        30,
        "https://site.teste/ok".into(),
        "https://site.teste/cancel".into(),
    )
}

/// Reserva criada via fluxo do site (com hold + token público).
async fn reserva_do_site(c: &common::Cenario, pool: &PgPool) -> (i64, Uuid) {
    let (ini, fim) = common::datas();
    c.services
        .reservas
        .criar(&c.ator, input_reserva(c, ini, fim))
        .await
        .expect("criar reserva");
    let (id, token): (i64, Uuid) =
        sqlx::query_as("SELECT id, token_publico FROM reserva ORDER BY id DESC LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap();
    (id, token)
}

fn evento_session(
    session_id: &str,
    pi_id: &str,
    tipo: &str,
) -> clarituz_domain::entities::WebhookEvento {
    clarituz_domain::entities::WebhookEvento {
        id: 0,
        provedor: "stripe".into(),
        event_id: format!("evt_{tipo}_{session_id}"),
        event_type: tipo.into(),
        payload: serde_json::json!({
            "data": {"object": {
                "id": session_id,
                "payment_intent": pi_id,
                "payment_method_types": ["card"],
            }}
        }),
        idintegracao: None,
        status: StatusProcWebhook::Recebido,
        tentativas: 0,
        ultimo_erro: None,
        recebido_em: Utc::now(),
        processado_em: None,
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_integral_cria_sessao_e_tentativa(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    let out = svc
        .criar_checkout_publico(CheckoutPublicoInput {
            token,
            tipo: TipoPagamento::Integral,
        })
        .await
        .unwrap();

    assert!(out.checkout_url.contains("checkout.fake"));
    // 2 diárias × R$350 = R$700 → 70000 centavos — valor veio do servidor.
    assert_eq!(out.valor_centavos, 70000);
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_sinal_cobra_30_porcento(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    let out = svc
        .criar_checkout_publico(CheckoutPublicoInput {
            token,
            tipo: TipoPagamento::Sinal,
        })
        .await
        .unwrap();

    assert_eq!(out.valor_centavos, 21000); // 30% de 70000
}

#[sqlx::test(migrations = "../../migrations")]
async fn webhook_confirmado_paga_e_e_idempotente(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Integral,
    })
    .await
    .unwrap();

    let p = sqlx::query_scalar::<_, i64>("SELECT id FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    // Evento processado duas vezes — segunda passagem é no-op.
    for _ in 0..2 {
        let ev = evento_session(
            &format!("cs_fake_{p}"),
            &format!("pi_fake_{p}"),
            "checkout.session.completed",
        );
        svc.processar_evento(&ev).await.unwrap();
    }

    let status: String = sqlx::query_scalar("SELECT status::text FROM pagamento WHERE id = $1")
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pago");

    let pi: String = sqlx::query_scalar("SELECT pi_id FROM pagamento WHERE id = $1")
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pi, format!("pi_fake_{p}"));
}

#[sqlx::test(migrations = "../../migrations")]
async fn saldo_respeita_ja_pago(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    // Paga o sinal e confirma.
    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Sinal,
    })
    .await
    .unwrap();
    let p = sqlx::query_scalar::<_, i64>("SELECT id FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    svc.processar_evento(&evento_session(
        &format!("cs_fake_{p}"),
        &format!("pi_fake_{p}"),
        "checkout.session.completed",
    ))
    .await
    .unwrap();

    // Saldo = total − sinal = 70000 − 21000 = 49000.
    let out = svc
        .criar_checkout_publico(CheckoutPublicoInput {
            token,
            tipo: TipoPagamento::Saldo,
        })
        .await
        .unwrap();
    assert_eq!(out.valor_centavos, 49000);
}

#[sqlx::test(migrations = "../../migrations")]
async fn reembolso_parcial_atualiza_status(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Integral,
    })
    .await
    .unwrap();
    let p = sqlx::query_scalar::<_, i64>("SELECT id FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    svc.processar_evento(&evento_session(
        &format!("cs_fake_{p}"),
        &format!("pi_fake_{p}"),
        "checkout.session.completed",
    ))
    .await
    .unwrap();

    let r = svc
        .reembolsar(
            &c.ator, // admin — financeiro implícito
            p,
            ReembolsarPagamentoInput {
                valor_centavos: 30000,
                motivo: Some("cancelamento parcial".into()),
            },
        )
        .await
        .unwrap();
    assert!(r.refund_id.unwrap().starts_with("re_fake_"));

    let status: String = sqlx::query_scalar("SELECT status::text FROM pagamento WHERE id = $1")
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "reembolso_parcial");
}

#[sqlx::test(migrations = "../../migrations")]
async fn reembolso_exige_permissao_financeira(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);
    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Integral,
    })
    .await
    .unwrap();

    let p = sqlx::query_scalar::<_, i64>("SELECT id FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let r = svc
        .reembolsar(
            &common::ator_recepcao(), // nivel 3 sem flag financeiro
            p,
            ReembolsarPagamentoInput {
                valor_centavos: 100,
                motivo: None,
            },
        )
        .await;
    assert!(r.is_err());
}

#[sqlx::test(migrations = "../../migrations")]
async fn webhook_duplicado_na_inbox_e_noop(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let _ = reserva_do_site(&c, &pool).await;
    let repo = PgPagamentoRepository::new(pool.clone());

    let ev = NovoEventoWebhook {
        provedor: "stripe".into(),
        event_id: "evt_dup_1".into(),
        event_type: "checkout.session.completed".into(),
        payload: serde_json::json!({"data": {"object": {}}}),
        idintegracao: None,
    };
    assert!(repo.registrar_evento(&ev).await.unwrap()); // 1ª vez: novo
    assert!(!repo.registrar_evento(&ev).await.unwrap()); // 2ª: duplicado
}

#[sqlx::test(migrations = "../../migrations")]
async fn hold_expirado_cancela_reserva_e_pagamento(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Integral,
    })
    .await
    .unwrap();

    // Força o hold vencido — o sweeper deve cancelar tudo.
    sqlx::query("UPDATE reserva SET expira_em = now() - interval '1 minute' WHERE id = $1")
        .bind(idreserva)
        .execute(&pool)
        .await
        .unwrap();

    svc.conciliar().await.unwrap();

    let st: String = sqlx::query_scalar("SELECT status::text FROM reserva WHERE id = $1")
        .bind(idreserva)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(st, "c");
    let sp: String = sqlx::query_scalar("SELECT status::text FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sp, "expirado");
}

#[sqlx::test(migrations = "../../migrations")]
async fn conciliacao_confirma_pagamento_sem_webhook(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Integral,
    })
    .await
    .unwrap();
    // Simula webhook perdido — grava pi manualmente e deixa 'pendente'.
    sqlx::query("UPDATE pagamento SET pi_id = 'pi_fake_1' WHERE status = 'pendente'")
        .execute(&pool)
        .await
        .unwrap();

    svc.conciliar().await.unwrap();

    let st: String = sqlx::query_scalar("SELECT status::text FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(st, "pago"); // reconciliador consultou o provedor e liquidou
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_persiste_identidade_do_provedor(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (_idreserva, token) = reserva_do_site(&c, &pool).await;
    let svc = service(&pool);

    svc.criar_checkout_publico(CheckoutPublicoInput {
        token,
        tipo: TipoPagamento::Integral,
    })
    .await
    .unwrap();

    // Fallback de ambiente grava 'stripe' — o reembolso futuro saberá
    // qual provedor consultar mesmo se o padrão mudar depois.
    let provedor: String = sqlx::query_scalar("SELECT provedor FROM pagamento LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(provedor, "stripe");
}

#[sqlx::test(migrations = "../../migrations")]
async fn inbox_dedup_e_por_provedor(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let _ = reserva_do_site(&c, &pool).await;
    let repo = PgPagamentoRepository::new(pool.clone());

    let novo = |provedor: &str| NovoEventoWebhook {
        provedor: provedor.into(),
        event_id: "evt_mesmo_id".into(),
        event_type: "payment".into(),
        payload: serde_json::json!({}),
        idintegracao: None,
    };
    assert!(repo.registrar_evento(&novo("stripe")).await.unwrap());
    // Mesmo event_id de outro provedor NÃO colide — dedup é (provedor, event_id).
    assert!(repo.registrar_evento(&novo("mercadopago")).await.unwrap());
    assert!(!repo.registrar_evento(&novo("stripe")).await.unwrap());
}
