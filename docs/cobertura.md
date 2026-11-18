# Cobertura de testes

Medição realizada em 18/11/2026 (local, Windows) com `cargo-llvm-cov 0.9.1`
(backend) e `@vitest/coverage-v8 4.x` via `ng test --coverage` (frontends).
Números de referência — podem variar alguns pontos entre plataformas
(Windows/Linux) e versões de toolchain.

## Números medidos

| Área | Ferramenta | Testes | Linhas | Regiões/Stmts | Funções | Branches |
| --- | --- | --- | --- | --- | --- | --- |
| `server/crates/domain` (`clarituz-domain`) | cargo-llvm-cov | 18 | **40,5%** (624 linhas) | 47,4% | 36,5% | n/d¹ |
| `server/crates/application` (`clarituz-application`) | cargo-llvm-cov | 61 | **12,6%** (13 904 linhas) | 12,5% | 12,7% | n/d¹ |
| `client/admin` | vitest/v8 (`ng test`) | 62 | **52,8%** | 49,4% | 30,6% | 53,7% |
| `client/web` | vitest/v8 (`ng test`) | 43 | **57,3%** | 56,5% | 46,7% | 52,5% |

¹ O relatório do llvm-cov neste toolchain não produz coluna de branches
(`-`): gate usa apenas linhas.

## Gates no CI

| Área | Piso atual | Meta | Onde |
| --- | --- | --- | --- |
| `clarituz-domain` | **35%** linhas (`--fail-under-lines 35`) | 70% | `.github/workflows/api.yml` |
| `clarituz-application` | **10%** linhas (`--fail-under-lines 10`) | subir junto com o domínio | `.github/workflows/api.yml` |
| `client/admin` | stmts 44 / branch 48 / funcs 25 / lines 47 | subir incrementalmente | `client/admin/angular.json` → `coverageThresholds` |
| `client/web` | stmts 51 / branch 47 / funcs 41 / lines 52 | subir incrementalmente | `client/web/angular.json` → `coverageThresholds` |

Os pisos foram fixados abaixo do valor medido (~5 p.p. de folga) para
absorver variação entre plataformas/toolchains sem quebrar o build. Eles
impedem **regressão** — a meta é subir o piso a cada ciclo de testes.

## Como rodar localmente

### Backend (server/)

```powershell
# uma vez:
cargo install cargo-llvm-cov --locked
rustup component add llvm-tools

# relatório por crate (com gate):
cd server
cargo llvm-cov -p clarituz-domain      --summary-only --fail-under-lines 35
cargo llvm-cov -p clarituz-application --summary-only --fail-under-lines 10

# relatório HTML navegável:
cargo llvm-cov -p clarituz-domain -p clarituz-application --html
# abre target/llvm-cov/html/index.html
```

Os testes de `domain` e `application` não precisam de Postgres. Os `#[sqlx::test]`
e2e ficam em `infrastructure`/`api` e exigem `DATABASE_URL` (ver
`.github/workflows/api.yml`).

### Frontend (client/admin, client/web)

```powershell
cd client/admin   # ou client/web
npm test               # testes sem cobertura (comportamento inalterado)
npm run test:coverage  # testes + cobertura + gate (usa coverageThresholds do angular.json)
# relatório HTML em coverage/index.html
```

## Roadmap para 70% no domínio

`clarituz-domain` está em **40,5% de linhas**. Para chegar a ~70%:

1. **Entities e value objects sem teste** — os maiores buracos medidos:
   `entities/integracao.rs` (0%), `entities/reserva.rs` (0%),
   `entities/verificacao.rs` (28,9%), `entities/fiscal.rs` (62,8%),
   `events.rs` (0%), `error.rs` (16,7%), `enums/*` (0–40%).
   São tipos puros: testes unitários baratos de escrever, sem mocks.
2. **`enums/*`**: testar mapeamentos/parse serialização (Display/FromStr,
   serde) — ~55 linhas descobertas, retorno rápido.
3. **`ports/*`** (0%): traits com implementações concretas no crate —
   testar via mocks simples ou garantir cobertura indireta pelos
   use-cases de `application`.
4. **`application/services/*`**: hoje 12,6%. Priorizar serviços com
   regra pura já parcialmente coberta (`reserva_busca` 72,5%, `cargos`
   91%, `cafe` 82,2%, `estoque` 44,3%, `pdv` 46,3%) e atacar os
   gigantes zerados (`comunicacao` 906 linhas, `reservas` 1 221,
   `channex` 1 067, `fiscal` 753, `integracoes` 696,
   `pagamentos_online` 659, `tesouraria` 563). Extrair lógica pura de
   I/O para testar sem banco — vários desses serviços dependem de
   `sqlx`/repos concretos; o caminho é injetar ports do domínio.
5. A cada marco (+10 p.p.), subir `--fail-under-lines` no `api.yml`
   (ex.: 35 → 45 → 55 → 70).

## Pendências conhecidas

- **Cargo audit**: `cargo audit` permanece no pipeline independente dos
  gates de cobertura.
- **`infrastructure`/`api`/`agente`/`shared`**: fora da medição inicial.
  `infrastructure` e `api` dependem de Postgres/serviços externos nos
  testes (`#[sqlx::test]`) — cobertura deles exige o serviço de CI
  (já provisionado no `api.yml`) ou medição dedicada.
- **Detalhe por arquivo**: rodar `cargo llvm-cov ... --html` ou
  `ng test --coverage` e abrir o relatório HTML gerado.
