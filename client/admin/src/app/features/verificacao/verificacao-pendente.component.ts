// UI de verificacao-pendente — template, estilos e bindings. A lógica vive em verificacao-pendente.store.ts.
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { VerificacaoPendenteStore } from './verificacao-pendente.store';

@Component({
  selector: 'app-verificacao-pendente',
  imports: [MatIconModule],
  template: `
    <div class="vp">
      <div class="vp-card">
        <span class="vp-ic" [class.ok]="aprovada()"
          ><mat-icon>{{ icone() }}</mat-icon></span
        >
        <h1 class="vp-t">{{ titulo() }}</h1>
        <p class="vp-sub">{{ subtitulo() }}</p>

        @if (v()?.url && pendente()) {
          <button type="button" class="vp-btn" (click)="abrir()">
            <mat-icon>open_in_new</mat-icon> Continuar verificação
          </button>
        } @else if (pendente() && criarDisponivel()) {
          <button type="button" class="vp-btn" (click)="criarSessao()" [disabled]="criando()">
            <mat-icon>verified_user</mat-icon>
            {{ criando() ? 'Gerando link…' : 'Verificar minha identidade' }}
          </button>
        }

        <p class="vp-status">
          Status: <strong>{{ v()?.rotulo ?? 'Carregando…' }}</strong>
          @if (ultimoCheck()) {
            <span class="vp-mut">· atualizado {{ ultimoCheck() }}</span>
          }
        </p>

        @if (recusada()) {
          <p class="vp-aviso">
            A verificação foi recusada ou expirou. Fale com o administrador para gerar um novo link
            ou verificar os dados enviados.
          </p>
        }

        <div class="vp-acoes">
          @if (v()?.admin && v()?.bloqueado) {
            <button type="button" class="vp-bypass" (click)="bypass()">
              Continuar assim mesmo (administrador)
            </button>
          }
          <button type="button" class="vp-sair" (click)="sair()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .vp {
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: linear-gradient(160deg, #054054 0%, #0b2437 100%);
    }
    .vp-card {
      width: min(460px, 100%);
      background: #fff;
      border-radius: 20px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
    }
    .vp-ic {
      display: inline-grid;
      place-items: center;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #eef4f6;
      margin-bottom: 16px;
    }
    .vp-ic mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: #054054;
    }
    .vp-ic.ok {
      background: #e6f4ea;
    }
    .vp-ic.ok mat-icon {
      color: #1e7d32;
    }
    .vp-t {
      font-size: 22px;
      font-weight: 700;
      color: #0b2437;
      margin: 0 0 8px;
    }
    .vp-sub {
      font-size: 14px;
      color: #5a6b76;
      line-height: 1.55;
      margin: 0 0 24px;
    }
    .vp-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 24px;
      border: 0;
      border-radius: 999px;
      background: #054054;
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    .vp-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .vp-status {
      font-size: 13px;
      color: #0b2437;
      margin: 20px 0 0;
    }
    .vp-mut {
      color: #8aa0ac;
    }
    .vp-aviso {
      font-size: 13px;
      color: #8a5a00;
      background: #fff7e0;
      border-radius: 10px;
      padding: 10px 12px;
      margin: 16px 0 0;
    }
    .vp-acoes {
      margin-top: 24px;
      display: grid;
      gap: 8px;
    }
    .vp-bypass {
      border: 0;
      background: none;
      color: #4b95ab;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
    }
    .vp-sair {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 0;
      background: none;
      color: #8aa0ac;
      font-size: 13px;
      cursor: pointer;
    }
  `,
})
export class VerificacaoPendenteComponent extends VerificacaoPendenteStore {}
