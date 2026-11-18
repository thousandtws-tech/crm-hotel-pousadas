//! Campanhas de marketing — blast WhatsApp para hóspedes opt-in LGPD.
//! Cobre: autorização gerencial, filtro de elegíveis (consent + opt-out +
//! telefone), dedup na fila, personalização `{nome}` e agregados.

mod common;

use common::{ator_recepcao, cenario};
use sqlx::PgPool;

async fn cliente(
    pool: &PgPool,
    cpf: &str,
    nome: &str,
    telefone: Option<&str>,
    consent: bool,
    opt_out: bool,
) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO cliente (nome, cpf, data_nascimento, telefone,
                              consent_marketing, lgpd_opt_out)
         VALUES ($1, $2, '1990-01-01', $3, $4, $5) RETURNING id",
    )
    .bind(nome)
    .bind(cpf)
    .bind(telefone)
    .bind(consent)
    .bind(opt_out)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn campanha_enfileira_apenas_optins_com_telefone(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    // Elegível: opt-in + telefone.
    let id_ok = cliente(
        &pool,
        "10000000001",
        "Maria Optante",
        Some("+5585999990001"),
        true,
        false,
    )
    .await;
    // Sem consentimento — transacional não conta.
    cliente(
        &pool,
        "10000000002",
        "José Sem Consent",
        Some("+5585999990002"),
        false,
        false,
    )
    .await;
    // Opt-in mas fez opt-out depois — LGPD manda excluir.
    cliente(
        &pool,
        "10000000003",
        "Ana Arrependida",
        Some("+5585999990003"),
        true,
        true,
    )
    .await;
    // Opt-in sem telefone — não há destino.
    cliente(&pool, "10000000004", "Sem Fone", None, true, false).await;

    let c = c
        .services
        .comunicacao
        .criar_campanha(&c.ator, "Inauguração", "Oi {nome}, 10% off na inauguração!")
        .await
        .unwrap();

    assert_eq!(c.destinatarios, 1);
    assert!(c.disparada_em.is_some());

    // Item na fila com dedup estável e nome personalizado.
    let (dedup, texto): (String, String) = sqlx::query_as(
        "SELECT dedup_key, payload->>'texto' FROM fila_envio
         WHERE idcliente = $1 AND template = 'campanha'",
    )
    .bind(id_ok)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(dedup, format!("campanha:{}:cliente:{}", c.id, id_ok));
    assert!(texto.starts_with("Oi Maria,"), "personalizou: {texto}");
    assert!(!texto.contains("{nome}"), "placeholder resolvido");
}

#[sqlx::test(migrations = "../../migrations")]
async fn campanha_dedup_impede_reenfileirar(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let id = cliente(
        &pool,
        "10000000005",
        "Maria",
        Some("+5585999990001"),
        true,
        false,
    )
    .await;
    let c1 = c
        .services
        .comunicacao
        .criar_campanha(&c.ator, "C1", "texto")
        .await
        .unwrap();
    // Mesma campanha não reenfileira: dedup_key já existe → enfileirar_dedup
    // devolve None e o item não duplica.
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fila_envio WHERE dedup_key LIKE 'campanha:%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(total, 1);
    // Nova campanha (id diferente) enfileira de novo — dedup é por campanha.
    let c2 = c
        .services
        .comunicacao
        .criar_campanha(&c.ator, "C2", "texto")
        .await
        .unwrap();
    assert!(c2.destinatarios == 1 && c2.id != c1.id);
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fila_envio WHERE dedup_key LIKE 'campanha:%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(total, 2);
    let _ = id;
}

#[sqlx::test(migrations = "../../migrations")]
async fn campanha_exige_nivel_gerencial(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    let err = c
        .services
        .comunicacao
        .criar_campanha(&ator_recepcao(), "X", "texto")
        .await
        .unwrap_err();
    assert!(matches!(
        err.domain(),
        clarituz_domain::DomainError::Proibido(_)
    ));
    // Recepção também não lê o relatório.
    assert!(c
        .services
        .comunicacao
        .listar_campanhas(&ator_recepcao())
        .await
        .is_err());
}

#[sqlx::test(migrations = "../../migrations")]
async fn campanha_valida_entrada(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    for (nome, texto) in [("  ", "texto"), ("ok", "   "), ("ok", &"x".repeat(1001))] {
        assert!(
            c.services
                .comunicacao
                .criar_campanha(&c.ator, nome, texto)
                .await
                .is_err(),
            "rejeitou nome={nome:?} texto.len={}",
            texto.len()
        );
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn campanha_sem_elegiveis_enfileira_zero(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    cliente(
        &pool,
        "10000000006",
        "Sem Consent",
        Some("+5585999990002"),
        false,
        false,
    )
    .await;
    let v = c
        .services
        .comunicacao
        .criar_campanha(&c.ator, "Vazia", "texto")
        .await
        .unwrap();
    assert_eq!(v.destinatarios, 0);
    // Campanha existe mesmo sem disparo — histórico importa.
    assert!(v.disparada_em.is_some());
}

#[sqlx::test(migrations = "../../migrations")]
async fn listar_campanhas_agrega_status_da_fila(pool: PgPool) {
    let c = cenario(pool.clone()).await;
    cliente(
        &pool,
        "10000000005",
        "Maria",
        Some("+5585999990001"),
        true,
        false,
    )
    .await;
    let criada = c
        .services
        .comunicacao
        .criar_campanha(&c.ator, "Relatório", "texto")
        .await
        .unwrap();
    // Simula o worker marcando o item como enviado.
    sqlx::query(
        "UPDATE fila_envio SET status = 'enviado'
         WHERE dedup_key LIKE 'campanha:%'",
    )
    .execute(&pool)
    .await
    .unwrap();

    let lista = c
        .services
        .comunicacao
        .listar_campanhas(&c.ator)
        .await
        .unwrap();
    let v = lista.iter().find(|x| x.id == criada.id).unwrap();
    assert_eq!((v.destinatarios, v.enviados, v.pendentes), (1, 1, 0));
}
