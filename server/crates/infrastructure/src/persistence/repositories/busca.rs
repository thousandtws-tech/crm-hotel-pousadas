//! Busca global do header — UNION ALL sobre as entidades navegáveis,
//! cada braço com LIMIT próprio (os primeiros N por tipo, como o
//! "top results" do Salesforce/HubSpot). Funcionários só entram para admin.

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::ItemBusca;
use clarituz_domain::ports::BuscaRepository;
use clarituz_domain::DomainError;
use sqlx::PgPool;

pub struct PgBuscaRepository {
    pool: PgPool,
}

impl PgBuscaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BuscaRepository for PgBuscaRepository {
    async fn buscar(
        &self,
        termo: &str,
        admin: bool,
        limite: i64,
    ) -> Result<Vec<ItemBusca>, DomainError> {
        sqlx::query_as::<_, ItemBusca>(
            "(SELECT 'cliente' AS tipo, c.id, c.nome AS titulo,
                     'CPF ' || c.cpf AS sub, '/clientes' AS rota
              FROM cliente c
              WHERE c.ativo
                AND (c.nome ILIKE '%' || $1 || '%'
                     OR c.cpf ILIKE '%' || $1 || '%'
                     OR c.email ILIKE '%' || $1 || '%'
                     OR c.telefone ILIKE '%' || $1 || '%')
              ORDER BY c.nome LIMIT $2)
             UNION ALL
             (SELECT 'reserva', r.id, 'Reserva Nº ' || r.id,
                     c.nome || ' · ' || a.nome, '/reservas/' || r.id
              FROM reserva r
              JOIN cliente c ON c.id = r.idcliente
              JOIN acomodacao a ON a.id = r.idacomodacao
              WHERE r.id::text = $1
                 OR c.nome ILIKE '%' || $1 || '%'
                 OR a.nome ILIKE '%' || $1 || '%'
              ORDER BY r.id DESC LIMIT $2)
             UNION ALL
             (SELECT 'acomodacao', a.id, a.nome || ' Nº' || a.numero,
                     'Capacidade ' || a.capacidade, '/acomodacoes'
              FROM acomodacao a
              WHERE a.ativo
                AND (a.nome ILIKE '%' || $1 || '%' OR a.numero::text = $1)
              LIMIT $2)
             UNION ALL
             (SELECT 'funcionario', f.id, f.nome, f.login, '/funcionarios'
              FROM funcionario f
              WHERE $3::bool AND f.ativo
                AND (f.nome ILIKE '%' || $1 || '%' OR f.login ILIKE '%' || $1 || '%')
              LIMIT $2)
             UNION ALL
             (SELECT 'estoque', i.id, i.nome,
                     'Estoque ' || i.quantidade, '/estoque'
              FROM estoque i
              WHERE i.ativo AND i.nome ILIKE '%' || $1 || '%'
              LIMIT $2)",
        )
        .bind(termo)
        .bind(limite)
        .bind(admin)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
