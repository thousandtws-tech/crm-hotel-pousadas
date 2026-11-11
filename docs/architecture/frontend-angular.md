# Arquitetura dos frontends Angular

Documento de referência da padronização dos dois clientes Angular do monorepo
(Pousada Espírito do Mar — uma única propriedade, sem multiempresa).

| Aplicação | Pasta | Papel |
| --- | --- | --- |
| CRM administrativo | `client/admin` | Operação interna: recepção, reservas, PDV/caixa, estoque, financeiro, CMS, MAR IA |
| Website público | `client/web` | Site institucional, reserva pública, pagamento, portal do hóspede, FNRH, newsletter |

Ambas são **Angular 22.2.x standalone**, **zoneless** (sem `zone.js` nas
dependências nem nos lockfiles), com `strict` + `strictTemplates` ativos e
`bootstrapApplication` via `ApplicationConfig`. São apps independentes — build,
deploy e lockfile separados — e compartilham apenas convenções, não código.

## Estrutura e limites de dependência

Organização por capacidade de negócio (`features/`), com infraestrutura
transversal em `core/` e UI genérica em `shared/`:

```
src/app/
├── core/                 # infraestrutura transversal (singletons)
│   ├── api/              #   clientes HTTP tipados por domínio (admin)
│   ├── models/           #   contratos da API por domínio (admin)
│   ├── services/         #   auth store, realtime, notify, MAR IA...
│   ├── guards/ interceptors/ config/ (admin)
│   └── config/ services/ (web)
├── features/             # páginas e componentes por capacidade
├── layout/               # shell com navegação (admin) / public layout (web)
└── shared/               # UI genérica sem regra de negócio
```

A direção usual é **interface → facade/store → acesso a dados**. Componentes de
negócio nunca fazem HTTP diretamente: usam o cliente tipado do seu domínio
(`*Api` no admin) ou o service de domínio (web). `features/` não importa
`features/` de outro domínio; compartilhado vai para `core/` ou `shared/`.

`models/` é TypeScript puro — nunca importa Angular, HTTP ou UI.

As fronteiras são verificadas por `dependency-cruiser`
(`npm run deps:check` em cada app, `.dependency-cruiser.js` na raiz de cada um):
sem ciclos, `features` isoladas entre si, `shared` sem depender de features,
`models` puros, `core` sem depender de `features`/`layout`. As regras rodam na
CI (`.github/workflows/client.yml`).

## Acesso a dados (admin)

`ApiService` (1.234 linhas, ~265 métodos, ~26 domínios) e `api.models.ts`
(~200 tipos) foram divididos por domínio de negócio:

- `core/api/api-http.ts` — `ApiHttp`, base abstrata com `get/post/put/patch/del`
  tipados e o helper `params()` (query params ignorando `null`/`undefined`/`''`).
- `core/api/<dominio>.api.ts` — 24 clientes (`ReservasApi`, `PagamentosApi`,
  `CaixaApi`, `PdvApi`, `CmsApi`, `InteligenciaApi` [MAR IA], …), cada um
  `@Service()` estendendo `ApiHttp`.
- `core/models/<dominio>.models.ts` — 22 arquivos de contratos; `index.ts`
  re-exporta tudo, então `import * as M from '@core/models'` continua estável.

Todas as chamadas passam pelo `authInterceptor`: Bearer apenas em rotas
protegidas (nunca em `/auth/*`), um único retry após rotação de refresh em 401,
com header `X-Retry` anti-loop. O refresh é *single-flight* no `AuthStore`
(`shareReplay(1)`) — N respostas 401 simultâneas disparam **uma** rotação.

No website, o acesso é via services de domínio com `HttpClient` tipado
(`BookingService`, `PaymentService`, `GuestService`, `NewsletterService`,
`SiteContentService`, `AccommodationService`, `BlogService`, …). Não há `fetch`
solto em código de aplicativo.

## Estado, DI e fluxos assíncronos

- **Signals** para estado de tela (`signal` privado + `asReadonly` público,
  `computed` para derivados). Ex.: `AuthStore.user/autenticado/isAdmin/
  canFinanceiro`, `BookingService.filter/nights`, `Realtime.online/ultimoAviso`.
- **RxJS** permanece onde resolve composição temporal: interceptors, debounce,
  cancelamento e single-flight (`shareReplay`, `switchMap`, `catchError`).
- `effect()` reage a deltas realtime (padrão `rt.mudanca('tabela')` no admin) —
  nunca para copiar estado derivado.
- Escopo de DI: singletons transversais usam `@Service()`/`providedIn:'root'`;
  estado de tela vive no componente. `@Service` não transforma estado de tela
  em singleton.
- Ciclo de vida: timers, sockets, observers e `AudioContext` têm teardown
  explícito — `DestroyRef.onDestroy` nos services de socket do website,
  `Realtime.parar()` limpa canais + debounce + áudio, `MariaService.desconectar`
  cancela retry pendente e fecha os dois `AudioContext`.

## Zoneless

Sem `zone.js`: atualização de tela acontece por signals consumidos no template,
`AsyncPipe` ou `markForCheck` pontual. Integrações imperativas que **não** devem
disparar CD usam `NgZone.runOutsideAngular` (loop `requestAnimationFrame` do
`maria-aura`) — API ainda válida em zoneless como guarda sem custo.

Verificado em jornada e em specs: respostas HTTP (interceptor + stores),
eventos Phoenix (`Realtime`, `SiteContentService`), WebSocket binário do MAR IA,
ECharts, timers de negócio (relógio do KDS, polling de `payment-status` com
limite de tentativas) — todos atualizam o DOM sem clique extra nem
`detectChanges` repetitivo.

## Renderização e deploy

Os dois apps são **CSR estático** servidos por nginx (Dockerfiles com
`npm ci` sem flags + `ng build` + nginx). O website **não** tem SSR:
`@angular/ssr`, `provideClientHydration` e dependências mortas (`swiper`,
`lucide-angular`) foram removidos — a configuração agora reflete o deploy real.
PWA via `@angular/service-worker` nos dois apps; o admin reage a
`VERSION_READY` ativando a atualização e recarregando.

O realtime usa Phoenix Channels (hub Elixir): `deltas` + `avisos` no admin
(token reavaliado a cada reconexão via `params` função), `site:deltas` público
no website (sem auth — whitelist de tabelas no hub). MAR IA usa WebSocket
binário próprio (`mariaUrl`), com backoff exponencial e cancelamento no
teardown.

## Exemplo real de funcionalidade — reserva pública (website)

`features/booking/booking.component.ts` → `BookingService` →
`POST /publico/reservas`:

1. O componente mantém signals de formulário (`checkIn`, `guestName`,
   `aceiteTermos`, `isLoading`, `errorMessage`) — template reage a cada `.set`.
2. `BookingService.submitBookingRequest` faz `HttpClient.post` tipado para
   `/publico/reservas` com o payload do contrato (snake_case), traduzindo
   `HttpErrorResponse` em mensagem de negócio ou de rede (status 0).
3. Código corporativo é validado por `GET /publico/contrato/{codigo}` (debounce
   no componente), nunca no cliente.
4. Pagamento vai a `PaymentService.criarCheckout` — o servidor calcula o valor;
   a página de retorno (`payment-status`) só reflete o estado persistido pelo
   webhook, com polling limitado (`pendente/pago/falhou/reembolsado` do
   backend, nunca inferência local).

Cobertura: specs de serviço (`booking.service.spec.ts`, `payment.service.spec.ts`)
+ jornada Playwright (`client/e2e/web-booking.spec.ts`) — sucesso e conflito 409.

## Testes

- Unitários/integração: `@angular/build:unit-test` (Vitest) — `npm test` em cada app.
- Jornadas de browser: Playwright em `client/e2e` (`npx playwright test`) com a
  API inteira mockada por `page.route` — nenhum dado real ou backend envolvido.
- Fronteiras: `npm run deps:check` (dependency-cruiser) em cada app.

Detalhes de execução e resultados: `docs/validation/frontend-angular.md`.
