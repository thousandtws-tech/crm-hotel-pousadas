# Clarituz Admin — Angular 22 + Material (M3)

Painel administrativo do CRM de pousadas, integrado ao backend Rust
(`server/`, `clarituz-api`).

## Requisitos

- Node 20+ e npm
- Backend rodando em `http://localhost:8080` (`cargo run -p clarituz-api -- serve`)

## Rodar

```powershell
npm install
npm start          # http://localhost:4200
```

Login de desenvolvimento: crie um admin com
`cargo run -p clarituz-api -- create-admin --login admin --nome "Admin" --senha <senha>`.

## Configuração da API

`src/environments/environment.ts` → `apiUrl`. Em produção, gerar
`environment.prod.ts` apontando para o host do backend.

## Arquitetura

```
src/app/
├── core/                       # singletons — nunca depende de shared/features
│   ├── guards/                 # auth.guard.ts — authGuard / guestGuard / adminGuard
│   ├── interceptors/           # auth.interceptor.ts — Bearer + retry em 401
│   ├── services/               # api.service (endpoints /api/v1), auth.store,
│   │                           # notify, confirm, realtime (SSE), notificacoes
│   └── models/                 # api.models — contratos 1:1 com o backend
├── shared/components/          # UI global burra: toast-container, confirm-dialog
├── layout/shell.component.ts   # sidenav + toolbar + sino de notificações
└── features/                   # domínios lazy-loaded — deletar a pasta = deletar a feature
    ├── auth/                   # login
    ├── dashboard/              # cards + pendências do dia + últimas reservas
    ├── reservas/               # grade de cards, busca livre, nova reserva com
    │                           # disponibilidade, detalhe: check-in/out, consumo
    ├── clientes/               # CRUD + busca + ativação
    ├── acomodacoes/            # acomodações, tipos, quartos, histórico de tarifas
    ├── estoque/                # itens, categorias, movimentações entrada/saída
    ├── frigobares/             # frigobar por acomodação, reposição (debita estoque)
    ├── estacionamento/         # vagas + vínculo com acomodação
    ├── pagamentos/             # formas de pagamento
    ├── estabelecimento/        # dados + endereço + impressoras (admin)
    ├── funcionarios/           # CRUD de funcionários (admin)
    ├── financeiro/             # resumo do período + séries (gráficos CSS)
    └── auditoria/              # trilha de logs com filtros
```

Aliases do `tsconfig.json`: `@core/*`, `@shared/*`, `@features/*` —
imports cruzando fronteiras usam alias (`import { ApiService } from
'@core/services/api.service'`), nunca `../../..`.

Convenções: standalone components (sem `shared.module` — imports diretos),
signals, `inject()`, control flow nativo (`@if`/`@for`), reactive forms,
lazy loading por rota.

## Build

```powershell
npm run build      # dist/admin
```

## Observações de contrato

- Valores monetários chegam como **string** (`Decimal`) — use o helper `num()`.
- Paginação: `page`/`por_pagina` → `Page<T> { items, page, per_page, total }`.
- Erros: `{ erro: { codigo, mensagem } }` — exibidos via snackbar.
- Cancelamento de reserva em estadia exige `login_admin`/`senha_admin` no corpo.
