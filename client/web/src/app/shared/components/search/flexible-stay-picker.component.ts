import { Component, computed, input, model, signal } from '@angular/core';
import { StayPreset } from '../../../core/models/search.models';
import { addCalendarMonths, CivilDate, compareDates } from '../../../core/services/search-periods';
import { rotuloMes } from './date-range-picker.component';
import { IconComponent } from '../icons/icon.component';

interface Preset {
  valor: StayPreset;
  titulo: string;
  ariaDescricao: string;
}

interface CartaoMes {
  chave: string; // 'YYYY-MM'
  rotulo: string;
  ano: number;
  selecionado: boolean;
}

const CARTOES_POR_JANELA = 6;

@Component({
  selector: 'app-flexible-stay-picker',
  imports: [IconComponent],
  template: `
    <h3 class="font-serif text-center text-xl text-[#054054] mb-3">
      Por quanto tempo você gostaria de ficar?
    </h3>
    <div class="flex justify-center flex-wrap gap-2 mb-7" role="radiogroup" aria-label="Duração da estadia">
      @for (p of presets; track p.valor) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="stayPreset() === p.valor"
          [attr.aria-label]="p.titulo + ' — ' + p.ariaDescricao"
          class="px-5 py-2.5 rounded-full border text-sm transition-colors"
          [class]="stayPreset() === p.valor
            ? 'border-2 border-[#054054] bg-[#EEF4F6] text-[#054054] font-semibold shadow-sm'
            : 'border-[#DCE6EA] text-[#054054] hover:border-[#4B95AB]'"
          (click)="stayPreset.set(p.valor)"
        >{{ p.titulo }}</button>
      }
    </div>

    <h3 class="font-serif text-center text-xl text-[#054054] mb-3">Quando você quer ir?</h3>
    <div class="flex items-center justify-between mb-2" aria-live="polite">
      <button
        type="button"
        class="w-9 h-9 rounded-full border border-[#DCE6EA] text-[#054054] text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#4B95AB] hover:bg-[#EEF4F6] transition-colors"
        [disabled]="janela() === 0"
        aria-label="Meses anteriores"
        (click)="janela.set(janela() - 1)"
      >‹</button>
      <span class="text-[11px] text-[#536B73]">
        {{ mesesSelecionados() === 0
          ? 'Selecione um ou mais meses de entrada'
          : mesesSelecionados() + (mesesSelecionados() === 1 ? ' mês selecionado' : ' meses selecionados') }}
      </span>
      <button
        type="button"
        class="w-9 h-9 rounded-full border border-[#DCE6EA] text-[#054054] text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#4B95AB] hover:bg-[#EEF4F6] transition-colors"
        [disabled]="(janela() + 1) * CARTOES >= todos().length"
        aria-label="Meses seguintes"
        (click)="janela.set(janela() + 1)"
      >›</button>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3" role="group" aria-label="Meses disponíveis">
      @for (c of cartoesVisiveis(); track c.chave) {
        <button
          type="button"
          [attr.aria-pressed]="c.selecionado"
          class="rounded-2xl border p-4 flex flex-col items-start gap-2 transition-colors"
          [class]="c.selecionado
            ? 'border-2 border-[#054054] bg-[#EEF4F6] text-[#054054] shadow-sm'
            : 'border-[#DCE6EA] text-[#054054] hover:border-[#4B95AB]'"
          (click)="alternar(c.chave)"
        >
          <span [class]="c.selecionado ? 'text-[#1A6F8A]' : 'text-[#8BA0A8]'">
            <app-icon name="calendar" [size]="22" aria-hidden="true" />
          </span>
          <span class="text-left">
            <span class="font-serif block text-lg leading-tight">{{ c.rotulo }}</span>
            <span class="block text-[11px] text-[#536B73]">{{ c.ano }}</span>
          </span>
        </button>
      }
    </div>
    <p class="mt-3 text-[11px] text-center text-[#536B73]">
      {{ descricaoPreset() }}
    </p>
  `,
})
export class FlexibleStayPickerComponent {
  public readonly stayPreset = model.required<StayPreset>();
  /** Chaves 'YYYY-MM' selecionadas — [(months)] no pai. */
  public readonly months = model.required<string[]>();
  public readonly hoje = input.required<CivilDate>();
  public readonly horizonte = input.required<CivilDate>();

  protected readonly CARTOES = CARTOES_POR_JANELA;
  /** Janela de visualização (página de cartões) — não é limite do motor. */
  protected readonly janela = signal(0);

  public readonly presets: Preset[] = [
    { valor: 'weekend', titulo: 'Um fim de semana', ariaDescricao: 'sexta a domingo, 2 noites' },
    { valor: 'week', titulo: 'Uma semana', ariaDescricao: '7 noites a partir de cada entrada' },
    { valor: 'month', titulo: 'Um mês', ariaDescricao: 'um mês calendário por entrada' },
  ];

  protected readonly descricaoPreset = computed(() => {
    switch (this.stayPreset()) {
      case 'weekend':
        return 'Entradas às sextas-feiras, saída no domingo — 2 noites por período.';
      case 'week':
        return 'Qualquer dia de entrada dentro dos meses — 7 noites por período.';
      case 'month':
        return 'Um mês calendário por entrada — a saída ajusta ao último dia válido do mês seguinte.';
    }
  });

  /** Todos os meses elegíveis: mês corrente até o horizonte. */
  protected readonly todos = computed<CivilDate[]>(() => {
    const lista: CivilDate[] = [];
    let m = { y: this.hoje().y, m: this.hoje().m, d: 1 };
    while (compareDates(m, this.horizonte()) <= 0) {
      lista.push(m);
      m = addCalendarMonths(m, 1);
    }
    return lista;
  });

  protected readonly cartoesVisiveis = computed<CartaoMes[]>(() => {
    const selecionados = new Set(this.months());
    const inicio = this.janela() * CARTOES_POR_JANELA;
    return this.todos()
      .slice(inicio, inicio + CARTOES_POR_JANELA)
      .map((m) => ({
        chave: chaveMes(m),
        rotulo: rotuloMes(m.m),
        ano: m.y,
        selecionado: selecionados.has(chaveMes(m)),
      }));
  });

  protected readonly mesesSelecionados = computed(() => this.months().length);

  protected alternar(chave: string): void {
    this.months.update((atual) =>
      atual.includes(chave) ? atual.filter((m) => m !== chave) : [...atual, chave].sort(),
    );
  }
}

export function chaveMes(m: CivilDate): string {
  return `${m.y}-${String(m.m).padStart(2, '0')}`;
}
