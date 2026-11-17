import { Component, computed, ElementRef, inject, output, signal } from '@angular/core';
import { SearchStateService } from '../../../core/services/search-state.service';
import { diffDays, parseDate } from '../../../core/services/search-periods';
import { DateRangePickerComponent, rotuloMes } from './date-range-picker.component';
import { DateToleranceSelectorComponent } from './date-tolerance-selector.component';
import { FlexibleStayPickerComponent } from './flexible-stay-picker.component';
import { GuestSelectorComponent } from './guest-selector.component';
import { IconComponent } from '../icons/icon.component';

type Painel = 'quando' | 'quem' | null;

/**
 * Barra de pesquisa do motor — padrão Airbnb: pílula compacta com
 * segmentos Quando/Quem + botão Buscar; clicar num segmento abre o
 * painel ancorado logo abaixo (toggle Datas/Flexível vive dentro do
 * painel "Quando"). Sem campo "Onde" — o destino é a própria pousada.
 * Estado em `SearchStateService` (rascunho × consulta aplicada).
 */
@Component({
  selector: 'app-search-bar',
  imports: [
    DateRangePickerComponent,
    DateToleranceSelectorComponent,
    FlexibleStayPickerComponent,
    GuestSelectorComponent,
    IconComponent,
  ],
  template: `
    <div class="relative w-full max-w-3xl mx-auto px-4 sm:px-6">

      <!-- Pílula principal -->
      <div
        class="grid grid-cols-[1fr_1fr_auto] items-center rounded-full border shadow-[0_8px_28px_rgba(5,64,84,0.10)] transition-colors"
        [class]="painel() !== null ? 'bg-[#E8F0F2] border-[#DCE6EA]' : 'bg-white border-[#DCE6EA]'"
      >
        <!-- Quando -->
        <button
          #gatilhoQuando
          type="button"
          class="text-left pl-6 pr-4 py-3 rounded-full transition-colors"
          [class]="painel() === 'quando' ? 'bg-white shadow-md' : 'hover:bg-[#F0F5F6]'"
          [attr.aria-expanded]="painel() === 'quando'"
          aria-haspopup="dialog"
          (click)="alternarPainel('quando')"
        >
          <span class="block text-[10px] font-semibold uppercase tracking-wide text-[#054054]">Quando</span>
          <span class="block text-sm truncate" [class]="temQuando() ? 'text-[#054054] font-medium' : 'text-[#536B73]'">
            {{ resumoQuando() }}
          </span>
        </button>

        <!-- Quem -->
        <button
          #gatilhoQuem
          type="button"
          class="text-left pl-6 pr-4 py-3 rounded-full transition-colors border-l border-[#DCE6EA]"
          [class]="painel() === 'quem' ? 'bg-white shadow-md' : 'hover:bg-[#F0F5F6]'"
          [attr.aria-expanded]="painel() === 'quem'"
          aria-haspopup="dialog"
          (click)="alternarPainel('quem')"
        >
          <span class="block text-[10px] font-semibold uppercase tracking-wide text-[#054054]">Quem</span>
          <span class="block text-sm truncate" [class]="temQuem() ? 'text-[#054054] font-medium' : 'text-[#536B73]'">
            {{ resumoQuem() }}
          </span>
        </button>

        <!-- Buscar -->
        <div class="p-2">
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-full bg-[#054054] text-white font-semibold
                   hover:bg-[#0a5a73] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            [class]="painel() !== null ? 'px-6 py-3 text-sm' : 'w-11 h-11'"
            [disabled]="!state.prontoParaBuscar() || state.loading()"
            [attr.aria-label]="state.loading() ? 'Buscando…' : 'Buscar'"
            (click)="buscar.emit()"
          >
            <app-icon name="search" [size]="18" aria-hidden="true" />
            @if (painel() !== null) {
              <span>{{ state.loading() ? 'Buscando…' : 'Buscar' }}</span>
            }
          </button>
        </div>
      </div>

      <!-- Validação / prévia -->
      @if (state.validacaoRascunho(); as msg) {
        <p class="px-6 pt-2 text-xs text-[#9A3B3B]" role="status">{{ msg }}</p>
      } @else if (state.previaPeriodos(); as n) {
        <p class="px-6 pt-2 text-[11px] text-[#536B73]">
          A busca vai consultar {{ n }} {{ n === 1 ? 'período' : 'períodos' }}.
        </p>
      }

      <!-- Painéis ancorados -->
      @if (painel() === 'quando') {
        <div
          class="absolute z-50 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[min(92vw,700px)]
                 top-full mt-3 bg-white rounded-3xl border border-[#DCE6EA] shadow-2xl p-5 sm:p-6
                 max-h-[78vh] overflow-y-auto"
          role="dialog"
          aria-label="Escolher datas"
          (keydown.escape)="fecharPainel(true)"
        >
          <!-- Toggle Datas/Flexível (dentro do painel, padrão Airbnb) -->
          <div class="flex justify-center mb-5">
            <div class="inline-flex bg-[#E8F0F2] rounded-full p-1" role="tablist" aria-label="Modo de busca">
              @for (aba of abas; track aba.valor) {
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="state.mode() === aba.valor"
                  class="px-6 py-2 rounded-full text-sm font-medium transition-colors"
                  [class]="state.mode() === aba.valor ? 'bg-white text-[#054054] shadow-sm' : 'text-[#536B73] hover:text-[#054054]'"
                  (click)="state.mode.set(aba.valor)"
                >{{ aba.rotulo }}</button>
              }
            </div>
          </div>

          @if (state.mode() === 'dates') {
            <app-date-range-picker
              [(checkIn)]="state.checkIn"
              [(checkOut)]="state.checkOut"
              [hoje]="state.hoje()"
              [horizonte]="state.horizonte()"
            />
            <div class="mt-5">
              <app-tolerance-selector [(tolerance)]="state.tolerance" [noites]="noitesRascunho()" />
            </div>
          } @else {
            <app-flexible-stay-picker
              [(stayPreset)]="state.stayPreset"
              [(months)]="state.months"
              [hoje]="state.hoje()"
              [horizonte]="state.horizonte()"
            />
          }

          <div class="flex justify-between items-center mt-5 pt-4 border-t border-[#F0F5F6]">
            <button
              type="button"
              class="text-xs font-medium text-[#536B73] underline underline-offset-2 hover:text-[#054054]"
              (click)="limpar()"
            >Limpar</button>
            <button
              type="button"
              class="px-5 py-2 rounded-full bg-[#054054] text-white text-xs font-semibold hover:bg-[#0a5a73]"
              (click)="fecharPainel(true)"
            >Concluir</button>
          </div>
        </div>
      }

      @if (painel() === 'quem') {
        <div
          class="absolute z-50 right-4 sm:right-6 w-[min(92vw,380px)]
                 top-full mt-3 bg-white rounded-3xl border border-[#DCE6EA] shadow-2xl px-5 py-4"
          role="dialog"
          aria-label="Escolher hóspedes"
          (keydown.escape)="fecharPainel(true)"
        >
          <app-guest-selector [(guests)]="state.guests" />
          <div class="flex justify-between items-center mt-3 pt-3 border-t border-[#F0F5F6]">
            <button
              type="button"
              class="text-xs font-medium text-[#536B73] underline underline-offset-2 hover:text-[#054054]"
              (click)="limpar()"
            >Limpar</button>
            <button
              type="button"
              class="px-5 py-2 rounded-full bg-[#054054] text-white text-xs font-semibold hover:bg-[#0a5a73]"
              (click)="fecharPainel(true)"
            >Concluir</button>
          </div>
        </div>
      }
    </div>

    <!-- Click-catcher transparente (Airbnb não escurece a página) -->
    @if (painel() !== null) {
      <div class="fixed inset-0 z-40" aria-hidden="true" (click)="fecharPainel(false)"></div>
    }
  `,
  host: {
    '(document:keydown.escape)': 'fecharPainel(true)',
  },
})
export class SearchBarComponent {
  public readonly state = inject(SearchStateService);
  public readonly buscar = output<void>();

  protected readonly painel = signal<Painel>(null);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly abas = [
    { valor: 'dates' as const, rotulo: 'Datas' },
    { valor: 'flexible' as const, rotulo: 'Flexível' },
  ];

  protected alternarPainel(p: Exclude<Painel, null>): void {
    this.painel.update((atual) => (atual === p ? null : p));
  }

  protected fecharPainel(devolverFoco: boolean): void {
    const qual = this.painel();
    if (qual === null) return;
    this.painel.set(null);
    if (devolverFoco) {
      const ref = qual === 'quando' ? '#gatilhoQuando' : '#gatilhoQuem';
      (this.host.nativeElement.querySelector(ref) as HTMLElement | null)?.focus();
    }
  }

  protected limpar(): void {
    if (this.painel() === 'quando') {
      if (this.state.mode() === 'dates') {
        this.state.checkIn.set('');
        this.state.checkOut.set('');
        this.state.tolerance.set(0);
      } else {
        this.state.months.set([]);
        this.state.stayPreset.set('weekend');
      }
    } else {
      this.state.guests.set({ adults: 0, children: 0, infants: 0, pets: 0 });
    }
  }

  protected readonly noitesRascunho = computed(() => {
    const i = parseDate(this.state.checkIn());
    const f = parseDate(this.state.checkOut());
    return i && f ? diffDays(f, i) : null;
  });

  protected readonly temQuando = computed(
    () =>
      (this.state.mode() === 'dates' && Boolean(this.state.checkIn())) ||
      (this.state.mode() === 'flexible' && this.state.months().length > 0),
  );

  protected readonly temQuem = computed(() => {
    const g = this.state.guests();
    return g.adults + g.children + g.infants + g.pets > 0;
  });

  protected readonly resumoQuando = computed(() => {
    if (this.state.mode() === 'flexible') {
      const preset = this.state.stayPreset();
      const nome =
        preset === 'weekend' ? 'Um fim de semana' : preset === 'week' ? 'Uma semana' : 'Um mês';
      const n = this.state.months().length;
      if (n === 0) return this.temQuando() ? nome : 'Qualquer dia';
      return `${nome} · ${n} ${n === 1 ? 'mês' : 'meses'}`;
    }
    const i = parseDate(this.state.checkIn());
    const f = parseDate(this.state.checkOut());
    if (!i) return 'Insira as datas';
    if (!f) return `${diaCurto(i)} — saída`;
    const tol = this.state.tolerance();
    const margem = tol ? ` · ±${tol}d` : '';
    return `${diaCurto(i)} — ${diaCurto(f)}${margem}`;
  });

  protected readonly resumoQuem = computed(() => {
    const g = this.state.guests();
    const pessoas = g.adults + g.children;
    const partes: string[] = [];
    if (pessoas === 0 && g.infants === 0 && g.pets === 0) return 'Hóspedes?';
    if (pessoas > 0) partes.push(`${pessoas} ${pessoas === 1 ? 'hóspede' : 'hóspedes'}`);
    if (g.infants > 0) partes.push(`${g.infants} ${g.infants === 1 ? 'bebê' : 'bebês'}`);
    if (g.pets > 0) partes.push(`${g.pets} ${g.pets === 1 ? 'animal' : 'animais'}`);
    return partes.join(' · ');
  });
}

function diaCurto(c: { y: number; m: number; d: number }): string {
  return `${c.d} ${rotuloMes(c.m).slice(0, 3)}`;
}
