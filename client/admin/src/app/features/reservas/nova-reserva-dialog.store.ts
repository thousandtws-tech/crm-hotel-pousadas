// Lógica e estado de nova-reserva-dialog — separada da camada de UI (nova-reserva-dialog.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, OnInit, Directive } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ClientesApi } from '@core/api/clientes.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num';
import { Cliente } from '@core/models/clientes.models';
import {
  AcomodacaoDisponivel,
  DisponibilidadeResponse,
  ReservaInput,
} from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { of } from 'rxjs';
import type { OutputEmitterRef } from '@angular/core';

/** Drawer lateral de nova reserva — fluxo: hóspede → período → disponibilidade → detalhes. */
@Directive()
export abstract class NovaReservaDialogStore implements OnInit {
  declare protected readonly fechar: OutputEmitterRef<void>;
  declare protected readonly criada: OutputEmitterRef<void>;

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
      this.disp()?.acomodacoes.some((a: AcomodacaoDisponivel) => a.id === this.idAcom()) === true
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
