import { Component, computed, input, model, signal } from '@angular/core';
import {
  addCalendarMonth,
  addCalendarMonths,
  addDays,
  CivilDate,
  compareDates,
  diffDays,
  formatDate,
  parseDate,
  weekday,
} from '../../../core/services/search-periods';

interface Celula {
  data: CivilDate;
  chave: string;
  foraDoMes: boolean;
  desabilitada: boolean;
}

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function rotuloMes(m: number): string {
  return MESES_PT[m - 1];
}

/**
 * Calendário de intervalo com dois meses consecutivos (um em telas
 * pequenas). Máquina de seleção:
 * - sem intervalo → clique define entrada;
 * - só entrada → clique posterior define saída; igual/anterior redefine
 *   entrada e continua aguardando;
 * - intervalo completo → clique inicia intervalo novo.
 * Hover/focus em saída candidata mostra a prévia do intervalo.
 */
@Component({
  selector: 'app-date-range-picker',
  template: `
    <div class="flex items-center justify-between mb-3">
      <button
        type="button"
        class="w-8 h-8 rounded-full border border-[#B9CBD3] text-[#054054] disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#054054]"
        [disabled]="!podeVoltar()"
        aria-label="Mês anterior"
        (click)="navegar(-1)"
      >‹</button>
      <span class="text-xs text-[#536B73]">
        {{ rotuloMes(mesVisivel().m) }} {{ mesVisivel().y }}
        <span class="hidden sm:inline">· {{ rotuloMes(mesSeguinte().m) }} {{ mesSeguinte().y }}</span>
      </span>
      <button
        type="button"
        class="w-8 h-8 rounded-full border border-[#B9CBD3] text-[#054054] disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#054054]"
        [disabled]="!podeAvancar()"
        aria-label="Próximo mês"
        (click)="navegar(1)"
      >›</button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      @for (mes of [mesVisivel(), mesSeguinte()]; track mes.y + '-' + mes.m; let i = $index) {
        <div [class]="i === 1 ? 'hidden sm:block' : ''">
          <p class="sm:hidden text-center text-xs font-semibold text-[#054054] mb-1">
            {{ rotuloMes(mes.m) }} {{ mes.y }}
          </p>
          <div class="grid grid-cols-7 gap-0.5" role="grid" [attr.aria-label]="rotuloMes(mes.m) + ' de ' + mes.y">
            @for (d of DIAS; track $index) {
              <span class="text-center text-[10px] font-semibold text-[#536B73] py-1" role="columnheader">{{ d }}</span>
            }
            @for (cel of grade(mes); track cel.chave + $index) {
              @if (cel.foraDoMes) {
                <span aria-hidden="true"></span>
              } @else {
                <button
                  type="button"
                  role="gridcell"
                  class="aspect-square text-xs rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-[#054054]"
                  [class]="classeCelula(cel.data)"
                  [disabled]="cel.desabilitada"
                  [attr.data-dia]="formatDate(cel.data)"
                  [attr.aria-label]="ariaDia(cel.data)"
                  [attr.aria-selected]="selecionada(cel.data)"
                  (click)="clicar(cel.data)"
                  (mouseenter)="pairar(cel.data)"
                  (focus)="pairar(cel.data)"
                  (mouseleave)="pairar(null)"
                  (blur)="pairar(null)"
                  (keydown)="teclaDia($event, cel.data)"
                >{{ cel.data.d }}</button>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class DateRangePickerComponent {
  /** 'YYYY-MM-DD' ou '' — [(checkIn)]/[(checkOut)] no pai. */
  public readonly checkIn = model<string>('');
  public readonly checkOut = model<string>('');
  public readonly hoje = input.required<CivilDate>();
  public readonly horizonte = input.required<CivilDate>();

  protected readonly DIAS = DIAS_PT;
  protected readonly formatDate = formatDate;
  protected readonly rotuloMes = rotuloMes;

  /** Primeiro mês da janela visível. */
  protected readonly mesVisivel = signal<CivilDate>({ y: 0, m: 0, d: 1 });
  protected readonly mesSeguinte = computed(() => addCalendarMonth(this.mesVisivel()));
  /** Saída candidata sob o cursor/foco (só quando aguardando saída). */
  protected readonly previewFim = signal<CivilDate | null>(null);

  private inicializado = false;

  protected readonly entrada = computed(() => parseDate(this.checkIn()));
  protected readonly saida = computed(() => parseDate(this.checkOut()));

  protected podeVoltar(): boolean {
    const h = this.hoje();
    const vis = this.mesVisivel();
    return vis.y > h.y || (vis.y === h.y && vis.m > h.m);
  }

  protected podeAvancar(): boolean {
    const hz = this.horizonte();
    const seg = this.mesSeguinte();
    return seg.y < hz.y || (seg.y === hz.y && seg.m <= hz.m);
  }

  protected navegar(delta: number): void {
    this.mesVisivel.update((m) => addCalendarMonths({ ...m, d: 1 }, delta));
  }

  /** Deve ser chamado pelo pai quando o painel abre (sincroniza janela). */
  public sincronizarJanela(): void {
    if (this.inicializado) return;
    this.inicializado = true;
    const base = this.entrada() ?? this.hoje();
    this.mesVisivel.set({ y: base.y, m: base.m, d: 1 });
  }

  public grade(mes: CivilDate): Celula[] {
    const primeiro = { y: mes.y, m: mes.m, d: 1 };
    const offset = weekday(primeiro); // domingo = 0
    const celulas: Celula[] = [];
    for (let i = 0; i < offset; i++) {
      celulas.push({
        data: primeiro,
        chave: `vazio-${mes.y}-${mes.m}-${i}`,
        foraDoMes: true,
        desabilitada: true,
      });
    }
    let dia = primeiro;
    while (dia.m === mes.m) {
      const desabilitada =
        compareDates(dia, this.hoje()) < 0 || compareDates(dia, this.horizonte()) > 0;
      celulas.push({ data: dia, chave: formatDate(dia), foraDoMes: false, desabilitada });
      dia = addDays(dia, 1);
    }
    return celulas;
  }

  protected clicar(dia: CivilDate): void {
    const inicio = this.entrada();
    const fim = this.saida();
    if (!inicio || (inicio && fim)) {
      // Sem intervalo ou intervalo completo → inicia novo.
      this.checkIn.set(formatDate(dia));
      this.checkOut.set('');
    } else if (compareDates(dia, inicio) > 0) {
      this.checkOut.set(formatDate(dia));
    } else {
      // Igual/anterior → reposiciona a entrada, segue aguardando saída.
      this.checkIn.set(formatDate(dia));
    }
    this.previewFim.set(null);
  }

  protected pairar(dia: CivilDate | null): void {
    const inicio = this.entrada();
    if (!inicio || this.saida()) {
      this.previewFim.set(null);
      return;
    }
    this.previewFim.set(dia && compareDates(dia, inicio) > 0 ? dia : null);
  }

  protected selecionada(dia: CivilDate): boolean {
    const i = this.entrada();
    const f = this.saida();
    return (i !== null && diffDays(dia, i) === 0) || (f !== null && diffDays(dia, f) === 0);
  }

  protected classeCelula(dia: CivilDate): string {
    const i = this.entrada();
    const f = this.saida() ?? this.previewFim();
    const desabilitada = compareDates(dia, this.hoje()) < 0 || compareDates(dia, this.horizonte()) > 0;
    if (desabilitada) return 'text-[#B9CBD3] cursor-not-allowed';
    const base = 'text-[#054054] hover:bg-[#DCE6EA]';
    const eBorda = (i && diffDays(dia, i) === 0) || (f && diffDays(dia, f) === 0);
    if (eBorda) return 'bg-[#054054] text-white font-semibold';
    if (i && f && compareDates(dia, i) > 0 && compareDates(dia, f) < 0) {
      return 'bg-[#DCE6EA]/70 text-[#054054]';
    }
    return base;
  }

  protected ariaDia(dia: CivilDate): string {
    return `${dia.d} de ${rotuloMes(dia.m)} de ${dia.y}`;
  }

  /** Setas movem o foco entre dias; Enter/Espaço nativos selecionam. */
  protected teclaDia(ev: KeyboardEvent, dia: CivilDate): void {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[ev.key];
    if (delta === undefined) return;
    ev.preventDefault();
    let destino = addDays(dia, delta);
    // Não foca dias fora do intervalo permitido — para na borda.
    if (compareDates(destino, this.hoje()) < 0 || compareDates(destino, this.horizonte()) > 0) return;
    const alvo = (ev.currentTarget as HTMLElement)
      .closest('app-date-range-picker')
      ?.querySelector<HTMLElement>(`[data-dia="${formatDate(destino)}"]`);
    alvo?.focus();
    this.pairar(destino);
  }
}
