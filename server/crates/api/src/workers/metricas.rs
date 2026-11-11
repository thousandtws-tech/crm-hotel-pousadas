//! Gauges de saturação a cada 10 s, exportados no `/metrics`:
//! pool do Postgres (size/idle) e assinantes do bus (≈ conexões SSE
//! abertas na réplica). `idle → 0` sustentado = hora de subir réplica
//! ou `DB_MAX_CONNECTIONS`.

use axum_prometheus::metrics;
use clarituz_infrastructure::EventBus;
use sqlx::PgPool;

pub(crate) fn spawn(pool: PgPool, eventos: EventBus) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            tick.tick().await;
            metrics::gauge!("clarituz_db_pool_connections").set(pool.size() as f64);
            metrics::gauge!("clarituz_db_pool_idle").set(pool.num_idle() as f64);
            metrics::gauge!("clarituz_db_pool_max")
                .set(pool.options().get_max_connections() as f64);
            metrics::gauge!("clarituz_sse_subscribers").set(eventos.assinantes() as f64);
        }
    });
}
