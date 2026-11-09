global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  # API Rust — métricas HTTP + gauges de saturação (pool PG, SSE)
  - job_name: api
    metrics_path: /metrics
    static_configs:
      - targets: ["__API_SCRAPE__"]

  # MAR IA — turnos, latência por estágio, chamadas de ferramentas
  - job_name: maria
    metrics_path: /metrics.prom
    static_configs:
      - targets: ["__MARIA_SCRAPE__"]

  # Postgres via exporter dedicado — conexões, locks, tamanho
  - job_name: postgres
    static_configs:
      - targets: ["pg-exporter.railway.internal:9187"]

  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
