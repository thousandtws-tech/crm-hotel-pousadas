// UI de integracao-didit — template, estilos e bindings. A lógica vive em integracao-didit.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { estadoDe } from './integracoes.const';
import { IntegracaoDiditStore } from './integracao-didit.store';

@Component({
  selector: 'app-integracao-didit',
  imports: [RouterLink, ReactiveFormsModule, MatIconModule],
  template: `
    <div class="pag">
      <div class="cab">
        <div>
          <a class="volta" routerLink="/integracoes"><mat-icon>arrow_back</mat-icon> Integrações</a>
          <h2 class="titulo">
            Didit <span class="amb">{{ rotuloAmb }}</span>
          </h2>
          <p class="sub">
            Verificação de identidade (KYC) dos funcionários — documento, biometria facial e análise
            de IP em sessão hospedada pela Didit.
          </p>
        </div>
        @if (i(); as int) {
          <span class="pill" [class]="estadoDe(int.estado).pill">{{
            estadoDe(int.estado).rotulo
          }}</span>
        }
      </div>

      @if (carregando()) {
        <p class="mut">Carregando…</p>
      } @else if (!i()) {
        <div class="card">
          <p class="mut">Integração ainda não criada — salve as credenciais.</p>
        </div>
      }

      <!-- Credenciais -->
      <section class="card">
        <h3 class="card-t"><mat-icon>key</mat-icon> Credenciais</h3>
        <p class="mut">Valores nunca são exibidos — só o estado configurado.</p>
        @for (c of campos; track c.nome) {
          <label class="fld">
            <span class="fld-l"
              >{{ c.rotulo }}
              @if (configurado(c)) {
                <em class="conf">•••••• configurado</em>
              }
            </span>
            <input
              class="fld-i"
              [type]="c.segredo ? 'password' : 'text'"
              [formControl]="controle(c.nome)"
              [placeholder]="c.placeholder ?? (configurado(c) ? 'Deixe em branco para manter' : '')"
              autocomplete="off"
            />
            @if (c.dica) {
              <span class="fld-d">{{ c.dica }}</span>
            }
            @if (configurado(c)) {
              <label class="mini"
                ><input
                  type="checkbox"
                  [checked]="limpar()[c.nome]"
                  (change)="toggleLimpar(c.nome)"
                />
                Limpar ao salvar</label
              >
            }
          </label>
        }
        <div class="acoes">
          <button type="button" class="btn-pri" (click)="salvar()" [disabled]="salvando()">
            {{ salvando() ? 'Salvando…' : 'Salvar credenciais' }}
          </button>
          <button type="button" class="btn-sec" (click)="testar()" [disabled]="testando()">
            <mat-icon>bolt</mat-icon> {{ testando() ? 'Testando…' : 'Testar conexão' }}
          </button>
        </div>
        @if (teste(); as t) {
          <p
            class="teste"
            [class.ok]="t.verificacao_status === 'ok'"
            [class.erro]="t.verificacao_status !== 'ok'"
          >
            {{ t.mensagem }} {{ t.nome_conta ? '— ' + t.nome_conta : '' }}
          </p>
        }
      </section>

      <!-- Operação -->
      @if (i(); as int) {
        <section class="card">
          <h3 class="card-t"><mat-icon>tune</mat-icon> Operação</h3>
          <label class="sw">
            <input
              type="checkbox"
              [checked]="int.habilitado"
              (change)="alternar(int)"
              [disabled]="alternando()"
            />
            <span
              ><strong>Integração habilitada</strong> — sessões de verificação podem ser
              criadas.</span
            >
          </label>
        </section>
      }

      <!-- Verificação -->
      <section class="card">
        <h3 class="card-t"><mat-icon>verified_user</mat-icon> Verificação de identidade</h3>
        <p class="mut">
          O workflow define os checks (documento + rosto + AML). Crie/edite em
          <b>business.didit.me → Workflows</b> e cole o ID aqui.
        </p>
        <label class="fld">
          <span class="fld-l">Workflow ID</span>
          <input class="fld-i" [formControl]="fWorkflow" placeholder="UUID do workflow Didit" />
        </label>
        <label class="fld">
          <span class="fld-l">URL de retorno (opcional)</span>
          <input
            class="fld-i"
            [formControl]="fCallback"
            placeholder="https://crm.espiritodomar.com.br/verificacao"
          />
          <span class="fld-d"
            >Para onde o funcionário volta ao terminar a verificação hospedada.</span
          >
        </label>
        <label class="sw">
          <input type="checkbox" [formControl]="fExigir" />
          <span>
            <strong>Exigir verificação no login</strong> — funcionários não aprovados ficam na tela
            de verificação até concluir o KYC (válido só para a integração de produção).
          </span>
        </label>
        <div class="acoes">
          <button type="button" class="btn-pri" (click)="salvarConfig()" [disabled]="salvandoCfg()">
            {{ salvandoCfg() ? 'Salvando…' : 'Salvar configuração' }}
          </button>
        </div>
      </section>

      <!-- Webhook -->
      <section class="card">
        <h3 class="card-t"><mat-icon>webhook</mat-icon> Webhook</h3>
        @if (i()?.webhook_url) {
          <div class="hook">
            <code class="hook-url">{{ i()!.webhook_url }}</code>
            <button type="button" class="btn-sec" (click)="copiar(i()!.webhook_url!)">
              <mat-icon>content_copy</mat-icon> Copiar
            </button>
          </div>
          <p class="mut">Registrado na Didit — o segredo de assinatura já está guardado.</p>
        } @else {
          <p class="mut">
            Registre o destino para receber os eventos <code>status.updated</code> — sem ele o
            status só avança pela sincronização manual.
          </p>
        }
        <div class="acoes">
          <button
            type="button"
            class="btn-sec"
            (click)="registrarWebhook()"
            [disabled]="registrandoHook()"
          >
            <mat-icon>add_link</mat-icon>
            {{ registrandoHook() ? 'Registrando…' : 'Registrar webhook na Didit' }}
          </button>
        </div>
      </section>

      <section class="card aviso-card">
        <h3 class="card-t"><mat-icon>info</mat-icon> Como funciona</h3>
        <ul class="lista">
          <li>
            Cada funcionário recebe um <b>link hospedado</b> (em Funcionários → Verificar) para
            fazer o KYC — documento + selfie.
          </li>
          <li>
            O status chega pelo <b>webhook</b> (ou pelo botão Sincronizar) e aparece como badge na
            equipe.
          </li>
          <li>
            Com <b>“Exigir verificação”</b> ligado, quem não aprovou fica na tela de verificação
            após o login — admin pode seguir em emergência.
          </li>
          <li>
            Ambiente <b>teste</b> nunca bloqueia login — serve para homologar o fluxo com cenários
            de sandbox.
          </li>
        </ul>
      </section>
    </div>
  `,
  styles: `
    .pag {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 16px 64px;
      display: grid;
      gap: 16px;
    }
    .cab {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .volta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: #4b95ab;
      text-decoration: none;
      font-weight: 600;
    }
    .volta mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .titulo {
      font-size: 22px;
      font-weight: 700;
      margin: 6px 0 4px;
      color: #0b2437;
    }
    .amb {
      font-size: 13px;
      font-weight: 600;
      color: #4b95ab;
    }
    .sub {
      font-size: 13px;
      color: #5a6b76;
      margin: 0;
      line-height: 1.5;
    }
    .card {
      background: #fff;
      border: 1px solid #e4ecf0;
      border-radius: 14px;
      padding: 18px;
    }
    .card-t {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 700;
      color: #0b2437;
      margin: 0 0 8px;
    }
    .card-t mat-icon {
      color: #054054;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .mut {
      font-size: 13px;
      color: #7a8b96;
      margin: 0 0 10px;
      line-height: 1.5;
    }
    .fld {
      display: grid;
      gap: 4px;
      margin-bottom: 12px;
    }
    .fld-l {
      font-size: 13px;
      font-weight: 600;
      color: #0b2437;
    }
    .conf {
      font-style: normal;
      font-size: 12px;
      color: #1e7d32;
      font-weight: 600;
    }
    .fld-i {
      padding: 10px 12px;
      border: 1px solid #d5e0e6;
      border-radius: 10px;
      font-size: 14px;
      font-family: inherit;
    }
    .fld-i:focus {
      outline: 2px solid #4b95ab;
      border-color: transparent;
    }
    .fld-d {
      font-size: 12px;
      color: #7a8b96;
    }
    .mini {
      font-size: 12px;
      color: #7a8b96;
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .acoes {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .btn-pri {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 18px;
      border: 0;
      border-radius: 999px;
      background: #054054;
      color: #fff;
      font-size: 14px;
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
      padding: 10px 16px;
      border: 1px solid #d5e0e6;
      border-radius: 999px;
      background: #fff;
      color: #054054;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-sec:disabled {
      opacity: 0.6;
    }
    .btn-sec mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .pill {
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }
    .pill-ok {
      background: #e6f4ea;
      color: #1e7d32;
    }
    .pill-warn {
      background: #fff7e0;
      color: #8a5a00;
    }
    .pill-erro {
      background: #fdecea;
      color: #b3261e;
    }
    .pill-off {
      background: #eef2f4;
      color: #5a6b76;
    }
    .pill-info {
      background: #e3f2f7;
      color: #216a80;
    }
    .sw {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      font-size: 13px;
      color: #39464f;
      line-height: 1.5;
      margin: 10px 0;
      cursor: pointer;
    }
    .sw input {
      margin-top: 3px;
    }
    .teste {
      font-size: 13px;
      margin: 12px 0 0;
      padding: 10px 12px;
      border-radius: 10px;
    }
    .teste.ok {
      background: #e6f4ea;
      color: #1e7d32;
    }
    .teste.erro {
      background: #fdecea;
      color: #b3261e;
    }
    .hook {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .hook-url {
      font-size: 12px;
      background: #f2f6f8;
      padding: 8px 10px;
      border-radius: 8px;
      word-break: break-all;
    }
    .lista {
      margin: 0;
      padding-left: 18px;
      font-size: 13px;
      color: #39464f;
      display: grid;
      gap: 6px;
      line-height: 1.5;
    }
    .aviso-card {
      background: #f7fafb;
    }
  `,
})
export class IntegracaoDiditComponent extends IntegracaoDiditStore {}
