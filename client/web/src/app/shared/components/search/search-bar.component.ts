import { Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { SearchStateService } from '../../../core/services/search-state.service';
import { diffDays, parseDate } from '../../../core/services/search-periods';
import { DateRangePickerComponent, rotuloMes } from './date-range-picker.component';
import { DateToleranceSelectorComponent } from './date-tolerance-selector.component';
import { FlexibleStayPickerComponent } from './flexible-stay-picker.component';
import { GuestSelectorComponent } from './guest-selector.component';

type Painel = 'quando' | 'quem' | null;

/**
 * Barra de pesquisa do motor — abas Datas/Flexível, popovers Quando e
 * Quem, resumo da seleção e ação Buscar. Todo o estado vive em
 * `SearchStateService` (rascunho × consulta aplicada separados).
 */
@Component({
  selector: 'app-search-bar',
  imports: [
    DateRangePickerComponent,
    DateToleranceSelectorComponent,
    FlexibleStayPickerComponent,
    GuestSelectorComponent,
  ],
  template: `
    <div class="w-full max-w-5xl mx-auto px-4 sm:px-6">
      <div class="bg-white border border-[#DCE6EA] rounded-2xl shadow-[0_12px_32px_rgba(5,64,84,0.08)]">

        <!-- Abas -->
        <div class="flex border-b border-[#E8F0F2] px-3 pt-3 gap-1" role="tablist" aria-label="Modo de busca">
          @for (aba of abas; track aba.valor) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="state.mode() === aba.valor"
              class="px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors"
              [class]="state.mode() === aba.valor
                ? 'border-[#054054] text-[#054054]'
                : 'border-transparent text-[#536B73] hover:text-[#054054]'"
              (click)="state.mode.set(aba.valor)"
            >{{ aba.rotulo }}</button>
          }
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] divide-y sm:divide-y-0 sm:divide-x divide-[#E8F0F2]">
          <!-- Quando -->
          <div class="relative">
            <button
              #gatilhoQuando
              type="button"
              class="w-full text-left px-5 py-4 hover:bg-[#F4F8F9] transition-colors"
              [attr.aria-expanded]="painel() === 'quando'"
              aria-haspopup="dialog"
              (click)="alternarPainel('quando')"
            >
              <span class="type-eyebrow block text-[10px] text-[#536B73] mb-1">Quando</span>
              <span class="block text-sm font-medium text-[#054054]">{{ resumoQuando() }}</span>
            </button>
          </div>

          <!-- Quem -->
          <div class="relative">
            <button
              #gatilhoQuem
              type="button"
              class="w-full text-left px-5 py-4 hover:bg-[#F4F8F9] transition-colors"
              [attr.aria-expanded]="painel() === 'quem'"
              aria-haspopup="dialog"
              (click)="alternarPainel('quem')"
            >
              <span class="type-eyebrow block text-[10px] text-[#536B73] mb-1">Quem</span>
              <span class="block text-sm font-medium text-[#054054]">{{ resumoQuem() }}</span>
            </button>
          </div>

          <!-- Buscar -->
          <div class="flex items-center px-4 py-3">
            <button
              type="button"
              class="w-full sm:w-auto px-8 py-3 rounded-full bg-[#054054] text-white text-sm font-semibold
                     hover:bg-[#0a5a73] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              [disabled]="!state.prontoParaBuscar() || state.loading()"
              (click)="buscar.emit()"
            >
              @if (state.loading()) { Buscando… } @else { Buscar }
            </button>
          </div>
        </div>

        <!-- Validação -->
        @if (state.validacaoRascunho(); as msg) {
          <p class="px-5 pb-3 text-xs text-[#9A3B3B]" role="status">{{ msg }}</p>
        } @else if (state.previaPeriodos(); as n) {
          <p class="px-5 pb-3 text-[11px] text-[#536B73]">
            A busca vai consultar {{ n }} {{ n === 1 ? 'período' : 'períodos' }}.
          </p>
        }
      </div>
    </div>

    <!-- Backdrop + painéis -->
    @if (painel() !== null) {
      <div class="fixed inset-0 z-40 bg-[#054054]/20" aria-hidden="true" (click)="fecharPainel(false)"></div>
      <div
        class="fixed z-50 inset-x-4 top-24 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(92vw,680px)]
               bg-white border border-[#DCE6EA] rounded-2xl shadow-2xl p-5 max-h-[75vh] overflow-y-auto"
        role="dialog"
        [attr.aria-label]="painel() === 'quando' ? 'Escolher datas' : 'Escolher hóspedes'"
        (keydown.escape)="fecharPainel(true)"
      >
        @if (painel() === 'quando') {
          @if (state.mode() === 'dates') {
            <app-date-range-picker
              [(checkIn)]="state.checkIn"
              [(checkOut)]="state.checkOut"
              [hoje]="state.hoje()"
              [horizonte]="state.horizonte()"
            />
            <div class="mt-4 pt-4 border-t border-[#E8F0F2]">
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
        } @else {
          <app-guest-selector [(guests)]="state.guests" />
        }

        <div class="flex justify-between items-center mt-4 pt-4 border-t border-[#E8F0F2]">
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
  `,
  host: {
    '(document:keydown.escape)': 'fecharPainel(true)',
  },
})
export class SearchBarComponent {
  public readonly state = inject(SearchStateService);
  public readonly buscar = output<void>();

  protected readonly painel = signal<Painel>(null);
  protected readonly picker = viewChild(DateRangePickerComponent);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly abas = [
    { valor: 'dates' as const, rotulo: 'Datas' },
    { valor: 'flexible' as const, rotulo: 'Flexível' },
  ];

  protected alternarPainel(p: Exclude<Painel, null>): void {
    this.painel.update((atual) => (atual === p ? null : p));
    if (this.painel() === 'quando') {
      // Sincroniza a janela do calendário com o rascunho atual.
      setTimeout(() => this.picker()?.sincronizarJanela());
    }
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

  protected readonly resumoQuando = computed(() => {
    if (this.state.mode() === 'flexible') {
      const preset = this.state.stayPreset();
      const nome =
        preset === 'weekend' ? 'Um fim de semana' : preset === 'week' ? 'Uma semana' : 'Um mês';
      const n = this.state.months().length;
      return n === 0 ? nome : `${nome} · ${n} ${n === 1 ? 'mês' : 'meses'}`;
    }
    const i = parseDate(this.state.checkIn());
    const f = parseDate(this.state.checkOut());
    if (!i) return 'Escolha as datas';
    if (!f) return `${diaCurto(i)} — saída`;
    const tol = this.state.tolerance();
    const margem = tol ? ` · ±${tol}d` : '';
    return `${diaCurto(i)} — ${diaCurto(f)}${margem}`;
  });

  protected readonly resumoQuem = computed(() => {
    const g = this.state.guests();
    const pessoas = g.adults + g.children;
    const partes: string[] = [];
    if (pessoas === 0 && g.infants === 0 && g.pets === 0) return 'Quem viaja?';
    if (pessoas > 0) partes.push(`${pessoas} ${pessoas === 1 ? 'hóspede' : 'hóspedes'}`);
    if (g.infants > 0) partes.push(`${g.infants} ${g.infants === 1 ? 'bebê' : 'bebês'}`);
    if (g.pets > 0) partes.push(`${g.pets} ${g.pets === 1 ? 'animal' : 'animais'}`);
    return partes.join(' · ');
  });
}

function diaCurto(c: { y: number; m: number; d: number }): string {
  return `${c.d} ${rotuloMes(c.m).slice(0, 3)}`;
}
