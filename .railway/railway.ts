// IaC do Railway — mudanças aqui disparam o stage 'iac-drift' no Jenkins (apenas aviso; apply é manual).
import { defineRailway, github, group, image, postgres, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-east4-eqdc4a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const Redis = redis("Redis", { region: "us-east4-eqdc4a" });
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const bucketVolume = volume("bucket-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 5000 });
  const mariaVolume = volume("maria-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 5000 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 5000 });
  const admin = service("admin", {
    replicas: { "us-east4-eqdc4a": 1 },
    // nginx estático — 0.25 vCPU / 512 MiB
    deploy: {
      limitOverride: { containers: { cpu: 0.25, memoryBytes: 536870912 } },
      restartPolicyMaxRetries: 5,
    },
    env: { RAILWAY_DOCKERFILE_PATH: preserve() },
  });
  const Console = service("Console", {
    source: github("railwayapp-templates/minio-console", { commitSha: "f2b900e6d097cc5383533f0e1f52acb9927ead1d", upstreamUrl: "https://github.com/railwayapp-templates/minio-console" }),
    start: "/bin/sh -c \"exec console server --host 0.0.0.0 --port $PORT\"",
    healthcheck: "/login",
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "console" },
    env: { CONSOLE_MINIO_SERVER: preserve(), PASSWORD: preserve(), PORT: preserve(), USERNAME: preserve() },
  });
  const maria = service("inteligencia-artificial", {
    replicas: { "us-east4-eqdc4a": 1 },
    // agente de voz Python — 0.5 vCPU / 1 GiB
    deploy: {
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 1073741824 } },
      restartPolicyMaxRetries: 5,
    },
    volumeMounts: { "/app/data": mariaVolume },
    // Backup automático → MinIO: DSN e credenciais S3 são referências
    // (mesmo padrão do pg-exporter/pg-backup) — zero segredo copiado à mão
    // e nada se perde num apply. Bucket/flags são literais: backup nasce
    // ligado; intervalo/retenção/prefixo/região ficam preserve() p/ tuning.
    env: { API_BASE: preserve(), BACKUP_DATABASE_URL: "postgresql://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}?sslmode=disable", CEREBRAS_API_KEY: preserve(), CEREBRAS_MODEL: preserve(), ELEVENLABS_AGENT_ID: preserve(), ELEVENLABS_API_KEY: preserve(), ELEVENLABS_MODEL_ID: preserve(), ELEVENLABS_SIMILARITY: preserve(), ELEVENLABS_SPEED: preserve(), ELEVENLABS_STABILITY: preserve(), ELEVENLABS_STYLE: preserve(), ELEVENLABS_VOICE_ID: preserve(), INNA_INTERNAL_KEY: preserve(), JWT_SECRET: preserve(), MARIA_BACKUP_ENABLED: "true", MARIA_BACKUP_INTERVAL_H: preserve(), MARIA_BACKUP_RETAIN: preserve(), MARIA_BUDGET_TOKENS_DIA: preserve(), MARIA_CORS_ORIGINS: preserve(), MARIA_DEFAULT_LANGUAGE: preserve(), MARIA_HISTORY_ENABLED: preserve(), MARIA_HISTORY_MAX_TURNS: preserve(), MARIA_RATE_TURNOS_MIN: preserve(), MARIA_S3_ACCESS_KEY: "${{Bucket.MINIO_ROOT_USER}}", MARIA_S3_BUCKET: "backups", MARIA_S3_ENDPOINT: "http://${{Bucket.MINIO_PRIVATE_HOST}}:${{Bucket.MINIO_PRIVATE_PORT}}", MARIA_S3_PREFIX: preserve(), MARIA_S3_REGION: preserve(), MARIA_S3_SECRET_KEY: "${{Bucket.MINIO_ROOT_PASSWORD}}", MARIA_TIMEZONE: preserve(), MARIA_TTS_PROVIDER: preserve(), MARIA_VOICE_ENABLED: preserve(), OPENAI_API_KEY: preserve(), OPENAI_LLM_MODEL: preserve(), OPENAI_REALTIME_MODEL: preserve(), OPENAI_SERVER_VAD: preserve(), OPENAI_TRANSCRIPTION_MODEL: preserve(), PIPER_VOICE: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), REDIS_URL: "${{Redis.REDIS_URL}}" },
  });
  const realtime = service("motor-realtime-erlang", {
    replicas: { "us-east4-eqdc4a": 1 },
    // hub Phoenix/BEAM — 1 vCPU / 1 GiB (não hibernar: WebSocket + LISTEN 24/7)
    deploy: {
      limitOverride: { containers: { cpu: 1, memoryBytes: 1073741824 } },
      restartPolicyMaxRetries: 5,
    },
    env: { CHECK_ORIGIN: preserve(), DATABASE_URL: preserve(), INGEST_TOKEN: preserve(), JWT_SECRET: preserve(), PHX_HOST: preserve(), PHX_SERVER: preserve(), PORT: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), SECRET_KEY_BASE: preserve() },
  });
  const web = service("website-institucional", {
    replicas: { "us-east4-eqdc4a": 1 },
    // nginx estático — 0.25 vCPU / 512 MiB
    deploy: {
      limitOverride: { containers: { cpu: 0.25, memoryBytes: 536870912 } },
      restartPolicyMaxRetries: 5,
    },
    env: { API_INTERNAL_URL: preserve(), RAILWAY_DOCKERFILE_PATH: preserve() },
  });
  const api = service("api-server-rust", {
    // API stateless: réplicas N×(DB_MAX_CONNECTIONS + 1 LISTEN) devem ficar
    // < ~80% do max_connections do Postgres (2×(10+1)=22 conns aqui — ok).
    // Avisos/deltas cruzam réplicas via LISTEN/NOTIFY (clarituz_aviso/delta).
    replicas: { "us-east4-eqdc4a": 2 },
    // Rust/Axum — 1 vCPU / 1 GiB
    deploy: {
      limitOverride: { containers: { cpu: 1, memoryBytes: 1073741824 } },
      restartPolicyMaxRetries: 5,
    },
    env: { CORS_ORIGINS: preserve(), DATABASE_URL: preserve(), DB_MAX_CONNECTIONS: preserve(), INNA_INTERNAL_KEY: preserve(), INTEGRACOES_MASTER_KEY: preserve(), JWT_SECRET: preserve(), MARIA_URL: preserve(), POUSADA_NOME: preserve(), PUBLIC_API_URL: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), RESEND_API_KEY: preserve(), RUST_LOG: preserve(), S3_ACCESS_KEY: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve(), S3_SECRET_KEY: preserve(), SITE_BASE: preserve(), STORAGE_DIR: preserve(), STRIPE_CANCEL_URL: preserve(), STRIPE_SECRET_KEY: preserve(), STRIPE_SUCCESS_URL: preserve(), STRIPE_WEBHOOK_SECRET: preserve(), VAPID_CONTATO: preserve(), VAPID_PRIVATE_PEM: preserve(), VAPID_PUBLIC_B64: preserve(), WHATSAPP_APP_SECRET: preserve(), WHATSAPP_PHONE_ID: preserve(), WHATSAPP_TOKEN: preserve(), WHATSAPP_VERIFY_TOKEN: preserve() },
  });
  const Bucket = service("Bucket", {
    source: github("railwayapp-templates/minio", { commitSha: "4a260461496f2ecd60944a51e6df6dabc073720f", upstreamUrl: "https://github.com/railwayapp-templates/minio" }),
    start: "/bin/sh -c \"exec minio server --address [::]:$MINIO_PRIVATE_PORT $RAILWAY_VOLUME_MOUNT_PATH\"",
    healthcheck: "/minio/health/ready",
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "bucket" },
    volumeMounts: { "/data": bucketVolume },
    env: { MINIO_BROWSER_REDIRECT_URL: preserve(), MINIO_PRIVATE_ENDPOINT: preserve(), MINIO_PRIVATE_HOST: preserve(), MINIO_PRIVATE_PORT: preserve(), MINIO_PUBLIC_ENDPOINT: preserve(), MINIO_PUBLIC_HOST: preserve(), MINIO_PUBLIC_PORT: preserve(), MINIO_ROOT_PASSWORD: preserve(), MINIO_ROOT_USER: preserve(), PORT: preserve() },
  });
  const MinIO = group("MinIO", [Console, Bucket]);

  // --------------------------------------------------------- Observabilidade
  const prometheusVolume = volume("prometheus-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 2000 });
  const grafanaVolume = volume("grafana-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 1000 });
  const prometheus = service("prometheus", {
    // Deploy via `railway up` a partir de monitoring/prometheus (como os
    // demais serviços — nenhum build conectado ao GitHub).
    healthcheck: "/-/healthy",
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "prometheus" },
    deploy: {
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 536870912 } },
      restartPolicyMaxRetries: 5,
    },
    volumeMounts: { "/prometheus": prometheusVolume },
    env: {
      PORT: "9090",
      // ${{service.PORT}} não resolve — PORT é injetada em runtime e não é
      // variável declarada. api e maria escutam :8080 na rede privada.
      API_SCRAPE: "api.railway.internal:8080",
      MARIA_SCRAPE: "maria.railway.internal:8080",
    },
  });
  const grafana = service("grafana", {
    // Deploy via `railway up` a partir de monitoring/grafana — datasource +
    // dashboards + regras provisionados; admin/senha/webhook no dashboard.
    healthcheck: "/api/health",
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "grafana" },
    deploy: {
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 536870912 } },
      restartPolicyMaxRetries: 5,
    },
    volumeMounts: { "/var/lib/grafana": grafanaVolume },
    env: {
      PORT: "3000",
      GF_SERVER_HTTP_PORT: "3000",
      GF_SECURITY_ADMIN_USER: preserve(),
      GF_SECURITY_ADMIN_PASSWORD: preserve(),
      GF_USERS_ALLOW_SIGN_UP: "false",
      ALERT_WEBHOOK_URL: preserve(),
    },
  });
  const pgExporter = service("pg-exporter", {
    // métricas internas do Postgres (conexões, locks, tamanho) — sem elas
    // o gargalo real do sistema ficaria invisível.
    source: image("quay.io/prometheuscommunity/postgres-exporter:v0.17.1"),
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "pg-exporter" },
    deploy: {
      limitOverride: { containers: { cpu: 0.25, memoryBytes: 268435456 } },
      restartPolicyMaxRetries: 5,
    },
    env: {
      DATA_SOURCE_NAME: "postgresql://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}?sslmode=disable",
    },
  });
  const Observabilidade = group("Observabilidade", [prometheus, grafana, pgExporter]);

  // ---------------------------------------------------------------- CI/CD
  const jenkinsVolume = volume("jenkins-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 2000 });
  const jenkins = service("jenkins", {
    // Deploy via `railway up` a partir de ci/jenkins — JCasC provisiona
    // admin, credenciais (env) e o job clarituz-deploy sem setup manual.
    healthcheck: "/login",
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "jenkins" },
    deploy: {
      limitOverride: { containers: { cpu: 1, memoryBytes: 2147483648 } },
      restartPolicyMaxRetries: 5,
    },
    volumeMounts: { "/var/jenkins_home": jenkinsVolume },
    env: {
      PORT: "8080",
      JENKINS_ADMIN_USER: preserve(),
      JENKINS_ADMIN_PASSWORD: preserve(),
      JENKINS_URL: preserve(),
      RAILWAY_TOKEN: preserve(),
      GITHUB_USER: preserve(),
      GITHUB_TOKEN: preserve(),
    },
  });
  const CI = group("CI", [jenkins]);

  // ------------------------------------------------------------------- Ops
  const pgBackup = service("pg-backup", {
    // Dump diário do Postgres → MinIO (ops/pg-backup, deploy via `railway up`).
    // Só-outbound: nenhum endpoint — nada conecta nele, ele conecta nos outros.
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: {
      limitOverride: { containers: { cpu: 0.25, memoryBytes: 268435456 } },
      restartPolicyMaxRetries: 10,
    },
    env: {
      PGHOST: "${{Postgres.PGHOST}}",
      PGPORT: "${{Postgres.PGPORT}}",
      PGUSER: "${{Postgres.PGUSER}}",
      PGPASSWORD: "${{Postgres.PGPASSWORD}}",
      PGDATABASE: "${{Postgres.PGDATABASE}}",
      S3_ACCESS_KEY: "${{Bucket.MINIO_ROOT_USER}}",
      S3_SECRET_KEY: "${{Bucket.MINIO_ROOT_PASSWORD}}",
    },
  });

  return project("projeto-espirito-do-mar", {
    resources: [admin, maria, realtime, Postgres, Redis, web, api, bucketVolume, mariaVolume, postgresVolume, prometheusVolume, grafanaVolume, jenkinsVolume, MinIO, Observabilidade, CI, pgBackup],
  });
});
