// Lógica e estado de date-input — separada da camada de UI (date-input.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { Injectable, computed, effect, signal } from '@angular/core';
import { ControlValueAccessor, FormControl } from '@angular/forms';
import { MatDateFormats, NativeDateAdapter } from '@angular/material/core';
import type { InputSignal, OutputEmitterRef, Signal } from '@angular/core';
import { Directive } from '@angular/core';

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** ISO "yyyy-mm-dd" → Date local (sem fuso: evita o dia "voltar" um). */
function isoParaDate(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function dateParaIso(d: Date | null): string | null {
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
}

/** Adapter nativo com parse/format brasileiro dd/mm/aaaa. */
@Injectable()
export class BrDateAdapter extends NativeDateAdapter {
  override parse(value: unknown): Date | null {
    if (value instanceof Date) return value;
    const d = String(value ?? '').replace(/\D/g, '');
    if (d.length !== 8) return null;
    const day = +d.slice(0, 2);
    const month = +d.slice(2, 4);
    const year = +d.slice(4);
    const dt = new Date(year, month - 1, day);
    return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day
      ? dt
      : this.invalid();
  }

  override format(date: Date, displayFormat: object): string {
    if ((displayFormat as { br?: boolean }).br) {
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    }
    return super.format(date, displayFormat);
  }

  override getFirstDayOfWeek(): number {
    return 0;
  }
}

export const BR_FORMATS: MatDateFormats = {
  parse: { dateInput: { br: true } },
  display: {
    dateInput: { br: true },
    monthYearLabel: { year: 'numeric', month: 'short' },
    dateA11yLabel: { year: 'numeric', month: 'long', day: 'numeric' },
    monthYearA11yLabel: { year: 'numeric', month: 'long' },
  },
};

/**
 * Campo de data dd/mm/aaaa com o calendário do Angular Material.
 * Digitação com máscara automática; ícone abre o popup. Integra com reactive
 * forms (CVA) e aceita uso simples via [value]/(alterar). Valor: ISO ou null.
 */
@Directive()
export abstract class DateInputStore implements ControlValueAccessor {
  declare protected readonly value: InputSignal<string | null>;
  declare protected readonly min: InputSignal<string | null>;
  declare protected readonly max: InputSignal<string | null>;
  declare protected readonly rotulo: InputSignal<string | null>;
  declare protected readonly alterar: OutputEmitterRef<string>;

  protected readonly ctrl = new FormControl<Date | null>(null);
  protected readonly desabilitado = signal(false);
  protected readonly minDate = computed(() => isoParaDate(this.min()));
  protected readonly maxDate = computed(() => isoParaDate(this.max()));
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => this.writeValue(this.value()));
    this.ctrl.valueChanges.subscribe((d) => this.alterar.emit(this.iso(d) ?? ''));
  }

  writeValue(v: string | null): void {
    if (v !== this.iso(this.ctrl.value)) this.ctrl.setValue(isoParaDate(v), { emitEvent: false });
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.ctrl.valueChanges.subscribe((d) => fn(this.iso(d)));
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.desabilitado.set(d);
    if (d) this.ctrl.disable({ emitEvent: false });
    else this.ctrl.enable({ emitEvent: false });
  }

  /** Máscara dd/mm/aaaa durante a digitação; o parse é do BrDateAdapter. */
  protected mascarar(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    const m =
      d.length > 4
        ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
        : d.length > 2
          ? `${d.slice(0, 2)}/${d.slice(2)}`
          : d;
    if (el.value !== m) el.value = m;
  }

  protected toque(): void {
    this.onTouched();
  }

  /** Datas inválidas (digitação incompleta) viram null para o form. */
  private iso(d: Date | null): string | null {
    return d && !isNaN(d.getTime()) ? dateParaIso(d) : null;
  }
}
