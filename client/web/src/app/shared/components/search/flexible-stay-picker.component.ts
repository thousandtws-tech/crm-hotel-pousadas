import { Component, computed, input, model, signal } from '@angular/core';
import { StayPreset } from '../../../core/models/search.models';
import { addCalendarMonths, CivilDate, compareDates } from '../../../core/services/search-periods';
import { rotuloMes } from './date-range-picker.component';

interface Preset {
  valor: StayPreset;
  titulo: string;
  descricao: string;
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
  template: `
    <fieldset class="mb-4">
      <legend class="type-eyebrow text-[10px] text-[#536B73] mb-2">Duração da estadia</legend>
      <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Duração da estadia">
        @for (p of presets; track p.valor) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="stayPreset() === p.valor"
            class="rounded-xl border p-3 text-left transition-colors"
            [class]="stayPreset() === p.valor
              ? 'bg-[#054054] border-[#054054] text-white'
              : 'border-[#DCE6EA] text-[#054054] hover:border-[#054054]'"
            (click)="stayPreset.set(p.valor)"
          >
            <span class="block text-sm font-semibold">{{ p.titulo }}</span>
            <span class="block text-[11px] mt-0.5" [class]="stayPreset() === p.valor ? 'text-white/80' : 'text-[#536B73]'">
              {{ p.descricao }}
            </span>
          </button>
        }
      </div>
    </fieldset>

    <fieldset>
      <legend class="type-eyebrow text-[10px] text-[#536B73] mb-2">
        Meses de entrada — selecione um ou mais
      </legend>
      <div class="flex items-center justify-between mb-2">
        <button
          type="button"
          class="w-7 h-7 rounded-full border border-[#B9CBD3] text-[#054054] disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#054054]"
          [disabled]="janela() === 0"
          aria-label="Meses anteriores"
          (click)="janela.set(janela() - 1)"
        >‹</button>
        <span class="text-[11px] text-[#536B73]">
          {{ mesesSelecionados() === 0
            ? 'Nenhum mês selecionado'
            : mesesSelecionados() + (mesesSelecionados() === 1 ? ' mês selecionado' : ' meses selecionados') }}
        </span>
        <button
          type="button"
          class="w-7 h-7 rounded-full border border-[#B9CBD3] text-[#054054] disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#054054]"
          [disabled]="(janela() + 1) * CARTOES >= todos().length"
          aria-label="Meses seguintes"
          (click)="janela.set(janela() + 1)"
        >›</button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="Meses disponíveis">
        @for (c of cartoesVisiveis(); track c.chave) {
          <button
            type="button"
            [attr.aria-pressed]="c.selecionado"
            class="rounded-xl border p-3 text-left transition-colors"
            [class]="c.selecionado
              ? 'bg-[#054054] border-[#054054] text-white'
              : 'border-[#DCE6EA] text-[#054054] hover:border-[#054054]'"
            (click)="alternar(c.chave)"
          >
            <span class="block text-sm font-semibold capitalize">{{ c.rotulo }}</span>
            <span class="block text-[11px] mt-0.5" [class]="c.selecionado ? 'text-white/80' : 'text-[#536B73]'">
              {{ c.ano }}
            </span>
          </button>
        }
      </div>
      <p class="mt-2 text-[11px] text-[#536B73]">
        A saída pode cair no mês seguinte — cada período é validado no servidor.
      </p>
    </fieldset>
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
    { valor: 'weekend', titulo: 'Um fim de semana', descricao: 'Sexta a domingo · 2 noites' },
    { valor: 'week', titulo: 'Uma semana', descricao: '7 noites a partir de cada entrada' },
    { valor: 'month', titulo: 'Um mês', descricao: 'Um mês calendário por entrada' },
  ];

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
