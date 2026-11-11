// Editor dirigido por esquema de todas as páginas do site institucional.
// Cada seção é uma linha `cms_site` (objeto JSON livre); campos de mídia
// guardam o id de um item da biblioteca `site_midia`.

import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { CmsSecao, SiteMidia } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { PAGINAS_SITE, SecaoDef } from './site-schema';
import { SecaoCampoComponent } from './secao-campo.component';

type Dict = Record<string, unknown>;

@Component({
  selector: 'app-paginas-editor',
  imports: [SecaoCampoComponent],
  template: `
    <div class="paginas">
      <nav class="abas" aria-label="Páginas do site">
        @for (p of paginas; track p.pagina) {
          <button type="button" class="aba" [class.ativa]="paginaSel() === p.pagina"
                  (click)="paginaSel.set(p.pagina)">
            {{ p.titulo }}
            @if (pendenciasPagina(p.pagina) > 0) { <span class="dot" [attr.aria-label]="pendenciasPagina(p.pagina) + ' alterações'"></span> }
          </button>
        }
      </nav>

      <div class="pagina-head">
        <div>
          <h3>{{ paginaAtual().titulo }}</h3>
          <p>Seções exibidas na página. Edite, salve por seção ou publique tudo de uma vez.</p>
        </div>
        <button type="button" class="bt pri" [disabled]="salvandoTudo() || pendenciasPagina(paginaSel()) === 0"
                (click)="salvarPagina()">
          {{ salvandoTudo() ? 'Salvando…' : 'Salvar alterações da página' }}
        </button>
      </div>

      @for (def of paginaAtual().secoes; track def.secao) {
        <section class="card" [class.oculta]="!visivel(def.secao)">
          <header class="card-head">
            <div>
              <strong>{{ def.titulo }}</strong>
              <p class="desc">{{ def.descricao }}</p>
            </div>
            <div class="head-acoes">
              @if (existe(def.secao)) {
                <label class="vis">
                  <input type="checkbox" [checked]="visivel(def.secao)" [disabled]="toggling() === def.secao"
                         (change)="toggleVisivel(def.secao)" />
                  Visível no site
                </label>
              }
              @if (dirty(def.secao)) { <span class="pend">alterado</span> }
              <button type="button" class="bt" [disabled]="salvando() === def.secao || !dirty(def.secao)"
                      (click)="salvar(def)">
                {{ salvando() === def.secao ? 'Salvando…' : 'Salvar' }}
              </button>
            </div>
          </header>
          <div class="campos">
            @for (c of def.campos; track c.key) {
              <app-secao-campo [campo]="c" [valor]="valor(def.secao, c.key)" [midias]="midias()"
                               (valorChange)="setValor(def.secao, c.key, $event)"
                               (midiaEnviada)="midias.update(l => [...l, $event])" />
            }
          </div>
        </section>
      }

      <section class="card">
        <header class="card-head">
          <div>
            <strong>Biblioteca de mídia</strong>
            <p class="desc">Imagens e vídeos disponíveis para todas as páginas. Enviar também é possível ao escolher mídia num campo.</p>
          </div>
          <label class="bt">Enviar arquivo
            <input type="file" hidden accept="image/*,video/mp4,video/webm" (change)="upload($event)" />
          </label>
        </header>
        @if (subindo()) { <p class="muted">Enviando…</p> }
        <div class="lib-grid">
          @for (m of midias(); track m.id) {
            <figure class="lib-item">
              @if (m.tipo === 'video') {
                <video [src]="url(m.id)" muted playsinline preload="metadata" controls></video>
              } @else {
                <img [src]="url(m.id)" [alt]="m.nome" loading="lazy" />
              }
              <figcaption>
                <span class="nome" [title]="m.nome">{{ m.nome || ('#' + m.id) }}</span>
                @if (usos(m.id) > 0) { <span class="uso">{{ usos(m.id) }} uso(s)</span> }
                <button type="button" class="bt per" [disabled]="usos(m.id) > 0"
                        [title]="usos(m.id) > 0 ? 'Em uso — remova das seções primeiro' : 'Excluir'"
                        (click)="excluirMidia(m)">Excluir</button>
              </figcaption>
            </figure>
          } @empty {
            <p class="muted">Biblioteca vazia.</p>
          }
        </div>
      </section>
    </div>
  `,
  styles: `
    .paginas { display: grid; gap: 14px; }
    .abas { display: flex; gap: 6px; flex-wrap: wrap; }
    .aba { position: relative; padding: 8px 14px; border: 1px solid #e4e4e7; border-radius: 999px; background: #fff;
           font: inherit; font-size: 12px; font-weight: 500; color: #52525b; cursor: pointer; }
    .aba:hover { border-color: #a1a1aa; }
    .aba.ativa { background: #18181b; border-color: #18181b; color: #fff; }
    .dot { position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; background: #18181b; border: 2px solid #fff; }
    .aba.ativa .dot { border-color: #18181b; background: #fff; }
    .pagina-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .pagina-head h3 { margin: 0 0 2px; font-size: 16px; color: #18181b; }
    .pagina-head p { margin: 0; font-size: 12px; color: #71717a; }
    .card { border: 1px solid #e4e4e7; border-radius: 12px; background: #fff; padding: 16px; display: grid; gap: 14px; }
    .card.oculta { opacity: .55; }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .card-head strong { font-size: 14px; color: #18181b; }
    .desc { margin: 2px 0 0; font-size: 12px; color: #71717a; }
    .head-acoes { display: flex; align-items: center; gap: 10px; }
    .vis { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #52525b; cursor: pointer; }
    .pend { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #71717a;
            border: 1px solid #e4e4e7; border-radius: 999px; padding: 3px 8px; }
    .campos { display: grid; gap: 12px; max-width: 720px; }
    .bt { padding: 7px 14px; border: 1px solid #e4e4e7; border-radius: 6px; background: #fff; color: #18181b;
          font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
    .bt:hover { background: #f4f4f5; }
    .bt:disabled { opacity: .4; cursor: default; }
    .bt.pri { background: #18181b; border-color: #18181b; color: #fff; }
    .bt.pri:hover:not(:disabled) { background: #27272a; }
    .bt.per { color: #b91c1c; padding: 4px 8px; font-size: 11px; }
    .muted { margin: 0; font-size: 12px; color: #a1a1aa; }
    .lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
    .lib-item { margin: 0; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden; display: grid; }
    .lib-item img, .lib-item video { width: 100%; height: 88px; object-fit: cover; background: #f4f4f5; }
    .lib-item figcaption { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
    .lib-item .nome { flex: 1; min-width: 0; font-size: 11px; color: #52525b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lib-item .uso { font-size: 10px; color: #a1a1aa; white-space: nowrap; }
  `,
})
export class PaginasEditorComponent implements OnInit {
  protected readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly paginas = PAGINAS_SITE;
  readonly paginaSel = signal('home');
  readonly secoes = signal<CmsSecao[]>([]);
  readonly draft = signal<Record<string, Dict>>({});
  readonly midias = signal<SiteMidia[]>([]);
  readonly salvando = signal<string | null>(null);
  readonly salvandoTudo = signal(false);
  readonly toggling = signal<string | null>(null);
  readonly subindo = signal(false);

  readonly paginaAtual = computed(() =>
    this.paginas.find(p => p.pagina === this.paginaSel()) ?? this.paginas[0]);

  private origem = new Map<string, string>();

  ngOnInit() {
    forkJoin({
      secoes: this.api.listarSiteSecoes(),
      midias: this.api.listarSiteMidias(),
    }).subscribe({
      next: ({ secoes, midias }) => {
        this.secoes.set(secoes);
        this.midias.set(midias);
        this.hidratar(secoes);
      },
      error: e => this.notify.erro(e),
    });
  }

  private hidratar(secoes: CmsSecao[]) {
    const d: Record<string, Dict> = {};
    this.origem.clear();
    for (const s of secoes) {
      const dados = (s.dados ?? {}) as Dict;
      d[s.secao] = structuredClone(dados);
      this.origem.set(s.secao, JSON.stringify(this.norm(dados)));
    }
    this.draft.set(d);
  }

  /** Remove chaves nulas — sujeira não deve contar como alteração. */
  private norm(d: Dict): Dict {
    const limpo: Dict = {};
    for (const [k, v] of Object.entries(d)) {
      if (v === null || v === undefined || v === '') continue;
      limpo[k] = Array.isArray(v)
        ? v.map(it => (it && typeof it === 'object' ? this.norm(it as Dict) : it))
        : v;
    }
    return limpo;
  }

  existe(secao: string) { return this.secoes().some(s => s.secao === secao); }
  visivel(secao: string) { return this.secoes().find(s => s.secao === secao)?.visivel ?? false; }
  valor(secao: string, key: string) { return this.draft()[secao]?.[key] ?? null; }

  setValor(secao: string, key: string, v: unknown) {
    this.draft.update(d => ({ ...d, [secao]: { ...(d[secao] ?? {}), [key]: v } }));
  }

  dirty(secao: string) {
    const d = this.draft()[secao];
    if (!d) return false;
    return JSON.stringify(this.norm(d)) !== (this.origem.get(secao) ?? 'null');
  }

  pendenciasPagina(pagina: string) {
    const def = this.paginas.find(p => p.pagina === pagina);
    return def ? def.secoes.filter(s => this.dirty(s.secao)).length : 0;
  }

  salvar(def: SecaoDef, silencioso = false) {
    const dados = this.norm(this.draft()[def.secao] ?? {});
    this.salvando.set(def.secao);
    this.api.salvarSiteSecao(def.secao, dados).subscribe({
      next: s => {
        this.salvando.set(null);
        this.secoes.update(l => [...l.filter(x => x.secao !== s.secao), s]);
        this.origem.set(s.secao, JSON.stringify(this.norm(dados)));
        if (!silencioso) this.notify.ok(`"${def.titulo}" publicada no site.`);
      },
      error: e => { this.salvando.set(null); this.notify.erro(e); },
    });
  }

  salvarPagina() {
    const pendentes = this.paginaAtual().secoes.filter(s => this.dirty(s.secao));
    if (!pendentes.length) return;
    this.salvandoTudo.set(true);
    forkJoin(pendentes.map(s => this.api.salvarSiteSecao(s.secao, this.norm(this.draft()[s.secao] ?? {})))).subscribe({
      next: salvas => {
        this.salvandoTudo.set(false);
        this.secoes.update(l => [...l.filter(x => !salvas.some(s => s.secao === x.secao)), ...salvas]);
        for (const s of salvas) this.origem.set(s.secao, JSON.stringify(this.norm(this.draft()[s.secao] ?? {})));
        this.notify.ok(`${salvas.length} seção(ões) publicadas em "${this.paginaAtual().titulo}".`);
      },
      error: e => { this.salvandoTudo.set(false); this.notify.erro(e); },
    });
  }

  toggleVisivel(secao: string) {
    const alvo = !this.visivel(secao);
    this.toggling.set(secao);
    this.api.definirSiteVisivel(secao, alvo).subscribe({
      next: s => {
        this.toggling.set(null);
        this.secoes.update(l => [...l.filter(x => x.secao !== s.secao), s]);
        this.notify.ok(alvo ? 'Seção visível no site.' : 'Seção ocultada do site.');
      },
      error: e => { this.toggling.set(null); this.notify.erro(e); },
    });
  }

  url(id: number) { return this.api.siteMidiaUrl(id); }

  /** Quantas chaves de mídia (em qualquer seção rascunho ou salva) referenciam o id. */
  usos(id: number) {
    const conta = (v: unknown): number =>
      Array.isArray(v) ? v.reduce((a, it) => a + conta(it), 0) : v === id ? 1 : 0;
    let n = 0;
    for (const dados of Object.values(this.draft())) {
      for (const v of Object.values(dados)) n += conta(v);
    }
    return n;
  }

  upload(ev: Event) {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    if (!file) return;
    this.subindo.set(true);
    this.api.uploadSiteMidia(file, file.name.replace(/\.[^.]+$/, '')).subscribe({
      next: m => { this.subindo.set(false); this.midias.update(l => [...l, m]); this.notify.ok('Mídia enviada.'); },
      error: e => { this.subindo.set(false); this.notify.erro(e); },
    });
    el.value = '';
  }

  excluirMidia(m: SiteMidia) {
    if (!confirm(`Excluir "${m.nome || '#' + m.id}" da biblioteca?`)) return;
    this.api.removerSiteMidia(m.id).subscribe({
      next: () => { this.midias.update(l => l.filter(x => x.id !== m.id)); this.notify.ok('Mídia excluída.'); },
      error: e => this.notify.erro(e),
    });
  }
}
