import { Component, Injectable, effect, forwardRef, input, output, signal } from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  NgbDateAdapter,
  NgbDateParserFormatter,
  NgbDatepickerI18n,
  NgbDatepickerModule,
  NgbDateStruct,
} from '@ng-bootstrap/ng-bootstrap';
import { MatIconModule } from '@angular/material/icon';

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

function isoParaStruct(iso: string | null | undefined): NgbDateStruct | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}

/** Modelo do form continua sendo ISO "yyyy-mm-dd" — o backend não muda. */
@Injectable()
class IsoDateAdapter extends NgbDateAdapter<string> {
  fromModel(value: string | null): NgbDateStruct | null {
    return isoParaStruct(value);
  }
  toModel(date: NgbDateStruct | null): string | null {
    return date ? `${date.year}-${pad(date.month)}-${pad(date.day)}` : null;
  }
}

/** Exibe e aceita digitação no formato brasileiro dd/mm/aaaa. */
@Injectable()
class BrDateFormatter extends NgbDateParserFormatter {
  parse(value: string | null): NgbDateStruct | null {
    const d = (value ?? '').replace(/\D/g, '');
    if (d.length !== 8) return null;
    const day = +d.slice(0, 2);
    const month = +d.slice(2, 4);
    const year = +d.slice(4);
    const dt = new Date(year, month - 1, day);
    return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day
      ? { day, month, year }
      : null;
  }
  format(date: NgbDateStruct | null): string {
    return date ? `${pad(date.day)}/${pad(date.month)}/${date.year}` : '';
  }
}

const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

@Injectable()
class PtBrDatepickerI18n extends NgbDatepickerI18n {
  getWeekdayLabel(weekday: number): string {
    return DIAS_CURTOS[weekday - 1];
  }
  getMonthShortName(month: number): string {
    return MESES_CURTOS[month - 1];
  }
  getMonthFullName(month: number): string {
    return MESES[month - 1];
  }
  getDayAriaLabel(date: NgbDateStruct): string {
    return `${date.day}/${date.month}/${date.year}`;
  }
}

/**
 * Campo de data dd/mm/aaaa com o calendário do ng-bootstrap (ngbDatepicker).
 * Digitação com máscara automática; ícone abre o popup. Integra com reactive
 * forms (CVA) e aceita uso simples via [value]/(alterar). Valor: ISO ou null.
 */
@Component({
  selector: 'app-date',
  imports: [ReactiveFormsModule, NgbDatepickerModule, MatIconModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputComponent), multi: true },
    { provide: NgbDateAdapter, useClass: IsoDateAdapter },
    { provide: NgbDateParserFormatter, useClass: BrDateFormatter },
    { provide: NgbDatepickerI18n, useClass: PtBrDatepickerI18n },
  ],
  template: `
    <div class="dw">
      <input
        class="input-inn dw-txt"
        type="text"
        inputmode="numeric"
        placeholder="dd/mm/aaaa"
        ngbDatepicker
        #dp="ngbDatepicker"
        [formControl]="ctrl"
        [minDate]="minStruct()!"
        [maxDate]="maxStruct()!"
        (input)="mascarar($event)"
        (blur)="toque()"
      />
      <button
        type="button"
        class="dw-btn"
        (click)="dp.toggle()"
        [disabled]="desabilitado()"
        tabindex="-1"
        aria-label="Abrir calendário"
      >
        <mat-icon>calendar_month</mat-icon>
      </button>
    </div>
  `,
  styles: `
    .dw { position: relative; display: flex; }
    .dw-txt { width: 100%; padding-right: 36px; }
    .dw-btn {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 26px; height: 26px; padding: 0;
      border: 0; background: transparent; border-radius: 4px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #5d6d7e; cursor: pointer;
    }
    .dw-btn:hover { background: rgba(0, 0, 0, 0.06); }
    .dw-btn:disabled { cursor: default; opacity: 0.5; }
    .dw-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `,
})
export class DateInputComponent implements ControlValueAccessor {
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly alterar = output<string>();

  protected readonly ctrl = new FormControl<string | null>(null);
  protected readonly desabilitado = signal(false);
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => this.writeValue(this.value()));
    this.ctrl.valueChanges.subscribe((v) => this.alterar.emit(v ?? ''));
  }

  writeValue(v: string | null): void {
    if (v !== this.ctrl.value) this.ctrl.setValue(v, { emitEvent: false });
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.ctrl.valueChanges.subscribe((v) => fn(v));
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.desabilitado.set(d);
    if (d) this.ctrl.disable({ emitEvent: false });
    else this.ctrl.enable({ emitEvent: false });
  }

  /** Máscara dd/mm/aaaa durante a digitação; o parse é do BrDateFormatter. */
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

  protected minStruct(): NgbDateStruct | null {
    return isoParaStruct(this.min());
  }
  protected maxStruct(): NgbDateStruct | null {
    return isoParaStruct(this.max());
  }
}
