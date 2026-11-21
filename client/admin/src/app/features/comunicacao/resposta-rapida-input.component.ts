// Textarea com expansão de respostas rápidas — digitar '/atalho' abre o
// menu filtrado (setas navegam, Enter/Tab confirma, Esc fecha). O texto
// substitui o token '/consulta' e o atendente revisa antes de enviar.
import { Component, ElementRef, computed, input, model, signal, viewChild } from '@angular/core';
import { RespostaRapida } from '@core/models/comunicacao.models';

@Component({
  selector: 'app-rr-textarea',
  template: `
    <textarea
      #ta
      class="rr-input"
      [rows]="rows()"
      [placeholder]="placeholder()"
      [value]="texto()"
      (input)="digitar($event)"
      (keydown)="tecla($event)"
      (blur)="menuAberto.set(false)"
      role="combobox"
      aria-autocomplete="list"
      [attr.aria-expanded]="menuAberto()"
      aria-controls="rr-menu"
      [attr.aria-activedescendant]="ativoDesc()"
    ></textarea>
    @if (menuAberto() && sugestoes().length) {
      <ul class="rr-menu" id="rr-menu" role="listbox" aria-label="Respostas rápidas">
        @for (r of sugestoes(); track r.id; let i = $index) {
          <li
            role="option"
            [id]="'rr-op-' + r.id"
            [attr.aria-selected]="i === indice()"
            [class.sel]="i === indice()"
          >
            <button type="button" (mousedown)="$event.preventDefault(); escolher(r)">
              <code>/{{ r.atalho }}</code>
              <span>{{ r.titulo }}</span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; position: relative; }
    .rr-input {
      padding: 0.55rem 0.65rem;
      border: 1px solid var(--borda, #ccd);
      border-radius: 8px;
      font: inherit;
      font-size: 0.9rem;
      resize: vertical;
    }
    .rr-input:focus-visible { outline: 2px solid #054054; outline-offset: 0; }
    .rr-menu {
      position: absolute;
      bottom: calc(100% + 0.25rem);
      left: 0; right: 0;
      margin: 0; padding: 0.25rem;
      list-style: none;
      background: #fff;
      border: 1px solid var(--borda, #ccd);
      border-radius: 8px;
      box-shadow: 0 -4px 16px rgba(5, 20, 30, 0.14);
      max-height: 13.5rem;
      overflow-y: auto;
      z-index: 20;
    }
    .rr-menu button {
      all: unset;
      box-sizing: border-box;
      display: flex;
      gap: 0.55rem;
      align-items: baseline;
      width: 100%;
      padding: 0.45rem 0.55rem;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .rr-menu button:focus-visible,
    .rr-menu li.sel > button { background: #eef4f7; }
    .rr-menu code { color: #054054; font-weight: 700; }
    .rr-menu span { color: var(--mut, #667); }
  `,
})
export class RespostaRapidaTextareaComponent {
  /** Texto do campo — `[(texto)]` bidirecional. */
  readonly texto = model.required<string>();
  /** Catálogo de respostas (já carregado pelo store pai). */
  readonly respostas = input<RespostaRapida[]>([]);
  readonly rows = input(4);
  readonly placeholder = input('');

  private readonly ta = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  protected readonly menuAberto = signal(false);
  protected readonly indice = signal(0);
  /** Token '/consulta' em edição — posições no valor atual. */
  private readonly token = signal<{ ini: number; fim: number } | null>(null);
  private readonly consulta = signal('');

  protected readonly sugestoes = computed(() => {
    const q = this.consulta().toLowerCase();
    return this.respostas()
      .filter((r) => r.ativo)
      .filter((r) => !q || r.atalho.includes(q) || r.titulo.toLowerCase().includes(q))
      .slice(0, 8);
  });

  protected readonly ativoDesc = computed(() =>
    this.menuAberto() && this.sugestoes().length
      ? `rr-op-${this.sugestoes()[this.indice()]?.id}`
      : null,
  );

  digitar(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    this.texto.set(el.value);
    this.avaliar(el.selectionStart);
  }

  tecla(e: KeyboardEvent): void {
    if (!this.menuAberto()) return;
    const n = this.sugestoes().length;
    if (e.key === 'Escape') {
      this.fechar();
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && n > 0) {
      this.indice.set((this.indice() + 1) % n);
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && n > 0) {
      this.indice.set((this.indice() - 1 + n) % n);
      e.preventDefault();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && n > 0) {
      this.escolher(this.sugestoes()[this.indice()]);
      e.preventDefault();
    }
  }

  escolher(r: RespostaRapida): void {
    const t = this.token();
    const el = this.ta()?.nativeElement;
    if (!t || !el) return;
    const v = this.texto();
    const nova = v.slice(0, t.ini) + r.texto + ' ' + v.slice(t.fim);
    this.texto.set(nova);
    el.value = nova;
    this.fechar();
    const pos = t.ini + r.texto.length + 1;
    el.focus();
    el.setSelectionRange(pos, pos);
  }

  /** '/xyz' conta como token só no início de uma palavra (evita disparar
   *  em datas, URLs ou frações digitadas no meio do texto). */
  private avaliar(caret: number): void {
    const antes = this.texto().slice(0, caret);
    const m = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(antes);
    if (!m) {
      this.fechar();
      return;
    }
    this.token.set({ ini: caret - m[1].length - 1, fim: caret });
    this.consulta.set(m[1].toLowerCase());
    this.indice.set(0);
    this.menuAberto.set(true);
  }

  private fechar(): void {
    this.menuAberto.set(false);
    this.token.set(null);
    this.consulta.set('');
  }
}
