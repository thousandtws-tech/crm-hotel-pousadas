import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@core/services/api.service';
import { Acomodacao, VagaEstacionamento } from '@core/models/api.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';

@Component({
  selector: 'app-estacionamento',
  imports: [ReactiveFormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <div class="inner-card" style="margin-top: 0">
        <div class="inner-card-header"><h4>Estacionamento</h4></div>
        <div class="inner-card-body">
          <form class="form-vaga" (submit)="$event.preventDefault(); criar()" autocomplete="off">
            <label class="form-label-inn" for="numero-vaga">
              Cadastrar vaga (Número)
            </label>
            <div class="input-group-inn">
              <input
                id="numero-vaga"
                class="input-inn"
                type="number"
                min="1"
                required
                [formControl]="numero"
                placeholder="Número da vaga"
                title="Número da vaga"
              />
              <button class="btn-green" type="submit" [disabled]="numero.invalid">
                Cadastrar
              </button>
            </div>
          </form>

          <div class="tbl-wrap">
            @if (carregando()) {
              <div class="center"><mat-spinner diameter="36" /></div>
            }
            <table class="plain bordered">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Número</th>
                  <th>Acomodação</th>
                  <th class="tc">Status</th>
                  @if (auth.isAdmin()) {
                    <th class="tc">Excluir</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (v of vagas(); track v.id) {
                  <tr>
                    <td>{{ v.id }}</td>
                    <td>{{ v.numero }}</td>
                    <td>
                      <select
                        class="input-inn sel"
                        [value]="v.idacomodacao ?? ''"
                        (change)="vincular(v, $event)"
                        aria-label="Acomodação vinculada"
                      >
                        <option value="">Livre</option>
                        @for (a of acomodacoes(); track a.id) {
                          <option [value]="a.id">{{ a.nome }} ({{ a.numero }})</option>
                        }
                      </select>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="status-chip badge-toggle"
                        [class.bg-success]="v.ativo"
                        [class.bg-danger]="!v.ativo"
                        [title]="v.ativo ? 'Desativar' : 'Ativar'"
                        (click)="status(v, !v.ativo)"
                      >
                        {{ v.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    @if (auth.isAdmin()) {
                      <td class="tc">
                        <button
                          type="button"
                          class="btn-del"
                          (click)="remover(v)"
                          aria-label="Excluir vaga"
                          title="Excluir"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      </td>
                    }
                  </tr>
                } @empty {
                  @if (!carregando()) {
                    <tr>
                      <td colspan="5" class="muted tc">Nenhuma vaga cadastrada.</td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .form-vaga { max-width: 340px; }
    .tbl-wrap {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #dee2e6;
      overflow-x: auto;
    }
    .sel { min-width: 160px; }
    .btn-del {
      background: none; border: none; cursor: pointer;
      color: #842029; padding: 2px;
    }
    .btn-del:hover { color: #dc3545; }
    .center { display: grid; place-items: center; padding: 24px; }
  `,
})
export class EstacionamentoComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('estacionamento', 'acomodacao');
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
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly auth = inject(AuthStore);

  protected readonly vagas = signal<VagaEstacionamento[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly carregando = signal(true);
  protected readonly numero = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(1),
  ]);

  ngOnInit(): void {
    this.carregar();
    this.api.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.api.listarVagas().subscribe({
      next: (v) => {
        this.vagas.set(v);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  criar(): void {
    const n = this.numero.value;
    if (n == null || n < 1) return;
    this.api.criarVaga(String(n)).subscribe({
      next: () => {
        this.numero.reset();
        this.notify.ok('Vaga cadastrada.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  vincular(v: VagaEstacionamento, e: Event): void {
    const raw = (e.target as HTMLSelectElement).value;
    const idacomodacao = raw === '' ? null : Number(raw);
    this.api.vincularVaga(v.id, idacomodacao).subscribe({
      next: () => {
        this.notify.ok('Vínculo atualizado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  status(v: VagaEstacionamento, ativo: boolean): void {
    this.api.statusVaga(v.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  async remover(v: VagaEstacionamento): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover a vaga ${v.numero}?`, {
      titulo: 'Remover vaga',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.api.removerVaga(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }
}
