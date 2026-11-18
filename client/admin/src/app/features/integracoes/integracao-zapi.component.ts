// UI de integracao-zapi — template, estilos e bindings. A lógica vive em integracao-zapi.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { estadoDe } from './integracoes.const';
import { IntegracaoZapiStore } from './integracao-zapi.store';

@Component({
  selector: 'app-integracao-zapi',
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
              <p class="eyebrow">Configurações · Integrações · Comunicação</p>
              <h2 class="titulo">
                Z-API
                <span class="env">Produção</span>
              </h2>
              <p class="sub">
                WhatsApp Business via Z-API — credenciais cifradas no servidor e sessão pareada por
                QR Code.
              </p>
            </div>
            <div class="cab-pills">
              <span [class]="'pill ' + estadoDe(int.estado).pill">
                {{ estadoDe(int.estado).rotulo }}
              </span>
              <span
                class="pill"
                [class.pill-ok]="sessaoConectada()"
                [class.pill-warn]="!sessaoConectada()"
              >
                {{ sessaoConectada() ? 'WhatsApp conectado' : 'WhatsApp não pareado' }}
              </span>
              @if (int.padrao_site) {
                <span class="pill pill-gold"> <mat-icon>star</mat-icon> Padrão WhatsApp </span>
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
              Dados da instância no painel Z-API. Campos em branco mantêm o valor atual; “Limpar”
              remove o credencial ao salvar.
            </p>

            <label class="dl">
              <span class="dl-rotulo">Nome da conexão</span>
              <input
                class="input-inn"
                [formControl]="fNomeConta"
                placeholder="Ex.: WhatsApp da pousada"
              />
            </label>

            <label class="dl">
              <span class="dl-rotulo">Instance ID</span>
              <input
                class="input-inn mono"
                [formControl]="fInstanceId"
                placeholder="Ex.: 3E2A1B…"
                autocomplete="off"
              />
              <span class="mini"
                >Identificador da instância — visível no painel, não é segredo.</span
              >
            </label>

            @for (c of campos; track c.nome) {
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

            <div class="dl">
              <span class="dl-rotulo">
                Segredo do webhook
                @if (segredoWebhook()) {
                  <span class="conf">•••••• configurado</span>
                }
              </span>
              <input
                class="input-inn"
                readonly
                [value]="
                  segredoWebhook()
                    ? 'Gerado automaticamente pelo servidor'
                    : 'Será gerado automaticamente ao salvar'
                "
                aria-label="Segredo do webhook — gerado automaticamente"
              />
              <span class="mini">
                Autentica os callbacks na URL pública — gerado pelo servidor, não é editável.
              </span>
            </div>

            <div class="acoes">
              <button type="button" class="btn-pri" (click)="salvar()" [disabled]="salvando()">
                {{ salvando() ? 'Salvando…' : 'Salvar credenciais' }}
              </button>
            </div>

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

          <!-- ================= Sessão WhatsApp ================= -->
          <div class="inner-card">
            <h3 class="card-h">Sessão WhatsApp</h3>
            <p class="card-sub">
              Credencial válida não significa sessão conectada — o pareamento é feito por QR Code.
            </p>

            @if (sessao(); as s) {
              <dl class="fatos">
                <div class="fato">
                  <dt>Estado</dt>
                  <dd>{{ s.conectado ? 'Conectado' : 'Não pareado' }}</dd>
                </div>
                @if (s.telefone) {
                  <div class="fato">
                    <dt>Número</dt>
                    <dd>{{ s.telefone }}</dd>
                  </div>
                }
                <div class="fato">
                  <dt>Smartphone</dt>
                  <dd>{{ s.smartphone_conectado ? 'Online' : 'Offline' }}</dd>
                </div>
                @if (s.verificado_em) {
                  <div class="fato">
                    <dt>Verificado em</dt>
                    <dd>{{ s.verificado_em | date: 'dd/MM/yyyy HH:mm' }}</dd>
                  </div>
                }
                @if (s.desconectado_em) {
                  <div class="fato">
                    <dt>Desconectado em</dt>
                    <dd>{{ s.desconectado_em | date: 'dd/MM/yyyy HH:mm' }}</dd>
                  </div>
                }
              </dl>
            } @else {
              <p class="vazio">
                Sessão ainda não observada — salve as credenciais e atualize o status.
              </p>
            }

            <div class="acoes-linha">
              <button
                type="button"
                [class]="sessaoConectada() ? 'btn-sec' : 'btn-pri'"
                (click)="abrirQr()"
                [disabled]="qrCarregando()"
              >
                <mat-icon>qr_code_2</mat-icon>
                {{ sessaoConectada() ? 'Exibir QR Code' : 'Conectar WhatsApp' }}
              </button>
              <button type="button" class="btn-sec" (click)="testar()" [disabled]="testando()">
                <mat-icon>sync</mat-icon>
                {{ testando() ? 'Atualizando…' : 'Atualizar status' }}
              </button>
              <button
                type="button"
                class="btn-sec perigo"
                (click)="desconectar()"
                [disabled]="desconectando() || !sessaoConectada()"
                title="Desvincula o número — será preciso ler um novo QR Code"
              >
                <mat-icon>link_off</mat-icon>
                {{ desconectando() ? 'Desconectando…' : 'Desconectar sessão' }}
              </button>
            </div>

            @if (qrAberto()) {
              <div class="qr-area">
                @if (qrCarregando()) {
                  <p class="vazio">Gerando QR Code…</p>
                } @else if (qrErro()) {
                  <div class="res res-erro" role="alert">
                    <mat-icon>error</mat-icon>
                    <span>{{ qrErro() }}</span>
                  </div>
                  <div class="acoes-linha">
                    <button type="button" class="btn-sec" (click)="buscarQr()">
                      <mat-icon>refresh</mat-icon> Tentar novamente
                    </button>
                    <button type="button" class="mini-btn" (click)="fecharQr()">Fechar</button>
                  </div>
                } @else if (qr(); as q) {
                  @if (q.tipo === 'imagem') {
                    <img class="qr-img" [src]="q.valor" alt="QR Code para parear o WhatsApp" />
                    <p class="mini qr-dica">
                      WhatsApp → Aparelhos conectados → Conectar aparelho — aponte a câmera para o
                      código. Depois de parear, use “Atualizar status” para conferir a sessão.
                    </p>
                  } @else {
                    <div class="res res-info" role="status">
                      <mat-icon>smartphone</mat-icon>
                      <span>{{ q.mensagem }}</span>
                    </div>
                    <p class="mini qr-dica">
                      O provedor pediu verificação adicional — conclua o pareamento pelo painel
                      oficial da Z-API.
                    </p>
                  }
                  <div class="acoes-linha">
                    <button type="button" class="btn-sec" (click)="buscarQr()">
                      <mat-icon>refresh</mat-icon> Atualizar QR
                    </button>
                    <button
                      type="button"
                      class="btn-sec"
                      (click)="testar()"
                      [disabled]="testando()"
                    >
                      <mat-icon>sync</mat-icon> Já pareei — atualizar status
                    </button>
                    <button type="button" class="mini-btn" (click)="fecharQr()">Fechar</button>
                  </div>
                }
              </div>
            }
          </div>

          <!-- ================= Webhooks ================= -->
          <div class="inner-card">
            <h3 class="card-h">Webhooks</h3>
            <p class="card-sub">
              Callbacks que a instância chama — mensagens recebidas, confirmações de entrega, status
              e eventos da sessão.
            </p>

            @if (webhooksDe(int) > 0) {
              <p class="wh-status">
                <mat-icon>check_circle</mat-icon>
                {{ webhooksDe(int) }} de {{ esperadosDe(int) }} callbacks configurados.
              </p>
            } @else {
              <p class="vazio">
                Nenhum callback registrado — depois de conectar a sessão, rode “Configurar
                webhooks”.
              </p>
            }

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
            }

            <div class="acoes-linha">
              <button
                type="button"
                class="btn-sec"
                (click)="configurarWebhooks()"
                [disabled]="configurandoWh()"
              >
                <mat-icon>webhook</mat-icon>
                {{ configurandoWh() ? 'Configurando…' : 'Configurar webhooks' }}
              </button>
            </div>

            @if (whResultado(); as n) {
              <div class="res res-ok" role="status">
                <mat-icon>check_circle</mat-icon>
                <span>{{ n }} callbacks configurados na instância.</span>
              </div>
            }
          </div>

          <!-- ================= Mensagem de teste ================= -->
          <div class="inner-card">
            <h3 class="card-h">Mensagem de teste</h3>
            <p class="card-sub">
              Envio único, fora da fila — para validar a sessão sem passar pelo concierge.
            </p>

            <div class="msg-linha">
              <label class="dl msg-tel">
                <span class="dl-rotulo">Telefone</span>
                <input
                  class="input-inn"
                  [formControl]="fTelefone"
                  placeholder="+55 44 99999-0000"
                  inputmode="tel"
                  autocomplete="tel"
                />
                <span class="mini">Com DDI e DDD — só números são enviados.</span>
              </label>
              <label class="dl msg-txt">
                <span class="dl-rotulo">Mensagem <span class="mut">(opcional)</span></span>
                <input
                  class="input-inn"
                  [formControl]="fTextoMsg"
                  placeholder="Usa o texto padrão se vazio"
                />
              </label>
              <div class="msg-acao">
                <button
                  type="button"
                  class="btn-pri"
                  (click)="enviarTeste()"
                  [disabled]="enviandoMsg() || fTelefone.value.trim().length === 0"
                >
                  <mat-icon>send</mat-icon>
                  {{ enviandoMsg() ? 'Enviando…' : 'Enviar teste' }}
                </button>
              </div>
            </div>

            @if (msgErro()) {
              <p class="mini erro" role="alert">{{ msgErro() }}</p>
            }
            @if (msgResultado(); as r) {
              <div class="res res-ok" role="status">
                <mat-icon>check_circle</mat-icon>
                <span> Mensagem enviada{{ r.id_provedor ? ' — id ' + r.id_provedor : '' }}. </span>
              </div>
            }
          </div>

          <!-- ================= Operação ================= -->
          <div class="inner-card">
            <h3 class="card-h">Operação</h3>

            <div class="op-linha">
              <div>
                <strong>Integração habilitada</strong>
                <p class="mini">
                  Quando desabilitada, a instância não envia mensagens — a sessão não é afetada.
                </p>
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
                <strong>Padrão do WhatsApp</strong>
                <p class="mini">Novas mensagens do canal usam esta instância.</p>
              </div>
              <button
                type="button"
                class="btn-sec"
                (click)="definirPadrao()"
                [disabled]="definindo() || int.padrao_site || int.estado !== 'ativa'"
                [title]="
                  int.padrao_site
                    ? 'Já é o padrão do WhatsApp'
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
            <p class="card-sub">Últimos callbacks recebidos da instância.</p>

            @if (carregandoEventos()) {
              <p class="vazio">Carregando…</p>
            } @else if (eventos().length === 0) {
              <p class="vazio">
                Nenhum evento recebido ainda — quando a instância chamar os callbacks, eles aparecem
                aqui.
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
                        <strong class="ev-tipo">{{ rotuloEvento(e.event_type) }}</strong>
                        <span class="mini ev-id">{{ e.event_id }}</span>
                      </td>
                      <td>
                        <span [class]="'pill ' + pillEvento(e.status)">
                          {{ rotuloStatusEvento(e.status) }}
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
      max-width: 64ch;
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
    .btn-pri mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
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
    .btn-sec.perigo {
      color: #b3402a;
    }
    .btn-sec.perigo:hover:not(:disabled) {
      border-color: #b3402a;
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
    .acoes-linha {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 4px;
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
    .res-info {
      background: rgba(26, 111, 138, 0.08);
      color: #1a6f8a;
    }

    /* ---------- sessão / QR ---------- */
    .fatos {
      display: flex;
      gap: 22px;
      flex-wrap: wrap;
      margin: 0 0 14px;
    }
    .fato {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .fato dt {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #7d97a1;
    }
    .fato dd {
      margin: 0;
      font-size: 0.86rem;
      color: #33424c;
    }
    .qr-area {
      margin-top: 14px;
      border: 1px dashed #c3d2d9;
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      background: #fafcfd;
    }
    .qr-area .acoes-linha {
      justify-content: center;
    }
    .qr-img {
      width: 220px;
      height: 220px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid #e3eaef;
    }
    .qr-dica {
      max-width: 46ch;
      text-align: center;
    }

    /* ---------- webhooks ---------- */
    .wh-status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 12px;
      font-size: 0.82rem;
      color: #17703f;
    }
    .wh-status mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .inner-card .segredo-linha {
      margin-bottom: 12px;
    }

    /* ---------- mensagem de teste ---------- */
    .msg-linha {
      display: flex;
      gap: 14px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .msg-linha .dl {
      flex: 1;
      min-width: 200px;
      margin-bottom: 0;
    }
    .msg-acao {
      flex: none;
      padding-bottom: 2px;
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
      .msg-linha {
        flex-direction: column;
        align-items: stretch;
      }
      .msg-acao {
        padding-bottom: 0;
      }
    }
  `,
})
export class IntegracaoZapiComponent extends IntegracaoZapiStore {}
