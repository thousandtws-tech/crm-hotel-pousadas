import { Component, computed, model } from '@angular/core';
import { GuestsDraft } from '../../../core/models/search.models';
import { MAX_PESSOAS } from '../../../core/services/search-periods';

interface GuestRow {
  key: keyof GuestsDraft;
  titulo: string;
  descricao: string;
  contaComoPessoa: boolean;
}

const MAX_PETS = MAX_PESSOAS; // teto coerente com a política de pessoas

@Component({
  selector: 'app-guest-selector',
  template: `
    <div role="group" aria-label="Composição de hóspedes" class="divide-y divide-[#E8F0F2]">
      @for (row of rows; track row.key) {
        <div class="flex items-center justify-between gap-4 py-3.5">
          <div>
            <p class="text-sm font-medium text-[#054054]">{{ row.titulo }}</p>
            <p class="text-xs text-[#536B73]">{{ row.descricao }}</p>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="w-10 h-10 rounded-full border border-[#CBD7DC] text-[#054054] text-xl leading-none disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#4B95AB] hover:bg-[#EEF4F6] transition-colors"
              [disabled]="valor(row.key) <= 0"
              [attr.aria-label]="'Remover ' + row.titulo.toLowerCase()"
              (click)="alterar(row, -1)"
            >−</button>
            <span class="w-6 text-center text-sm font-semibold text-[#054054]" aria-live="polite">
              {{ valor(row.key) }}
            </span>
            <button
              type="button"
              class="w-10 h-10 rounded-full border border-[#CBD7DC] text-[#054054] text-xl leading-none disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#4B95AB] hover:bg-[#EEF4F6] transition-colors"
              [disabled]="!podeAdicionar(row)"
              [attr.aria-label]="'Adicionar ' + row.titulo.toLowerCase()"
              (click)="alterar(row, 1)"
            >+</button>
          </div>
        </div>
      }
      <p class="pt-2 text-xs text-[#536B73]">
        Bebês contam na capacidade da acomodação. Animais não contam como pessoas —
        a política pet é confirmada com a recepção.
      </p>
    </div>
  `,
})
export class GuestSelectorComponent {
  /** Rascunho editável — [(guests)] no pai. */
  public readonly guests = model.required<GuestsDraft>();

  public readonly rows: GuestRow[] = [
    { key: 'adults', titulo: 'Adultos', descricao: '13 anos ou mais', contaComoPessoa: true },
    { key: 'children', titulo: 'Crianças', descricao: 'De 2 a 12 anos', contaComoPessoa: true },
    { key: 'infants', titulo: 'Bebês', descricao: 'Menor de 2 anos', contaComoPessoa: true },
    { key: 'pets', titulo: 'Animais de estimação', descricao: 'Contagem separada de pessoas', contaComoPessoa: false },
  ];

  private readonly pessoas = computed(
    () => this.guests().adults + this.guests().children + this.guests().infants,
  );

  public valor(key: keyof GuestsDraft): number {
    return this.guests()[key];
  }

  public podeAdicionar(row: GuestRow): boolean {
    return row.contaComoPessoa ? this.pessoas() < MAX_PESSOAS : this.guests().pets < MAX_PETS;
  }

  public alterar(row: GuestRow, delta: number): void {
    this.guests.update((g) => {
      const proximo = g[row.key] + delta;
      if (proximo < 0) return g;
      if (row.contaComoPessoa && this.pessoas() + delta > MAX_PESSOAS) return g;
      if (!row.contaComoPessoa && proximo > MAX_PETS) return g;
      return { ...g, [row.key]: proximo };
    });
  }
}
