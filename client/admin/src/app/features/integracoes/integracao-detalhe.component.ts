import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { Notify } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  ROTULO_EVENTO,
  CampoCredencial,
  estadoDe,
  rotuloAmbiente,
  rotuloProvedor,
} from './integracoes.const';

const PROVEDORES: M.ProvedorPagamento[] = ['stripe', 'pagbank', 'mercadopago'];
const AMBIENTES: M.AmbienteIntegracao[] = ['producao', 'teste'];

/**
 * Detalhe de um par (provedor × ambiente): credenciais write-only, webhook
 * para copiar, habilitação, teste ao vivo, padrão do site e eventos recebidos.
 * Segredos nunca são exibidos — só o estado configurado/não-configurado.
 */
@Component({
  selector: 'app-integracao-detalhe',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe],
  template: `
    <div class="pag">
      <a class="volta" routerLink="/integracoes"> <mat-icon>arrow_back</mat-icon> Integrações </a>

      @if (carregando()) {
        <div class="inner-card" aria-hidden="true">
          <span class="skel sk-t"></span>
          <span class="skel sk-p"></span>
          <span class="skel sk-m"></span>
          <span class="skel sk-m"></span>
        </div>
      } @else if (falhou() || !i()) {
        <div class="inner-card vazio-card">
          <mat-icon>cloud_off</mat-icon>
          <p>Não foi possível carregar esta integração.</p>
          <button type="button" class="btn-sec" (click)="carregar()">Tentar novamente</button>
        </div>
      } @else {
        @if (i(); as int) {
          <div class="cab">
            <div>
              <p class="eyebrow">Configurações · Integrações</p>
              <h2 class="titulo">
                {{ rotuloProvedor(int.provedor) }}
                <span class="env">{{ rotuloAmbiente(int.ambiente) }}</span>
              </h2>
              <p class="sub">
                Credenciais cifradas no servidor — os valores nunca saem do backend.
              </p>
            </div>
            <div class="cab-pills">
              <span [class]="'pill ' + estadoDe(int.estado).pill">
                {{ estadoDe(int.estado).rotulo }}
              </span>
              @if (int.padrao_site) {
                <span class="pill pill-gold"> <mat-icon>star</mat-icon> Padrão do site </span>
              }
            </div>
          </div>

          @if (conflito()) {
            <div class="aviso" role="alert">
              <mat-icon>warning</mat-icon>
              <span>
                Outro administrador alterou esta integração. Recarregue para ver a versão atual
                antes de salvar.
              </span>
              <button type="button" class="mini-btn" (click)="carregar()">Recarregar</button>
            </div>
          }

          <!-- ================= Credenciais ================= -->
          <div class="inner-card">
            <h3 class="card-h">Credenciais</h3>
            <p class="card-sub">
              Campos em branco mantêm o valor atual; “Limpar” remove o credencial ao salvar.
            </p>

            @for (c of campos(); track c.nome) {
              <div class="dl">
                <span class="dl-rotulo">
                  {{ c.rotulo }}{{ c.obrigatorio ? ' *' : '' }}
                  @if (configurado(c)) {
                    <span class="conf">•••••• configurado</span>
                  }
                </span>
                <span class="segredo-linha">
                  <input
                    class="input-inn"
                    [type]="c.segredo ? 'password' : 'text'"
                    [formControl]="controle(c.nome)"
                    [placeholder]="
                      limpar()[c.nome]
                        ? 'Será removido ao salvar'
                        : configurado(c)
                          ? 'Deixe em branco para manter'
                          : (c.placeholder ?? '')
                    "
                    [disabled]="!!limpar()[c.nome]"
                    [attr.autocomplete]="c.segredo ? 'new-password' : null"
                    [attr.aria-label]="c.rotulo"
                  />
                  @if (configurado(c)) {
                    <button
                      type="button"
                      class="mini-btn"
                      [class.perigo]="limpar()[c.nome]"
                      [attr.aria-label]="
                        (limpar()[c.nome] ? 'Desfazer remoção de ' : 'Remover ') + c.rotulo
                      "
                      (click)="alternarLimpar(c.nome)"
                    >
                      {{ limpar()[c.nome] ? 'Desfazer' : 'Limpar' }}
                    </button>
                  }
                </span>
                @if (c.dica) {
                  <span class="mini">{{ c.dica }}</span>
                }
              </div>
            }

            <label class="dl">
              <span class="dl-rotulo">Nome da conta</span>
              <input
                class="input-inn"
                [formControl]="fNomeConta"
                placeholder="Ex.: Conta da pousada"
              />
            </label>

            <div class="acoes">
              <button type="button" class="btn-pri" (click)="salvar()" [disabled]="salvando()">
                {{ salvando() ? 'Salvando…' : 'Salvar credenciais' }}
              </button>
            </div>
          </div>

          <!-- ================= Webhook ================= -->
          <div class="inner-card">
            <h3 class="card-h">Webhook</h3>
            <p class="card-sub">
              Cadastre esta URL no painel do provedor para receber os eventos de pagamento.
            </p>
            @if (int.webhook_url) {
              <span class="segredo-linha">
                <input
                  class="input-inn mono"
                  readonly
                  [value]="int.webhook_url"
                  aria-label="URL do webhook"
                />
                <button type="button" class="mini-btn" (click)="copiar(int.webhook_url!)">
                  <mat-icon>content_copy</mat-icon> Copiar
                </button>
              </span>
            } @else {
              <p class="mini mut">Nenhuma URL de webhook definida.</p>
            }

            <div class="verif">
              @if (int.ultima_verificacao_em) {
                <span class="mini">
                  Última verificação:
                  {{ int.ultima_verificacao_em | date: 'dd/MM/yyyy HH:mm' }}
                  — {{ int.verificacao_status === 'ok' ? 'ok' : 'falhou' }}
                </span>
                @if (int.verificacao_status === 'falha' && int.verificacao_erro) {
                  <span class="mini erro">{{ int.verificacao_erro }}</span>
                }
              } @else {
                <span class="mini">Nunca verificada.</span>
              }

              <button type="button" class="btn-sec" (click)="testar()" [disabled]="testando()">
                <mat-icon>network_check</mat-icon>
                {{ testando() ? 'Testando…' : 'Testar conexão' }}
              </button>
            </div>

            @if (teste(); as t) {
              <div
                class="res"
                [class.res-ok]="t.verificacao_status === 'ok'"
                [class.res-erro]="t.verificacao_status !== 'ok'"
                role="status"
              >
                <mat-icon>
                  {{ t.verificacao_status === 'ok' ? 'check_circle' : 'error' }}
                </mat-icon>
                <span>
                  @if (t.verificacao_status === 'ok') {
                    Conexão verificada{{ t.nome_conta ? ' — ' + t.nome_conta : '' }}.
                  } @else {
                    Falha na verificação{{ t.mensagem ? ' — ' + t.mensagem : '' }}.
                  }
                </span>
              </div>
            }
          </div>

          <!-- ================= Operação ================= -->
          <div class="inner-card">
            <h3 class="card-h">Operação</h3>

            <div class="op-linha">
              <div>
                <strong>Integração habilitada</strong>
                <p class="mini">Quando desabilitada, o provedor não recebe novas cobranças.</p>
              </div>
              <button
                type="button"
                class="sw"
                [class.on]="int.habilitado"
                role="switch"
                [attr.aria-checked]="int.habilitado"
                aria-label="Integração habilitada"
                (click)="alternarHabilitado(int)"
                [disabled]="alternando()"
              >
                <span class="sw-dot"></span>
              </button>
            </div>

            <div class="op-linha">
              <div>
                <strong>Padrão do site</strong>
                <p class="mini">Novas cobranças do site usam este provedor e ambiente.</p>
              </div>
              <button
                type="button"
                class="btn-sec"
                (click)="definirPadrao()"
                [disabled]="definindo() || int.padrao_site || int.estado !== 'ativa'"
                [title]="
                  int.padrao_site
                    ? 'Já é o padrão do site'
                    : int.estado !== 'ativa'
                      ? 'Só é possível quando a integração está ativa'
                      : 'Definir como padrão'
                "
              >
                <mat-icon>star</mat-icon>
                {{
                  int.padrao_site
                    ? 'Já é o padrão'
                    : definindo()
                      ? 'Definindo…'
                      : 'Definir como padrão'
                }}
              </button>
            </div>
          </div>

          <!-- ================= Eventos ================= -->
          <div class="inner-card">
            <h3 class="card-h">Eventos de webhook</h3>
            <p class="card-sub">Últimos eventos recebidos do provedor.</p>

            @if (carregandoEventos()) {
              <p class="vazio">Carregando…</p>
            } @else if (eventos().length === 0) {
              <p class="vazio">
                Nenhum evento recebido ainda — quando o provedor chamar a URL acima, os eventos
                aparecem aqui.
              </p>
            } @else {
              <table class="tab">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Status</th>
                    <th>Recebido em</th>
                    <th>Último erro</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of eventos(); track e.event_id) {
                    <tr>
                      <td>
                        <strong class="ev-tipo">{{ e.event_type }}</strong>
                        <span class="mini ev-id">{{ e.event_id }}</span>
                      </td>
                      <td>
                        <span [class]="'pill ' + pillEvento(e.status)">
                          {{ rotuloEvento(e.status) }}
                        </span>
                      </td>
                      <td class="ev-data">
                        {{ e.recebido_em | date: 'dd/MM/yyyy HH:mm' }}
                      </td>
                      <td>
                        @if (e.ultimo_erro) {
                          <span class="mini erro" [title]="e.ultimo_erro">
                            {{ e.ultimo_erro }}
                          </span>
                        } @else {
                          <span class="mini mut">—</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        }
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
    .volta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.82rem;
      color: #1a6f8a;
      width: fit-content;
    }
    .volta mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .volta:hover {
      text-decoration: underline;
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
    .env {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #536b73;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 9px;
      vertical-align: middle;
      margin-left: 8px;
    }
    .sub {
      margin: 4px 0 0;
      font-size: 0.82rem;
      color: #5d6d7e;
    }
    .cab-pills {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* ---------- pills ---------- */
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
      white-space: nowrap;
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

    /* ---------- aviso de conflito ---------- */
    .aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #fdf6e8;
      border: 1px solid #ecd9a8;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 0.82rem;
      color: #7a5a10;
    }
    .aviso mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    .aviso .mini-btn {
      margin-left: auto;
    }

    /* ---------- cards ---------- */
    .inner-card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px;
      overflow-x: auto;
    }
    .card-h {
      margin: 0 0 4px;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
    }
    .card-sub {
      margin: 0 0 14px;
      font-size: 0.78rem;
      color: #7d97a1;
    }

    /* ---------- formulário ---------- */
    .dl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.78rem;
      color: #5d6d7e;
      margin-bottom: 12px;
    }
    .dl-rotulo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }
    .conf {
      font-size: 0.7rem;
      font-weight: 600;
      color: #17703f;
      background: rgba(25, 135, 84, 0.1);
      border-radius: 999px;
      padding: 2px 8px;
    }
    .segredo-linha {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .segredo-linha .input-inn {
      flex: 1;
      min-width: 0;
    }
    .segredo-linha .mini-btn {
      flex: none;
      margin-left: 0;
    }
    .input-inn {
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 0.88rem;
      font-family: inherit;
      color: #33424c;
      background: #fff;
    }
    .input-inn:focus {
      outline: none;
      border-color: #1a6f8a;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14);
    }
    .input-inn:disabled {
      background: #f6f9fa;
      color: #8fa3ab;
    }
    .input-inn[readonly] {
      background: #eef2f5;
    }
    .mono {
      font-family: monospace;
      font-size: 0.8rem;
    }
    .acoes {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }

    /* ---------- botões ---------- */
    .btn-pri {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1a6f8a;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      min-height: 38px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-pri:disabled {
      opacity: 0.6;
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
    .btn-sec:hover:not(:disabled) {
      border-color: #1a6f8a;
    }
    .btn-sec:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .btn-sec mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .mini-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid #d7e0e6;
      background: #fff;
      color: #1a6f8a;
      border-radius: 6px;
      padding: 5px 9px;
      font-size: 0.74rem;
      cursor: pointer;
      font-family: inherit;
    }
    .mini-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .mini-btn:hover {
      border-color: #1a6f8a;
    }
    .mini-btn.perigo {
      color: #b3402a;
    }

    /* ---------- verificação ---------- */
    .verif {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid #f0f4f6;
    }
    .verif .btn-sec {
      margin-left: auto;
    }
    .res {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 12px;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 0.82rem;
    }
    .res mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
      margin-top: 1px;
    }
    .res-ok {
      background: rgba(25, 135, 84, 0.08);
      color: #17703f;
    }
    .res-erro {
      background: rgba(179, 64, 42, 0.08);
      color: #b3402a;
    }

    /* ---------- operação ---------- */
    .op-linha {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid #f0f4f6;
    }
    .op-linha:last-child {
      border-bottom: none;
      padding-bottom: 2px;
    }
    .op-linha strong {
      font-size: 0.84rem;
      color: #33424c;
    }
    .op-linha .mini {
      margin-top: 2px;
    }
    .sw {
      flex: none;
      position: relative;
      width: 40px;
      height: 22px;
      border-radius: 999px;
      background: #c3d2d9;
      border: none;
      cursor: pointer;
      transition: background 0.15s;
      padding: 0;
    }
    .sw-dot {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: left 0.15s;
    }
    .sw.on {
      background: #1a6f8a;
    }
    .sw.on .sw-dot {
      left: 21px;
    }
    .sw:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .sw:focus-visible {
      outline: 2px solid #1a6f8a;
      outline-offset: 2px;
    }

    /* ---------- eventos ---------- */
    .tab {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }
    .tab th {
      text-align: left;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7d97a1;
      padding: 6px 10px;
      border-bottom: 1px solid #e3eaef;
    }
    .tab td {
      padding: 10px;
      border-bottom: 1px solid #f0f4f6;
      vertical-align: middle;
    }
    .ev-tipo {
      display: block;
      font-size: 0.84rem;
      color: #33424c;
    }
    .ev-id {
      display: block;
    }
    .ev-data {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-size: 0.8rem;
      color: #536b73;
    }
    .erro {
      color: #b3402a;
    }

    /* ---------- estados ---------- */
    .vazio {
      color: #7d97a1;
      font-size: 0.84rem;
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
    .mini {
      font-size: 0.76rem;
      color: #7d97a1;
    }
    .mut {
      color: #8fa3ab;
    }
    .skel {
      display: block;
      border-radius: 4px;
      background: #eef4f6;
      height: 13px;
      margin-bottom: 10px;
    }
    .sk-t {
      width: 160px;
      height: 18px;
    }
    .sk-p {
      width: 110px;
      height: 22px;
      border-radius: 999px;
    }
    .sk-m {
      width: 70%;
    }

    @media (max-width: 640px) {
      .segredo-linha {
        flex-direction: column;
      }
      .segredo-linha .mini-btn {
        width: fit-content;
      }
    }
  `,
})
export class IntegracaoDetalheComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly provedor = signal<M.ProvedorPagamento>('stripe');
  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly eventos = signal<M.EventoIntegracaoView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly falhou = signal(false);
  protected readonly carregandoEventos = signal(false);
  protected readonly salvando = signal(false);
  protected readonly alternando = signal(false);
  protected readonly testando = signal(false);
  protected readonly teste = signal<M.TesteIntegracao | null>(null);
  protected readonly definindo = signal(false);
  /** 409 do PUT — outro admin salvou depois do nosso carregamento. */
  protected readonly conflito = signal(false);
  /** campos marcados para remoção — enviam `""` no PUT. */
  protected readonly limpar = signal<Record<string, boolean>>({});

  protected readonly fNomeConta = this.fb.nonNullable.control('');
  private readonly controles: Record<string, FormControl<string>> = {};

  protected readonly campos = computed<CampoCredencial[]>(
    () => CAMPOS_POR_PROVEDOR[this.provedor()] ?? [],
  );

  protected readonly rotuloProvedor = rotuloProvedor;
  protected readonly rotuloAmbiente = rotuloAmbiente;
  protected readonly estadoDe = estadoDe;

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const provedor = p.get('provedor') as M.ProvedorPagamento;
      const ambiente = p.get('ambiente') as M.AmbienteIntegracao;
      if (!PROVEDORES.includes(provedor) || !AMBIENTES.includes(ambiente)) {
        this.carregando.set(false);
        this.falhou.set(true);
        return;
      }
      this.provedor.set(provedor);
      this.ambiente.set(ambiente);
      for (const c of CAMPOS_POR_PROVEDOR[provedor]) {
        this.controles[c.nome] = this.fb.nonNullable.control('');
      }
      this.carregar();
    });
  }

  /** Controle reativo do campo de credencial — vazio = manter valor atual. */
  protected controle(nome: string): FormControl<string> {
    return this.controles[nome] ?? (this.controles[nome] = this.fb.nonNullable.control(''));
  }

  protected configurado(c: CampoCredencial): boolean {
    return this.i()?.segredos.campos[c.nome] === true;
  }

  protected alternarLimpar(nome: string): void {
    this.limpar.update((m) => ({ ...m, [nome]: !m[nome] }));
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.falhou.set(false);
    this.conflito.set(false);
    this.teste.set(null);
    this.api.buscar(this.provedor(), this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.fNomeConta.setValue(i.nome_conta ?? '');
        for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
        this.limpar.set({});
        this.carregando.set(false);
        this.carregarEventos();
      },
      error: () => {
        this.carregando.set(false);
        this.falhou.set(true);
        this.notify.erroMsg('Falha ao carregar a integração.');
      },
    });
  }

  private carregarEventos(): void {
    this.carregandoEventos.set(true);
    this.api.eventos(this.provedor(), this.ambiente()).subscribe({
      next: (l) => {
        this.eventos.set(l);
        this.carregandoEventos.set(false);
      },
      error: () => this.carregandoEventos.set(false),
    });
  }

  protected salvar(): void {
    const i = this.i();
    if (!i) return;
    const lim = this.limpar();
    const segredos: Record<string, string> = {};
    for (const c of this.campos()) {
      const v = this.controle(c.nome).value.trim();
      if (lim[c.nome]) segredos[c.nome] = '';
      else if (v) segredos[c.nome] = v;
    }
    const input: M.IntegracaoInput = {
      versao: i.versao,
      nome_conta: this.fNomeConta.value.trim(),
    };
    if (Object.keys(segredos).length) input.segredos = segredos;

    this.salvando.set(true);
    this.api.salvar(i.provedor, i.ambiente, input).subscribe({
      next: (nova) => {
        this.salvando.set(false);
        this.i.set(nova);
        for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
        this.limpar.set({});
        this.notify.ok('Credenciais salvas.');
      },
      error: (e) => {
        this.salvando.set(false);
        if (e instanceof HttpErrorResponse && e.status === 409) {
          this.conflito.set(true);
          this.notify.aviso(
            'Esta integração foi alterada por outro administrador — recarregue antes de salvar.',
          );
        } else {
          this.notify.erro(e);
        }
      },
    });
  }

  protected alternarHabilitado(i: M.IntegracaoView): void {
    this.alternando.set(true);
    this.api.habilitacao(i.provedor, i.ambiente, !i.habilitado).subscribe({
      next: (nova) => {
        this.alternando.set(false);
        this.i.set(nova);
        this.notify.ok(nova.habilitado ? 'Integração habilitada.' : 'Integração desabilitada.');
      },
      error: (e) => {
        this.alternando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected testar(): void {
    const i = this.i();
    if (!i) return;
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar(i.provedor, i.ambiente).subscribe({
      next: (t) => {
        this.testando.set(false);
        this.teste.set(t);
        // A verificação atualiza o estado no backend — recarrega a visão.
        this.api.buscar(i.provedor, i.ambiente).subscribe({
          next: (nova) => this.i.set(nova),
        });
      },
      error: (e) => {
        this.testando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected definirPadrao(): void {
    const i = this.i();
    if (!i) return;
    this.definindo.set(true);
    this.api.definirPadrao(i.provedor, i.ambiente).subscribe({
      next: () => {
        this.definindo.set(false);
        this.i.update((v) => (v ? { ...v, padrao_site: true } : v));
        this.notify.ok('Integração definida como padrão do site.');
      },
      error: (e) => {
        this.definindo.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected copiar(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('URL do webhook copiada.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }

  protected rotuloEvento(status: string): string {
    return ROTULO_EVENTO[status]?.rotulo ?? status;
  }

  protected pillEvento(status: string): string {
    return ROTULO_EVENTO[status]?.pill ?? 'pill-off';
  }
}
