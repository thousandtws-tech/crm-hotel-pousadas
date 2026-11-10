import { Component, inject, output, signal, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService, num } from '@core/services/api.service';
import {
  AcomodacaoDisponivel,
  Cliente,
  DisponibilidadeResponse,
  ReservaInput,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { DateInputComponent } from '@shared/components/date-input.component';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { of } from 'rxjs';

@Component({
  selector: 'app-nova-reserva-dialog',
  imports: [ReactiveFormsModule, DecimalPipe, MatIconModule, DateInputComponent],
  template: `
    <div class="overlay" (click.self)="fechar.emit()">
      <div class="modal-inn modal-lg" role="dialog" aria-modal="true" aria-labelledby="titulo-res">
        <div class="modal-head">
          <h5 id="titulo-res">Nova reserva</h5>
          <button type="button" class="close" (click)="fechar.emit()" aria-label="Fechar">&times;</button>
        </div>
        <form (submit)="$event.preventDefault(); salvar()">
          <div class="modal-body f-grid">
            <div class="campo full">
              <label class="lbl" for="res-cli"> Cliente <small class="req">*</small> </label>
              @if (clienteSel(); as cs) {
                <div class="cli-sel">
                  <mat-icon>person</mat-icon>
                  <span>{{ cs.nome }} — {{ cs.cpf }}</span>
                  <button
                    type="button"
                    class="cli-x"
                    (click)="limparCliente()"
                    aria-label="Trocar cliente"
                    title="Trocar cliente"
                  >
                    &times;
                  </button>
                </div>
              } @else {
                <input
                  id="res-cli"
                  class="input-inn"
                  type="text"
                  [formControl]="buscaCliente"
                  placeholder="Digite nome ou CPF"
                  autocomplete="off"
                  title="Buscar cliente"
                />
                @if (buscaCliente.value && buscaCliente.value.length >= 2) {
                  <div class="cli-drop" role="listbox">
                    @for (c of clientes(); track c.id) {
                      <button
                        type="button"
                        class="cli-opt"
                        role="option"
                        [attr.aria-selected]="false"
                        (click)="selecionarCliente(c)"
                      >
                        {{ c.nome }} — {{ c.cpf }}
                      </button>
                    } @empty {
                      <div class="cli-opt muted">Nenhum cliente encontrado.</div>
                    }
                  </div>
                }
              }
            </div>

            <div class="campo">
              <label class="lbl" for="res-ent"> Entrada <small class="req">*</small> </label>
              <app-date formControlName="entrada" />
            </div>
            <div class="campo">
              <label class="lbl" for="res-sai"> Saída <small class="req">*</small> </label>
              <app-date formControlName="saida" />
            </div>

            <div class="campo full">
              <button
                class="btn-dark-blue btn-disp"
                type="button"
                (click)="verificar()"
                [disabled]="!datasValidas()"
              >
                <mat-icon>search</mat-icon> Verificar disponibilidade
              </button>
            </div>

            @if (disp(); as d) {
              <div class="campo full">
                @if (d.disponivel) {
                  <p class="disp-ok">
                    {{ d.quantidade }} acomodação(ões) livre(s) — {{ d.diarias }} diária(s)
                  </p>
                } @else {
                  <p class="disp-warn">Nenhuma acomodação livre no período.</p>
                }
                <label class="lbl" for="res-ac"> Acomodação <small class="req">*</small> </label>
                <select id="res-ac" class="input-inn" formControlName="idacomodacao" title="Acomodação">
                  <option [ngValue]="0">Selecione uma opção</option>
                  @for (a of d.acomodacoes; track a.id) {
                    <option [ngValue]="a.id">
                      {{ a.nome }} ({{ a.numero }}) — R$ {{ num(a.valor) | number: '1.2-2' }}/dia
                      — {{ a.capacidade }} hóspedes
                    </option>
                  }
                </select>
              </div>
            }

            <div class="campo">
              <label class="lbl" for="res-hosp"> Hóspedes <small class="req">*</small> </label>
              <input id="res-hosp" class="input-inn" type="number" min="1" formControlName="hospedes" title="Quantidade de hóspedes" />
            </div>
            <div class="campo">
              <label class="lbl" for="res-val"> Valor da diária (opcional) </label>
              <div class="input-group-inn">
                <span class="addon">R$</span>
                <input id="res-val" class="input-inn" type="number" step="0.01" min="0" formControlName="valordiaria" title="Valor da diária" />
              </div>
            </div>
            <div class="campo full" style="display:flex;gap:1.2rem;">
              <label class="lbl" style="display:flex;align-items:center;gap:.4rem;">
                <input type="checkbox" formControlName="early_checkin" /> Early check-in
              </label>
              <label class="lbl" style="display:flex;align-items:center;gap:.4rem;">
                <input type="checkbox" formControlName="late_checkout" /> Late checkout
              </label>
            </div>
            <div class="campo full">
              <label class="lbl" for="res-obs"> Observações </label>
              <textarea id="res-obs" class="input-inn" rows="2" formControlName="obs" title="Observações"></textarea>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn-gray" type="button" (click)="fechar.emit()">Cancelar</button>
            <button class="btn-green" type="submit" [disabled]="!pronto() || salvando()">
              <mat-icon>save</mat-icon>
              {{ salvando() ? 'Salvando…' : 'Criar reserva' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: `
    .btn-disp { display: inline-flex; align-items: center; gap: 6px; width: fit-content; }
    .disp-ok { color: #15803d; margin: 0; font-size: 0.85rem; }
    .disp-warn { color: #b45309; margin: 0; font-size: 0.85rem; }
    .cli-sel {
      display: flex; align-items: center; gap: 8px;
      border: 1px solid #c3d2d9; border-radius: 4px;
      padding: 6px 10px; background: #f7fafb; font-size: 0.85rem;
    }
    .cli-sel mat-icon { font-size: 18px; width: 18px; height: 18px; color: #5d6d7e; }
    .cli-x {
      margin-left: auto; border: 0; background: none;
      color: #7d97a1; font-size: 1.1rem; cursor: pointer; line-height: 1;
    }
    .cli-drop {
      border: 1px solid #c3d2d9; border-radius: 4px;
      background: #fff; margin-top: 4px;
      max-height: 180px; overflow-y: auto;
      box-shadow: 0 4px 8px rgba(0,0,0,0.08);
    }
    .cli-opt {
      display: block; width: 100%; text-align: left;
      border: 0; background: none; padding: 7px 10px;
      font-size: 0.85rem; cursor: pointer;
    }
    .cli-opt:hover { background: #f1f1f1; }
  `,
})
export class NovaReservaDialogComponent implements OnInit {
  readonly fechar = output<void>();
  readonly criada = output<void>();

  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly clienteSel = signal<Cliente | null>(null);
  protected readonly disp = signal<DisponibilidadeResponse | null>(null);
  protected readonly salvando = signal(false);
  protected readonly num = num;

  protected readonly buscaCliente = this.fb.nonNullable.control('');
  protected readonly form = this.fb.nonNullable.group({
    entrada: ['', Validators.required],
    saida: ['', Validators.required],
    idacomodacao: [0],
    hospedes: [1, [Validators.required, Validators.min(1)]],
    valordiaria: [null as number | null],
    early_checkin: [false],
    late_checkout: [false],
    obs: [''],
  });

  ngOnInit(): void {
    this.buscaCliente.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((v) =>
          v.length >= 2 ? this.api.listarClientes(v, 1, 8, true) : of(null),
        ),
      )
      .subscribe((p) => this.clientes.set(p?.items ?? []));

    this.form.valueChanges.subscribe(() => this.disp.set(null));
  }

  selecionarCliente(c: Cliente): void {
    this.clienteSel.set(c);
    this.clientes.set([]);
  }

  limparCliente(): void {
    this.clienteSel.set(null);
    this.buscaCliente.setValue('');
  }

  datasValidas(): boolean {
    const { entrada, saida } = this.form.getRawValue();
    return !!entrada && !!saida && saida > entrada;
  }

  verificar(): void {
    if (!this.datasValidas()) return;
    const { entrada, saida } = this.form.getRawValue();
    this.api.disponibilidade(entrada, saida).subscribe({
      next: (d) => {
        this.disp.set(d);
        if (d.acomodacoes.length === 1) {
          this.form.patchValue({ idacomodacao: d.acomodacoes[0].id });
        }
      },
      error: (e) => this.notify.erro(e),
    });
  }

  pronto(): boolean {
    return (
      this.form.valid &&
      this.clienteSel() !== null &&
      this.disp()?.acomodacoes.some(
        (a: AcomodacaoDisponivel) => a.id === this.form.getRawValue().idacomodacao,
      ) === true
    );
  }

  salvar(): void {
    const c = this.clienteSel();
    if (!c || !this.pronto()) return;
    this.salvando.set(true);
    const v = this.form.getRawValue();
    const input: ReservaInput = {
      idacomodacao: v.idacomodacao,
      idcliente: c.id,
      quantidade_hospedes: v.hospedes,
      entradaprevista: v.entrada,
      saidaprevista: v.saida,
      obs: v.obs || null,
      valordiaria: v.valordiaria ?? null,
      early_checkin: v.early_checkin === true,
      late_checkout: v.late_checkout === true,
    };
    this.api.criarReserva(input).subscribe({
      next: () => this.criada.emit(),
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }
}
