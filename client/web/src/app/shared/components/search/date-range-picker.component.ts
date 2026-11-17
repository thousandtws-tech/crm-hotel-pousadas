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
 * Calendário de intervalo — dois meses consecutivos no desktop, um em
 * telas pequenas. Identidade Espírito do Mar: meses em serif (Cormorant),
 * barra do intervalo em névoa oceânica, pontas navy, indicador de "hoje"
 * no dourado do sol do logotipo. Máquina de seleção:
 * - sem intervalo → clique define entrada;
 * - só entrada → clique posterior define saída; igual/anterior redefine
 *   entrada e continua aguardando;
 * - intervalo completo → clique inicia intervalo novo.
 * Hover/focus em saída candidata mostra a prévia do intervalo.
 */
@Component({
  selector: 'app-date-range-picker',
  template: `
    <div class="relative">
      <button
        type="button"
        class="absolute -top-1 left-0 w-10 h-10 rounded-full text-[#054054] text-xl leading-none
               disabled:opacity-25 disabled:cursor-not-allowed hover:bg-[#EEF4F6] transition-colors"
        [disabled]="!podeVoltar()"
        aria-label="Mês anterior"
        (click)="navegar(-1)"
      >‹</button>
      <button
        type="button"
        class="absolute -top-1 right-0 w-10 h-10 rounded-full text-[#054054] text-xl leading-none
               disabled:opacity-25 disabled:cursor-not-allowed hover:bg-[#EEF4F6] transition-colors"
        [disabled]="!podeAvancar()"
        aria-label="Próximo mês"
        (click)="navegar(1)"
      >›</button>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
        @for (mes of [mesVisivel(), mesSeguinte()]; track mes.y + '-' + mes.m; let i = $index) {
          <div [class]="i === 1 ? 'hidden sm:block' : ''">
            <h4 class="font-serif text-center text-lg text-[#054054] mb-1.5">
              {{ rotuloMes(mes.m) }} de {{ mes.y }}
            </h4>
            <div class="grid grid-cols-7" role="grid" [attr.aria-label]="rotuloMes(mes.m) + ' de ' + mes.y">
              @for (d of DIAS; track $index) {
                <span class="text-center text-[10px] font-semibold tracking-wider text-[#8BA0A8] py-1.5" role="columnheader">{{ d }}</span>
              }
              @for (cel of grade(mes); track cel.chave + $index) {
                @if (cel.foraDoMes) {
                  <span aria-hidden="true"></span>
                } @else {
                  <button
                    type="button"
                    role="gridcell"
                    class="relative aspect-square min-h-10 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-[#1A6F8A] focus-visible:rounded-full"
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
                  >
                    {{ cel.data.d }}
                    @if (ehHoje(cel.data) && !selecionada(cel.data)) {
                      <span class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#DDA554]" aria-hidden="true"></span>
                    }
                  </button>
                }
              }
            </div>
          </div>
        }
      </div>
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

  /** Janela manual de navegação — null = segue a entrada (ou hoje). */
  private readonly janelaManual = signal<CivilDate | null>(null);
  /** Primeiro mês da janela visível — sempre válido desde o 1º render. */
  protected readonly mesVisivel = computed<CivilDate>(() => {
    const manual = this.janelaManual();
    if (manual) return manual;
    const base = this.entrada() ?? this.hoje();
    return { y: base.y, m: base.m, d: 1 };
  });
  protected readonly mesSeguinte = computed(() => addCalendarMonth(this.mesVisivel()));
  /** Saída candidata sob o cursor/foco (só quando aguardando saída). */
  protected readonly previewFim = signal<CivilDate | null>(null);

  protected readonly entrada = computed(() => parseDate(this.checkIn()));
  protected readonly saida = computed(() => parseDate(this.checkOut()));

  protected ehHoje(dia: CivilDate): boolean {
    return diffDays(dia, this.hoje()) === 0;
  }

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
    this.janelaManual.set(addCalendarMonths({ ...this.mesVisivel(), d: 1 }, delta));
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
    if (desabilitada) return 'text-[#CBD7DC] cursor-not-allowed';
    const eBorda = (i && diffDays(dia, i) === 0) || (f && diffDays(dia, f) === 0);
    if (eBorda) return 'bg-[#054054] text-white font-semibold rounded-full shadow-md';
    if (i && f && compareDates(dia, i) > 0 && compareDates(dia, f) < 0) {
      // Barra contínua em névoa oceânica entre entrada e saída.
      return 'bg-[#EEF4F6] text-[#054054]';
    }
    return 'text-[#054054] rounded-full hover:ring-1 hover:ring-[#4B95AB]';
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
    const destino = addDays(dia, delta);
    // Não foca dias fora do intervalo permitido — para na borda.
    if (compareDates(destino, this.hoje()) < 0 || compareDates(destino, this.horizonte()) > 0) return;
    const alvo = (ev.currentTarget as HTMLElement)
      .closest('app-date-range-picker')
      ?.querySelector<HTMLElement>(`[data-dia="${formatDate(destino)}"]`);
    alvo?.focus();
    this.pairar(destino);
  }
}
