//! E2E do módulo de integrações — Postgres real + vault AES real.
//! Cobre: persistência de segredos cifrados (nunca em claro no banco),
//! mapa campo→configurado, estados efetivos, habilitação, padrão do site,
//! conflito otimista de versão e resolução de gateway por provedor.

mod common;

use clarituz_application::dto::{HabilitacaoInput, SalvarIntegracaoInput};
use clarituz_application::services::IntegracoesService;
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorIntegracao};
use clarituz_domain::ports::{EstadoEfetivo, GatewayResolver, ResolucaoGateway};
use clarituz_infrastructure::integrations::resolver::PgGatewayResolver;
use clarituz_infrastructure::repositories::{PgIntegracaoRepository, PgPagamentoRepository};
use clarituz_infrastructure::security::vault::AesCredentialVault;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;

fn stack(pool: &PgPool) -> (IntegracoesService, Arc<PgGatewayResolver>) {
    let repo = Arc::new(PgIntegracaoRepository::new(pool.clone()));
    let vault = Arc::new(AesCredentialVault::new(&"a".repeat(64)).unwrap());
    let resolver = Arc::new(PgGatewayResolver::new(repo.clone(), vault.clone(), None));
    let pagamentos = Arc::new(PgPagamentoRepository::new(pool.clone()));
    (
        IntegracoesService::new(
            repo,
            vault,
            resolver.clone(),
            None,
            None,
            None,
            None,
            None,
            pagamentos,
            false,
        ),
        resolver,
    )
}

fn segredos(pares: &[(&str, &str)]) -> HashMap<String, String> {
    pares
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[sqlx::test(migrations = "../../migrations")]
async fn catalogo_sem_config_mostra_nao_configurada(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);

    let cat = svc.catalogo(&c.ator).await.unwrap();
    // 3 pagamentos × 2 ambientes + Z-API/Spedy/Didit/Channex por ambiente.
    assert_eq!(cat.len(), 11);
    assert!(cat.iter().all(|i| matches!(
        i.estado,
        EstadoEfetivo::NaoConfigurada | EstadoEfetivo::GerenciadoPeloAmbiente
    )));
}

#[sqlx::test(migrations = "../../migrations")]
async fn salvar_cifra_segredos_e_expoe_apenas_mapa(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);

    let view = svc
        .salvar(
            &c.ator,
            ProvedorIntegracao::Pagbank,
            AmbienteIntegracao::Teste,
            SalvarIntegracaoInput {
                config: None,
                versao: 0, // criação
                segredos: Some(segredos(&[("access_token", "tok_pagbank_secreto")])),
                nome_conta: Some("Conta Teste".into()),
                webhook_url: None,
            },
        )
        .await
        .unwrap();

    assert!(view
        .segredos
        .campos
        .get("access_token")
        .copied()
        .unwrap_or(false));
    assert_eq!(view.nome_conta.as_deref(), Some("Conta Teste"));

    // O valor NUNCA aparece na view — e no banco está cifrado.
    let bruto: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT valor_enc FROM integracao_segredo WHERE campo = 'access_token'")
            .fetch_optional(&pool)
            .await
            .unwrap();
    let bruto = bruto.expect("segredo persistido");
    assert!(!bruto
        .windows(20)
        .any(|w| w == b"tok_pagbank_secreto".as_slice()));
}

#[sqlx::test(migrations = "../../migrations")]
async fn campo_fora_da_lista_e_rejeitado(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);

    let r = svc
        .salvar(
            &c.ator,
            ProvedorIntegracao::Pagbank,
            AmbienteIntegracao::Producao,
            SalvarIntegracaoInput {
                config: None,
                versao: 0,
                segredos: Some(segredos(&[("senha_do_wifi", "x")])),
                nome_conta: None,
                webhook_url: None,
            },
        )
        .await;
    assert!(r.is_err());
}

#[sqlx::test(migrations = "../../migrations")]
async fn versao_divergente_retorna_conflito(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);

    let v1 = svc
        .salvar(
            &c.ator,
            ProvedorIntegracao::Mercadopago,
            AmbienteIntegracao::Producao,
            SalvarIntegracaoInput {
                config: None,
                versao: 0,
                segredos: Some(segredos(&[("access_token", "APP-1")])),
                nome_conta: None,
                webhook_url: None,
            },
        )
        .await
        .unwrap();

    // Outro admin salvou entre o GET e o PUT → a versão lida ficou velha.
    let r = svc
        .salvar(
            &c.ator,
            ProvedorIntegracao::Mercadopago,
            AmbienteIntegracao::Producao,
            SalvarIntegracaoInput {
                config: None,
                versao: v1.versao + 99,
                segredos: Some(segredos(&[("access_token", "APP-2")])),
                nome_conta: None,
                webhook_url: None,
            },
        )
        .await;
    assert!(r.is_err());
}

#[sqlx::test(migrations = "../../migrations")]
async fn habilitar_sem_credencial_obrigatoria_falha(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);

    svc.salvar(
        &c.ator,
        ProvedorIntegracao::Stripe,
        AmbienteIntegracao::Teste,
        SalvarIntegracaoInput {
            config: None,
            versao: 0,
            segredos: None, // linha criada sem nenhum segredo
            nome_conta: Some("Parcial".into()),
            webhook_url: None,
        },
    )
    .await
    .unwrap();

    let r = svc
        .habilitacao(
            &c.ator,
            ProvedorIntegracao::Stripe,
            AmbienteIntegracao::Teste,
            HabilitacaoInput { habilitado: true },
        )
        .await;
    assert!(r.is_err(), "habilitar sem secret_key deve falhar");
}

#[sqlx::test(migrations = "../../migrations")]
async fn padrao_site_e_unico_e_resolver_retorna_gateway(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, resolver) = stack(&pool);

    for (p, tok) in [
        (ProvedorIntegracao::Pagbank, "tok_pb"),
        (ProvedorIntegracao::Mercadopago, "tok_mp"),
    ] {
        let v = svc
            .salvar(
                &c.ator,
                p,
                AmbienteIntegracao::Producao,
                SalvarIntegracaoInput {
                    config: None,
                    versao: 0,
                    segredos: Some(segredos(&[("access_token", tok)])),
                    nome_conta: None,
                    webhook_url: None,
                },
            )
            .await
            .unwrap();
        svc.habilitacao(
            &c.ator,
            p,
            AmbienteIntegracao::Producao,
            HabilitacaoInput { habilitado: true },
        )
        .await
        .unwrap_or_else(|_| panic!("habilitar {p:?} falhou (versao {})", v.versao));
    }

    // Define PagBank como padrão → resolver devolve gateway persistido.
    svc.definir_padrao(
        &c.ator,
        ProvedorIntegracao::Pagbank,
        AmbienteIntegracao::Producao,
    )
    .await
    .unwrap();
    let (p, a, _id) = svc.provedor_padrao_site().await.unwrap().unwrap();
    assert_eq!(
        (p, a),
        (ProvedorIntegracao::Pagbank, AmbienteIntegracao::Producao)
    );

    match resolver
        .resolver(ProvedorIntegracao::Pagbank, AmbienteIntegracao::Producao)
        .await
        .unwrap()
    {
        ResolucaoGateway::Persistida(gw) => assert_eq!(gw.provedor(), "pagbank"),
        _ => panic!("esperava gateway persistido"),
    }

    // Troca o padrão pra MP — o anterior sai (único por escopo).
    svc.definir_padrao(
        &c.ator,
        ProvedorIntegracao::Mercadopago,
        AmbienteIntegracao::Producao,
    )
    .await
    .unwrap();
    let (p2, _, _) = svc.provedor_padrao_site().await.unwrap().unwrap();
    assert_eq!(p2, ProvedorIntegracao::Mercadopago);
    let n_padroes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM integracao_padrao WHERE escopo = 'pagamentos_site'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(n_padroes, 1);
}

#[sqlx::test(migrations = "../../migrations")]
async fn desativada_nao_resolve_mas_historico_sim(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, resolver) = stack(&pool);

    svc.salvar(
        &c.ator,
        ProvedorIntegracao::Pagbank,
        AmbienteIntegracao::Producao,
        SalvarIntegracaoInput {
            config: None,
            versao: 0,
            segredos: Some(segredos(&[("access_token", "tok")])),
            nome_conta: None,
            webhook_url: None,
        },
    )
    .await
    .unwrap();
    svc.habilitacao(
        &c.ator,
        ProvedorIntegracao::Pagbank,
        AmbienteIntegracao::Producao,
        HabilitacaoInput { habilitado: true },
    )
    .await
    .unwrap();
    svc.habilitacao(
        &c.ator,
        ProvedorIntegracao::Pagbank,
        AmbienteIntegracao::Producao,
        HabilitacaoInput { habilitado: false },
    )
    .await
    .unwrap();

    // Nova cobrança: indisponível. Histórico (reembolso/conciliação): resolve.
    assert!(matches!(
        resolver
            .resolver(ProvedorIntegracao::Pagbank, AmbienteIntegracao::Producao)
            .await
            .unwrap(),
        ResolucaoGateway::Indisponivel
    ));
    assert!(matches!(
        resolver
            .resolver_historico(ProvedorIntegracao::Pagbank, AmbienteIntegracao::Producao)
            .await
            .unwrap(),
        ResolucaoGateway::Persistida(_)
    ));
}

#[sqlx::test(migrations = "../../migrations")]
async fn segredo_webhook_resolve_por_integracao(pool: PgPool) {
    let c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);

    svc.salvar(
        &c.ator,
        ProvedorIntegracao::Mercadopago,
        AmbienteIntegracao::Producao,
        SalvarIntegracaoInput {
            config: None,
            versao: 0,
            segredos: Some(segredos(&[
                ("access_token", "APP-x"),
                ("webhook_secret", "whsec_mp"),
            ])),
            nome_conta: None,
            webhook_url: None,
        },
    )
    .await
    .unwrap();

    let id: i64 = sqlx::query_scalar(
        "SELECT id FROM integracao WHERE provedor = 'mercadopago' AND ambiente = 'producao'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        svc.segredo_webhook(id, "webhook_secret")
            .await
            .unwrap()
            .as_deref(),
        Some("whsec_mp")
    );
    assert!(svc
        .segredo_webhook(id, "inexistente")
        .await
        .unwrap()
        .is_none());
}

#[sqlx::test(migrations = "../../migrations")]
async fn nao_admin_nao_gerencia_integracoes(pool: PgPool) {
    let _c = common::cenario(pool.clone()).await;
    let (svc, _) = stack(&pool);
    let recepcao = common::ator_recepcao();

    assert!(svc.catalogo(&recepcao).await.is_err());
    assert!(svc
        .salvar(
            &recepcao,
            ProvedorIntegracao::Stripe,
            AmbienteIntegracao::Producao,
            SalvarIntegracaoInput {
                config: None,
                versao: 0,
                segredos: None,
                nome_conta: None,
                webhook_url: None,
            },
        )
        .await
        .is_err());
}
