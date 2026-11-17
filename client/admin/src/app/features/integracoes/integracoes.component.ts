import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { Notify } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  ORDEM_AMBIENTE,
  ORDEM_PROVEDOR,
  estadoDe,
  rotuloAmbiente,
  rotuloProvedor,
} from './integracoes.const';

/**
 * Integrações de pagamento — um card por par (provedor × ambiente). Credenciais
 * são cifradas e write-only; aqui só aparecem estado, conta e erros de
 * verificação. Edição acontece no detalhe.
 */
@Component({
  selector: 'app-integracoes',
  imports: [RouterLink, MatIconModule],
  template: `
    <div class="pag">
      <div class="cab">
        <div>
          <p class="eyebrow">Configurações</p>
          <h2 class="titulo">Integrações</h2>
          <p class="sub">
            Provedores de pagamento do site — credenciais cifradas, webhooks e o padrão das novas
            cobranças.
          </p>
        </div>
      </div>

      @if (carregando()) {
        <div class="grade">
          @for (s of skel; track s) {
            <div class="card-int" aria-hidden="true">
              <span class="skel sk-t"></span>
              <span class="skel sk-p"></span>
              <span class="skel sk-m"></span>
            </div>
          }
        </div>
      } @else if (falhou()) {
        <div class="inner-card vazio-card">
          <mat-icon>cloud_off</mat-icon>
          <p>Não foi possível carregar as integrações.</p>
          <button type="button" class="btn-sec" (click)="carregar()">Tentar novamente</button>
        </div>
      } @else {
        <div class="grade">
          @for (i of ordenadas(); track i.provedor + '/' + i.ambiente) {
            <a
              class="card-int"
              [routerLink]="['/integracoes', i.provedor, i.ambiente]"
              [attr.aria-label]="
                'Abrir ' + rotuloProvedor(i.provedor) + ' ' + rotuloAmbiente(i.ambiente)
              "
            >
              <div class="card-top">
                <span class="card-nome">{{ rotuloProvedor(i.provedor) }}</span>
                <span class="env">{{ rotuloAmbiente(i.ambiente) }}</span>
              </div>

              <div class="card-pills">
                <span [class]="'pill ' + estadoDe(i.estado).pill">
                  {{ estadoDe(i.estado).rotulo }}
                </span>
                @if (i.padrao_site) {
                  <span class="pill pill-gold"> <mat-icon>star</mat-icon> Padrão do site </span>
                }
              </div>

              <div class="card-mini">
                @if (i.nome_conta) {
                  <span class="mini">{{ i.nome_conta }}</span>
                }
                @if (i.verificacao_status === 'falha' && i.verificacao_erro) {
                  <span class="mini erro">{{ i.verificacao_erro }}</span>
                } @else if (i.ultima_verificacao_em && i.verificacao_status === 'ok') {
                  <span class="mini">Verificada em {{ dataBr(i.ultima_verificacao_em) }}</span>
                }
              </div>

              <div class="card-fim">
                <span class="mini">{{ i.habilitado ? 'Habilitada' : 'Desabilitada' }}</span>
                <mat-icon class="card-seta">chevron_right</mat-icon>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .pag {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .cab {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    .eyebrow {
      margin: 0;
      font-size: 0.72rem;
      font-weight: 700;
      color: #4b95ab;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .titulo {
      margin: 2px 0 0;
      font-size: 1.4rem;
      font-weight: 600;
      color: #054054;
    }
    .sub {
      margin: 4px 0 0;
      font-size: 0.82rem;
      color: #5d6d7e;
      max-width: 60ch;
    }

    /* ---------- grade de cards (provedor × ambiente) ---------- */
    .grade {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 12px;
    }
    .card-int {
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 14px 16px 12px;
      color: inherit;
      cursor: pointer;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .card-int:hover {
      border-color: #4b95ab;
      box-shadow: 0 1px 4px rgba(5, 64, 84, 0.08);
    }
    .card-int:focus-visible {
      outline: 2px solid #1a6f8a;
      outline-offset: 2px;
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .card-nome {
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
    }
    .env {
      flex: none;
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #536b73;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 9px;
    }

    .card-pills {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(26, 111, 138, 0.1);
      color: #1a6f8a;
    }
    .pill mat-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
    }
    .pill-ok {
      background: rgba(25, 135, 84, 0.12);
      color: #17703f;
    }
    .pill-warn {
      background: rgba(181, 129, 31, 0.14);
      color: #8a6210;
    }
    .pill-erro {
      background: rgba(179, 64, 42, 0.1);
      color: #b3402a;
    }
    .pill-info {
      background: rgba(26, 111, 138, 0.1);
      color: #1a6f8a;
    }
    .pill-gold {
      background: rgba(181, 129, 31, 0.14);
      color: #8a6210;
    }
    .pill-off {
      background: #f0f4f6;
      color: #7d97a1;
    }

    .card-mini {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 1.1rem;
    }
    .mini {
      font-size: 0.76rem;
      color: #7d97a1;
    }
    .mini.erro {
      color: #b3402a;
    }

    .card-fim {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px solid #f0f4f6;
    }
    .card-seta {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #8fa3ab;
    }
    .card-int:hover .card-seta {
      color: #1a6f8a;
    }

    /* ---------- estados ---------- */
    .inner-card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px;
    }
    .vazio-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: #7d97a1;
    }
    .vazio-card mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
    }
    .btn-sec {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #d7e0e6;
      background: #fff;
      color: #1a6f8a;
      border-radius: 8px;
      padding: 0 16px;
      min-height: 38px;
      font-size: 0.82rem;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-sec:hover {
      border-color: #1a6f8a;
    }

    .skel {
      display: block;
      border-radius: 4px;
      background: #eef4f6;
      height: 13px;
    }
    .sk-t {
      width: 120px;
      height: 16px;
    }
    .sk-p {
      width: 90px;
      height: 22px;
      border-radius: 999px;
    }
    .sk-m {
      width: 180px;
    }

    @media (max-width: 640px) {
      .grade {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class IntegracoesComponent implements OnInit {
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(Notify);

  protected readonly integracoes = signal<M.IntegracaoView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly falhou = signal(false);
  protected readonly skel = [0, 1, 2, 3, 4, 5];

  protected readonly rotuloProvedor = rotuloProvedor;
  protected readonly rotuloAmbiente = rotuloAmbiente;
  protected readonly estadoDe = estadoDe;

  /** Ordem estável: provedor (Stripe → PagBank → Mercado Pago), Produção → Teste. */
  protected readonly ordenadas = computed(() =>
    [...this.integracoes()].sort(
      (a, b) =>
        ORDEM_PROVEDOR.indexOf(a.provedor) - ORDEM_PROVEDOR.indexOf(b.provedor) ||
        ORDEM_AMBIENTE.indexOf(a.ambiente) - ORDEM_AMBIENTE.indexOf(b.ambiente),
    ),
  );

  ngOnInit(): void {
    this.carregar();
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.falhou.set(false);
    this.api.listar().subscribe({
      next: (l) => {
        this.integracoes.set(l);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.falhou.set(true);
        this.notify.erroMsg('Falha ao carregar as integrações.');
      },
    });
  }

  protected dataBr(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
