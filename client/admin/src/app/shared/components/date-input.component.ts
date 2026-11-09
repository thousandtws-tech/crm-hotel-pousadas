import { Component, Injectable, computed, effect, forwardRef, input, output, signal } from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  DateAdapter,
  MAT_DATE_FORMATS,
  MAT_DATE_LOCALE,
  MatDateFormats,
  NativeDateAdapter,
} from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';

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
class BrDateAdapter extends NativeDateAdapter {
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

const BR_FORMATS: MatDateFormats = {
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
@Component({
  selector: 'app-date',
  imports: [ReactiveFormsModule, MatDatepickerModule, MatIconModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputComponent), multi: true },
    { provide: MAT_DATE_LOCALE, useValue: 'pt-BR' },
    { provide: DateAdapter, useClass: BrDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: BR_FORMATS },
  ],
  template: `
    <div class="dw">
      <input
        class="input-inn dw-txt"
        type="text"
        inputmode="numeric"
        placeholder="dd/mm/aaaa"
        [attr.aria-label]="rotulo()"
        [matDatepicker]="dp"
        [formControl]="ctrl"
        [min]="minDate()"
        [max]="maxDate()"
        (input)="mascarar($event)"
        (blur)="toque()"
      />
      <button
        type="button"
        class="dw-btn"
        (click)="dp.open()"
        [disabled]="desabilitado()"
        tabindex="-1"
        aria-label="Abrir calendário"
      >
        <mat-icon>calendar_month</mat-icon>
      </button>
      <mat-datepicker #dp />
    </div>
  `,
  styles: `
    .dw { position: relative; display: flex; }
    .dw-txt { width: 100%; padding-right: 36px; }
    .dw-btn {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 28px; height: 28px; padding: 0;
      border: 0; background: transparent; border-radius: 6px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #5d6d7e; cursor: pointer;
    }
    .dw-btn:hover { background: rgba(0, 0, 0, 0.06); color: #054054; }
    .dw-btn:disabled { cursor: default; opacity: 0.5; }
    .dw-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class DateInputComponent implements ControlValueAccessor {
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly rotulo = input<string | null>(null);
  readonly alterar = output<string>();

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
      d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
      : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}`
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
