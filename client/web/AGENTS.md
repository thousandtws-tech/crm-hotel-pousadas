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

## Estrutura do projeto (web)

```
src/app/
├── core/
│   ├── services/       acesso a dados por domínio (booking, payment, guest,
│   │                   newsletter, site-content, accommodation, blog...) —
│   │                   HttpClient tipado; NUNCA fetch solto em componentes.
│   ├── config/         hotel-config, modelos públicos
│   └── models/
├── features/<pagina>/  páginas lazy (loadComponent nas rotas)
├── layout/             public layout (header/footer)
└── shared/             UI genérica sem regra de negócio
```

O site é **SSR** (`@angular/ssr`, `outputMode: "server"`): Node/Express em
`src/server.ts` serve os estáticos e renderiza cada rota — HTML completo pro
SEO (inauguração 01/dez). Hidratação via `provideClientHydration` +
`withEventReplay`; `RenderMode.Server` em todas as rotas
(`app.routes.server.ts`). Regras de plataforma: dados que devem entrar no
HTML do SSR rodam fora de `isPlatformBrowser` (o `carregar()` dos services
de conteúdo); socket realtime, listeners de `document`/`window`, gsap e
localStorage só dentro do guard ou em `afterNextRender`. `allowedHosts`
em `angular.json` autoriza os domínios (SSRF guard do app engine) —
domínios novos entram lá ou via `NG_ALLOWED_HOSTS`. PWA ativo via
`@angular/service-worker`.

Realtime público (Phoenix `site:deltas`): `SiteContentService` e
`AccommodationService` recarregam após deltas; ambos têm teardown via
`DestroyRef` (socket, canal, timers, listeners). `AccommodationService` mantém
FALLBACK embutido só para indisponibilidade da API.

Pagamento: o servidor calcula valores e confirma via webhook — a UI nunca
declara pagamento liquidado nem aprova reserva por estado local ou URL.

Comandos: `npm ci` (sem flags), `npm run build`, `npm test`, `npm run deps:check`.
E2E de jornadas: `client/e2e` (Playwright, API mockada).
