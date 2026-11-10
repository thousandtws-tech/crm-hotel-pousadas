//! Fixtures compartilhadas das suítes e2e — `#[sqlx::test]` cria um
//! database fresco por caso e roda as migrations, então cada teste só
//! precisa semear as entidades do seu cenário.
//!
//! Requer `DATABASE_URL` (ex.: `docker compose up -d postgres` e
//! `postgres://clarituz:clarituz@localhost:5432/clarituz`); na CI o job
//! sobe um postgres:17 service.

// Cada suíte compila este módulo separadamente — os helpers usados só
// por uma delas aparecem como mortos na outra.
#![allow(dead_code)]

use chrono::{Duration, NaiveDate, Utc};
use clarituz_application::actor::Ator;
use clarituz_application::dto::ReservaInput;
use clarituz_application::Services;
use clarituz_domain::enums::NivelAcesso;
use clarituz_infrastructure::{build_services, EventBus};
use clarituz_shared::Settings;
use sqlx::PgPool;

pub struct Cenario {
    pub services: Services,
    pub ator: Ator,
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub idestoque: i64,
    pub iditem_frigobar: i64,
    pub idforma_pagamento: i64,
    /// 'Caixa da Recepção' — semeada pela migration financeira.
    pub idconta_financeira: i64,
}

pub async fn cenario(pool: PgPool) -> Cenario {
    let idfuncionario = sqlx::query_scalar::<_, i64>(
        "INSERT INTO funcionario (nome, login, senha_hash, nivel)
         VALUES ('Recepcionista Teste', 'recep.teste', 'x', 1) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let idacomodacao = sqlx::query_scalar::<_, i64>(
        "INSERT INTO acomodacao (nome, numero, valor, capacidade)
         VALUES ('Suíte Teste', 101, 350.00, 2) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let idcliente = sqlx::query_scalar::<_, i64>(
        "INSERT INTO cliente (nome, cpf, data_nascimento)
         VALUES ('Hóspede Teste', '00011122233', '1990-01-01') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let idestoque = sqlx::query_scalar::<_, i64>(
        "INSERT INTO estoque (nome, unidade, quantidade, valor_unitario, eh_insumo)
         VALUES ('Água 500 ml', 'un', 24, 5.00, FALSE) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let idfrigobar = sqlx::query_scalar::<_, i64>(
        "INSERT INTO frigobar (idacomodacao, modelo) VALUES ($1, 'MB-1') RETURNING id",
    )
    .bind(idacomodacao)
    .fetch_one(&pool)
    .await
    .unwrap();

    let iditem_frigobar = sqlx::query_scalar::<_, i64>(
        "INSERT INTO item_frigobar (idfrigobar, iditem, quantidade)
         VALUES ($1, $2, 10) RETURNING id",
    )
    .bind(idfrigobar)
    .bind(idestoque)
    .fetch_one(&pool)
    .await
    .unwrap();

    let idforma_pagamento = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM forma_pagamento WHERE ativo ORDER BY id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let idconta_financeira = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM conta_financeira WHERE tipo = 'caixa' ORDER BY id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    Cenario {
        services: build_services(&settings_teste(), &pool, &EventBus::new()).services,
        ator: Ator {
            id: idfuncionario,
            login: "recep.teste".into(),
            nome: "Recepcionista Teste".into(),
            nivel: NivelAcesso::Administrador,
            financeiro: false,
        },
        idacomodacao,
        idcliente,
        idestoque,
        iditem_frigobar,
        idforma_pagamento,
        idconta_financeira,
    }
}

/// Recepção (`nivel = 3`) — ator sem privilégio administrativo.
pub fn ator_recepcao() -> Ator {
    Ator {
        id: 999,
        login: "recep.nivel3".into(),
        nome: "Recepção".into(),
        nivel: NivelAcesso::Recepcao,
        financeiro: false,
    }
}

fn settings_teste() -> Settings {
    Settings {
        http_addr: "127.0.0.1:0".into(),
        database_url: String::new(),
        db_max_connections: 5,
        jwt_secret: "segredo-de-teste-com-32-bytes-aaaaa".into(),
        jwt_ttl_secs: 3600,
        refresh_ttl_secs: 86400,
        cors_origins: vec![],
        log_filter: String::new(),
        storage_dir: "./data".into(),
        s3_endpoint: None,
        s3_bucket: None,
        s3_access_key: None,
        s3_secret_key: None,
        s3_region: "us-east-1".into(),
        stripe_secret_key: None,
        stripe_webhook_secret: None,
        stripe_success_url: "https://site.teste/ok".into(),
        stripe_cancel_url: "https://site.teste/cancel".into(),
        sinal_percentual: 30,
        hold_minutos: 30,
        resend_api_key: None,
        email_remetente: "Pousada <teste@local>".into(),
        whatsapp_token: None,
        whatsapp_phone_id: None,
        whatsapp_verify_token: None,
        whatsapp_app_secret: None,
        maria_url: None,
        inna_internal_key: None,
        vapid_private_pem: None,
        vapid_public_b64: None,
        vapid_contato: "mailto:teste@local".into(),
        site_base: "https://site.teste".into(),
        pousada_nome: "Pousada Teste".into(),
    }
}

pub fn datas() -> (NaiveDate, NaiveDate) {
    let hoje = Utc::now().date_naive();
    (hoje + Duration::days(1), hoje + Duration::days(3))
}

pub fn input_reserva(c: &Cenario, entrada: NaiveDate, saida: NaiveDate) -> ReservaInput {
    ReservaInput {
        idacomodacao: c.idacomodacao,
        idcliente: c.idcliente,
        quantidade_hospedes: 2,
        entradaprevista: entrada,
        saidaprevista: saida,
        obs: None,
        valordiaria: None,
        early_checkin: None,
        late_checkout: None,
    }
}
