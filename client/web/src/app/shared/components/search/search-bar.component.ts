import { Component, computed, ElementRef, inject, output, signal } from '@angular/core';
import { SearchStateService } from '../../../core/services/search-state.service';
import { diffDays, parseDate } from '../../../core/services/search-periods';
import { DateRangePickerComponent, rotuloMes } from './date-range-picker.component';
import { DateToleranceSelectorComponent } from './date-tolerance-selector.component';
import { FlexibleStayPickerComponent } from './flexible-stay-picker.component';
import { GuestSelectorComponent } from './guest-selector.component';
import { IconComponent } from '../icons/icon.component';
import { StayPreset } from '../../../core/models/search.models';

type Painel = 'quando' | 'quem' | null;

const PRESETS: Record<StayPreset, { quando: string; curto: string }> = {
  weekend: { quando: 'Qualquer fim de semana', curto: 'Fim de semana' },
  week: { quando: 'Qualquer semana', curto: 'Semana' },
  month: { quando: 'Qualquer mês', curto: 'Mês' },
};

/**
 * Barra de pesquisa do motor — pílula compacta Quando/Quem/Buscar com
 * identidade Espírito do Mar (navy + dourado do sol, serif nos títulos).
 * Desktop: painel ancorado abaixo da barra. Mobile: bottom-sheet com
 * slide-up e área segura. Sem campo "Onde" — o destino é a pousada.
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
  styles: [
    `
      @keyframes search-sheet-up {
        from { transform: translateY(28px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes search-panel-drop {
        from { transform: translate(-50%, -6px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
      @keyframes search-panel-drop-right {
        from { transform: translateY(-6px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .search-sheet { animation: search-sheet-up 160ms ease-out; }
      .search-drop { animation: search-panel-drop 140ms ease-out; }
      .search-drop-quem { animation: search-panel-drop-right 140ms ease-out; }
      /* A regra editorial main div.bg-white.border tem especificidade
         maior que .rounded-full — a pílula precisa vencê-la. */
      .search-pill { border-radius: 9999px !important; }
    `,
  ],
  template: `
    <div class="relative w-full max-w-2xl sm:max-w-[880px] mx-auto px-4 sm:px-6">

      <!-- Pílula principal -->
      <div
        class="search-pill grid grid-cols-[1fr_1fr_auto] items-center rounded-full border shadow-raised transition-colors"
        [class]="painel() !== null ? 'bg-[#EEF3F5] border-[#DCE6EA]' : 'bg-white border-[#DCE6EA]'"
      >
        <!-- Quando -->
        <button
          id="search-gatilho-quando"
          type="button"
          class="min-w-0 text-left pl-5 sm:pl-8 pr-3 sm:pr-4 py-3.5 sm:py-4 rounded-lg transition-colors"
          [class]="painel() === 'quando' ? 'bg-white shadow-md' : 'hover:bg-[#F0F5F6]'"
          [attr.aria-expanded]="painel() === 'quando'"
          aria-haspopup="dialog"
          (click)="alternarPainel('quando')"
        >
          <span class="block text-xs font-semibold text-[#054054]">Quando</span>
          <span class="block text-base truncate" [class]="temQuando() ? 'text-[#054054] font-medium' : 'text-[#536B73]'">
            {{ resumoQuando() }}
          </span>
        </button>

        <!-- Quem -->
        <button
          id="search-gatilho-quem"
          type="button"
          class="min-w-0 text-left pl-5 sm:pl-8 pr-3 sm:pr-4 py-3.5 sm:py-4 rounded-lg transition-colors border-l border-[#DCE6EA]"
          [class]="painel() === 'quem' ? 'bg-white shadow-md' : 'hover:bg-[#F0F5F6]'"
          [attr.aria-expanded]="painel() === 'quem'"
          aria-haspopup="dialog"
          (click)="alternarPainel('quem')"
        >
          <span class="block text-xs font-semibold text-[#054054]">Quem</span>
          <span class="block text-base truncate" [class]="temQuem() ? 'text-[#054054] font-medium' : 'text-[#536B73]'">
            {{ resumoQuem() }}
          </span>
        </button>

        <!-- Buscar — navy com lupa dourada (sol do logotipo) -->
        <div class="p-2 sm:p-2.5">
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-full bg-[#054054] text-white font-semibold hover:bg-[#032B38] transition disabled:opacity-40 disabled:cursor-not-allowed"
            [class]="painel() !== null
              ? 'w-12 h-12 sm:w-auto sm:h-auto sm:px-7 sm:py-3.5 sm:text-[15px]'
              : 'w-12 h-12 sm:w-[52px] sm:h-[52px]'"
            [disabled]="!state.prontoParaBuscar() || state.loading()"
            [attr.aria-label]="state.loading() ? 'Buscando…' : 'Buscar'"
            (click)="buscar.emit()"
          >
            <span class="text-[#8A5A1E]"><app-icon name="search" [size]="20" aria-hidden="true" /></span>
            @if (painel() !== null) {
              <span class="hidden sm:inline">{{ state.loading() ? 'Buscando…' : 'Buscar' }}</span>
            }
          </button>
        </div>
      </div>

      <!-- Validação / prévia -->
      @if (state.validacaoVisivel(); as msg) {
        <p class="px-6 pt-2 text-xs text-[#9A3B3B]" role="status">{{ msg }}</p>
      } @else if (state.previaVisivel(); as n) {
        <p class="px-6 pt-2 text-xs text-[#536B73]">
          A busca vai consultar {{ n }} {{ n === 1 ? 'período' : 'períodos' }}.
        </p>
      }

      <!-- Painel Quando: ancorado no desktop, bottom-sheet no mobile -->
      @if (painel() === 'quando') {
        <div
          class="search-sheet sm:search-drop fixed sm:absolute z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(92vw,700px)] sm:top-full sm:mt-3 bg-white rounded-t-3xl sm:rounded-3xl border-t sm:border border-[#DCE6EA] shadow-overlay sm:shadow-2xl px-5 pt-3 pb-5 sm:p-6 max-h-[88vh] sm:max-h-[78vh] overflow-y-auto"
          role="dialog"
          aria-label="Escolher datas"
          (keydown.escape)="fecharPainel(true)"
        >
          <!-- Handle mobile -->
          <div class="sm:hidden flex justify-center pb-2" aria-hidden="true">
            <span class="w-10 h-1 rounded-full bg-[#DCE6EA]"></span>
          </div>

          <!-- Toggle Datas/Flexível (dentro do painel) -->
          <div class="flex justify-center mb-5">
            <div class="inline-flex bg-[#EEF3F5] rounded-lg p-1" role="tablist" aria-label="Modo de busca">
              @for (aba of abas; track aba.valor) {
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="state.mode() === aba.valor"
                  class="px-6 py-2 rounded-lg text-sm font-medium transition-colors"
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

          <div class="flex justify-between items-center mt-5 pt-4 border-t border-[#F0F5F6] pb-[env(safe-area-inset-bottom)]">
            <button
              type="button"
              class="text-xs font-medium text-[#536B73] underline underline-offset-2 hover:text-[#054054]"
              (click)="limpar()"
            >Limpar</button>
            <button
              type="button"
              class="px-5 py-2 rounded-lg bg-[#054054] text-white text-xs font-semibold hover:bg-[#032B38]"
              (click)="fecharPainel(true)"
            >Concluir</button>
          </div>
        </div>
      }

      <!-- Painel Quem: dropdown à direita no desktop, bottom-sheet no mobile -->
      @if (painel() === 'quem') {
        <div
          class="search-sheet sm:search-drop-quem fixed sm:absolute z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:right-6 sm:w-[380px] sm:top-full sm:mt-3 bg-white rounded-t-3xl sm:rounded-3xl border-t sm:border border-[#DCE6EA] shadow-overlay sm:shadow-2xl px-5 pt-3 pb-4"
          role="dialog"
          aria-label="Escolher hóspedes"
          (keydown.escape)="fecharPainel(true)"
        >
          <div class="sm:hidden flex justify-center pb-2" aria-hidden="true">
            <span class="w-10 h-1 rounded-full bg-[#DCE6EA]"></span>
          </div>
          <app-guest-selector [(guests)]="state.guests" />
          <div class="flex justify-between items-center mt-3 pt-3 border-t border-[#F0F5F6] pb-[env(safe-area-inset-bottom)]">
            <button
              type="button"
              class="text-xs font-medium text-[#536B73] underline underline-offset-2 hover:text-[#054054]"
              (click)="limpar()"
            >Limpar</button>
            <button
              type="button"
              class="px-5 py-2 rounded-lg bg-[#054054] text-white text-xs font-semibold hover:bg-[#032B38]"
              (click)="fecharPainel(true)"
            >Concluir</button>
          </div>
        </div>
      }
    </div>

    <!-- Click-catcher transparente (sem escurecer a página) -->
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
      const ref = qual === 'quando' ? '#search-gatilho-quando' : '#search-gatilho-quem';
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
      this.state.mode() === 'flexible',
  );

  protected readonly temQuem = computed(() => {
    const g = this.state.guests();
    return g.adults + g.children + g.infants + g.pets > 0;
  });

  protected readonly resumoQuando = computed(() => {
    if (this.state.mode() === 'flexible') {
      const preset = PRESETS[this.state.stayPreset()];
      const meses = this.state.months();
      if (meses.length === 0) return preset.quando;
      const nomes = meses.slice(0, 3).map((k) => rotuloMes(Number(k.slice(5))).slice(0, 3));
      const extra = meses.length > 3 ? ` +${meses.length - 3}` : '';
      return `${preset.curto} · ${nomes.join(', ')}${extra}`;
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
