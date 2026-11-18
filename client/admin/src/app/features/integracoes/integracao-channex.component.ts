// UI de integracao-channex — template, estilos e bindings. A lógica vive em integracao-channex.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { estadoDe, rotuloAmbiente } from './integracoes.const';
import { IntegracaoChannexStore } from './integracao-channex.store';

@Component({
  selector: 'app-integracao-channex',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe],
  template: `
    <div class="pag">
      <a class="volta" routerLink="/integracoes"><mat-icon>arrow_back</mat-icon> Integrações</a>

      @if (i(); as int) {
        <div class="cab">
          <div>
            <p class="eyebrow">Configurações · Integrações</p>
            <h2 class="titulo">
              Channex <span class="env">{{ rotuloAmbiente(int.ambiente) }}</span>
            </h2>
            <p class="sub">
              Distribuição de inventário e tarifas para OTAs — reservas entram por feed + webhook.
            </p>
          </div>
          <div class="cab-pills">
            <span [class]="'pill ' + estadoDe(int.estado).pill">{{
              estadoDe(int.estado).rotulo
            }}</span>
            @if (opcoes()?.publicacao_pausada) {
              <span class="pill pill-warn"><mat-icon>pause</mat-icon> Publicação pausada</span>
            }
          </div>
        </div>

        <!-- Credenciais -->
        <div class="card">
          <h3 class="card-h">Credenciais</h3>
          <div class="dl">
            <span class="dl-rotulo">
              API key (user-api-key) *
              @if (int.segredos.campos['api_key']) {
                <span class="conf">•••••• configurada</span>
              }
            </span>
            <input
              class="input"
              type="password"
              [formControl]="fApiKey"
              autocomplete="new-password"
              [placeholder]="
                int.segredos.campos['api_key']
                  ? 'Deixe em branco para manter'
                  : 'user-api-key da conta Channex'
              "
            />
            <span class="mini">A chave define o host — conta staging usa staging.channex.io.</span>
          </div>
          <div class="dl">
            <span class="dl-rotulo">
              Webhook signing secret
              @if (int.segredos.campos['webhook_secret']) {
                <span class="conf">•••••• configurado</span>
              }
            </span>
            <input
              class="input"
              type="password"
              [formControl]="fSecret"
              autocomplete="new-password"
              [placeholder]="
                int.segredos.campos['webhook_secret']
                  ? 'Deixe em branco para manter'
                  : 'Preenchido ao registrar o webhook'
              "
            />
          </div>
          <div class="acoes">
            <button type="button" class="btn-sec" (click)="testar()" [disabled]="ocupado()">
              <mat-icon>network_check</mat-icon> Testar conexão
            </button>
            <button type="button" class="btn-pri" (click)="salvar()" [disabled]="ocupado()">
              Salvar credenciais
            </button>
          </div>
          <div class="op-linha">
            <div>
              <strong>Integração habilitada</strong>
              <p class="mini">
                Desabilitada não publica ARI nem importa reservas — revisões ficam pendentes no
                feed.
              </p>
            </div>
            <button
              type="button"
              class="sw"
              [class.on]="int.habilitado"
              role="switch"
              [attr.aria-checked]="int.habilitado"
              aria-label="Integração habilitada"
              (click)="habilitar(int)"
              [disabled]="ocupado()"
            >
              <span class="sw-dot"></span>
            </button>
          </div>
        </div>

        <!-- Propriedade + webhook -->
        <div class="card">
          <h3 class="card-h">Propriedade</h3>
          @if (opcoes()?.property_id) {
            <p class="mini">
              Vinculada: <strong class="mono">{{ opcoes()!.property_id }}</strong>
            </p>
          }
          <div class="linha">
            <button
              type="button"
              class="btn-sec"
              (click)="carregarPropriedades()"
              [disabled]="ocupado()"
            >
              <mat-icon>hotel</mat-icon> Listar propriedades da conta
            </button>
            <button
              type="button"
              class="btn-sec"
              (click)="registrarWebhook()"
              [disabled]="ocupado() || !opcoes()?.property_id"
            >
              <mat-icon>webhook</mat-icon> Registrar webhook assinado
            </button>
          </div>
          @for (p of propriedades(); track p.id) {
            <div class="op-linha">
              <div>
                <strong>{{ p.title }}</strong>
                <p class="mini mono">{{ p.id }}</p>
              </div>
              <button
                type="button"
                class="mini-btn"
                (click)="vincular(p.id)"
                [disabled]="ocupado()"
              >
                Vincular
              </button>
            </div>
          }
          @if (int.webhook_url) {
            <span class="segredo-linha">
              <input
                class="input mono"
                readonly
                [value]="int.webhook_url"
                aria-label="URL do webhook"
              />
              <button type="button" class="mini-btn" (click)="copiar(int.webhook_url!)">
                <mat-icon>content_copy</mat-icon>
              </button>
            </span>
          }
        </div>

        <!-- Mapeamento -->
        @if (opcoes()?.property_id) {
          <div class="card">
            <h3 class="card-h">Mapeamento de acomodações</h3>
            <p class="card-sub">
              Cada acomodação aponta um Room Type + Rate Plan — publica ARI só dos mapeados.
            </p>
            <table class="tab">
              <thead>
                <tr>
                  <th>Acomodação</th>
                  <th>Room type</th>
                  <th>Rate plan</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (a of opcoes()!.acomodacoes; track a.id) {
                  <tr>
                    <td>
                      <strong>Nº{{ a.numero }} {{ a.nome }}</strong>
                    </td>
                    @if (mapaDe(a.id); as m) {
                      <td class="mono">{{ tituloRt(m.room_type_id) }}</td>
                      <td class="mono">{{ tituloRp(m.rate_plan_id) }}</td>
                      <td>
                        <button
                          type="button"
                          class="mini-btn perigo"
                          (click)="desmapear(m.id)"
                          [disabled]="ocupado()"
                        >
                          Desmapear
                        </button>
                      </td>
                    } @else {
                      <td colspan="2">
                        <select
                          class="input"
                          [value]="selRt()[a.id] ?? ''"
                          (change)="selRtMuda(a.id, $any($event.target).value)"
                          aria-label="Room type"
                        >
                          <option value="">Room type…</option>
                          @for (rt of opcoes()!.room_types; track rt.id) {
                            <option [value]="rt.id">{{ rt.title }}</option>
                          }
                        </select>
                        <select
                          class="input"
                          [value]="selRp()[a.id] ?? ''"
                          (change)="selRpMuda(a.id, $any($event.target).value)"
                          aria-label="Rate plan"
                        >
                          <option value="">Rate plan…</option>
                          @for (rp of ratePlansDe(selRt()[a.id] ?? ''); track rp.id) {
                            <option [value]="rp.id">{{ rp.title }}</option>
                          }
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          class="mini-btn"
                          (click)="mapear(a.id)"
                          [disabled]="ocupado() || !selRt()[a.id] || !selRp()[a.id]"
                        >
                          Mapear
                        </button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- Sincronização -->
        @if (opcoes()?.property_id) {
          <div class="card">
            <h3 class="card-h">Sincronização</h3>
            @if (resumo(); as r) {
              <div class="stats">
                <span class="stat"
                  ><strong>{{ r.mapeadas }}</strong> mapeadas</span
                >
                <span class="stat"
                  ><strong>{{ r.outbox_pendente }}</strong> na outbox</span
                >
                <span class="stat"
                  ><strong>{{ r.revisoes_sem_ack }}</strong> sem ack</span
                >
                <span class="stat"
                  ><strong>{{ r.pendencias_abertas }}</strong> pendências</span
                >
              </div>
            }
            <div class="linha">
              <button type="button" class="btn-sec" (click)="sincronizar()" [disabled]="ocupado()">
                <mat-icon>sync</mat-icon> Sincronizar 90 dias
              </button>
              <button type="button" class="btn-sec" (click)="reconciliar()" [disabled]="ocupado()">
                <mat-icon>restart_alt</mat-icon> Reconciliar (janela cheia + feed)
              </button>
              <button type="button" class="btn-sec" (click)="pausar()" [disabled]="ocupado()">
                <mat-icon>{{ opcoes()?.publicacao_pausada ? 'play_arrow' : 'pause' }}</mat-icon>
                {{ opcoes()?.publicacao_pausada ? 'Retomar publicação' : 'Pausar publicação' }}
              </button>
            </div>
            <p class="mini">
              Pausar não fecha vendas nas OTAs nem interrompe o recebimento — retomar reconcilia a
              janela.
            </p>
          </div>
        }

        <!-- Revisões -->
        @if (revisoes().length) {
          <div class="card">
            <h3 class="card-h">Revisões recebidas</h3>
            <table class="tab">
              <thead>
                <tr>
                  <th>OTA</th>
                  <th>Status</th>
                  <th>Aplicação</th>
                  <th>Recebida</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (r of revisoes(); track r.id) {
                  <tr>
                    <td>
                      <strong>{{ r.ota_name ?? 'OTA' }}</strong>
                      <span class="mini block">{{ r.ota_reservation_code ?? r.booking_id }}</span>
                    </td>
                    <td>
                      <span
                        class="pill"
                        [class.pill-erro]="r.status === 'cancelled'"
                        [class.pill-warn]="r.status === 'modified'"
                        >{{ r.status }}</span
                      >
                    </td>
                    <td>
                      @if (r.aplicada) {
                        <span class="pill pill-ok"
                          >aplicada{{ r.ack ? ' · ack' : ' · ack pendente' }}</span
                        >
                      } @else {
                        <span class="pill pill-erro" [title]="r.erro ?? ''">pendente</span>
                      }
                    </td>
                    <td class="ev-data">{{ r.recebido_em | date: 'dd/MM HH:mm' }}</td>
                    <td>
                      @if (!r.aplicada) {
                        <button
                          type="button"
                          class="mini-btn"
                          (click)="reprocessar(r.revision_id)"
                          [disabled]="ocupado()"
                        >
                          Reprocessar
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- Pendências -->
        @if (pendencias().length) {
          <div class="card">
            <h3 class="card-h">Pendências operacionais</h3>
            @for (p of pendencias(); track p.id) {
              <div class="op-linha">
                <div>
                  <strong>{{ rotuloPendencia(p.tipo) }}</strong>
                  <p class="mini">{{ p.descricao }}</p>
                </div>
                <button
                  type="button"
                  class="mini-btn"
                  (click)="resolverPendencia(p.id)"
                  [disabled]="ocupado()"
                >
                  Resolver
                </button>
              </div>
            }
          </div>
        }
      } @else {
        <div class="card vazio">
          <mat-icon>cloud_off</mat-icon>
          <p>Carregando…</p>
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
    .card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px;
      overflow-x: auto;
    }
    .card-h {
      margin: 0 0 10px;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
    }
    .card-sub {
      margin: 0 0 14px;
      font-size: 0.78rem;
      color: #7d97a1;
    }
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
    .input {
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 0.88rem;
      font-family: inherit;
      color: #33424c;
      background: #fff;
    }
    .input:focus {
      outline: none;
      border-color: #1a6f8a;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14);
    }
    .input[readonly] {
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
    .linha {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .segredo-linha {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .segredo-linha .input {
      flex: 1;
      min-width: 0;
    }
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
    .btn-sec mat-icon,
    .mini-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .btn-pri:disabled,
    .btn-sec:disabled,
    .mini-btn:disabled {
      opacity: 0.6;
      cursor: default;
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
    .mini-btn.perigo {
      color: #b3402a;
    }
    .op-linha {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid #f0f4f6;
    }
    .op-linha strong {
      font-size: 0.84rem;
      color: #33424c;
    }
    .mini {
      font-size: 0.76rem;
      color: #7d97a1;
      margin: 2px 0 0;
    }
    .block {
      display: block;
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
    .ev-data {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-size: 0.8rem;
      color: #536b73;
    }
    .stats {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin: 6px 0 10px;
    }
    .stat {
      font-size: 0.78rem;
      color: #7d97a1;
    }
    .stat strong {
      font-size: 1.05rem;
      color: #054054;
      margin-right: 4px;
    }
    .vazio {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: #7d97a1;
    }
    .vazio mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
    }
  `,
})
export class IntegracaoChannexComponent extends IntegracaoChannexStore {}
