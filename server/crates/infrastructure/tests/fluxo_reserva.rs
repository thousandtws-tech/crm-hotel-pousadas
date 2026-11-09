//! e2e do fluxo crítico de reserva — services reais, repositórios PG
//! reais, constraint anti-overbooking e auditoria no banco de verdade.
//! `#[sqlx::test]` cria um database fresco por caso e roda as migrations.
//!
//! Requer `DATABASE_URL` (ex.: `docker compose up -d postgres` e
//! `postgres://clarituz:clarituz@localhost:5432/clarituz`); na CI o job
//! sobe um postgres:17 service.

mod common;

use chrono::{Duration, NaiveDate, Utc};
use clarituz_application::dto::{
    AdicionalInput, CancelarReservaRequest, CheckoutRequest, ItemConsumidoRequest,
    ReservaPublicaInput,
};
use clarituz_domain::enums::{StatusConsumo, StatusReserva};
use common::{cenario, datas, input_reserva};
use rust_decimal_macros::dec;
use sqlx::PgPool;

/// reserva → check-in → item do frigobar → check-out com adicional e
/// desconto — verifica status, valores e trilha de auditoria.
#[sqlx::test(migrations = "../../migrations")]
async fn fluxo_estadia_completo(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (entrada, saida) = datas();

    let reserva = c
        .services
        .reservas
        .criar(&c.ator, input_reserva(&c, entrada, saida))
        .await
        .expect("criar reserva");
    assert_eq!(reserva.status, StatusReserva::Pendente);
    assert_eq!(reserva.valordiaria, dec!(350.00));

    let reserva = c
        .services
        .reservas
        .checkin(&c.ator, reserva.id, Utc::now())
        .await
        .expect("check-in");
    assert_eq!(reserva.status, StatusReserva::Iniciada);
    assert!(reserva.checkin_em.is_some());

    let item = c
        .services
        .reservas
        .registrar_item_consumido(
            &c.ator,
            reserva.id,
            ItemConsumidoRequest {
                iditem_frigobar: c.iditem_frigobar,
                quantidade: 2,
            },
        )
        .await
        .expect("lançar item");
    assert_eq!(item.valor_total, dec!(10.00));

    let (reserva, consumo) = c
        .services
        .reservas
        .checkout(
            &c.ator,
            reserva.id,
            CheckoutRequest {
                idforma_pagamento: c.idforma_pagamento,
                total_desconto: Some(dec!(50.00)),
                adicionais: vec![AdicionalInput {
                    motivo: "early check-in".into(),
                    valor: dec!(30.00),
                }],
            },
        )
        .await
        .expect("check-out");

    // 2 diárias × 350 + 10 frigobar + 30 adicional − 50 desconto = 690
    assert_eq!(reserva.status, StatusReserva::Finalizada);
    assert!(reserva.checkout_em.is_some());
    assert_eq!(consumo.status, StatusConsumo::Concluido);
    assert_eq!(consumo.valor_estadia, dec!(700.00));
    assert_eq!(consumo.valor_itens, dec!(10.00));
    assert_eq!(consumo.valor_final, Some(dec!(690.00)));

    // trilha: cadastro + checkin + consumo + checkout na mesma reserva
    let logs = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM log WHERE tabela = 'reserva' AND idtabela = $1",
    )
    .bind(reserva.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(logs, 3, "cadastro + check-in + check-out auditados");
}

/// O período sobreposto é barrado pela exclusion constraint do Postgres
/// (GiST no daterange) — `23P01` vira `DomainError::Conflito`.
#[sqlx::test(migrations = "../../migrations")]
async fn overbooking_bloqueado(pool: PgPool) {
    let c = cenario(pool).await;
    let (entrada, saida) = datas();

    c.services
        .reservas
        .criar(&c.ator, input_reserva(&c, entrada, saida))
        .await
        .expect("primeira reserva");

    let err = c
        .services
        .reservas
        .criar(
            &c.ator,
            input_reserva(&c, entrada + Duration::days(1), saida),
        )
        .await
        .expect_err("segunda reserva sobreposta deve falhar");
    assert_eq!(err.code(), "CONFLITO");

    // janela começando no dia seguinte à saída é permitida (o constraint
    // cobre o dia do check-out: range [entrada, saida+1))
    let ok = c
        .services
        .reservas
        .criar(
            &c.ator,
            input_reserva(&c, saida + Duration::days(1), saida + Duration::days(3)),
        )
        .await;
    assert!(ok.is_ok(), "período seguinte à saída deve ser aceito");
}

#[sqlx::test(migrations = "../../migrations")]
async fn cancelamento_de_pendente(pool: PgPool) {
    let c = cenario(pool).await;
    let (entrada, saida) = datas();

    let reserva = c
        .services
        .reservas
        .criar(&c.ator, input_reserva(&c, entrada, saida))
        .await
        .expect("criar reserva");

    c.services
        .reservas
        .cancelar(
            &c.ator,
            reserva.id,
            CancelarReservaRequest {
                motivo: Some("hóspede desistiu".into()),
                login_admin: None,
                senha_admin: None,
            },
        )
        .await
        .expect("cancelar");

    let cancelada = c
        .services
        .reservas
        .buscar(reserva.id)
        .await
        .expect("recarregar");
    assert_eq!(cancelada.status, StatusReserva::Cancelada);

    // após cancelar, o período volta a ficar disponível
    let outra = c
        .services
        .reservas
        .criar(&c.ator, input_reserva(&c, entrada, saida))
        .await;
    assert!(outra.is_ok(), "período liberado pelo cancelamento");
}

/// Reserva pública do site: find-or-create do cliente e período ocupado
/// viram `consulta_registrada` (lead), nunca erro.
#[sqlx::test(migrations = "../../migrations")]
async fn reserva_publica_site(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let (entrada, saida) = datas();

    let input_site = |check_in: NaiveDate, check_out: NaiveDate| ReservaPublicaInput {
        slug: None,
        idacomodacao: Some(c.idacomodacao),
        check_in,
        check_out,
        hospedes: 2,
        nome: "Visitante Site".into(),
        email: "visitante@exemplo.com".into(),
        telefone: "(48) 99999-0000".into(),
        cpf: None,
        observacoes: None,
    };

    let out = c
        .services
        .reservas
        .criar_reserva_site(input_site(entrada, saida))
        .await
        .expect("reserva do site");
    assert_eq!(out.status, "reserva_criada");

    // cliente criado pelo fluxo público (CPF sintético SITE-…)
    let clientes = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cliente WHERE email = 'visitante@exemplo.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(clientes, 1);

    // período agora ocupado → consulta_registrada, não erro nem duplicata
    let out = c
        .services
        .reservas
        .criar_reserva_site(input_site(entrada, saida))
        .await
        .expect("período ocupado vira consulta");
    assert_eq!(out.status, "consulta_registrada");

    let reservas = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM reserva")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(reservas, 1, "conflito não insere segunda reserva");
}
