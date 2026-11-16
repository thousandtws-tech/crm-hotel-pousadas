# Redesign do CRM administrativo — diagnóstico, sistema visual e validação

Branch: `feat/admin-redesign-minimalista` (base `feat/web-redesign-espirito-do-mar`,
que contém a refatoração de arquitetura do admin ausente em `main`).
Escopo: `client/admin`. Site público (`client/web`) e contratos de API inalterados.

## 1. Diagnóstico (estado anterior)

Inventário: ~30 rotas lazy-loaded (dashboard, recepção, reservas + detalhe,
operadoras, contratos, clientes, acomodações, estoque, insumos, compras,
frigobares, estacionamento, PDV/KDS/café, CMS, estabelecimento, funcionários,
comunicação, inteligência, governança/manutenção/escalas, financeiro com 7
sub-telas, auditoria). Guards `authGuard`/`adminGuard`/`guestGuard`, realtime
Phoenix, notificações e trilha de auditoria já existentes.

Problemas comprovados (não hipóteses):

- **Identidade visual conflitante**: trilho lateral navy `#14303c` + header navy
  `#054054` + dourado `#b5811f` + serifa Cormorant Garamond — linguagem
  editorial/marketing do site público dentro de uma ferramenta operacional.
- **Dispersão de cor**: ~2.600 literais hexadecimais repetidos nos componentes,
  inviabilizando varredura manual — mapeados para uma paleta canônica.
- **Títulos de página a 1.9–2.1rem em serifa** — hierarquia de vitrine, não de
  sistema.
- **Aliases `--inn-*`** referenciando a marca antiga espalhados pelos
  componentes.
- **Gradientes azul→azul e azul→âmbar** em avatares, chips e legendas —
  decorativos, sem função.
- **Login sem marca** no cartão e ilustração navy desalinhada.

O que já era bom e foi preservado: arquitetura de informação (dashboard
operacional com chegadas/saídas/ocupação; recepção com mapa de quartos;
reservas com lista/calendário/mapa/grupos; estados skeleton; guards;
realtime).

## 2. Referências consultadas

- **Cloudbeds (novo calendário)**: grid data×unidade com ocupação visível,
  busca spotlight, filtros que desenfatizam reservas não correspondentes,
  painéis laterais que preservam o contexto do calendário, configuração de
  exibição por usuário.
- **Mews**: navegação lateral colapsável, busca global, utilitários de
  notificação, resumo operacional do dia (chegadas, partidas, ocupação,
  governança, VIPs, indicadores financeiros).
- **Oracle OPERA Cloud** (citado no brief): tomado como referência conceitual
  de clareza em recepção/faturamento; sem extração detalhada registrada.

Uso: referência de maturidade operacional — a identidade visual é própria.

## 3. Sistema visual adotado

Paleta canônica (`client/admin/src/styles.css`):

| Papel | Token | Valor |
| --- | --- | --- |
| Fundo da página | `--bg` | `#F5F7FA` |
| Superfícies | `--surface` | `#FFFFFF` |
| Texto | `--text` | `#20242C` |
| Texto secundário | `--text-3` | `#55606D` |
| Primária (ações/seleção) | `--primary` | `#2457A7` |
| Perigo | `--danger` | `#DC3545` |
| Sucesso | `--success` | `#198754` |
| Aviso | `--warning` | `#B45309` |
| Raio | `--radius`/`--radius-lg` | 6px / 8px |
| Sombras | `--shadow-sm/md/lg` | discretas, neutras |

Tipografia: uma família (Manrope); `--font-display` agora aliás de
`--font-body`. Literais Cormorant removidos dos componentes. Títulos internos
padronizados (~1.45rem/700; `.page h1` 1.4rem).

Shell: sidebar **clara** (antes navy+dourado), ativo em `--primary-soft` com
acento `--primary`, marca sem inversão, header branco com borda, avatar em
`--primary` sem aro dourado, indicador de tempo real verde/âmbar coerente.
Comportamento inalterado (rail expansível, grupos, scrim mobile, teclas).

Método de migração (o volume de literais exigiu automação): (a) tabela de
mapeamento explícita paleta antiga → nova em 43 arquivos; (b) segunda passada
por cor mais próxima da paleta canônica para tints pontuais (~175 cores em 42
arquivos); (c) terceira passada equivalente para literais `rgba()` (28
arquivos), restaurando âmbar onde a distância RGB o havia rebaixado a cinza;
(d) substituição de literais Cormorant e tamanhos de título; (e) remoção de
gradientes decorativos (skeletons funcionais preservados).

Cores semânticas de status (reserva, quarto, KDS, limpeza, manutenção)
permanecem distintas da cor de marca — informação nunca depende só de cor
(chips têm rótulo textual; mapa de quartos tem legenda e ícones).

## 4. Matriz de cobertura dos módulos

| Módulo/rota | Estado | Revisão |
| --- | --- | --- |
| `/login` | Existente | Redesenhado (marca no cartão, painel ilustrado, botão primário azul) |
| `/dashboard` | Existente | KPIs sóbrios; período 7d/30d/mês; chegadas/saídas/ocupação/recebido |
| `/recepcao` | Existente | Quadro do dia, chegadas com check-in, mapa de quartos com legenda |
| `/reservas` (+`/:id`) | Existente | Lista/calendário/mapa/grupos, filtros de status, detalhe com FNRH |
| `/clientes`, `/acomodacoes` | Existente | Tabelas densas, cards informativos, status chips |
| `/operadoras`, `/contratos` | Existente | Revisão visual via remap global |
| `/estoque`, `/insumos`, `/compras`, `/frigobares` | Existente | Revisão visual via remap global |
| `/estacionamento` | Existente | Revisão visual via remap global |
| `/pdv`, `/cozinha`, `/cafe` | Existente | Títulos e cores normalizados; KDS mantém cores de estado |
| `/operacao/*` | Existente | Governança/manutenção/escalas revisados |
| `/financeiro/*` (7 telas) | Existente | Fin-nav, KPIs, DRE, conciliação, caixa — remap global |
| `/cms`, `/estabelecimento`, `/funcionarios` | Existente | Skeletons, formulários e modais revisados |
| `/comunicacao`, `/inteligencia` | Parcial (dependem de dados da API) | Estados vazios existentes; gráficos só com dados reais |
| `/auditoria` | Existente | Tabela/feed revisados |
| MAR IA widget | Existente | FAB e aura normalizados para a paleta |

Não inventado: nenhum seletor multi-empresa/rede, nenhum indicador sem fonte
na API, nenhum botão sem efeito. Permissões seguem `isAdmin`/`canFinanceiro`
(server-side na API; ocultar botão não substitui autorização).

## 5. Estados de interface

Verificados nas capturas: skeletons de tabela (CMS, acomodações), vazio com
explicação ("Nenhuma mesa encontrada", "Sem movimentação no período",
"Sem acompanhantes", governança "o cron gera às 22h UTC"), erro (`alert-err`,
toasts), "Reconectando…" (realtime offline), confirm modais (`.confirm-*`),
negação de permissão via `adminGuard`. Mensagens curtas preservadas.

## 6. Validação executada

| Verificação | Resultado |
| --- | --- |
| `npm run build` (admin) | ✅ OK — 3 warnings de orçamento CSS já pré-existentes (reservas/pdv/cms) |
| `npm test` (admin, Vitest) | ✅ 29/29 specs em 7 arquivos |
| `npm run deps:check` | ✅ 164 módulos, 0 violações |
| Capturas Playwright (`admin-capture.spec.ts`, API mockada) | ✅ 20 telas × 390/768/1366 px |
| Zoom 200% (`admin-zoom.spec.ts`, body zoom) | ✅ sem scroll horizontal de página; reflow intacto |
| Contraste (paleta) | `--text` 14:1, `--text-3` ~6.4:1, `--primary` ~6.9:1, `--muted` ~5.7:1 em `#fff` |
| Site público | Inalterado — nenhum arquivo de `client/web` tocado |
| Contratos de API/permissões/realtime | Inalterados — nenhum arquivo de `server/` ou `core/api` tocado |

Capturas em `client/e2e/capturas-crm/` (ignorada no git) — comparáveis com o
estado anterior nas mesmas dimensões.

## 7. Preview

```bash
cd client/admin && npm start   # http://localhost:4300 (ou :4301 via e2e)
cd client/e2e && npx playwright test --project=admin admin-capture.spec.ts
```

## 8. Pendências e riscos

- **Cores de quarto/acomodação vêm da API** (`cor` no CMS): quartos já
  cadastrados podem carregar a paleta antiga — é dado, não código; ajuste pelo
  CMS se desejado.
- `login-bg.svg` (ilustração) ainda usa acentos teal sobre fundo escuro —
  asset decorativo; troca é opcional.
- Views "Calendário"/"Mapa" de reservas herdam o mesmo design system; não
  foram capturadas isoladamente (requerem interação) — revisar em uso real.
- Módulos parciais (`inteligencia`, `comunicacao`) exibem estados vazios sem
  dados — validar com volume real em staging.
- `admin-zoom.spec.ts` usa CSS zoom (conservador); zoom real do navegador
  aciona os breakpoints responsivos e tende a ser ainda melhor.
- O deploy do site público saiu do working tree (`railway up`), não do git —
  merge desta branch na `main` é pré-requisito para reprodutibilidade futura.
