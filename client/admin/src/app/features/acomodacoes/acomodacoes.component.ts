import { DecimalPipe, DatePipe } from '@angular/common';
import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin } from 'rxjs';
import { ApiService, num } from '@core/services/api.service';
import {
  Acomodacao,
  AcomodacaoInput,
  Quarto,
  TarifaHistorico,
  TipoAcomodacao,
  VagaEstacionamento,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';

type Modal = 'acomodacao' | 'tipos' | 'quarto' | null;

@Component({
  selector: 'app-acomodacoes',
  imports: [
    DecimalPipe,
    DatePipe,
    MatIconModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  template: `
    <div class="page">
      <div class="acoes-topo">
        <button class="btn-dark-blue" type="button" (click)="abrirTipos()">
          <mat-icon>category</mat-icon> Tipo de acomodação
        </button>
        <button class="btn-dark-blue" type="button" (click)="abrirForm()">
          <mat-icon>add_box</mat-icon> Acomodação
        </button>
      </div>

      <div class="inner-card">
        <div class="inner-card-header"><h4>Acomodações</h4></div>
        <div class="inner-card-body">
          @if (carregando()) {
            <div class="center"><mat-spinner diameter="36" /></div>
          }
          <div class="tbl-wrap">
            <table class="plain bordered">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Número</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Capacidade</th>
                  <th>Descrição</th>
                  <th>Status</th>
                  <th class="tc">Ação</th>
                </tr>
              </thead>
              <tbody>
                @for (a of items(); track a.id) {
                  <tr>
                    <td>{{ a.id }}</td>
                    <td><span class="dot" [style.background]="a.cor"></span>{{ a.nome }}</td>
                    <td>{{ a.numero }}</td>
                    <td>{{ tipoNome(a.idtipo_acomodacao) }}</td>
                    <td>
                      @if (a.valor !== null) {
                        R$ {{ num(a.valor) | number: '1.2-2' }}
                      }
                    </td>
                    <td>{{ a.capacidade }}</td>
                    <td>{{ a.descricao }}</td>
                    <td>
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="status-chip badge-toggle"
                          [class.bg-success]="a.ativo"
                          [class.bg-danger]="!a.ativo"
                          [title]="a.ativo ? 'Desativar' : 'Ativar'"
                          (click)="statusAcomodacao(a, !a.ativo)"
                        >
                          {{ a.ativo ? 'Ativo' : 'Inativo' }}
                        </button>
                      } @else {
                        <span
                          class="status-chip"
                          [class.bg-success]="a.ativo"
                          [class.bg-danger]="!a.ativo"
                        >{{ a.ativo ? 'Ativo' : 'Inativo' }}</span>
                      }
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="badge-acao bg-yellow text-black-50"
                        title="Editar"
                        (click)="abrirForm(a)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="badge-acao bg-blue"
                        title="Visualizar"
                        (click)="visualizar(a)"
                      >
                        <mat-icon>visibility</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  @if (!carregando()) {
                    <tr><td colspan="9" class="muted tc">Nenhuma acomodação.</td></tr>
                  }
                }
              </tbody>
            </table>
          </div>

          @if (selecionada(); as a) {
            <div class="detalhe">
              <div class="detalhe-head">
                <strong>{{ a.nome }} — Nº{{ a.numero }}</strong>
                <button class="btn-gray" type="button" (click)="selecionada.set(null)">
                  <mat-icon>close</mat-icon> Fechar
                </button>
              </div>
              <p class="muted">{{ a.descricao }}</p>

              <h4>Quartos físicos</h4>
              <div class="quartos">
                @for (q of quartos(); track q.id) {
                  <span class="chip">
                    {{ q.numero }}
                    <button
                      type="button"
                      class="status-chip badge-toggle"
                      [class.bg-success]="q.ativo"
                      [class.bg-danger]="!q.ativo"
                      (click)="statusQuarto(q, !q.ativo)"
                    >{{ q.ativo ? 'Ativo' : 'Inativo' }}</button>
                  </span>
                } @empty {
                  <span class="muted">Nenhum quarto cadastrado.</span>
                }
                <button class="btn-dark-blue" type="button" (click)="abrirQuarto(a)">
                  <mat-icon>add</mat-icon> Quarto
                </button>
              </div>

              <h4>Histórico de tarifas</h4>
              <table class="plain bordered">
                <thead>
                  <tr><th>Valor</th><th>Vigente desde</th><th>Até</th></tr>
                </thead>
                <tbody>
                  @for (t of tarifas(); track t.id) {
                    <tr>
                      <td>R$ {{ num(t.valor) | number: '1.2-2' }}</td>
                      <td>{{ t.vigente_desde | date: 'dd/MM/yyyy' }}</td>
                      <td>{{ t.vigente_ate ? (t.vigente_ate | date: 'dd/MM/yyyy') : 'vigente' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="3" class="muted tc">Sem histórico.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>
    </div>

    <!-- ============ Modal Acomodação (criar/editar) ============ -->
    @if (modal() === 'acomodacao') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn modal-acomodacao" role="dialog" aria-modal="true" aria-labelledby="titulo-ac">
          <div class="modal-head">
            <h5 id="titulo-ac">
              @if (editando(); as e) {
                <span>#{{ e.id }}</span> Editar acomodação {{ e.nome }}
              } @else {
                Cadastrar nova Acomodação
              }
            </h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <form [formGroup]="form" (ngSubmit)="salvar()">
            <div class="modal-body form-grid">
              <div class="campo">
                <label class="lbl" for="ac-nome"> Nome <small class="req">*</small> </label>
                <input
                  id="ac-nome"
                  class="input-inn"
                  type="text"
                  formControlName="nome"
                  placeholder="Nome da acomodação"
                  title="Nome da acomodação"
                />
              </div>
              <div class="campo">
                <label class="lbl" for="ac-numero"> Número <small class="req">*</small> </label>
                <input
                  id="ac-numero"
                  class="input-inn"
                  type="number"
                  min="0"
                  formControlName="numero"
                  placeholder="Número da acomodação"
                  title="Número da acomodação"
                />
              </div>
              <div class="campo">
                <label class="lbl" for="ac-tipo"> Tipo <small class="req">*</small> </label>
                <select id="ac-tipo" class="input-inn" formControlName="idtipo_acomodacao" title="Tipo de acomodação">
                  <option [ngValue]="null">Selecione uma opção</option>
                  @for (t of tipos(); track t.id) {
                    @if (t.ativo) {
                      <option [ngValue]="t.id">{{ t.nome }}</option>
                    }
                  }
                </select>
              </div>
              @if (!editando()) {
                <div class="campo campo-vaga">
                  <div class="check-inn">
                    <input
                      id="ac-vaga-check"
                      type="checkbox"
                      [disabled]="vagasLivres().length === 0"
                      (change)="comVaga.set(chk($event))"
                    />
                    <label for="ac-vaga-check"> Vaga no estacionamento </label>
                  </div>
                  <select
                    class="input-inn"
                    multiple
                    [disabled]="!comVaga()"
                    (change)="selecionarVagas($event)"
                    aria-label="Vagas disponíveis"
                    size="3"
                  >
                    @for (v of vagasLivres(); track v.id) {
                      <option [value]="v.id">Nº {{ v.numero }}</option>
                    } @empty {
                      <option disabled>Sem vagas disponíveis</option>
                    }
                  </select>
                </div>
              }
              <div class="campo">
                <label class="lbl" for="ac-valor"> Valor (diária) </label>
                <div class="input-group-inn">
                  <span class="addon">R$</span>
                  <input
                    id="ac-valor"
                    class="input-inn"
                    type="number"
                    step="0.01"
                    min="0"
                    formControlName="valor"
                    placeholder="Ex.: 1500,00"
                    title="Valor da acomodação"
                  />
                </div>
              </div>
              <div class="campo">
                <label class="lbl" for="ac-cap"> Capacidade <small class="req">*</small> </label>
                <div class="input-group-inn">
                  <span class="addon"><mat-icon>group</mat-icon></span>
                  <input
                    id="ac-cap"
                    class="input-inn"
                    type="number"
                    min="0"
                    formControlName="capacidade"
                    placeholder="Ex.: 5"
                    title="Capacidade máxima"
                  />
                </div>
              </div>
              <div class="campo">
                <label class="lbl" for="ac-cor"> Cor (calendário) </label>
                <input
                  id="ac-cor"
                  class="input-inn cor"
                  type="color"
                  formControlName="cor"
                  title="Cor da acomodação no calendário"
                />
              </div>
              <div class="campo full">
                <label class="lbl" for="ac-desc"> Descrição </label>
                <textarea
                  id="ac-desc"
                  class="input-inn"
                  rows="3"
                  maxlength="240"
                  formControlName="descricao"
                  placeholder="Descrição da acomodação"
                  title="Informe uma descrição"
                ></textarea>
              </div>
              <small class="req">* Obrigatório</small>
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="form.invalid">
                <mat-icon>{{ editando() ? 'edit' : 'save' }}</mat-icon>
                {{ editando() ? 'Alterar' : 'Gravar' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    }

    <!-- ============ Modal Tipos de acomodação ============ -->
    @if (modal() === 'tipos') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-labelledby="titulo-tipos">
          <div class="modal-head">
            <h5 id="titulo-tipos">Tipo de acomodação</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <div class="modal-body">
            <form class="input-group-inn mb" (submit)="$event.preventDefault(); criarTipo()">
              <input
                class="input-inn"
                type="text"
                [formControl]="novoTipo"
                placeholder="Ex.: Suíte"
                aria-label="Nome do tipo de acomodação"
              />
              <button class="btn-green" type="submit" [disabled]="novoTipo.invalid">Cadastrar</button>
            </form>
            <table class="plain bordered">
              <thead>
                <tr><th>#</th><th>Nome</th><th>Status</th><th class="tc">Editar</th></tr>
              </thead>
              <tbody>
                @for (t of tipos(); track t.id) {
                  <tr>
                    <td>{{ t.id }}</td>
                    <td>
                      @if (editandoTipo() === t.id) {
                        <input
                          class="input-inn"
                          type="text"
                          [formControl]="tipoNomeCtrl"
                          (keyup.enter)="salvarTipo(t)"
                          aria-label="Nome do tipo"
                        />
                      } @else {
                        {{ t.nome }}
                      }
                    </td>
                    <td>
                      <button
                        type="button"
                        class="status-chip badge-toggle"
                        [class.bg-success]="t.ativo"
                        [class.bg-danger]="!t.ativo"
                        (click)="statusTipo(t, !t.ativo)"
                      >
                        {{ t.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc">
                      @if (editandoTipo() === t.id) {
                        <button type="button" class="badge-acao bg-green" title="Salvar" (click)="salvarTipo(t)">
                          <mat-icon>check</mat-icon>
                        </button>
                        <button type="button" class="badge-acao bg-gray" title="Cancelar" (click)="editandoTipo.set(null)">
                          <mat-icon>close</mat-icon>
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="badge-acao bg-yellow text-black-50"
                          title="Editar"
                          (click)="editarTipo(t)"
                        >
                          <mat-icon>edit</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="muted tc">Nenhum tipo cadastrado.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }

    <!-- ============ Modal novo quarto ============ -->
    @if (modal() === 'quarto') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn modal-sm" role="dialog" aria-modal="true" aria-labelledby="titulo-quarto">
          <div class="modal-head">
            <h5 id="titulo-quarto">Cadastrar quarto</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <form (submit)="$event.preventDefault(); criarQuarto()">
            <div class="modal-body">
              <label class="lbl" for="quarto-num"> Número <small class="req">*</small> </label>
              <input
                id="quarto-num"
                class="input-inn"
                type="text"
                [formControl]="quartoNumero"
                placeholder="Ex.: Q101"
                title="Número do quarto"
              />
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="quartoNumero.invalid">
                <mat-icon>save</mat-icon> Gravar
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: `
    .tbl-wrap { overflow-x: auto; }
    .center { display: grid; place-items: center; padding: 24px; }
    .dot {
      display: inline-block; width: 12px; height: 12px;
      border-radius: 50%; margin-right: 8px;
    }
    .badge-acao {
      display: inline-flex; align-items: center;
      border: none; border-radius: 0.25rem;
      padding: 0.35em 0.55em; margin: 0 3px;
      color: #fff; cursor: pointer;
    }
    .badge-acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-acao:hover { filter: brightness(0.9); }
    .bg-green { background: #198754; }
    .bg-gray { background: #6c757d; }

    .detalhe {
      margin-top: 1rem; padding: 1rem;
      border: 1px solid rgba(0, 0, 0, 0.125);
      border-radius: 0.25rem;
      background: #fafafa;
    }
    .detalhe-head {
      display: flex; justify-content: space-between; align-items: center;
    }
    .quartos {
      display: flex; flex-wrap: wrap; gap: 10px;
      align-items: center; margin-bottom: 12px;
    }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid #ced4da; border-radius: 4px; padding: 4px 10px;
      background: #fff;
    }
    h4 { font-size: 0.95rem; margin: 0.8rem 0 0.4rem; }

    /* --- modal acomodação (grid col-md-6 do legado) --- */
    .modal-acomodacao { max-width: 560px; }
    .modal-sm { max-width: 340px; }
    .form-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
    }
    .campo { display: flex; flex-direction: column; gap: 4px; }
    .campo.full { grid-column: 1 / -1; }
    .campo-vaga { justify-content: flex-end; gap: 6px; padding-top: 14px; }
    .lbl { font-size: 0.82rem; color: #212529; margin: 0; }
    .req { color: #dc3545; }
    .cor { padding: 2px 4px; height: 32px; }
    .input-group-inn { display: flex; align-items: stretch; }
    .input-group-inn .addon {
      display: inline-flex; align-items: center;
      padding: 0 10px; font-size: 0.8rem;
      background: #5d6d7e; color: #fff;
      border: 1px solid #5d6d7e;
      border-radius: 4px 0 0 4px;
    }
    .input-group-inn .addon mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .input-group-inn .input-inn { border-radius: 0 4px 4px 0; flex: 1; }
    .input-group-inn.mb { margin-bottom: 12px; }
    .input-group-inn.mb .input-inn { border-radius: 4px 0 0 4px; border-right: 0; }
    .input-group-inn.mb .btn-green { border-radius: 0 4px 4px 0; }
    .check-inn { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; }
    .modal-foot {
      display: flex; justify-content: flex-end;
      padding: 10px 14px; border-top: 1px solid #dee2e6;
    }
    .modal-foot .btn-green { display: inline-flex; align-items: center; gap: 6px; }
    .modal-foot mat-icon { font-size: 15px; width: 15px; height: 15px; }
  `,
})
export class AcomodacoesComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('acomodacao', 'quarto', 'tipo_acomodacao', 'estacionamento');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarTipos();
      }
    });
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<Acomodacao[]>([]);
  protected readonly tipos = signal<TipoAcomodacao[]>([]);
  protected readonly quartos = signal<Quarto[]>([]);
  protected readonly tarifas = signal<TarifaHistorico[]>([]);
  protected readonly selecionada = signal<Acomodacao | null>(null);
  protected readonly carregando = signal(true);
  protected readonly num = num;

  protected readonly modal = signal<Modal>(null);
  protected readonly editando = signal<Acomodacao | null>(null);
  protected readonly vagasLivres = signal<VagaEstacionamento[]>([]);
  protected readonly comVaga = signal(false);
  protected readonly vagasSel = signal<number[]>([]);
  protected readonly editandoTipo = signal<number | null>(null);
  protected readonly novoTipo = new FormControl('', [Validators.required]);
  protected readonly tipoNomeCtrl = new FormControl('', [Validators.required]);
  protected readonly quartoNumero = new FormControl('', [Validators.required]);

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    numero: [0, [Validators.required, Validators.min(0)]],
    idtipo_acomodacao: [null as number | null, Validators.required],
    valor: [null as number | null],
    capacidade: [1, [Validators.required, Validators.min(1)]],
    descricao: [''],
    cor: ['#0b5ccc'],
  });

  ngOnInit(): void {
    this.carregar();
    this.carregarTipos();
  }

  carregar(): void {
    this.api.listarAcomodacoes(1, 200).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregarTipos(): void {
    this.api.listarTipos().subscribe({
      next: (t) => this.tipos.set(t),
      error: (e) => this.notify.erro(e),
    });
  }

  tipoNome(id: number | null): string {
    return this.tipos().find((t) => t.id === id)?.nome ?? '—';
  }

  visualizar(a: Acomodacao): void {
    this.selecionada.set(a);
    this.api.listarQuartos(a.id).subscribe({
      next: (q) => this.quartos.set(q),
      error: () => undefined,
    });
    this.api.tarifasAcomodacao(a.id).subscribe({
      next: (t) => this.tarifas.set(t),
      error: () => undefined,
    });
  }

  fecharModal(): void {
    this.modal.set(null);
    this.editando.set(null);
    this.editandoTipo.set(null);
  }

  chk(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  selecionarVagas(e: Event): void {
    const sel = (e.target as HTMLSelectElement).selectedOptions;
    this.vagasSel.set(Array.from(sel).map((o) => Number(o.value)));
  }

  abrirForm(a?: Acomodacao): void {
    this.editando.set(a ?? null);
    this.comVaga.set(false);
    this.vagasSel.set([]);
    if (a) {
      this.form.patchValue({
        nome: a.nome,
        numero: a.numero,
        idtipo_acomodacao: a.idtipo_acomodacao,
        valor: a.valor !== null ? Number(a.valor) : null,
        capacidade: a.capacidade,
        descricao: a.descricao ?? '',
        cor: a.cor ?? '#0b5ccc',
      });
    } else {
      this.form.reset({
        nome: '',
        numero: 0,
        idtipo_acomodacao: null,
        valor: null,
        capacidade: 1,
        descricao: '',
        cor: '#0b5ccc',
      });
      this.api.listarVagas().subscribe({
        next: (v) => this.vagasLivres.set(v.filter((x) => x.ativo && x.idacomodacao === null)),
        error: () => this.vagasLivres.set([]),
      });
    }
    this.modal.set('acomodacao');
  }

  salvar(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const input: AcomodacaoInput = {
      nome: v.nome,
      numero: v.numero,
      idtipo_acomodacao: v.idtipo_acomodacao,
      valor: v.valor,
      capacidade: v.capacidade,
      descricao: v.descricao || null,
      cor: v.cor || null,
      version: this.editando()?.version,
    };
    const editando = this.editando();
    const op = editando
      ? this.api.atualizarAcomodacao(editando.id, input)
      : this.api.criarAcomodacao(input);
    op.subscribe({
      next: (salva) => {
        const vagas = this.vagasSel();
        if (!editando && vagas.length > 0) {
          forkJoin(vagas.map((id) => this.api.vincularVaga(id, salva.id)))
            .subscribe({ error: (e) => this.notify.erro(e) });
        }
        this.notify.ok('Acomodação salva.');
        this.fecharModal();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirTipos(): void {
    this.modal.set('tipos');
  }

  criarTipo(): void {
    const nome = this.novoTipo.value?.trim();
    if (!nome) return;
    this.api.criarTipo(nome).subscribe({
      next: () => {
        this.novoTipo.reset();
        this.carregarTipos();
        this.notify.ok('Tipo criado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  editarTipo(t: TipoAcomodacao): void {
    this.editandoTipo.set(t.id);
    this.tipoNomeCtrl.setValue(t.nome);
  }

  salvarTipo(t: TipoAcomodacao): void {
    const nome = this.tipoNomeCtrl.value?.trim();
    if (!nome) return;
    this.api.atualizarTipo(t.id, nome, t.version).subscribe({
      next: () => {
        this.editandoTipo.set(null);
        this.carregarTipos();
        this.notify.ok('Tipo atualizado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusTipo(t: TipoAcomodacao, ativo: boolean): void {
    this.api.statusTipo(t.id, ativo).subscribe({
      next: () => this.carregarTipos(),
      error: (e) => this.notify.erro(e),
    });
  }

  statusAcomodacao(a: Acomodacao, ativo: boolean): void {
    this.api.statusAcomodacao(a.id, ativo).subscribe({
      next: () => {
        this.notify.ok('Status atualizado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirQuarto(_a: Acomodacao): void {
    this.quartoNumero.reset();
    this.modal.set('quarto');
  }

  criarQuarto(): void {
    const a = this.selecionada();
    const numero = this.quartoNumero.value?.trim();
    if (!a || !numero) return;
    this.api.criarQuarto(a.id, numero).subscribe({
      next: () => {
        this.fecharModal();
        this.visualizar(a);
        this.notify.ok('Quarto cadastrado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusQuarto(q: Quarto, ativo: boolean): void {
    this.api.statusQuarto(q.id, ativo).subscribe({
      next: (novo) => {
        this.quartos.update((list) => list.map((x) => (x.id === novo.id ? novo : x)));
      },
      error: (e) => this.notify.erro(e),
    });
  }
}
