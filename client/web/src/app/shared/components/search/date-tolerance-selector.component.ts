import { Component, computed, input, model } from '@angular/core';
import { ToleranceDays } from '../../../core/models/search.models';
import { TOLERANCIAS } from '../../../core/services/search-periods';

interface Opcao {
  valor: ToleranceDays;
  rotulo: string;
}

@Component({
  selector: 'app-tolerance-selector',
  template: `
    <fieldset>
      <legend class="type-eyebrow text-[10px] text-[#536B73] mb-2">Margem de datas</legend>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Margem de dias ao redor das datas">
        @for (op of opcoes; track op.valor) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="tolerance() === op.valor"
            class="px-3.5 py-1.5 rounded-full border text-xs font-medium transition-colors"
            [class]="tolerance() === op.valor
              ? 'bg-[#054054] border-[#054054] text-white'
              : 'border-[#B9CBD3] text-[#054054] hover:border-[#054054]'"
            (click)="tolerance.set(op.valor)"
          >{{ op.rotulo }}</button>
        }
      </div>
      @if (ajuda()) {
        <p class="mt-2 text-[11px] text-[#536B73]" aria-live="polite">{{ ajuda() }}</p>
      }
    </fieldset>
  `,
})
export class DateToleranceSelectorComponent {
  public readonly tolerance = model.required<ToleranceDays>();
  /** Noites do intervalo-base — alimenta a ajuda contextual. */
  public readonly noites = input<number | null>(null);

  public readonly opcoes: Opcao[] = TOLERANCIAS.map((v) => ({
    valor: v,
    rotulo: v === 0 ? 'Datas exatas' : `± ${v} ${v === 1 ? 'dia' : 'dias'}`,
  }));

  public readonly ajuda = computed<string | null>(() => {
    const t = this.tolerance();
    if (t === 0) return null;
    const n = this.noites();
    const trechoNoites = n ? `, mantendo ${n} ${n === 1 ? 'noite' : 'noites'}` : '';
    return `Buscaremos também entradas até ${t} ${t === 1 ? 'dia' : 'dias'} antes ou depois${trechoNoites}.`;
  });
}
