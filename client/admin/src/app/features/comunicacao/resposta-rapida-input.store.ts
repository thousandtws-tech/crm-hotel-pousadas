// Lógica e estado de resposta-rapida-input — separada da camada de UI
// (resposta-rapida-input.component.ts). O componente herda os membros;
// templates e comportamento não mudam.
import { Directive, computed, signal } from '@angular/core';
import type { ElementRef, InputSignal, ModelSignal, Signal } from '@angular/core';
import { RespostaRapida } from '@core/models/comunicacao.models';

/**
 * Textarea com expansão de respostas rápidas — digitar '/atalho' abre o
 * menu filtrado (setas navegam, Enter/Tab confirma, Esc fecha). O texto
 * substitui o token '/consulta' e o atendente revisa antes de enviar.
 */
@Directive()
export abstract class RespostaRapidaInputStore {
  /** Texto do campo — `[(texto)]` bidirecional. */
  declare protected readonly texto: ModelSignal<string>;
  /** Catálogo de respostas (já carregado pelo store pai). */
  declare protected readonly respostas: InputSignal<RespostaRapida[]>;
  declare protected readonly rows: InputSignal<number>;
  declare protected readonly placeholder: InputSignal<string>;
  declare protected readonly ta: Signal<ElementRef<HTMLTextAreaElement> | undefined>;

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
