// UI de contratos — template, estilos e bindings. A lógica vive em contratos.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ContratosStore } from './contratos.store';

@Component({
  selector: 'app-contratos',
  imports: [ReactiveFormsModule, MatIconModule],
  template: `
    <div class="pag">
      <div class="cab">
        <div>
          <p class="eyebrow">Parcerias B2B</p>
          <h2 class="titulo">Contratos corporativos</h2>
          <p class="sub">
            Desconto negociado por código — o hóspede digita no motor e a diária já sai reduzida.
          </p>
        </div>
        <button type="button" class="btn-pri" (click)="abrirForm(null)">
          <mat-icon>add</mat-icon> Novo contrato
        </button>
      </div>

      @if (carregando()) {
        <p class="vazio">Carregando…</p>
      } @else {
        @if (contratos().length) {
          <div class="kpis">
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Cadastrados</span>
                <span class="kpi-ic"><mat-icon>corporate_fare</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ contratos().length }}</strong>
              <span class="kpi-sub">contratos no total</span>
            </div>
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Ativos</span>
                <span class="kpi-ic"><mat-icon>check_circle</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ ativos() }}</strong>
              <span class="kpi-sub">códigos valendo</span>
            </div>
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Expirados</span>
                <span class="kpi-ic"><mat-icon>event_busy</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ expirados() }}</strong>
              <span class="kpi-sub">fora da vigência</span>
            </div>
            <div class="kpi">
              <div class="kpi-top">
                <span class="kpi-lbl">Desconto médio</span>
                <span class="kpi-ic"><mat-icon>percent</mat-icon></span>
              </div>
              <strong class="kpi-num">{{ descontoMedio() }}</strong>
              <span class="kpi-sub">nos contratos ativos</span>
            </div>
          </div>
        }

        @if (contratos().length === 0) {
          <div class="inner-card vazio-card">
            <mat-icon>corporate_fare</mat-icon>
            <p>
              Nenhum contrato cadastrado. Empresas com código ganham desconto automático no motor.
            </p>
          </div>
        } @else {
          <div class="inner-card">
            <table class="tab">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Código</th>
                  <th>Desconto</th>
                  <th>Vigência</th>
                  <th>Contato</th>
                  <th>Status</th>
                  <th class="ac">Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (c of contratos(); track c.id) {
                  <tr [class.inativa]="!c.ativo">
                    <td>
                      <strong>{{ c.empresa }}</strong>
                      @if (c.notas) {
                        <span class="mini notas">{{ c.notas }}</span>
                      }
                    </td>
                    <td>
                      <span class="codigo">{{ c.codigo }}</span>
                    </td>
                    <td>{{ c.desconto_pct }}%</td>
                    <td>
                      <span class="mini"
                        >{{ dataBr(c.vigente_de) }} → {{ dataBr(c.vigente_ate) }}</span
                      >
                      @if (expirado(c)) {
                        <span class="pill pill-off">expirado</span>
                      }
                    </td>
                    <td>
                      <span class="mini">{{ c.contato ?? '—' }} · {{ c.email ?? '—' }}</span>
                    </td>
                    <td>
                      <span class="pill" [class.pill-off]="!c.ativo">
                        {{ c.ativo ? 'Ativo' : 'Inativo' }}
                      </span>
                    </td>
                    <td class="ac">
                      <button type="button" class="mini-btn" (click)="abrirForm(c)" title="Editar">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="mini-btn"
                        [class.perigo]="c.ativo"
                        (click)="alternar(c)"
                        [title]="c.ativo ? 'Desativar' : 'Reativar'"
                      >
                        <mat-icon>{{ c.ativo ? 'block' : 'check_circle' }}</mat-icon>
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
              <span class="como-ic"><mat-icon>corporate_fare</mat-icon></span>
              <div>
                <strong>1 · Cadastre a empresa</strong>
                <p>
                  Defina o desconto, a vigência e um código público curto — ex.: <b>ACME2025</b>.
                </p>
              </div>
            </div>
            <div class="como-passo">
              <span class="como-ic"><mat-icon>key</mat-icon></span>
              <div>
                <strong>2 · Compartilhe o código</strong>
                <p>
                  Entregue o código ao contato da empresa — ele funciona enquanto o contrato estiver
                  ativo e na vigência.
                </p>
              </div>
            </div>
            <div class="como-passo">
              <span class="como-ic"><mat-icon>sell</mat-icon></span>
              <div>
                <strong>3 · Desconto automático</strong>
                <p>
                  O hóspede digita o código no motor de reservas e a diária já sai com o desconto
                  negociado.
                </p>
              </div>
            </div>
          </div>
        </div>
      }

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
          [attr.aria-label]="editando() ? 'Editar contrato' : 'Novo contrato'"
        >
          <h2>{{ editando() ? 'Editar contrato' : 'Novo contrato' }}</h2>
          <form [formGroup]="form" (ngSubmit)="salvar()">
            <label class="dl">
              <span>Empresa *</span>
              <input
                class="input-inn"
                formControlName="empresa"
                placeholder="Ex.: Acme Logística Ltda"
              />
            </label>
            <div class="grid2">
              <label class="dl">
                <span>Código público *</span>
                <input
                  class="input-inn mono"
                  formControlName="codigo"
                  placeholder="ACME2025"
                  aria-describedby="codigo-dica"
                />
                <span id="codigo-dica" class="dica"
                  >O hóspede digita no motor — maiúsculas, sem espaço.</span
                >
              </label>
              <label class="dl">
                <span>Desconto % *</span>
                <input
                  class="input-inn"
                  type="number"
                  formControlName="desconto_pct"
                  min="1"
                  max="100"
                  step="0.5"
                />
              </label>
            </div>
            <div class="grid2">
              <label class="dl">
                <span>Vigente de *</span>
                <input class="input-inn" type="date" formControlName="vigente_de" />
              </label>
              <label class="dl">
                <span>Vigente até *</span>
                <input class="input-inn" type="date" formControlName="vigente_ate" />
              </label>
            </div>
            <div class="grid2">
              <label class="dl">
                <span>Contato</span>
                <input class="input-inn" formControlName="contato" />
              </label>
              <label class="dl">
                <span>E-mail</span>
                <input class="input-inn" type="email" formControlName="email" />
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

    .codigo {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 6px;
      background: #eef4f6;
      color: #054054;
      font-family: monospace;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.05em;
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
    .dica {
      font-size: 0.7rem;
      color: #7d97a1;
    }
    .pill {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(26, 111, 138, 0.1);
      color: #1a6f8a;
      margin-left: 6px;
    }
    .pill-off {
      background: #f0f4f6;
      color: #b3402a;
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
      text-transform: uppercase;
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
      width: min(520px, 92vw);
      max-height: 88vh;
      overflow-y: auto;
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
    @media (max-width: 640px) {
      .grid2 {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ContratosComponent extends ContratosStore {}
