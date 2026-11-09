# CI — Jenkins self-hosted no Railway

Push na `main` → webhook do GitHub → `clarituz-deploy` → `railway up`
por changeset (só sobem os serviços cujos paths mudaram).

## Componentes

| Peça | Onde |
|---|---|
| Imagem | `ci/jenkins/Dockerfile` — `jenkins/jenkins:lts-jdk21` + `@railway/cli` |
| Plugins | `ci/jenkins/plugins.txt` |
| Provisionamento | `ci/jenkins/casc/jenkins.yaml` — admin, credenciais, job seed (JCasC) |
| Pipeline | `Jenkinsfile` na raiz — stages por changeset |
| IaC | `.railway/railway.ts` — service jenkins + `jenkins-volume` + grupo CI |
| Webhook | repo Settings → Webhooks → `/github-webhook/` (push) |

## Acesso

- URL: `https://jenkins-production-3205.up.railway.app`
- admin: `JENKINS_ADMIN_USER` / `JENKINS_ADMIN_PASSWORD` (vars do service)

## Configuração necessária (1 passo manual)

`RAILWAY_TOKEN` ainda é placeholder — o `railway up` no pipeline falha
sem ele. Crie um **project token**:

1. Railway → projeto `projeto-espirito-do-mar` → **Settings → Tokens**
   → New Token (escopo: este projeto, environment production)
2. Suba a variável:

```bash
railway variable set RAILWAY_TOKEN=<token> -s jenkins
```

O próximo push já executa `railway up` autenticado. Para manter o token
da conta (acesso mais amplo), vale o mesmo comando — prefira o project
token (menor privilégio).

## Mapa changeset → serviço

| Path | Serviço |
|---|---|
| `server/crates`, `server/migrations`, `server/Cargo.*`, `server/Dockerfile` | `api` |
| `server/maria/**` | `maria` |
| `server/realtime/**` | `realtime` |
| `client/admin/**` | `admin` |
| `client/web/**` | `web` |
| `monitoring/prometheus/**` | `prometheus` |
| `monitoring/grafana/**` | `grafana` |
| `ci/jenkins/**` | `jenkins` (self-update) |
| `.railway/**` | só aviso — `config apply` fica manual (destrutivo) |

## Notas operacionais

- `railway up -d` é assíncrono: o pipeline dispara e sai; a saúde do
  rollout acompanha em `railway deployment list -s <svc>` ou Grafana.
- `disableConcurrentBuilds()` evita deploys paralelos na mesma main.
- Falha num stage não derruba produção — Railway mantém o último deploy
  saudável.
- O primeiro build após provisionar o job registra o trigger
  `githubPush()` — pushes subsequentes já disparam sozinhos.
