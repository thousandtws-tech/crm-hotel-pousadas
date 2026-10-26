import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '@core/services/api.service';
import { ComprovanteResumo, FormaPagamento } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';

// Réplica de pagamentos/index.php: card "Comprovantes de pagamento"
// + modal "Formas de pagamento" (cadastro/status/edição inline).
@Component({
  selector: 'app-pagamentos',
  imports: [MatIconModule],
  template: `
    <div class="page">
      <button class="btn-dark-blue" type="button" (click)="abrirFormas()">
        <mat-icon>add_box</mat-icon> Formas de pagamento
      </button>

      <div class="inner-card">
        <div class="inner-card-header"><h4>Comprovantes de pagamento</h4></div>
        <div class="inner-card-body">
          <div class="tbl-wrap">
            <table class="plain">
              <thead>
                <tr>
                  <th>Cód.Comprovante</th>
                  <th>Nº Reserva</th>
                  <th>Cliente</th>
                  <th>Acomodação</th>
                  <th class="tc">Visualizar</th>
                  <th class="tc">Baixar</th>
                  <th class="tc">Imprimir</th>
                </tr>
              </thead>
              <tbody>
                @for (c of comprovantes(); track c.idreserva) {
                  <tr>
                    <td>{{ codigo(c) }}</td>
                    <td>{{ c.idreserva }}</td>
                    <td>{{ c.cliente }}</td>
                    <td>{{ c.acomodacao }}</td>
                    <td class="tc">
                      <button
                        class="acao bg-blue1"
                        type="button"
                        title="Visualizar"
                        (click)="visualizar(c)"
                      >
                        <mat-icon>visibility</mat-icon>
                      </button>
                    </td>
                    <td class="tc">
                      <button
                        class="acao bg-green-b"
                        type="button"
                        title="Baixar"
                        (click)="baixar(c)"
                      >
                        <mat-icon>download</mat-icon>
                      </button>
                    </td>
                    <td class="tc">
                      <button
                        class="acao bg-print"
                        type="button"
                        title="Imprimir na térmica"
                        [disabled]="imprimindo() === c.idreserva"
                        (click)="imprimir(c)"
                      >
                        <mat-icon>print</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="muted tc">Nenhum comprovante emitido.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== modal Formas de pagamento (mPagamentos.php) ===== -->
    @if (modalFormas()) {
      <div class="overlay" (click.self)="modalFormas.set(false)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Formas de pagamento">
          <div class="modal-head">
            <h5>Formas de pagamento</h5>
            <button class="close" type="button" (click)="modalFormas.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <div class="input-group-inn">
              <input
                class="input-inn"
                type="text"
                placeholder="Ex.: Dinheiro"
                [value]="nova()"
                (input)="nova.set(valorDe($event))"
                (keyup.enter)="criar()"
                aria-label="Nome da forma de pagamento"
              />
              <button class="btn-green" type="button" (click)="criar()">Cadastrar</button>
            </div>
            <table class="plain">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Status</th>
                  <th class="tc">Editar</th>
                </tr>
              </thead>
              <tbody>
                @for (p of formas(); track p.id) {
                  <tr>
                    <td>{{ p.id }}</td>
                    <td>
                      @if (editando() === p.id) {
                        <input
                          class="input-inn inline"
                          type="text"
                          [value]="p.nome"
                          (keyup.enter)="salvarNome(p, $event)"
                          (blur)="salvarNome(p, $event)"
                          aria-label="Nome"
                        />
                      } @else {
                        {{ p.nome }}
                      }
                    </td>
                    <td>
                      <button
                        class="status-chip clickable"
                        type="button"
                        [class.on]="p.ativo"
                        [class.off]="!p.ativo"
                        (click)="alternar(p)"
                      >{{ p.ativo ? 'Ativo' : 'Inativo' }}</button>
                    </td>
                    <td class="tc">
                      <button
                        class="acao bg-warn"
                        type="button"
                        title="Editar"
                        (click)="editando.set(p.id)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="muted tc">Nenhuma forma cadastrada.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .tc { text-align: center; }
    .tbl-wrap { overflow-x: auto; }
    .acao {
      display: inline-flex; align-items: center;
      border: none; border-radius: 0.25rem;
      padding: 0.35em 0.55em; color: #fff; cursor: pointer;
    }
    .acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .acao:hover { filter: brightness(0.9); }
    .bg-green-b { background-color: #28a745; }
    .bg-print { background-color: #274259; }
    .acao:disabled { opacity: 0.5; cursor: wait; }
    .bg-warn { background-color: #f4d03f; color: #212529; }
    .status-chip.clickable { cursor: pointer; border: none; font-family: inherit; }
    .status-chip.on { background: #28a745; color: #fff; }
    .status-chip.off { background: #dc3545; color: #fff; }

    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(0, 0, 0, 0.5);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 2rem 1rem;
    }
    .modal-inn {
      background: #fff; border-radius: 0.3rem; width: 100%; max-width: 520px;
      box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
      animation: in 0.15s ease-out;
    }
    @keyframes in { from { transform: translateY(-12px); opacity: 0; } }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; border-bottom: 1px solid #dee2e6;
    }
    .modal-head h5 { margin: 0; font-size: 1rem; font-weight: 600; }
    .modal-head .close {
      border: none; background: none; cursor: pointer; color: #555;
      display: inline-flex; padding: 2px;
    }
    .modal-body { padding: 1rem; }
    .modal-body .input-group-inn { margin-bottom: 0.75rem; }
    .input-inn.inline { width: 100%; padding: 0.25rem 0.5rem; }
  `,
})
export class PagamentosComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('forma_pagamento', 'consumo');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarFormas();
      }
    });
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  protected readonly comprovantes = signal<ComprovanteResumo[]>([]);
  protected readonly formas = signal<FormaPagamento[]>([]);
  protected readonly modalFormas = signal(false);
  protected readonly nova = signal('');
  protected readonly editando = signal<number | null>(null);
  protected readonly imprimindo = signal<number | null>(null);

  ngOnInit(): void {
    this.carregar();
    this.carregarFormas();
  }

  carregar(): void {
    this.api.comprovantes().subscribe({
      next: (c) => this.comprovantes.set(c),
      error: (e) => this.notify.erro(e),
    });
  }

  carregarFormas(): void {
    this.api.listarPagamentos(false).subscribe({
      next: (p) => this.formas.set(p),
      error: (e) => this.notify.erro(e),
    });
  }

  abrirFormas(): void {
    this.carregarFormas();
    this.modalFormas.set(true);
  }

  codigo(c: ComprovanteResumo): string {
    return c.comprovante.replace(/\.[^.]+$/, '');
  }

  visualizar(c: ComprovanteResumo): void {
    this.api.comprovanteTexto(c.idreserva).subscribe({
      next: (txt) => {
        const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        window.open(url, '_blank');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  baixar(c: ComprovanteResumo): void {
    this.api.comprovanteTexto(c.idreserva).subscribe({
      next: (txt) => {
        const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = c.comprovante;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  imprimir(c: ComprovanteResumo): void {
    this.imprimindo.set(c.idreserva);
    this.api.imprimirComprovante(c.idreserva).subscribe({
      next: (r) => {
        this.imprimindo.set(null);
        this.notify.ok(r.mensagem);
      },
      error: (e) => {
        this.imprimindo.set(null);
        this.notify.erro(e);
      },
    });
  }

  criar(): void {
    const nome = this.nova().trim();
    if (!nome) return;
    this.api.criarPagamento(nome).subscribe({
      next: () => {
        this.nova.set('');
        this.carregarFormas();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  salvarNome(p: FormaPagamento, e: Event): void {
    const nome = (e.target as HTMLInputElement).value.trim();
    this.editando.set(null);
    if (!nome || nome === p.nome) return;
    this.api.atualizarPagamento(p.id, nome, p.version).subscribe({
      next: () => this.carregarFormas(),
      error: (err) => this.notify.erro(err),
    });
  }

  alternar(p: FormaPagamento): void {
    this.api.statusPagamento(p.id, !p.ativo).subscribe({
      next: () => this.carregarFormas(),
      error: (e) => this.notify.erro(e),
    });
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
