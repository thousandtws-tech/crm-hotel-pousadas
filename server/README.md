# clarituz-server — Backend em Rust

Backend completo do CRM de hotel/pousada, reescrito em Rust a partir do
legado PHP (`../legado`). Monólito modular em workspace Cargo seguindo
Clean Architecture / Hexagonal.

```
crates/
├── shared/          Config, paginação, dinheiro (Decimal), tempo (America/Sao_Paulo)
├── domain/          Entidades, enums, value objects, erros e PORTS (traits)
├── application/     Casos de uso (services), DTOs, Ator (RBAC), AppError
├── infrastructure/  Adapters: PostgreSQL (sqlx), Argon2id, JWT
└── api/             Binário `clarituz-api`: axum, rotas /api/v1, CLI
```

Fluxo de dependência (setas apontam "conhece"):

```
api → application → domain ← infrastructure
```

O domínio não conhece HTTP nem SQL. Toda persistência passa por ports;
a infra implementa as transações de negócio completas (entidade +
efeitos colaterais + auditoria, tudo-ou-nada).

## Decisões arquiteturais

| Tema | Decisão | Motivação |
|---|---|---|
| Overbooking | `EXCLUDE USING gist` com `daterange` na tabela `reserva` | Substitui `GET_LOCK` do MySQL — invariante no storage, resiste a races reais (SQLSTATE 23P01 → HTTP 409) |
| Dinheiro | `rust_decimal`, escala 2, `NUMERIC(12,2)` | Nunca `f64` |
| Sessões | JWT (HS256) + refresh tokens rotacionados (SHA-256 no banco) | Stateless + revogável; uso de token revogado é detectável |
| Senhas | Argon2id (OWASP) | Memória-hard; verificação em tempo constante; hash dummy equaliza timing de login inexistente |
| Auditoria | `log` gravado na mesma transação da mutação | Paridade com o legado; falha no log falha a operação |
| Tempo | `America/Sao_Paulo` no app **e** na sessão PG | `CURRENT_DATE` no SQL já é o dia da pousada |
| Listagens | `LIMIT/OFFSET` em SQL com teto de 200/página | Nunca varredura ilimitada |

## Subindo o ambiente

```powershell
cd server
docker compose up -d            # PostgreSQL 16
copy .env.example .env          # edite JWT_SECRET (>=32 chars)
cargo run -p clarituz-api -- migrate
cargo run -p clarituz-api -- create-admin --login admin --nome "Administrador" --senha "senha-forte-aqui"
cargo run -p clarituz-api -- serve        # ou apenas `cargo run -p clarituz-api`
```

API em `http://localhost:8080` — probes: `GET /healthz`, `GET /readyz`.

## Autenticação

```http
POST /api/v1/auth/login     { "login": "admin", "senha": "..." }
→ { access_token, refresh_token, token_type, expira_em, funcionario }

POST /api/v1/auth/refresh   { "refresh_token": "..." }   # rotação: o antigo é revogado
POST /api/v1/auth/logout    { "refresh_token": "..." }
GET  /api/v1/auth/me        Authorization: Bearer <access_token>
```

Níveis (legado): `1` administrador, `2` gerente, `3` recepção.
Ações restritas são verificadas na camada de aplicação (`exigir_admin`,
`exigir_gerencial`) — incluindo o cancelamento de reserva em estadia,
que aceita credenciais de admin no corpo (`login_admin`/`senha_admin`,
paridade com `aCancelarReservaAdm.php`).

## Mapa de rotas `/api/v1`

| Recurso | Rotas |
|---|---|
| auth | `login`, `refresh`, `logout`, `me` |
| clientes | `GET/POST /clientes`, `GET/PUT /clientes/{id}`, `PATCH /clientes/{id}/status` |
| funcionários (admin) | `GET/POST /funcionarios`, `GET/PUT /funcionarios/{id}`, `PATCH .../status` |
| tipos | `GET/POST /tipos-acomodacao`, `PUT/{id}`, `PATCH .../status` |
| acomodações | `GET/POST /acomodacoes`, `GET/PUT/{id}`, `PATCH .../status`, `GET .../tarifas`, `GET/POST .../quartos`, `PATCH /quartos/{id}/status` |
| reservas | `GET/POST /reservas`, `GET /reservas/{id}`, `GET /reservas/disponibilidade`, `GET /reservas/eventos`, `POST .../check-in`, `.../check-out`, `.../cancelar`, `GET/POST .../itens-consumidos`, `GET .../adicionais` |
| estoque | `GET/POST /estoque/categorias`, `PATCH .../status`, `GET/POST /estoque/itens`, `GET/PUT/{id}`, `PATCH .../status`, `GET/POST /estoque/movimentacoes` |
| frigobares | `GET/POST /frigobares`, `GET/PUT/{id}`, `PATCH .../status`, `GET/POST .../itens`, `PUT/DELETE /frigobares/itens/{id}`, `PATCH .../status` |
| estacionamento | `GET/POST /estacionamento`, `DELETE/{id}`, `PATCH .../vinculo`, `PATCH .../status` |
| pagamentos | `GET/POST /formas-pagamento`, `PUT/{id}`, `PATCH .../status` |
| estabelecimento | `GET/PUT /estabelecimento`, `GET/PUT /estabelecimento/endereco` |
| financeiro | `GET /financeiro/resumo`, `GET /financeiro/series/{recebido,por-pagamento,reservas,vendas}` |
| dashboard | `GET /dashboard` |
| auditoria (admin) | `GET /auditoria/logs` |

Query params comuns: `page`, `per_page` (≤200), `apenas_ativos`,
`inicio`/`fim` (YYYY-MM-DD), `busca` (clientes). Dinheiro aceita número,
`"123.45"` ou formato BR `"1.234,56"`.

## Erros

```json
{ "erro": { "codigo": "CONFLITO", "mensagem": "Acomodação já reservada para esse período." } }
```

Códigos: `VALIDACAO` (400), `NAO_AUTENTICADO` (401), `PROIBIDO` (403),
`NAO_ENCONTRADO` (404), `CONFLITO` (409), `REGRA_NEGOCIO` (422),
`INTERNO` (500 — detalhe só no log, nunca no corpo).

## Verificação

```powershell
cargo fmt --all -- --check
cargo check --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

Testes unitários rodam sem banco. Os e2e `#[sqlx::test]` dos fluxos
críticos — reserva (`tests/fluxo_reserva.rs`) e operação PDV/caixa/
estoque/autorização (`tests/fluxo_operacao.rs`, fixtures em
`tests/common/`) — precisam de um Postgres local. `#[sqlx::test]` cria
e dropa um database por caso:

```powershell
docker compose up -d postgres
$env:DATABASE_URL = "postgres://clarituz:clarituz@localhost:5432/clarituz"
cargo test --workspace
```

## Rodar server 

cargo run -p clarituz-api -- migrate
cargo run -p clarituz-api -- create-admin --login admin --nome "Admin" --senha "..."
cargo run -p clarituz-api -- serve

## Diferenças conscientes do legado

- **Sessões de refresh**: novidade — o legado era PHP-session; aqui é JWT + rotação.
- **Disponibilidade**: sem cache de 30s do legado — a query é barata e sempre consistente.
- **Consumo**: `valor_final` é calculado no servidor (server-authoritative); itens de frigobar baixam estoque na mesma transação do lançamento.
- **Logs**: `obs` em texto puro (legado gravava HTML) + campo `dados` JSONB estruturado.
