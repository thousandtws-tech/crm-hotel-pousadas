// Campo genérico do editor de site — renderiza um CampoDef e emite o novo valor.
// Recursivo: campos do tipo `itens` renderizam os subcampos deste mesmo
// componente, o que permite listas de blocos com texto, CTA e mídia aninhados.

import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { SiteMidia } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { CampoDef } from './site-schema';

type Dict = Record<string, unknown>;

@Component({
  selector: 'app-secao-campo',
  imports: [SecaoCampoComponent],
  template: `
    <div class="campo">
      @switch (campo().tipo) {
        @case ('texto') {
          <label class="lb">{{ campo().label }}</label>
          <input class="inp" type="text" [value]="valorStr()" [attr.maxlength]="campo().max ?? null"
                 (input)="emitir($any($event.target).value)" />
        }
        @case ('longo') {
          <label class="lb">{{ campo().label }}</label>
          <textarea class="inp area" rows="4" [value]="valorStr()" [attr.maxlength]="campo().max ?? null"
                    (input)="emitir($any($event.target).value)"></textarea>
        }
        @case ('select') {
          <label class="lb">{{ campo().label }}</label>
          <select class="inp" [value]="valorStr()" (change)="emitir($any($event.target).value)">
            <option value="">—</option>
            @for (o of campo().opcoes ?? []; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        }
        @case ('cta') {
          <div class="cta">
            <label class="lb">{{ campo().label }}</label>
            <div class="cta-row">
              <input class="inp" type="text" placeholder="Rótulo (ex.: Reservar)"
                     [value]="ctaParte('label')" (input)="emitirCta('label', $any($event.target).value)" />
              <input class="inp" type="text" placeholder="Destino (ex.: /reservar ou https://…)"
                     [value]="ctaParte('href')" (input)="emitirCta('href', $any($event.target).value)" />
            </div>
          </div>
        }
        @case ('midia') {
          <div class="midia">
            <label class="lb">{{ campo().label }}</label>
            @if (midiaAtual(); as m) {
              <div class="thumb">
                @if (m.tipo === 'video') {
                  <video [src]="url(m.id)" muted playsinline></video>
                } @else {
                  <img [src]="url(m.id)" [alt]="m.nome" />
                }
                <span class="thumb-nome">{{ m.nome || ('#' + m.id) }}</span>
                <button type="button" class="bt" (click)="emitir(null)">Remover</button>
              </div>
            } @else {
              <button type="button" class="bt escolher" (click)="abrirPicker()">Escolher da biblioteca</button>
            }
          </div>
        }
        @case ('itens') {
          <div class="itens">
            <label class="lb">{{ campo().label }}</label>
            @for (item of itensLista(); track $index; let i = $index) {
              <div class="item">
                <header class="item-head">
                  <span class="item-num">{{ i + 1 }}</span>
                  <button type="button" class="bt ic" title="Subir" [disabled]="i === 0" (click)="mover(i, -1)">↑</button>
                  <button type="button" class="bt ic" title="Descer" [disabled]="i === itensLista().length - 1" (click)="mover(i, 1)">↓</button>
                  <button type="button" class="bt ic per" title="Remover" (click)="removerItem(i)">✕</button>
                </header>
                @for (sub of campo().subcampos ?? []; track sub.key) {
                  <app-secao-campo [campo]="sub" [valor]="item[sub.key]" [midias]="midias()"
                                   (valorChange)="setItem(i, sub.key, $event)"
                                   (midiaEnviada)="midiaEnviada.emit($event)" />
                }
              </div>
            } @empty {
              <p class="vazio">Nenhum item.</p>
            }
            <button type="button" class="bt add" (click)="addItem()">+ Adicionar</button>
          </div>
        }
      }
      @if (campo().hint) { <span class="hint">{{ campo().hint }}</span> }

      @if (picker()) {
        <div class="picker-back" (click)="picker.set(false)">
          <div class="picker" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
            <header class="picker-head">
              <strong>Biblioteca de mídia</strong>
              <label class="bt up">Enviar arquivo
                <input type="file" hidden accept="image/*,video/mp4,video/webm" (change)="upload($event)" />
              </label>
              <button type="button" class="bt ic" (click)="picker.set(false)">✕</button>
            </header>
            @if (subindo()) { <p class="vazio">Enviando…</p> }
            <div class="grid">
              @for (m of midias(); track m.id) {
                <button type="button" class="cell" (click)="escolher(m)">
                  @if (m.tipo === 'video') {
                    <video [src]="url(m.id)" muted playsinline preload="metadata"></video>
                  } @else {
                    <img [src]="url(m.id)" [alt]="m.nome" loading="lazy" />
                  }
                  <span>{{ m.nome || ('#' + m.id) }}</span>
                </button>
              } @empty {
                <p class="vazio">Biblioteca vazia — envie a primeira imagem ou vídeo.</p>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .campo { display: grid; gap: 4px; }
    .lb { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #71717a; }
    .hint { font-size: 11px; color: #a1a1aa; }
    .inp { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #e4e4e7; border-radius: 6px;
           font: inherit; font-size: 13px; color: #18181b; background: #fff; }
    .inp:focus { outline: none; border-color: #18181b; }
    .inp:focus-visible { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #18181b; }
    .area { resize: vertical; min-height: 64px; }
    .cta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .bt { padding: 7px 12px; border: 1px solid #e4e4e7; border-radius: 6px; background: #fff; color: #18181b;
          font: inherit; font-size: 12px; cursor: pointer; }
    .bt:hover { background: #f4f4f5; }
    .bt:disabled { opacity: .35; cursor: default; }
    .bt.ic { padding: 5px 9px; }
    .bt.per { color: #b91c1c; }
    .thumb { display: flex; align-items: center; gap: 10px; padding: 6px; border: 1px solid #e4e4e7; border-radius: 8px; }
    .thumb img, .thumb video { width: 72px; height: 48px; object-fit: cover; border-radius: 5px; background: #f4f4f5; }
    .thumb-nome { flex: 1; font-size: 12px; color: #52525b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .itens { display: grid; gap: 8px; }
    .item { border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px; display: grid; gap: 10px; background: #fafafa; }
    .item-head { display: flex; align-items: center; gap: 4px; }
    .item-num { flex: 1; font-size: 11px; font-weight: 700; color: #71717a; }
    .vazio { margin: 0; font-size: 12px; color: #a1a1aa; }
    .picker-back { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 60; display: grid; place-items: center; padding: 20px; }
    .picker { width: min(760px, 100%); max-height: 82vh; overflow: auto; background: #fff; border-radius: 12px; padding: 16px;
              display: grid; gap: 12px; }
    .picker-head { display: flex; align-items: center; gap: 10px; }
    .picker-head strong { flex: 1; font-size: 14px; }
    .up { display: inline-flex; align-items: center; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .cell { display: grid; gap: 4px; padding: 0; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden;
            background: #fff; cursor: pointer; font: inherit; }
    .cell:hover { border-color: #18181b; }
    .cell img, .cell video { width: 100%; height: 76px; object-fit: cover; background: #f4f4f5; }
    .cell span { font-size: 10px; color: #52525b; padding: 0 6px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class SecaoCampoComponent {
  readonly campo = input.required<CampoDef>();
  readonly valor = input<unknown>(null);
  readonly midias = input<SiteMidia[]>([]);
  readonly valorChange = output<unknown>();
  /** Nova mídia enviada por este campo — o pai adiciona à biblioteca compartilhada. */
  readonly midiaEnviada = output<SiteMidia>();

  protected readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly picker = signal(false);
  readonly subindo = signal(false);

  readonly valorStr = computed(() => {
    const v = this.valor();
    return typeof v === 'string' ? v : v == null ? '' : String(v);
  });

  readonly midiaAtual = computed(() => {
    const id = Number(this.valor());
    return Number.isFinite(id) && id > 0 ? (this.midias().find(m => m.id === id) ?? null) : null;
  });

  readonly itensLista = computed(() => {
    const v = this.valor();
    return Array.isArray(v) ? (v as Dict[]) : [];
  });

  url(id: number) { return this.api.siteMidiaUrl(id); }
  emitir(v: unknown) { this.valorChange.emit(v === '' ? null : v); }

  ctaParte(parte: 'label' | 'href') {
    return this.valorStrOf(`${this.campo().key}_${parte}`);
  }

  private valorStrOf(key: string) {
    const v = this.valor();
    const raw = v && typeof v === 'object' ? (v as Dict)[key] : null;
    return typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  }

  emitirCta(parte: 'label' | 'href', v: string) {
    const atual = this.valor() && typeof this.valor() === 'object' ? { ...(this.valor() as Dict) } : {};
    atual[`${this.campo().key}_${parte}`] = v === '' ? null : v;
    this.valorChange.emit(atual);
  }

  setItem(i: number, key: string, v: unknown) {
    const lista = this.itensLista().map((it, ix) => (ix === i ? { ...it, [key]: v } : it));
    this.valorChange.emit(lista);
  }
  addItem() {
    const base: Dict = {};
    for (const s of this.campo().subcampos ?? []) base[s.key] = s.tipo === 'itens' ? [] : null;
    this.valorChange.emit([...this.itensLista(), base]);
  }
  removerItem(i: number) { this.valorChange.emit(this.itensLista().filter((_, ix) => ix !== i)); }
  mover(i: number, dir: -1 | 1) {
    const lista = [...this.itensLista()];
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    this.valorChange.emit(lista);
  }

  abrirPicker() { this.picker.set(true); }
  escolher(m: SiteMidia) { this.valorChange.emit(m.id); this.picker.set(false); }

  upload(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.subindo.set(true);
    this.api.uploadSiteMidia(file, file.name.replace(/\.[^.]+$/, '')).subscribe({
      next: m => { this.subindo.set(false); this.midiaEnviada.emit(m); this.escolher(m); },
      error: e => { this.subindo.set(false); this.notify.erro(e); },
    });
    (ev.target as HTMLInputElement).value = '';
  }
}
