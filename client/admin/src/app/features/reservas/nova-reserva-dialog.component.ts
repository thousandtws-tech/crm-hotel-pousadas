import { Component, inject, output, signal, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ClientesApi } from '@core/api/clientes.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num';
import { Cliente } from '@core/models/clientes.models';
import { AcomodacaoDisponivel, DisponibilidadeResponse, ReservaInput } from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { DateInputComponent } from '@shared/components/date-input.component';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { of } from 'rxjs';

/** Drawer lateral de nova reserva — fluxo: hóspede → período → disponibilidade → detalhes. */
@Component({
  selector: 'app-nova-reserva-dialog',
  imports: [ReactiveFormsModule, DecimalPipe, MatIconModule, DateInputComponent],
  template: `
    <div class="ovl" (click.self)="fechar.emit()" (keydown.escape)="fechar.emit()">
      <div class="nr" role="dialog" aria-modal="true" aria-labelledby="titulo-res">
        <header class="nr-head">
          <div>
            <p class="eyebrow">Recepção</p>
            <h3 id="titulo-res" class="nr-titulo">Nova reserva</h3>
          </div>
          <button
            type="button"
            class="nr-x"
            (click)="fechar.emit()"
            aria-label="Fechar"
            title="Fechar"
          ><mat-icon>close</mat-icon></button>
        </header>

        <form [formGroup]="form" (submit)="$event.preventDefault(); salvar()" class="nr-form">
          <div class="nr-body">
            <!-- ============================ hóspede ============================ -->
            <section class="nr-sec">
              <h4 class="nr-sec-t"><mat-icon>person</mat-icon> Hóspede <em class="req">*</em></h4>
              @if (clienteSel(); as cs) {
                <div class="cli-sel">
                  <span class="cli-av">{{ iniciais(cs.nome) }}</span>
                  <span class="cli-txt">
                    <strong>{{ cs.nome }}</strong>
                    <small>CPF {{ cs.cpf }}</small>
                  </span>
                  <button
                    type="button"
                    class="nr-troca"
                    (click)="limparCliente()"
                    aria-label="Trocar cliente"
                    title="Trocar cliente"
                  ><mat-icon>swap_horiz</mat-icon></button>
                </div>
              } @else {
                <div class="nr-busca" [class.foco]="buscaFoco()">
                  <mat-icon class="nr-busca-ic">search</mat-icon>
                  <input
                    id="res-cli"
                    class="nr-busca-in"
                    type="search"
                    [formControl]="buscaCliente"
                    placeholder="Nome ou CPF do hóspede…"
                    aria-label="Buscar cliente por nome ou CPF"
                    autocomplete="off"
                    (focus)="buscaFoco.set(true)"
                    (blur)="buscaFoco.set(false)"
                  />
                </div>
                @if (buscaCliente.value && buscaCliente.value.length >= 2) {
                  <div class="cli-drop" role="listbox" aria-label="Clientes encontrados">
                    @for (c of clientes(); track c.id) {
                      <button
                        type="button"
                        class="cli-opt"
                        role="option"
                        [attr.aria-selected]="false"
                        (click)="selecionarCliente(c)"
                      >
                        <span class="cli-av mini">{{ iniciais(c.nome) }}</span>
                        <span>{{ c.nome }} <small>— {{ c.cpf }}</small></span>
                      </button>
                    } @empty {
                      <div class="cli-vazio">Nenhum cliente encontrado.</div>
                    }
                  </div>
                }
              }
            </section>

            <!-- ============================ período ============================ -->
            <section class="nr-sec">
              <h4 class="nr-sec-t"><mat-icon>calendar_month</mat-icon> Período <em class="req">*</em></h4>
              <div class="nr-duo">
                <div class="nr-campo">
                  <span class="nr-lbl">Entrada</span>
                  <app-date formControlName="entrada" [rotulo]="'Data de entrada da reserva'" />
                </div>
                <div class="nr-campo">
                  <span class="nr-lbl">Saída</span>
                  <app-date formControlName="saida" [rotulo]="'Data de saída da reserva'" />
                </div>
              </div>
              <button
                class="btn-disp"
                type="button"
                (click)="verificar()"
                [disabled]="!datasValidas() || verificando()"
              >
                <mat-icon>{{ verificando() ? 'hourglass_top' : 'event_available' }}</mat-icon>
                {{ verificando() ? 'Verificando…' : 'Verificar disponibilidade' }}
              </button>
              @if (disp(); as d) {
                @if (d.disponivel) {
                  <p class="disp-ok" role="status">
                    <mat-icon>check_circle</mat-icon>
                    {{ d.quantidade }} {{ d.quantidade === 1 ? 'acomodação livre' : 'acomodações livres' }}
                    — {{ d.diarias }} {{ d.diarias === 1 ? 'diária' : 'diárias' }}
                  </p>
                } @else {
                  <p class="disp-warn" role="alert">
                    <mat-icon>warning</mat-icon>
                    Nenhuma acomodação livre no período.
                  </p>
                }
              }
            </section>

            <!-- ==================== acomodação ==================== -->
            @if (disp()?.disponivel && disp()!.acomodacoes.length) {
              <section class="nr-sec">
                <h4 class="nr-sec-t"><mat-icon>king_bed</mat-icon> Acomodação <em class="req">*</em></h4>
                <div class="ac-grid" role="radiogroup" aria-label="Acomodações disponíveis">
                  @for (a of disp()!.acomodacoes; track a.id) {
                    <button
                      type="button"
                      role="radio"
                      class="ac-card"
                      [class.sel]="idAcom() === a.id"
                      [attr.aria-checked]="idAcom() === a.id"
                      (click)="idAcom.set(a.id)"
                    >
                      <mat-icon class="ac-check">check_circle</mat-icon>
                      <span class="ac-txt">
                        <strong>{{ a.nome }}</strong>
                        <small>
                          Nº {{ a.numero }} · {{ a.capacidade }}
                          {{ a.capacidade === 1 ? 'hóspede' : 'hóspedes' }}
                        </small>
                      </span>
                      <span class="ac-val">
                        <strong>R$ {{ num(a.valor) | number: '1.2-2' }}</strong>
                        <small>/diária</small>
                      </span>
                    </button>
                  }
                </div>
              </section>
            }

            <!-- ============================ detalhes ============================ -->
            <section class="nr-sec">
              <h4 class="nr-sec-t"><mat-icon>edit_note</mat-icon> Detalhes</h4>
              <div class="nr-duo">
                <div class="nr-campo">
                  <label class="nr-lbl" for="res-hosp">Hóspedes <em class="req">*</em></label>
                  <div class="nr-num">
                    <mat-icon>group</mat-icon>
                    <input id="res-hosp" type="number" min="1" max="20" formControlName="hospedes" aria-label="Quantidade de hóspedes" />
                  </div>
                </div>
                <div class="nr-campo">
                  <label class="nr-lbl" for="res-val">Valor da diária <small class="opc">(opcional)</small></label>
                  <div class="nr-num">
                    <span class="nr-addon">R$</span>
                    <input id="res-val" type="number" step="0.01" min="0" formControlName="valordiaria" aria-label="Valor da diária" placeholder="padrão da acomodação" />
                  </div>
                </div>
              </div>
              <div class="nr-tgl">
                <label class="tgl" [class.on]="form.value.early_checkin">
                  <input type="checkbox" formControlName="early_checkin" />
                  <mat-icon>login</mat-icon> Early check-in
                </label>
                <label class="tgl" [class.on]="form.value.late_checkout">
                  <input type="checkbox" formControlName="late_checkout" />
                  <mat-icon>logout</mat-icon> Late checkout
                </label>
              </div>
              <div class="nr-campo">
                <label class="nr-lbl" for="res-obs">Observações</label>
                <textarea
                  id="res-obs"
                  class="nr-txt"
                  rows="2"
                  formControlName="obs"
                  placeholder="Pedidos especiais, alergias, horário de chegada…"
                ></textarea>
              </div>
            </section>
          </div>

          <footer class="nr-foot">
            <button class="btn-ghost-txt" type="button" (click)="fechar.emit()">Cancelar</button>
            <button class="btn-criar" type="submit" [disabled]="!pronto() || salvando()">
              <mat-icon>{{ salvando() ? 'hourglass_top' : 'add' }}</mat-icon>
              {{ salvando() ? 'Salvando…' : 'Criar reserva' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  `,
  styles: `
    .ovl {
      position: fixed; inset: 0; z-index: 320;
      background: rgba(5, 30, 40, 0.5); backdrop-filter: blur(2px);
      display: flex; justify-content: flex-end;
    }
    .nr {
      width: 100%; max-width: 600px; height: 100%;
      background: #fff;
      box-shadow: -24px 0 60px rgba(5, 30, 40, 0.35);
      display: flex; flex-direction: column;
      animation: deslizar 0.2s ease-out;
    }
    @keyframes deslizar { from { opacity: 0.4; transform: translateX(60px); } }

    .nr-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; padding: 20px 22px 14px;
      border-bottom: 1px solid #eef2f5;
    }
    .eyebrow {
      margin: 0 0 2px; font-size: 0.68rem; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase; color: #4b95ab;
    }
    .nr-titulo {
      margin: 0; font-family: var(--font-display);
      font-size: 1.5rem; font-weight: 600; color: #054054;
    }
    .nr-x {
      width: 34px; height: 34px; border-radius: 8px;
      border: 1px solid #d7e0e6; background: #fff; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: border-color 0.15s, color 0.15s;
    }
    .nr-x:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .nr-x mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .nr-form { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .nr-body {
      padding: 16px 22px; display: flex; flex-direction: column; gap: 18px;
      flex: 1; overflow-y: auto;
    }
    .nr-sec { display: flex; flex-direction: column; gap: 9px; }
    .nr-sec-t {
      margin: 0; font-size: 0.74rem; font-weight: 700; color: #40525d;
      text-transform: uppercase; letter-spacing: 0.06em;
      display: flex; align-items: center; gap: 7px;
    }
    .nr-sec-t mat-icon { font-size: 16px; width: 16px; height: 16px; color: #4b95ab; }
    .req { color: #c0392b; font-style: normal; }
    .opc { color: #8fa3ab; font-weight: 500; text-transform: none; letter-spacing: 0; }

    .nr-duo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .nr-campo { display: flex; flex-direction: column; gap: 5px; }
    .nr-lbl { font-size: 0.8rem; font-weight: 600; color: #5d6d7e; }

    /* ---------- busca de hóspede ---------- */
    .nr-busca {
      display: flex; align-items: center; gap: 8px;
      border: 1px solid #d7e0e6; border-radius: 10px;
      padding: 0 12px; height: 42px; background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .nr-busca.foco { border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.13); }
    .nr-busca-ic { color: #7d97a1; font-size: 19px; width: 19px; height: 19px; }
    .nr-busca-in {
      flex: 1; border: none; outline: none; background: transparent;
      font-family: inherit; font-size: 0.9rem; color: #33424c; height: 100%;
    }
    .nr-busca-in::placeholder { color: #8fa3ab; }
    .nr-busca-in::-webkit-search-cancel-button { display: none; }

    .cli-drop {
      border: 1px solid #e3eaef; border-radius: 10px; background: #fff;
      max-height: 200px; overflow-y: auto;
      box-shadow: 0 10px 26px rgba(5, 64, 84, 0.1);
      padding: 4px;
    }
    .cli-opt {
      display: flex; align-items: center; gap: 10px;
      width: 100%; text-align: left; border: 0; background: none;
      padding: 8px 10px; border-radius: 8px;
      font-family: inherit; font-size: 0.87rem; color: #33424c; cursor: pointer;
    }
    .cli-opt small { color: #8a99a4; }
    .cli-opt:hover, .cli-opt:focus-visible { background: #f0f7fa; outline: none; }
    .cli-vazio { padding: 12px; font-size: 0.82rem; color: #8a99a4; text-align: center; }

    .cli-sel {
      display: flex; align-items: center; gap: 11px;
      border: 1px solid #c8e2d2; border-radius: 10px;
      padding: 10px 12px; background: #f2faf4;
    }
    .cli-av {
      flex: none; width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.76rem; font-weight: 800; letter-spacing: 0.03em;
    }
    .cli-av.mini { width: 30px; height: 30px; font-size: 0.66rem; }
    .cli-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cli-txt strong { font-size: 0.9rem; color: #054054; }
    .cli-txt small { font-size: 0.75rem; color: #7d97a1; }
    .nr-troca {
      flex: none; width: 32px; height: 32px; border-radius: 8px;
      border: 1px solid #d7e0e6; background: #fff; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: border-color 0.15s, color 0.15s;
    }
    .nr-troca:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .nr-troca mat-icon { font-size: 17px; width: 17px; height: 17px; }

    /* ---------- disponibilidade ---------- */
    .btn-disp {
      display: inline-flex; align-items: center; gap: 7px;
      width: fit-content; min-height: 38px; padding: 0 16px;
      border: 1.5px solid #1a6f8a; border-radius: 9px; background: #fff;
      color: #1a6f8a; font-family: inherit; font-size: 0.84rem; font-weight: 700;
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .btn-disp:hover:not(:disabled) { background: #1a6f8a; color: #fff; }
    .btn-disp:disabled { opacity: 0.45; cursor: default; }
    .btn-disp mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .disp-ok, .disp-warn {
      display: flex; align-items: center; gap: 7px;
      margin: 0; padding: 9px 12px; border-radius: 9px; font-size: 0.84rem; font-weight: 600;
    }
    .disp-ok { background: #e8f6ec; color: #146c2e; }
    .disp-warn { background: #fdf3d7; color: #8a6200; }
    .disp-ok mat-icon, .disp-warn mat-icon { font-size: 17px; width: 17px; height: 17px; }

    /* ---------- cards de acomodação ---------- */
    .ac-grid { display: flex; flex-direction: column; gap: 7px; }
    .ac-card {
      position: relative; display: flex; align-items: center; gap: 12px;
      width: 100%; text-align: left; padding: 11px 14px;
      border: 1.5px solid #e3eaef; border-radius: 10px; background: #fff;
      font-family: inherit; cursor: pointer;
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    .ac-card:hover { border-color: #4b95ab; }
    .ac-card.sel {
      border-color: #1a6f8a; background: #f0f7fa;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.12);
    }
    .ac-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .ac-txt strong { font-size: 0.9rem; color: #054054; font-weight: 700; }
    .ac-txt small { font-size: 0.75rem; color: #8a99a4; }
    .ac-val { display: flex; align-items: baseline; gap: 3px; color: #054054; }
    .ac-val strong { font-size: 0.92rem; font-variant-numeric: tabular-nums; }
    .ac-val small { font-size: 0.72rem; color: #8a99a4; }
    .ac-check {
      font-size: 19px; width: 19px; height: 19px; color: #146c2e;
      opacity: 0; transform: scale(0.6); transition: opacity 0.15s, transform 0.15s;
    }
    .ac-card.sel .ac-check { opacity: 1; transform: scale(1); }

    /* ---------- inputs numerados ---------- */
    .nr-num {
      display: flex; align-items: center; gap: 8px;
      border: 1px solid #d7e0e6; border-radius: 10px; background: #fff;
      padding: 0 12px; height: 42px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .nr-num:focus-within { border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.13); }
    .nr-num mat-icon { color: #7d97a1; font-size: 18px; width: 18px; height: 18px; }
    .nr-num input {
      flex: 1; border: none; outline: none; background: transparent;
      font-family: inherit; font-size: 0.9rem; color: #33424c; height: 100%; min-width: 0;
    }
    .nr-addon {
      font-size: 0.8rem; font-weight: 700; color: #7d97a1;
      background: #eef4f6; border-radius: 6px; padding: 2px 8px;
    }
    .nr-txt {
      border: 1px solid #d7e0e6; border-radius: 10px; padding: 10px 12px;
      font-family: inherit; font-size: 0.88rem; color: #33424c; resize: vertical;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .nr-txt:focus { outline: none; border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.13); }
    .nr-txt::placeholder { color: #8fa3ab; }

    /* ---------- toggles ---------- */
    .nr-tgl { display: flex; gap: 10px; flex-wrap: wrap; }
    .tgl {
      display: inline-flex; align-items: center; gap: 7px;
      border: 1px solid #d7e0e6; border-radius: 999px; background: #fff;
      padding: 7px 14px; font-size: 0.8rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; user-select: none; transition: all 0.15s;
    }
    .tgl input { position: absolute; opacity: 0; width: 0; height: 0; }
    .tgl mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tgl:hover { border-color: #4b95ab; }
    .tgl.on { background: #f0f7fa; border-color: #1a6f8a; color: #1a6f8a; }
    .tgl:has(input:focus-visible) { box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.2); }

    /* ---------- rodapé ---------- */
    .nr-foot {
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 14px 22px; border-top: 1px solid #eef2f5;
    }
    .btn-ghost-txt {
      border: 1px solid #d7e0e6; background: #fff; border-radius: 10px;
      padding: 0 18px; height: 40px; font-family: inherit;
      font-size: 0.86rem; font-weight: 600; color: #5d6d7e; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .btn-ghost-txt:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .btn-criar {
      display: inline-flex; align-items: center; gap: 7px;
      background: #054054; color: #fff; border: none; border-radius: 10px;
      padding: 0 20px; height: 40px; font-family: inherit;
      font-size: 0.86rem; font-weight: 700; cursor: pointer;
      transition: background 0.15s, transform 0.12s;
    }
    .btn-criar:hover:not(:disabled) { background: #1a6f8a; transform: translateY(-1px); }
    .btn-criar:disabled { opacity: 0.45; cursor: default; }
    .btn-criar mat-icon { font-size: 18px; width: 18px; height: 18px; }

    @media (prefers-reduced-motion: reduce) {
      .nr { animation: none; }
      .ac-check, .btn-criar { transition: none; }
    }
    @media (max-width: 560px) {
      .nr { max-width: none; }
      .nr-duo { grid-template-columns: 1fr; }
    }
  `,
})
export class NovaReservaDialogComponent implements OnInit {
  readonly fechar = output<void>();
  readonly criada = output<void>();

  private readonly clientesApi = inject(ClientesApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly clienteSel = signal<Cliente | null>(null);
  protected readonly disp = signal<DisponibilidadeResponse | null>(null);
  protected readonly idAcom = signal(0);
  protected readonly salvando = signal(false);
  protected readonly verificando = signal(false);
  protected readonly buscaFoco = signal(false);
  protected readonly num = num;

  protected readonly buscaCliente = this.fb.nonNullable.control('');
  protected readonly form = this.fb.nonNullable.group({
    entrada: ['', Validators.required],
    saida: ['', Validators.required],
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
          v.length >= 2 ? this.clientesApi.listarClientes(v, 1, 8, true) : of(null),
        ),
      )
      .subscribe((p) => this.clientes.set(p?.items ?? []));

    // Só as datas invalidam a disponibilidade já verificada.
    this.form.controls.entrada.valueChanges.subscribe(() => this.limparDisp());
    this.form.controls.saida.valueChanges.subscribe(() => this.limparDisp());
  }

  private limparDisp(): void {
    this.disp.set(null);
    this.idAcom.set(0);
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
    this.verificando.set(true);
    const { entrada, saida } = this.form.getRawValue();
    this.reservasApi.disponibilidade(entrada, saida).subscribe({
      next: (d) => {
        this.verificando.set(false);
        this.disp.set(d);
        if (d.acomodacoes.length === 1) {
          this.idAcom.set(d.acomodacoes[0].id);
        } else {
          this.idAcom.set(0);
        }
      },
      error: (e) => {
        this.verificando.set(false);
        this.notify.erro(e);
      },
    });
  }

  pronto(): boolean {
    return (
      this.form.valid &&
      this.clienteSel() !== null &&
      this.disp()?.acomodacoes.some(
        (a: AcomodacaoDisponivel) => a.id === this.idAcom(),
      ) === true
    );
  }

  salvar(): void {
    const c = this.clienteSel();
    if (!c || !this.pronto()) return;
    this.salvando.set(true);
    const v = this.form.getRawValue();
    const input: ReservaInput = {
      idacomodacao: this.idAcom(),
      idcliente: c.id,
      quantidade_hospedes: v.hospedes,
      entradaprevista: v.entrada,
      saidaprevista: v.saida,
      obs: v.obs || null,
      valordiaria: v.valordiaria ?? null,
      early_checkin: v.early_checkin === true,
      late_checkout: v.late_checkout === true,
    };
    this.reservasApi.criarReserva(input).subscribe({
      next: () => this.criada.emit(),
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  iniciais(nome: string): string {
    const p = nome.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
  }
}
