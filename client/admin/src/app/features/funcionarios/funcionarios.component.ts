import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '@core/services/api.service';
import { Funcionario, FuncionarioInput, FuncionarioUpdate } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { DateInputComponent } from '@shared/components/date-input.component';

@Component({
  selector: 'app-funcionarios',
  imports: [
    RouterLink,
    MatPaginatorModule,
    MatIconModule,
    ReactiveFormsModule,
    DateInputComponent,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <h1>Administrador</h1>
        <a class="btn-gray" routerLink="/auditoria">
          <mat-icon>history</mat-icon> Histórico de alterações
        </a>
      </div>

      <div class="func-grid">
        <!-- ===== cadastro inline (legado admin/index.php col-md-4) ===== -->
        <div class="inner-card" style="margin-top:0">
          <div class="inner-card-header">
            <mat-icon class="hdr-ic">badge</mat-icon> Cadastro de funcionário
          </div>
          <div class="inner-card-body">
            <form [formGroup]="formCad" (ngSubmit)="cadastrar()" class="f-cad">
              <div class="campo">
                <label class="lbl" for="c-nome"> Nome completo <small class="req">*</small> </label>
                <input id="c-nome" class="input-inn" type="text" formControlName="nome" autocomplete="off" />
              </div>
              <div class="f-duo">
                <div class="campo">
                  <label class="lbl" for="c-nasc"> Data de nascimento <small class="req">*</small> </label>
                  <app-date formControlName="data_nascimento" />
                </div>
                <div class="campo">
                  <label class="lbl" for="c-cpf"> CPF <small class="req">*</small> </label>
                  <input id="c-cpf" class="input-inn" type="text" formControlName="cpf" autocomplete="off" placeholder="000.000.000-00" />
                </div>
              </div>
              <div class="campo">
                <label class="lbl" for="c-nivel"> Função <small class="req">*</small> </label>
                <select id="c-nivel" class="input-inn" formControlName="nivel">
                  <option [ngValue]="3"> Recepção </option>
                  <option [ngValue]="2"> Gerente </option>
                  <option [ngValue]="1"> Administrador </option>
                </select>
              </div>
              <div class="f-duo">
                <div class="campo">
                  <label class="lbl" for="c-login"> Login <small class="req">*</small> </label>
                  <input id="c-login" class="input-inn" type="text" formControlName="login" autocomplete="off" />
                </div>
                <div class="campo">
                  <label class="lbl" for="c-senha"> Senha <small class="req">*</small> </label>
                  <input id="c-senha" class="input-inn" type="password" formControlName="senha" autocomplete="new-password" />
                </div>
              </div>
              <div class="cad-foot">
                <button class="btn-dark-blue" type="submit" [disabled]="formCad.invalid">
                  <mat-icon>save</mat-icon> Cadastrar
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- ===== listagem (legado col-md-8) ===== -->
        <div class="inner-card" style="margin-top:0">
          <div class="inner-card-header">
            <mat-icon class="hdr-ic">id_card</mat-icon> Funcionários cadastrados
          </div>
          <div class="inner-card-body" style="padding:0">
            <div class="table-wrap">
              <table class="plain">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>CPF</th>
                    <th>Tipo</th>
                    <th class="ta-c">Status</th>
                    <th class="ta-c">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of items(); track f.id) {
                    <tr>
                      <td>{{ f.id }}</td>
                      <td>
                        {{ f.nome }}
                        @if (f.id === auth.user()?.id) {
                          <small class="muted">(você)</small>
                        }
                      </td>
                      <td style="white-space:nowrap">{{ f.cpf || '—' }}</td>
                      <td>{{ nivelNome(f.nivel) }}</td>
                      <td class="ta-c">
                        <button
                          type="button"
                          class="status-chip badge-toggle"
                          [class.bg-green]="f.ativo"
                          [class.bg-danger]="!f.ativo"
                          [disabled]="f.id === auth.user()?.id"
                          [title]="f.id === auth.user()?.id ? 'Você não pode desativar a si mesmo' : (f.ativo ? 'Desativar' : 'Ativar')"
                          (click)="status(f, !f.ativo)"
                        >{{ f.ativo ? 'Ativo' : 'Inativo' }}</button>
                      </td>
                      <td class="ta-c">
                        <button
                          type="button"
                          class="badge-acao bg-yellow"
                          (click)="abrirEdicao(f)"
                          aria-label="Editar funcionário"
                          title="Editar"
                        ><mat-icon>edit</mat-icon></button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="ta-c muted">Nenhum funcionário.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <mat-paginator
              [length]="total()"
              [pageSize]="20"
              [pageIndex]="pagina() - 1"
              (page)="mudouPagina($event)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ============ Modal editar (legado mEditarFuncionario) ============ -->
    @if (editando(); as f) {
      <div class="overlay" (click.self)="fecharEdicao()">
        <div class="modal-inn modal-md" role="dialog" aria-modal="true" aria-labelledby="titulo-edit">
          <div class="modal-head">
            <h5 id="titulo-edit">{{ f.nome }}</h5>
            <button type="button" class="close" (click)="fecharEdicao()" aria-label="Fechar">&times;</button>
          </div>
          <form [formGroup]="formEdit" (ngSubmit)="salvarEdicao()">
            <div class="modal-body f-grid">
              <div class="campo full">
                <label class="lbl" for="e-nome"> Nome completo <small class="req">*</small> </label>
                <input id="e-nome" class="input-inn" type="text" formControlName="nome" autocomplete="off" />
              </div>
              <div class="campo">
                <label class="lbl" for="e-nasc"> Data de nascimento <small class="req">*</small> </label>
                <app-date formControlName="data_nascimento" />
              </div>
              <div class="campo">
                <label class="lbl" for="e-cpf"> CPF <small class="req">*</small> </label>
                <input id="e-cpf" class="input-inn" type="text" formControlName="cpf" autocomplete="off" />
              </div>
              <div class="campo full">
                <label class="lbl" for="e-nivel"> Função <small class="req">*</small> </label>
                <select id="e-nivel" class="input-inn" formControlName="nivel">
                  <option [ngValue]="3"> Recepção </option>
                  <option [ngValue]="2"> Gerente </option>
                  <option [ngValue]="1"> Administrador </option>
                </select>
              </div>
              <div class="campo full">
                <label class="lbl" for="e-login"> Login <small class="req">*</small> </label>
                <input id="e-login" class="input-inn" type="text" formControlName="login" autocomplete="off" />
              </div>
              <div class="campo">
                <label class="check-inn">
                  <input type="checkbox" [checked]="trocaSenha()" (change)="alternarSenha()" />
                  Alterar senha
                </label>
                <input
                  class="input-inn"
                  type="password"
                  formControlName="senha"
                  placeholder="Nova senha"
                  autocomplete="new-password"
                />
              </div>
              <small class="req">* Obrigatório</small>
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="formEdit.invalid">
                <mat-icon>save</mat-icon> Salvar
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: `
    .func-grid {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 1rem;
    }
    .func-grid > .inner-card { display: flex; flex-direction: column; }
    .func-grid > .inner-card > .inner-card-body { flex: 1; }
    .hdr-ic { font-size: 18px; width: 18px; height: 18px; vertical-align: -3px; margin-right: 4px; }
    .f-cad { display: flex; flex-direction: column; gap: 10px; }
    .f-duo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .cad-foot { display: flex; justify-content: flex-end; margin-top: 4px; }
    .table-wrap { overflow-x: auto; }
    .ta-c { text-align: center; }
    .muted { color: #6c757d; }
    .badge-toggle:disabled { opacity: 0.6; cursor: default; }
    @media (max-width: 900px) {
      .func-grid { grid-template-columns: 1fr; }
    }
  `,
})
export class FuncionariosComponent implements OnInit {
  private readonly rt = inject(Realtime);
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<Funcionario[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly editando = signal<Funcionario | null>(null);
  protected readonly trocaSenha = signal(false);

  /** Cadastro inline — mesmo conjunto de campos do card do legado. */
  protected readonly formCad = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    data_nascimento: ['', Validators.required],
    cpf: ['', Validators.required],
    nivel: [3, Validators.required],
    login: ['', Validators.required],
    senha: ['', [Validators.required, Validators.minLength(8)]],
  });

  /** Edição — senha opcional via checkbox "Alterar senha" (verificaCheck do legado). */
  protected readonly formEdit = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    data_nascimento: ['', Validators.required],
    cpf: ['', Validators.required],
    nivel: [3, Validators.required],
    login: ['', Validators.required],
    senha: this.fb.nonNullable.control({ value: '', disabled: true }, [Validators.minLength(8)]),
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('funcionario');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
  }

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.api.listarFuncionarios(this.pagina(), 20).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.total.set(p.total);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregar();
  }

  nivelNome(n: number): string {
    return n === 1 ? 'Administrador' : n === 2 ? 'Gerente' : 'Recepção';
  }

  status(f: Funcionario, ativo: boolean): void {
    this.api.statusFuncionario(f.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  cadastrar(): void {
    if (this.formCad.invalid) return;
    const v = this.formCad.getRawValue();
    const input: FuncionarioInput = {
      nome: v.nome,
      login: v.login,
      senha: v.senha,
      cpf: v.cpf || null,
      data_nascimento: v.data_nascimento || null,
      nivel: v.nivel,
    };
    this.api.criarFuncionario(input).subscribe({
      next: () => {
        this.notify.ok('Funcionário cadastrado.');
        this.formCad.reset({ nome: '', data_nascimento: '', cpf: '', nivel: 3, login: '', senha: '' });
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirEdicao(f: Funcionario): void {
    this.editando.set(f);
    this.trocaSenha.set(false);
    this.formEdit.controls.senha.disable();
    this.formEdit.reset({
      nome: f.nome,
      data_nascimento: f.data_nascimento ?? '',
      cpf: f.cpf ?? '',
      nivel: f.nivel,
      login: f.login,
      senha: '',
    });
  }

  fecharEdicao(): void {
    this.editando.set(null);
  }

  /** Legado verificaCheck(): habilita/desabilita o campo de senha. */
  alternarSenha(): void {
    const on = !this.trocaSenha();
    this.trocaSenha.set(on);
    const ctrl = this.formEdit.controls.senha;
    if (on) {
      ctrl.enable();
      ctrl.setValidators([Validators.required, Validators.minLength(8)]);
    } else {
      ctrl.disable();
      ctrl.setValue('');
      ctrl.setValidators([Validators.minLength(8)]);
    }
    ctrl.updateValueAndValidity();
  }

  salvarEdicao(): void {
    const f = this.editando();
    if (!f || this.formEdit.invalid) return;
    const v = this.formEdit.getRawValue();
    const input: FuncionarioUpdate = {
      nome: v.nome,
      login: v.login,
      cpf: v.cpf || null,
      data_nascimento: v.data_nascimento || null,
      nivel: v.nivel,
      version: f.version,
    };
    if (v.senha) input.senha = v.senha;
    this.api.atualizarFuncionario(f.id, input).subscribe({
      next: () => {
        this.notify.ok('Funcionário salvo.');
        this.fecharEdicao();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }
}
