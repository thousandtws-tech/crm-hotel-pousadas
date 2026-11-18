You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Estrutura do projeto (admin)

```
src/app/
├── core/
│   ├── api/            clientes HTTP por domínio — <dominio>.api.ts (@Service,
│   │                   extends ApiHttp de api-http.ts). Componentes NUNCA
│   │                   injetam HttpClient diretamente.
│   ├── models/         contratos da API por domínio — <dominio>.models.ts,
│   │                   TypeScript puro (sem Angular/HTTP). index.ts re-exporta.
│   ├── services/       auth.store, realtime (Phoenix), notify, maria, notificacoes
│   ├── guards/         authGuard, guestGuard, adminGuard
│   ├── interceptors/   authInterceptor (Bearer + single-flight refresh em 401)
│   └── config/
├── features/<dominio>/ páginas e componentes do domínio
│   │                   Uma pasta por componente: `features/<dominio>/<x>/`
│   │                   contém `x.component.ts` (decorador + `class XComponent
│   │                   extends XStore`, mais input/output/model/viewChild —
│   │                   detectados na classe decorada), `x.component.html`,
│   │                   `x.component.css` e `x.store.ts` (`@Directive() export
│   │                   abstract class XStore` com todo o estado/lógica;
│   │                   membros são herdados, bindings não mudam). CSS acima
│   │                   do budget pode ser dividido em `x.extra.css`
│   │                   (`styleUrls` em array).
├── layout/             shell autenticado com navegação
└── shared/             UI genérica sem regra de negócio
```

Scripts de refatoração mecânica (mesma convenção em arquivos novos):
`node scripts/split-components.cjs <caminho.component.ts> [--apply]`,
`node scripts/extract-views.cjs <caminho.component.ts>` (inline → .html/.css),
`node scripts/organize-folders.cjs` (agrupa em pasta por componente).

Fronteiras verificadas por `npm run deps:check` (dependency-cruiser): sem ciclos,
features isoladas entre si, `core`/`shared` não dependem de features, `models`
é puro. Quebrou o check = o import está errado — mova para `core` ou `shared`.

Realtime: `Realtime.delta('tabela')`/`mudanca(...)` dentro de `effect()` para
recarregar dados; `iniciar()`/`parar()` cuidam do ciclo de vida (não chame
`iniciar` duas vezes). Sockets, timers e AudioContext sempre têm teardown.

Comandos: `npm ci` (sem flags), `npm run build`, `npm test`, `npm run deps:check`.
E2E de jornadas: `client/e2e` (Playwright, API mockada).
