// Lógica e estado de escalas — separada da camada de UI (escalas.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { OperacaoApi } from '@core/api/operacao.api';
import { NotifyService } from '@core/services/notify.service';
import {
  CltViolacao,
  EscalaTurno,
  FuncionarioJornada,
  RegimeEscala,
} from '@core/models/operacao.models';

type Aba = 'grade' | 'jornadas' | 'clt';

const REGRA_ROTULO: Record<string, string> = {
  interjornada: 'Interjornada <11h',
  dsr: 'DSR semanal',
  jornada_diaria: 'Jornada diária',
  almoco: 'Intervalo de almoço',
  duracao: 'Duração do turno',
  duplicado: 'Turno duplicado',
};

/** Escalas — jornadas por regime, grade de turnos e conformidade CLT. */
@Directive()
export abstract class EscalasStore implements OnInit {
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly notify = inject(NotifyService);

  protected readonly aba = signal<Aba>('grade');
  protected readonly turnos = signal<EscalaTurno[]>([]);
  protected readonly jornadas = signal<FuncionarioJornada[]>([]);
  protected readonly violacoes = signal<CltViolacao[]>([]);
  protected readonly funcionarios = signal<{ id: number; nome: string }[]>([]);
  protected readonly modalJornada = signal(false);
  protected readonly alterados = signal<Set<number>>(new Set());
  // Datas locais (não UTC): toISOString vira o dia às 21h no horário de Brasília.
  protected inicio = EscalasStore.dataLocal(new Date());
  protected fim = EscalasStore.dataLocal(new Date(Date.now() + 13 * 864e5));
  protected diasGerar = 30;
  protected jornadaForm: {
    idfuncionario: number;
    regime: RegimeEscala;
    entrada: string;
    saida: string;
    almoco_min: number;
    ancora: string;
  } = {
    idfuncionario: 0,
    regime: '6x1',
    entrada: '08:00',
    saida: '17:00',
    almoco_min: 60,
    ancora: EscalasStore.dataLocal(new Date()),
  };
  protected readonly regraRotulo = REGRA_ROTULO;
  private nomes = new Map<number, string>();

  private static dataLocal(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 1 request consolidada — turnos + jornadas + violações CLT + funcionários.
  ngOnInit(): void {
    this.operacaoApi.painelEscalas(this.inicio, this.fim).subscribe({
      next: (p) => {
        this.funcionarios.set(p.funcionarios.map((f) => ({ id: f.id, nome: f.nome })));
        this.nomes = new Map(p.funcionarios.map((f) => [f.id, f.nome]));
        this.turnos.set(p.turnos);
        this.alterados.set(new Set());
        this.jornadas.set(p.jornadas);
        // null = sem nível gerencial — mesma ausência do 403 silencioso de antes.
        if (p.violacoes_clt) this.violacoes.set(p.violacoes_clt);
      },
      error: () => this.notify.erroMsg('Falha ao carregar escalas.'),
    });
  }

  carregar(): void {
    this.operacaoApi.turnos(this.inicio, this.fim).subscribe({
      next: (t) => {
        this.turnos.set(t);
        this.alterados.set(new Set());
      },
      error: () => this.notify.erroMsg('Falha ao carregar turnos.'),
    });
  }

  nomeFunc(id: number): string {
    return this.nomes.get(id) ?? `#${id}`;
  }

  editado(t: EscalaTurno): void {
    this.alterados.update((s) => new Set(s).add(t.id));
  }

  protected readonly horasEdit = new Map<string, string>();

  hhmm(iso: string): string {
    return iso.slice(11, 16);
  }

  salvarTurno(t: EscalaTurno): void {
    const inicio = `${t.data}T${this.horasEdit.get(t.id + '-i') ?? this.hhmm(t.inicio)}:00Z`;
    const fim = `${t.data}T${this.horasEdit.get(t.id + '-f') ?? this.hhmm(t.fim)}:00Z`;
    this.operacaoApi.turnoAtualizar(t.id, { inicio, fim, almoco_min: t.almoco_min }).subscribe({
      next: (salvo) => {
        this.turnos.update((l) => l.map((x) => (x.id === salvo.id ? salvo : x)));
        this.alterados.update((s) => {
          const n = new Set(s);
          n.delete(t.id);
          return n;
        });
        this.notify.ok('Turno atualizado.');
      },
      error: () => this.notify.erroMsg('Falha ao salvar turno.'),
    });
  }

  removerTurno(t: EscalaTurno): void {
    this.operacaoApi.removerTurno(t.id).subscribe({
      next: () => this.turnos.update((l) => l.filter((x) => x.id !== t.id)),
      error: () => this.notify.erroMsg('Falha ao excluir turno.'),
    });
  }

  gravarJornada(): void {
    this.operacaoApi
      .gravarJornada(
        {
          ...this.jornadaForm,
          entrada: this.jornadaForm.entrada + ':00',
          saida: this.jornadaForm.saida + ':00',
        },
        this.diasGerar,
      )
      .subscribe({
        next: () => {
          this.modalJornada.set(false);
          this.operacaoApi
            .jornadas()
            .subscribe({ next: (j) => this.jornadas.set(j), error: () => undefined });
          this.carregar();
          this.notify.ok(`Jornada salva — turnos gerados por ${this.diasGerar} dias.`);
        },
        error: () => this.notify.erroMsg('Falha ao salvar jornada.'),
      });
  }

  validarClt(): void {
    this.operacaoApi.cltValidar(14).subscribe({
      next: (v) => this.violacoes.set(v),
      error: () => undefined,
    });
  }

  corrigir(v: CltViolacao): void {
    this.operacaoApi.cltCorrigir(v.correcao).subscribe({
      next: () => {
        this.validarClt();
        this.carregar();
        this.notify.ok('Correção aplicada.');
      },
      error: () => this.notify.erroMsg('Falha ao aplicar correção.'),
    });
  }
}
