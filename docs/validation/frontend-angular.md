# Validação — padronização dos frontends Angular

Branch: `feat/frontend-angular-standardization` (base `main`, HEAD de referência `672e599`).
Data da execução: 11/11/2026. Ambiente: Windows 11, Node 22, npm 12, Vitest 4.1.12,
Playwright 1.65 + Chromium 158.

## Versões resolvidas (lockfiles regenerados)

| Pacote | admin | web |
| --- | --- | --- |
| `@angular/core`/`common`/`forms`/`router`/`platform-browser`/`compiler`/`compiler-cli`/`animations`/`service-worker` | 22.2.5 | 22.2.5 |
| `@angular/cli`/`build` | 22.2.6 | 22.2.6 |
| `@angular/cdk`/`material` | 22.2.7 | — |
| TypeScript | ~6.0.2 | ~6.0.2 |
| `zone.js` | **ausente** | **ausente** |

Antes, o lockfile do admin misturava `@angular/core@22.2.1` com
`@angular/service-worker@22.2.4` — `npm ci` só passava com
`--legacy-peer-deps` (flag presente nos dois Dockerfiles). As famílias foram
alinhadas e os lockfiles regenerados com `node_modules` removido; `npm ci`
agora passa **sem flags** nos dois apps e a flag foi removida dos Dockerfiles.

## Comandos reproduzíveis

```bash
cd client/admin   # ou client/web
npm ci            # instalação reproduzível — sem --legacy-peer-deps
npm run deps:check  # fronteiras de arquitetura (dependency-cruiser)
npm run build     # produção
npm test          # Vitest (unit-test builder)

cd client/e2e && npm ci && npx playwright install chromium
npx playwright test          # jornadas, API 100% mockada
```

## Resultados

### Build de produção (mesmos parâmetros antes/depois)

| App | Antes (raw / transfer) | Depois (raw / transfer) | Δ |
| --- | --- | --- | --- |
| admin | 811.41 kB / 193.73 kB | 789.52 kB / 189.40 kB | −21.9 kB / −4.3 kB |
| web | 463.49 kB / 113.08 kB | 463.70 kB / 113.11 kB | +0.2 kB / +0.03 kB (ruído) |

A redução do admin vem da remoção de scaffold morto e da resolução limpa de
deps — não é promessa de ganho de performance. Lazy loading preservado
(exceljs/jspdf/html2canvas seguem fora do bundle inicial; chunks por feature
intactos nos dois apps).

### Testes

| Suite | Antes | Depois |
| --- | --- | --- |
| admin unit | 2/2 falhando (spec de scaffold "Hello, admin" + `SwUpdate` sem provider) | **29/29** |
| web unit | 5/5 | **17/17** |
| e2e Playwright | inexistente | **5/5** |

Cobertura adicionada:

- **Autenticação** — `auth.store.spec.ts`: login persiste tokens/signals, logout
  limpa e navega, refresh single-flight sob concorrência, refresh falho encerra
  sessão, sem refresh token → `false` sem chamar a API. `auth.interceptor.spec.ts`:
  Bearer só em rotas protegidas, 401→rotação→retry com novo token, **dois 401
  simultânicos = uma rotação**, refresh falho → `sairSilencioso` + 401 propagado.
- **Contratos HTTP** — `reservas.api.spec.ts` (endpoints check-in/check-out/
  cancelar/no-show/disponibilidade, params `por_pagina`, 409 e falha de rede
  propagados), `pagamentos.api.spec.ts` (reembolso com `valor_centavos` nulo,
  resumo financeiro).
- **Realtime** — `realtime.service.spec.ts` (phoenix mockado): conexão única,
  debounce de rajada → 1 bump, `parar()` descarta timers pendentes, canais saem,
  socket desconecta, sinais de aviso. `maria.service.spec.ts` (WebSocket mockado):
  desconectar durante backoff **cancela o retry** (bug de ressurreição corrigido),
  queda inesperada reconecta.
- **Website** — `booking.service.spec.ts` (contrato `/publico/reservas`, erro do
  backend vs. falha de rede, `validarContrato`, `nights`),
  `payment.service.spec.ts` (checkout sem valor no corpo — servidor calcula;
  status por token), `newsletter.service.spec.ts`.
- **Jornadas e2e** — admin login (sucesso + 401), web reserva (sucesso + 409) e
  newsletter — `page.route` com fixtures sintéticas, nenhum backend envolvido.
  Console limpo nas jornadas após correções do `EChartComponent`.

### Fronteiras e tipagem

- `strict` + `strictTemplates`: **ativos nos dois apps**; a base já era type-safe —
  a única correção foi um optional-chain desnecessário (NG8107) no booking.
- `deps:check`: admin 159 módulos/700 deps, web 77/294 — **zero violações e zero
  ciclos** (features isoladas, `models` puros, `shared` sem depender de features).
- Sem `any`/`$any`/`ts-ignore` introduzidos; respostas externas estreitadas nas
  fronteiras (`HttpErrorResponse`, narrowing de payloads Phoenix/CMS).

### Zoneless

- `zone.js` ausente das deps e do bundle (polyfills admin: 494 bytes, sem zone).
- Correções de lifecycle: `Realtime.parar` (timers + AudioContext),
  `MariaService.desconectar` (retry + dois AudioContext), `SiteContentService` e
  `AccommodationService` (listener nomeado + `DestroyRef`), `EChartComponent`
  (resize via rAF, `title` fora do replaceMerge).
- MAR IA/microfone/áudio, ECharts, timers de negócio e Phoenix atualizam o DOM
  via signals — nenhum `detectChanges` artificial adicionado.

## Decisões registradas

1. **Website é CSR** — `@angular/ssr`/`provideClientHydration` removidos (não
   havia `server`/`ssr`/`prerender` no angular.json; deploy é nginx estático).
2. **`swiper`/`lucide-angular` removidos** — zero imports no `src`.
3. **`ApiService` → 24 `*Api` por domínio + `ApiHttp` base**; `api.models.ts` →
   22 arquivos + `index.ts` estável. Contratos e consumidores preservados;
   componentes nunca chamam `HttpClient` diretamente.
4. **`num()`/`STATUS_RESERVA` → `core/api/utils`** — helpers de apresentação
   fora do transporte.
5. **Playwright com API mockada** — separa teste de jornada de integração real;
   fixtures não usam dados pessoais.

## Pendências e limitações (não bloqueantes ou bloqueadas)

- **Warnings de budget CSS pré-existentes** no admin: `pdv.component.ts`
  15.86 kB (> 14 kB) e `cms.component.ts` 15.28 kB (> 14 kB). Idênticos antes
  e depois; budgets **não** foram ampliados — refatorar o CSS fica como
  trabalho posterior.
- **Domínio canônico inconsistente**: `espiritodomar.com.br` vs
  `pousadaespiritodomar.com.br` em SEO/canonical (pré-existente; decisão de
  negócio, não de código).
- **Formulário de contato** do website: revisar se persiste via API ou só
  simula sucesso (comportamento anterior preservado; requer alinhamento com o
  backend).
- **`environment.ts` de dev** aponta para a API de produção (realtime local):
  aceitável como convenção do projeto, mas deve ser revisto antes de staging.
- **Integração real** com backend/Stripe não exercitada — todos os testes usam
  mocks/fixtures por exigência de não usar dados reais; validar em staging com
  credenciais antes de release.
- **Cobertura de features migradas** (PDV, caixa, estoque, operação, CMS,
  auditoria, MAR IA UI): verificação estrutural + contratos de API + jornada
  de auth; specs de componente por domínio seguem como próximo incremento.
- **2 vulnerabilidades moderadas** reportadas pelo `npm audit` no admin
  (transitivas) — avaliar atualização de patch com o mantenedor.
