//! e2e da operação — PDV com baixa de estoque, turno de caixa e
//! autorização por nível. Mesma base do `fluxo_reserva`: services e
//! repositórios reais contra um Postgres efêmero por caso.

mod common;

use clarituz_application::dto::{
    AbrirCaixaInput, AbrirComandaInput, FecharCaixaInput, FecharComandaInput, ItemComandaInput,
    MovCaixaInput, MovimentacaoInput, MovimentacoesRequest,
};
use clarituz_domain::enums::{
    PdvComandaStatus, PdvComandaTipo, StatusTurno, TipoMovimento, TipoMovimentoCaixa,
};
use common::{ator_recepcao, cenario};
use rust_decimal_macros::dec;
use sqlx::PgPool;

/// Venda de balcão: abrir → lançar item → pagar. O lançamento baixa o
/// estoque atomicamente (`FOR UPDATE` + movimento auditado) e o
/// fechamento registra a receita na conta informada.
#[sqlx::test(migrations = "../../migrations")]
async fn pdv_comanda_paga_baixa_estoque(pool: PgPool) {
    let c = cenario(pool.clone()).await;

    let comanda = c
        .services
        .pdv
        .abrir_comanda(
            &c.ator,
            AbrirComandaInput {
                tipo: PdvComandaTipo::Balcao,
                idmesa: None,
                idquarto: None,
                idcliente: None,
                idgarcom: None,
                rotulo: Some("Balcão teste".into()),
            },
        )
        .await
        .expect("abrir comanda");
    assert_eq!(comanda.status, PdvComandaStatus::Aberta);

    c.services
        .pdv
        .adicionar_item(
            &c.ator,
            comanda.id,
            ItemComandaInput {
                iditem: c.idestoque,
                quantidade: 3,
            },
        )
        .await
        .expect("lançar item");

    let saldo = sqlx::query_scalar::<_, i32>("SELECT quantidade FROM estoque WHERE id = $1")
        .bind(c.idestoque)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saldo, 21, "lançamento baixou 3 unidades");

    let movimentos =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM movimento_estoque WHERE iditem = $1")
            .bind(c.idestoque)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(movimentos, 1, "saída auditada na mesma transação");

    let fechada = c
        .services
        .pdv
        .fechar_comanda(
            &c.ator,
            comanda.id,
            FecharComandaInput {
                modo: "pagar".into(),
                desconto: None,
                idconta_financeira: Some(c.idconta_financeira),
                idforma_pagamento: Some(c.idforma_pagamento),
                observacao: None,
            },
        )
        .await
        .expect("fechar comanda");
    assert_eq!(fechada.status, PdvComandaStatus::Fechada);
}

/// Turno de caixa: abertura com fundo, suprimento e fechamento — o
/// esperado calculado no servidor deve bater com o valor contado.
#[sqlx::test(migrations = "../../migrations")]
async fn caixa_turno_completo(pool: PgPool) {
    let c = cenario(pool.clone()).await;

    let turno = c
        .services
        .caixa
        .abrir(
            &c.ator,
            AbrirCaixaInput {
                idconta_financeira: c.idconta_financeira,
                saldo_inicial: dec!(100.00),
                observacao: None,
            },
        )
        .await
        .expect("abrir turno");
    assert_eq!(turno.status, StatusTurno::Aberto);

    let aberto = c
        .services
        .caixa
        .turno_aberto(c.idconta_financeira)
        .await
        .expect("turno aberto");
    assert_eq!(aberto.map(|t| t.id), Some(turno.id));

    c.services
        .caixa
        .movimentar(
            &c.ator,
            turno.id,
            MovCaixaInput {
                tipo: TipoMovimentoCaixa::Suprimento,
                valor: dec!(50.00),
                motivo: "reforço de troco".into(),
            },
        )
        .await
        .expect("suprimento");

    // esperado = 100 fundo + 50 suprimento; contado igual → quebra zero
    let fechado = c
        .services
        .caixa
        .fechar(
            &c.ator,
            turno.id,
            FecharCaixaInput {
                valor_contado: dec!(150.00),
                observacao: None,
            },
        )
        .await
        .expect("fechar turno");
    assert_eq!(fechado.status, StatusTurno::Fechado);
    assert_eq!(fechado.quebra, Some(dec!(0.00)));
}

/// Movimentação avulsa: entrada e saída alteram o saldo; saída maior
/// que o disponível é barrada por regra de negócio e não corrói o saldo.
#[sqlx::test(migrations = "../../migrations")]
async fn estoque_movimentacao_saldo(pool: PgPool) {
    let c = cenario(pool.clone()).await;

    let n = c
        .services
        .estoque
        .movimentar(
            &c.ator,
            MovimentacoesRequest {
                movimentos: vec![
                    MovimentacaoInput {
                        iditem: c.idestoque,
                        tipo: TipoMovimento::Entrada,
                        quantidade: 10,
                        motivo: None,
                    },
                    MovimentacaoInput {
                        iditem: c.idestoque,
                        tipo: TipoMovimento::Saida,
                        quantidade: 5,
                        motivo: None,
                    },
                ],
            },
        )
        .await
        .expect("movimentar");
    assert_eq!(n, 2);

    let saldo = sqlx::query_scalar::<_, i32>("SELECT quantidade FROM estoque WHERE id = $1")
        .bind(c.idestoque)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saldo, 29, "24 + 10 − 5");

    let err = c
        .services
        .estoque
        .movimentar(
            &c.ator,
            MovimentacoesRequest {
                movimentos: vec![MovimentacaoInput {
                    iditem: c.idestoque,
                    tipo: TipoMovimento::Saida,
                    quantidade: 999,
                    motivo: None,
                }],
            },
        )
        .await
        .expect_err("saída acima do saldo deve falhar");
    assert_eq!(err.code(), "REGRA_NEGOCIO");

    let saldo = sqlx::query_scalar::<_, i32>("SELECT quantidade FROM estoque WHERE id = $1")
        .bind(c.idestoque)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(saldo, 29, "saldo preservado após rejeição");
}

/// Recepção (nível 3) não executa ações administrativas — `PROIBIDO`
/// fail-fast antes de tocar no banco, e o alvo permanece intacto.
#[sqlx::test(migrations = "../../migrations")]
async fn autorizacao_nivel_restrito(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let recepcao = ator_recepcao();

    let err = c
        .services
        .estoque
        .status_item(&recepcao, c.idestoque, false)
        .await
        .expect_err("desativar item exige admin");
    assert_eq!(err.code(), "PROIBIDO");

    let err = c
        .services
        .estoque
        .remover_item(&recepcao, c.idestoque)
        .await
        .expect_err("remover item exige admin");
    assert_eq!(err.code(), "PROIBIDO");

    let ativo = sqlx::query_scalar::<_, bool>("SELECT ativo FROM estoque WHERE id = $1")
        .bind(c.idestoque)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(ativo, "rejeição não alterou o item");
}
