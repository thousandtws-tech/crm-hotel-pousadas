// UI de operadoras — template, estilos e bindings. A lógica vive em operadoras.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { OperadorasStore } from './operadoras.store';

@Component({
  selector: 'app-operadoras',
  imports: [ReactiveFormsModule, MatIconModule],
  template: `
    <div class="pag">
      <div class="cab">
        <div>
          <p class="eyebrow">Parcerias B2B</p>
          <h2 class="titulo">Operadoras</h2>
          <p class="sub">Parceiros B2B — tarifa net, extranet por token e faturamento segregado.</p>
        </div>
        <button type="button" class="btn-pri" (click)="abrirForm(null)">
          <mat-icon>add</mat-icon> Nova operadora
        </button>
      </div>

      @if (carregando()) {
        <p class="vazio">Carregando…</p>
      } @else {
        @if (operadoras().length) {
          <div class="kpis">
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Cadastradas</span>
                <span class="kpi-ic"><mat-icon>handshake</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ operadoras().length }}</strong>
              <span class="kpi-sub">operadoras no total</span>
            </div>
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Ativas</span>
                <span class="kpi-ic"><mat-icon>check_circle</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ ativas() }}</strong>
              <span class="kpi-sub">com extranet liberada</span>
            </div>
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Inativas</span>
                <span class="kpi-ic"><mat-icon>block</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ inativas() }}</strong>
              <span class="kpi-sub">acesso suspenso</span>
            </div>
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Comissão média</span>
                <span class="kpi-ic"><mat-icon>percent</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ comissaoMedia() }}</strong>
              <span class="kpi-sub">sobre tarifa net · ativas</span>
            </div>
          </div>
        }

        @if (operadoras().length === 0) {
          <div class="inner-card vazio-card">
            <mat-icon>handshake</mat-icon>
            <p>Nenhuma operadora cadastrada. Cadastre a primeira para liberar a extranet.</p>
          </div>
        } @else {
          <div class="inner-card">
            <table class="tab">
              <thead>
                <tr>
                  <th>Operadora</th>
                  <th>Comissão</th>
                  <th>Contato</th>
                  <th>Status</th>
                  <th class="ac">Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (o of operadoras(); track o.id) {
                  <tr [class.inativa]="!o.ativa">
                    <td>
                      <strong>{{ o.nome }}</strong>
                      @if (o.notas) {
                        <span class="mini notas">{{ o.notas }}</span>
                      }
                    </td>
                    <td>{{ o.comissao_pct }}% net</td>
                    <td>
                      @if (o.contato) {
                        <span class="mini">{{ o.contato }}<br /></span>
                      }
                      <span class="mini">{{ o.email ?? '—' }} · {{ o.telefone ?? '—' }}</span>
                    </td>
                    <td>
                      <span class="pill" [class.pill-off]="!o.ativa">
                        {{ o.ativa ? 'Ativa' : 'Inativa' }}
                      </span>
                    </td>
                    <td class="ac">
                      <button
                        type="button"
                        class="mini-btn"
                        (click)="verToken(o)"
                        title="Ver token da extranet"
                      >
                        <mat-icon>key</mat-icon> Token
                      </button>
                      <button
                        type="button"
                        class="mini-btn"
                        (click)="abrirFaturamento(o)"
                        title="Faturamento segregado"
                      >
                        <mat-icon>receipt_long</mat-icon> Faturamento
                      </button>
                      <button type="button" class="mini-btn" (click)="abrirForm(o)" title="Editar">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="mini-btn"
                        [class.perigo]="o.ativa"
                        (click)="alternar(o)"
                        [title]="o.ativa ? 'Desativar' : 'Reativar'"
                      >
                        <mat-icon>{{ o.ativa ? 'block' : 'check_circle' }}</mat-icon>
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div class="como">
          <h3>Como funciona</h3>
          <div class="como-grid">
            <div class="como-passo">
              <span class="como-ic"><mat-icon>handshake</mat-icon></span>
              <div>
                <strong>1 · Cadastre o parceiro</strong>
                <p>Defina a comissão sobre a tarifa net e os contatos comerciais da operadora.</p>
              </div>
            </div>
            <div class="como-passo">
              <span class="como-ic"><mat-icon>key</mat-icon></span>
              <div>
                <strong>2 · Compartilhe o token</strong>
                <p>
                  Cada operadora recebe uma credencial de extranet para consultar e registrar
                  reservas pela API.
                </p>
              </div>
            </div>
            <div class="como-passo">
              <span class="como-ic"><mat-icon>receipt_long</mat-icon></span>
              <div>
                <strong>3 · Acompanhe o faturamento</strong>
                <p>
                  Veja por período quantas reservas cada parceiro gerou e o total net a repassar.
                </p>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- ============ modal cadastro/edição ============ -->
      @if (modalForm()) {
        <div
          class="modal-fundo"
          (click)="modalForm.set(false)"
          (keydown.escape)="modalForm.set(false)"
          role="presentation"
        ></div>
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="editando() ? 'Editar operadora' : 'Nova operadora'"
        >
          <h2>{{ editando() ? 'Editar operadora' : 'Nova operadora' }}</h2>
          <form [formGroup]="form" (ngSubmit)="salvar()">
            <label class="dl">
              <span>Nome *</span>
              <input class="input-inn" formControlName="nome" placeholder="Ex.: CVC Viagens" />
            </label>
            <div class="grid2">
              <label class="dl">
                <span>Comissão % (net)</span>
                <input
                  class="input-inn"
                  type="number"
                  formControlName="comissao_pct"
                  min="0"
                  max="100"
                  step="0.5"
                />
              </label>
              <label class="dl">
                <span>Contato</span>
                <input
                  class="input-inn"
                  formControlName="contato"
                  placeholder="Nome do responsável"
                />
              </label>
            </div>
            <div class="grid2">
              <label class="dl">
                <span>E-mail</span>
                <input class="input-inn" type="email" formControlName="email" />
              </label>
              <label class="dl">
                <span>Telefone</span>
                <input class="input-inn" formControlName="telefone" />
              </label>
            </div>
            <label class="dl">
              <span>Notas internas</span>
              <textarea class="input-inn" formControlName="notas" rows="2"></textarea>
            </label>
            <div class="modal-acoes">
              <button type="button" class="btn-sec" (click)="modalForm.set(false)">Cancelar</button>
              <button type="submit" class="btn-pri" [disabled]="salvando()">
                {{ salvando() ? 'Salvando…' : 'Salvar' }}
              </button>
            </div>
          </form>
        </div>
      }

      <!-- ============ modal token ============ -->
      @if (modalToken(); as t) {
        <div
          class="modal-fundo"
          (click)="modalToken.set(null)"
          (keydown.escape)="modalToken.set(null)"
          role="presentation"
        ></div>
        <div class="modal" role="dialog" aria-modal="true" aria-label="Token da extranet">
          <h2>Extranet — {{ t.nome }}</h2>
          <p class="sub">
            O parceiro chama a API com o header <code>X-Extranet-Token</code>. Rotacionar invalida o
            token atual na hora.
          </p>
          <label class="dl">
            <span>Credencial</span>
            <input
              class="input-inn mono"
              readonly
              [value]="t.token"
              aria-label="Token da extranet"
            />
          </label>
          <div class="modal-acoes">
            <button type="button" class="btn-sec" (click)="copiar(t.token)">Copiar</button>
            <button type="button" class="btn-sec perigo" (click)="rotacionar(t.id)">
              Rotacionar token
            </button>
            <button type="button" class="btn-pri" (click)="modalToken.set(null)">Fechar</button>
          </div>
        </div>
      }

      <!-- ============ modal faturamento ============ -->
      @if (modalFat(); as f) {
        <div
          class="modal-fundo"
          (click)="modalFat.set(null)"
          (keydown.escape)="modalFat.set(null)"
          role="presentation"
        ></div>
        <div
          class="modal largo"
          role="dialog"
          aria-modal="true"
          aria-label="Faturamento da operadora"
        >
          <h2>Faturamento — {{ f.operadora.nome }}</h2>
          <div class="fat-filtro">
            <input
              class="input-inn"
              type="date"
              [value]="fatDe()"
              (change)="fatDe.set(valorDe($event))"
              aria-label="De"
            />
            <input
              class="input-inn"
              type="date"
              [value]="fatAte()"
              (change)="fatAte.set(valorDe($event))"
              aria-label="Até"
            />
            <button type="button" class="btn-sec" (click)="buscarFaturamento(f.operadora.id)">
              Buscar
            </button>
          </div>
          <div class="fat-resumo">
            <div class="fat-stat">
              <strong>{{ f.reservas }}</strong><span>reservas</span>
            </div>
            <div class="fat-stat">
              <strong>{{ brl(f.valor_total) }}</strong><span>total net</span>
            </div>
          </div>
          @if (f.linhas.length === 0) {
            <p class="vazio">Nenhuma reserva da operadora no período.</p>
          } @else {
            <table class="tab mini-tab">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Hóspede</th>
                  <th>Período</th>
                  <th>Status</th>
                  <th class="ac">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (l of f.linhas; track l.idreserva) {
                  <tr>
                    <td>{{ l.idreserva }}</td>
                    <td>{{ l.hospede }}</td>
                    <td>{{ dataBr(l.entrada) }} → {{ dataBr(l.saida) }}</td>
                    <td>
                      <span class="pill">{{ statusRotulo(l.status) }}</span>
                    </td>
                    <td class="ac">{{ brl(l.valor_total) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
          <div class="modal-acoes">
            <button type="button" class="btn-pri" (click)="modalFat.set(null)">Fechar</button>
          </div>
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
    }

    /* ---------- KPIs ---------- */
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .kpi {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 14px 16px 13px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kpi-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .kpi-lbl {
      font-size: 0.66rem;
      font-weight: 700;
      color: #7d97a1;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .kpi-ic {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      flex-shrink: 0;
      background: #eef4f6;
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .kpi-ic mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .kpi-num {
      font-size: 1.5rem;
      font-weight: 800;
      color: #054054;
      line-height: 1.1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .kpi-sub {
      font-size: 0.72rem;
      color: #8a99a4;
    }

    /* ---------- como funciona ---------- */
    .como {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px 18px;
    }
    .como h3 {
      margin: 0 0 12px;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
    }
    .como-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 14px;
    }
    .como-passo {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .como-ic {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      flex-shrink: 0;
      background: #eef4f6;
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .como-ic mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .como-passo strong {
      display: block;
      font-size: 0.84rem;
      color: #33424c;
      margin-bottom: 2px;
    }
    .como-passo p {
      margin: 0;
      font-size: 0.78rem;
      color: #7d97a1;
      line-height: 1.45;
    }
    .vazio {
      color: #7d97a1;
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
    .inner-card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px;
      overflow-x: auto;
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
    .tab tr.inativa td {
      opacity: 0.55;
    }
    .ac {
      text-align: right;
      white-space: nowrap;
    }
    .mini {
      font-size: 0.76rem;
      color: #7d97a1;
    }
    .notas {
      display: block;
    }
    .pill {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(26, 111, 138, 0.1);
      color: #1a6f8a;
    }
    .pill-off {
      background: #f0f4f6;
      color: #7d97a1;
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
      margin-left: 6px;
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
    }
    .btn-sec.perigo {
      color: #b3402a;
      border-color: rgba(179, 64, 42, 0.3);
    }
    .dl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.78rem;
      color: #5d6d7e;
      margin-bottom: 10px;
    }
    .input-inn {
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 0.88rem;
      font-family: inherit;
      color: #33424c;
    }
    .input-inn:focus {
      outline: none;
      border-color: #1a6f8a;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14);
    }
    .mono {
      font-family: monospace;
      font-size: 0.8rem;
    }
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .modal-fundo {
      position: fixed;
      inset: 0;
      background: rgba(9, 20, 26, 0.45);
      z-index: 60;
    }
    .modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 61;
      background: #fff;
      border-radius: 14px;
      padding: 22px;
      width: min(480px, 92vw);
      max-height: 88vh;
      overflow-y: auto;
    }
    .modal.largo {
      width: min(720px, 94vw);
    }
    .modal h2 {
      margin: 0 0 10px;
      font-size: 1.1rem;
      color: #054054;
    }
    .modal-acoes {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 14px;
    }
    .fat-filtro {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .fat-resumo {
      display: flex;
      gap: 24px;
      margin-bottom: 12px;
    }
    .fat-stat {
      display: flex;
      flex-direction: column;
    }
    .fat-stat strong {
      font-size: 1.3rem;
      color: #054054;
    }
    .fat-stat span {
      font-size: 0.72rem;
      color: #7d97a1;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mini-tab {
      font-size: 0.8rem;
    }
    @media (max-width: 640px) {
      .grid2 {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class OperadorasComponent extends OperadorasStore {}
