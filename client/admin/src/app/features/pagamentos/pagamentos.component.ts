import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ImpressorasApi } from '@core/api/impressoras.api';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { ComprovanteResumo, FormaPagamento } from '@core/models/pagamentos.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import { AuthStore } from '@core/services/auth.store';

// Central de pagamentos: comprovantes emitidos + formas de pagamento aceitas.
@Component({
  selector: 'app-pagamentos',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [MatIconModule],
  template: `
    <div class="page">
      <!-- ================= Cabeçalho ================= -->
      <div class="pg-head">
        <div>
          <h2 class="pg-titulo">Pagamentos</h2>
          <p class="pg-sub">Comprovantes emitidos no check-out e os meios de pagamento aceitos na pousada</p>
        </div>
        <div class="pg-acoes">
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-formas" class="btn-dark-blue" type="button" (click)="abrirFormas()">
            <mat-icon>credit_card</mat-icon> Formas de pagamento
          </button>
        </div>
      </div>

      <!-- ================= Banners ================= -->
      <div class="pg-banners">
        <div class="pg-banner">
          <span class="pg-banner-ic tint-teal"><mat-icon>receipt_long</mat-icon></span>
          <div>
            <strong>Comprovante a um clique</strong>
            <p>Todo check-out com pagamento gera um comprovante aqui — visualize, baixe o arquivo ou mande para a impressora térmica da recepção.</p>
          </div>
        </div>
        <div class="pg-banner">
          <span class="pg-banner-ic tint-gold"><mat-icon>payments</mat-icon></span>
          <div>
            <strong>Meios de pagamento flexíveis</strong>
            <p>PIX, cartões, dinheiro… cadastre e ative as formas aceitas no botão <b>Formas de pagamento</b>. Elas aparecem na hora de receber do hóspede.</p>
          </div>
        </div>
        <div class="pg-banner">
          <span class="pg-banner-ic tint-navy"><mat-icon>print</mat-icon></span>
          <div>
            <strong>Impressão térmica</strong>
            <p>O botão de impressora envia o comprovante direto para a térmica — sem abrir janelas nem copiar texto.</p>
          </div>
        </div>
      </div>

      <!-- ================= Barra de números ================= -->
      <div class="pg-resumo">
        <div class="pg-est">
          <span class="pg-est-num">{{ comprovantes().length }}</span>
          <span class="pg-est-lbl"><mat-icon>receipt</mat-icon> Comprovantes</span>
        </div>
        <div class="pg-est">
          <span class="pg-est-num">{{ ativas() }}</span>
          <span class="pg-est-lbl"><mat-icon>check_circle</mat-icon> Formas ativas</span>
        </div>
        <div class="pg-est">
          <span class="pg-est-num">{{ formas().length }}</span>
          <span class="pg-est-lbl"><mat-icon>credit_card</mat-icon> Formas cadastradas</span>
        </div>
      </div>

      <!-- ================= Tabela de comprovantes ================= -->
      <div class="inner-card pg-card" id="tour-tabela">
        <div class="pg-toolbar">
          <div class="pg-busca" [class.foco]="buscaFoco()">
            <mat-icon class="pg-busca-icone">search</mat-icon>
            <input
              class="pg-busca-input"
              type="search"
              [value]="termo()"
              (input)="termo.set(valorDe($event))"
              placeholder="Buscar por cliente, nº da reserva ou acomodação…"
              aria-label="Buscar comprovante"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button type="button" class="pg-limpar" aria-label="Limpar busca" (click)="termo.set('')">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          <span class="pg-contagem">{{ filtrados().length }} de {{ comprovantes().length }}</span>
        </div>

        <div class="pg-tabela-wrap">
          <table class="pg-tabela">
            <thead>
              <tr>
                <th>Comprovante</th>
                <th>Hóspede</th>
                <th>Acomodação</th>
                <th class="tc">Reserva</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td><span class="skel sk-cod"></span></td>
                    <td>
                      <span class="skel-cell"><span class="skel sk-av"></span><span class="skel sk-txt"></span></span>
                    </td>
                    <td><span class="skel sk-txt"></span></td>
                    <td><span class="skel sk-chip"></span></td>
                    <td><span class="skel sk-acoes"></span></td>
                  </tr>
                }
              } @else {
                @for (c of filtrados(); track c.idreserva) {
                  <tr>
                    <td class="td-cod"><mat-icon>receipt</mat-icon> {{ codigo(c) }}</td>
                    <td>
                      <div class="pg-cell">
                        <span class="pg-avatar">{{ iniciais(c.cliente) }}</span>
                        <span class="pg-cell-nome">{{ c.cliente }}</span>
                      </div>
                    </td>
                    <td>{{ c.acomodacao }}</td>
                    <td class="tc"><span class="pg-chip">Nº {{ c.idreserva }}</span></td>
                    <td class="tc">
                      <div class="pg-acoes-linha">
                        <button class="acao teal" type="button" title="Visualizar comprovante" (click)="visualizar(c)">
                          <mat-icon>visibility</mat-icon>
                        </button>
                        <button class="acao navy" type="button" title="Baixar arquivo" (click)="baixar(c)">
                          <mat-icon>download</mat-icon>
                        </button>
                        <button
                          class="acao gold" type="button" title="Imprimir na térmica"
                          [disabled]="imprimindo() === c.idreserva"
                          (click)="imprimir(c)"
                        >
                          <mat-icon>{{ imprimindo() === c.idreserva ? 'hourglass_top' : 'print' }}</mat-icon>
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="pg-vazio">
                      <mat-icon>receipt_long</mat-icon>
                      {{ termo() ? 'Nenhum comprovante encontrado para a busca.' : 'Nenhum comprovante emitido ainda — eles aparecem aqui após o check-out.' }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ================= Modal: Formas de pagamento ================= -->
    @if (modalFormas()) {
      <div class="overlay" (click.self)="modalFormas.set(false)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Formas de pagamento">
          <div class="modal-head">
            <h5><mat-icon>credit_card</mat-icon> Formas de pagamento</h5>
            <button class="close" type="button" (click)="modalFormas.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <div class="pg-novo">
              <span class="pg-novo-ic"><mat-icon>add_card</mat-icon></span>
              <div class="pg-novo-txt">
                <strong>Nova forma de pagamento</strong>
                <small>Ex.: PIX, Cartão de crédito, Dinheiro, Vale-refeição</small>
              </div>
              <input
                class="input-inn pg-novo-input"
                type="text"
                placeholder="Nome da forma"
                [value]="nova()"
                (input)="nova.set(valorDe($event))"
                (keyup.enter)="criar()"
                aria-label="Nome da forma de pagamento"
              />
              <button class="btn-dark-blue" type="button" (click)="criar()">
                <mat-icon>add</mat-icon> Cadastrar
              </button>
            </div>

            <div class="pg-tabela-wrap">
              <table class="pg-tabela">
                <thead>
                  <tr>
                    <th class="td-id">#</th>
                    <th>Nome</th>
                    <th class="tc">Status</th>
                    <th class="tc">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of formas(); track p.id) {
                    <tr>
                      <td class="td-id">{{ p.id }}</td>
                      <td>
                        @if (editando() === p.id) {
                          <input
                            class="input-inn pg-edit"
                            type="text"
                            [value]="p.nome"
                            (keyup.enter)="salvarNome(p, $event)"
                            (blur)="salvarNome(p, $event)"
                            aria-label="Nome"
                          />
                        } @else {
                          <span class="pg-forma-nome"><mat-icon>payments</mat-icon>{{ p.nome }}</span>
                        }
                      </td>
                      <td class="tc">
                        <button
                          class="status-chip clickable"
                          type="button"
                          [class.on]="p.ativo"
                          [class.off]="!p.ativo"
                          title="Clique para alternar"
                          (click)="alternar(p)"
                        >{{ p.ativo ? 'Ativa' : 'Inativa' }}</button>
                      </td>
                      <td class="tc">
                        <div class="pg-acoes-linha">
                          <button class="acao gold" type="button" title="Renomear" (click)="editando.set(p.id)">
                            <mat-icon>edit</mat-icon>
                          </button>
                          @if (auth.isAdmin()) {
                            <button
                              class="acao navy" type="button" title="Excluir"
                              aria-label="Excluir forma de pagamento"
                              (click)="excluir(p)"
                            >
                              <mat-icon>delete</mat-icon>
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="4" class="pg-vazio-tab">Nenhuma forma cadastrada — crie a primeira acima.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .pg-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .pg-titulo { margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054; letter-spacing: -0.02em; }
    .pg-sub { margin: 2px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .pg-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .pg-acoes button { display: inline-flex; align-items: center; gap: 6px; }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #d7e0e6; background: #fff;
      color: #5d6d7e; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600; font-family: inherit;
      transition: border-color .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { border-color: #1a6f8a; color: #1a6f8a; }

    /* ---------- banners ---------- */
    .pg-banners {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 960px) { .pg-banners { grid-template-columns: 1fr; } }
    .pg-banner {
      display: flex; gap: 12px; align-items: flex-start;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 14px 16px;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .pg-banner:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(5, 64, 84, 0.07); }
    .pg-banner-ic {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pg-banner-ic mat-icon { font-size: 21px; width: 21px; height: 21px; }
    .tint-teal { background: rgba(26, 111, 138, 0.1); color: #1a6f8a; }
    .tint-gold { background: rgba(221, 165, 84, 0.14); color: #b5811f; }
    .tint-navy { background: rgba(5, 64, 84, 0.08); color: #054054; }
    .pg-banner strong { display: block; font-size: 0.88rem; color: #054054; margin-bottom: 3px; }
    .pg-banner p { margin: 0; font-size: 0.78rem; color: #7d97a1; line-height: 1.45; }

    /* ---------- resumo ---------- */
    .pg-resumo {
      display: flex; align-items: center;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      margin-bottom: 16px; overflow-x: auto;
    }
    .pg-est {
      display: flex; flex-direction: column; gap: 3px;
      padding: 12px 26px; min-width: 150px;
      border-left: 1px solid #eef2f5;
    }
    .pg-est:first-child { border-left: none; }
    .pg-est-num {
      font-size: 1.5rem; font-weight: 800; color: #054054;
      line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
    }
    .pg-est-lbl {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; font-weight: 600; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap;
    }
    .pg-est-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; color: #a5b6bf; }

    /* ---------- toolbar/busca ---------- */
    .pg-card { padding-top: 14px; }
    .pg-toolbar {
      display: flex; align-items: center; gap: 14px;
      padding: 4px 2px 14px;
    }
    .pg-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; max-width: 420px;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color .15s, box-shadow .15s;
    }
    .pg-busca.foco { border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14); }
    .pg-busca-icone { color: #7d97a1; font-size: 20px; width: 20px; height: 20px; }
    .pg-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #33424c; font-family: inherit; height: 100%;
    }
    .pg-busca-input::placeholder { color: #8fa3ab; }
    .pg-busca-input::-webkit-search-cancel-button { display: none; }
    .pg-limpar {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .pg-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .pg-limpar:hover { background: #d7e0e6; }
    .pg-contagem { font-size: 0.78rem; color: #8a99a4; margin-left: auto; white-space: nowrap; }

    /* ---------- tabela ---------- */
    .pg-tabela-wrap { overflow-x: auto; }
    .pg-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .pg-tabela thead th {
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 12px 16px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .pg-tabela tbody td {
      padding: 12px 16px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .pg-tabela tbody tr:hover { background: #f7fafb; }
    .pg-tabela .tc { text-align: center; }
    .td-cod {
      font-weight: 700; color: #054054; white-space: nowrap;
    }
    .td-cod mat-icon { font-size: 16px; width: 16px; height: 16px; vertical-align: -3px; color: #1a6f8a; margin-right: 6px; }
    .td-id { font-weight: 700; color: #054054; }
    .pg-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .pg-avatar {
      width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em;
    }
    .pg-cell-nome {
      font-weight: 600; color: #054054;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px;
    }
    .pg-chip {
      display: inline-flex; align-items: center;
      background: #eef4f6; color: #1a6f8a; border-radius: 999px;
      padding: 3px 12px; font-size: 0.78rem; font-weight: 700; white-space: nowrap;
    }
    .pg-acoes-linha { display: inline-flex; gap: 5px; }
    .acao {
      display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 6px; width: 30px; height: 30px;
      color: #fff; cursor: pointer; transition: filter .14s;
    }
    .acao mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .acao:hover { filter: brightness(1.12); }
    .acao:disabled { opacity: 0.55; cursor: wait; }
    .acao.teal { background: #1a6f8a; }
    .acao.navy { background: #054054; }
    .acao.gold { background: #b5811f; color: #054054; }
    .pg-vazio {
      text-align: center; color: #8a99a4; padding: 34px !important; font-size: 0.86rem;
    }
    .pg-vazio mat-icon { display: block; margin: 0 auto 8px; font-size: 30px; width: 30px; height: 30px; color: #c3d2d9; }
    .pg-vazio-tab { text-align: center; color: #8a99a4; padding: 22px !important; font-size: 0.84rem; }
    .pg-forma-nome {
      display: inline-flex; align-items: center; gap: 8px;
      font-weight: 600; color: #054054;
    }
    .pg-forma-nome mat-icon { font-size: 17px; width: 17px; height: 17px; color: #1a6f8a; }
    .pg-edit { width: 100%; max-width: 260px; }

    /* ---------- skeleton ---------- */
    .skel-row td { padding: 14px 16px; }
    .skel {
      display: block; border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-cell { display: flex; align-items: center; gap: 10px; }
    .sk-av { width: 34px; height: 34px; border-radius: 50%; }
    .sk-cod { width: 110px; height: 16px; }
    .sk-txt { width: 130px; height: 14px; }
    .sk-chip { width: 70px; height: 22px; border-radius: 999px; margin: 0 auto; }
    .sk-acoes { width: 100px; height: 26px; margin: 0 auto; }

    /* ---------- modal ---------- */
    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(5, 64, 84, 0.45);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 2rem 1rem; backdrop-filter: blur(2px);
    }
    .modal-inn {
      background: #fff; border-radius: 12px; width: 100%; max-width: 560px;
      box-shadow: 0 18px 50px rgba(5, 64, 84, 0.25);
      animation: in 0.16s ease-out;
      max-height: 88vh; display: flex; flex-direction: column;
    }
    @keyframes in { from { transform: translateY(-12px); opacity: 0; } }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.85rem 1.15rem; border-bottom: 1px solid #e3eaef;
    }
    .modal-head h5 {
      margin: 0; font-size: 1rem; font-weight: 700; color: #054054;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .modal-head h5 mat-icon { font-size: 19px; width: 19px; height: 19px; color: #1a6f8a; }
    .modal-head .close {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 28px; height: 28px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .modal-head .close:hover { background: #d7e0e6; }
    .modal-head .close mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .modal-body { padding: 1rem 1.15rem; overflow-y: auto; }
    .pg-novo {
      display: flex; align-items: center; gap: 10px;
      background: #f4f8fa; border: 1px dashed #c5d6de; border-radius: 10px;
      padding: 10px 12px; margin-bottom: 14px; flex-wrap: wrap;
    }
    .pg-novo-ic {
      width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
      background: #1a6f8a; color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pg-novo-ic mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pg-novo-txt { display: flex; flex-direction: column; margin-right: 4px; }
    .pg-novo-txt strong { font-size: 0.85rem; color: #054054; }
    .pg-novo-txt small { font-size: 0.72rem; color: #7d97a1; }
    .pg-novo-input { flex: 1; min-width: 140px; }
    .status-chip.clickable { cursor: pointer; border: none; font-family: inherit; }
    .status-chip.on { background: #1a6f8a; color: #fff; }
    .status-chip.off { background: #7d97a1; color: #fff; }
  `,
})
export class PagamentosComponent implements OnInit {
  private readonly impressorasApi = inject(ImpressorasApi);
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly rt = inject(Realtime);
  private readonly tour = inject(TourGuiado);
  protected readonly auth = inject(AuthStore);

  protected readonly comprovantes = signal<ComprovanteResumo[]>([]);
  protected readonly formas = signal<FormaPagamento[]>([]);
  protected readonly modalFormas = signal(false);
  protected readonly nova = signal('');
  protected readonly editando = signal<number | null>(null);
  protected readonly imprimindo = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly skel = [0, 1, 2, 3, 4];

  protected readonly ativas = computed(() => this.formas().filter((f) => f.ativo).length);

  protected readonly filtrados = computed(() => {
    const t = this.termo().trim().toLowerCase();
    if (!t) return this.comprovantes();
    return this.comprovantes().filter(
      (c) =>
        c.cliente.toLowerCase().includes(t) ||
        c.acomodacao.toLowerCase().includes(t) ||
        String(c.idreserva).includes(t) ||
        this.codigo(c).toLowerCase().includes(t),
    );
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('forma_pagamento', 'consumo', 'pagamento');
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

  ngOnInit(): void {
    this.carregar();
    this.carregarFormas();
  }

  onEsc(): void {
    if (this.modalFormas()) this.modalFormas.set(false);
  }

  carregar(): void {
    this.pagamentosApi.comprovantes().subscribe({
      next: (c) => {
        this.comprovantes.set(c);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregarFormas(): void {
    this.pagamentosApi.listarPagamentos(false).subscribe({
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

  iniciais(nome: string | null | undefined): string {
    if (!nome) return '?';
    const p = nome.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  visualizar(c: ComprovanteResumo): void {
    this.pagamentosApi.comprovanteTexto(c.idreserva).subscribe({
      next: (txt) => {
        const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        window.open(url, '_blank');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  baixar(c: ComprovanteResumo): void {
    this.pagamentosApi.comprovanteTexto(c.idreserva).subscribe({
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
    this.impressorasApi.imprimirComprovante(c.idreserva).subscribe({
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
    this.pagamentosApi.criarPagamento(nome).subscribe({
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
    this.pagamentosApi.atualizarPagamento(p.id, nome, p.version).subscribe({
      next: () => this.carregarFormas(),
      error: (err) => this.notify.erro(err),
    });
  }

  alternar(p: FormaPagamento): void {
    this.pagamentosApi.statusPagamento(p.id, !p.ativo).subscribe({
      next: () => this.carregarFormas(),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(p: FormaPagamento): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a forma de pagamento "${p.nome}"?`,
      { titulo: 'Excluir forma de pagamento', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.pagamentosApi.excluirPagamento(p.id).subscribe({
      next: () => {
        this.notify.ok('Forma de pagamento excluída.');
        this.carregarFormas();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à tela de Pagamentos!',
          description:
            'Aqui ficam os <b>comprovantes emitidos</b> e as <b>formas de ' +
            'pagamento</b> aceitas na pousada. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '.pg-resumo',
        popover: {
          title: 'Resumo rápido',
          description:
            'Quantos <b>comprovantes</b> já foram emitidos e quantas ' +
            '<b>formas de pagamento</b> estão ativas no momento.',
          side: 'bottom',
        },
      },
      {
        element: '.pg-busca',
        popover: {
          title: 'Busca instantânea',
          description:
            'Digite o <b>nome do hóspede</b>, o <b>nº da reserva</b> ou a ' +
            '<b>acomodação</b> — a lista filtra sozinha.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Comprovantes',
          description:
            'Cada linha é um comprovante de check-out. Os botões permitem ' +
            '<b>visualizar</b> (teal), <b>baixar o arquivo</b> (navy) e ' +
            '<b>imprimir na térmica</b> (dourado).',
          side: 'top',
        },
      },
      {
        element: '#tour-formas',
        popover: {
          title: 'Formas de pagamento',
          description:
            'Abre o cadastro dos meios aceitos: <b>PIX, cartões, dinheiro</b>… ' +
            'O que estiver <b>ativo</b> aparece na hora de receber do hóspede ' +
            'no check-out.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Tela de Pagamentos dominada. Lembre: comprovante só existe após ' +
            'o check-out — e a impressão sai direto na térmica da recepção.',
        },
      },
    ]);
  }
}
