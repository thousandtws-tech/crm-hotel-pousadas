// UI de integracoes — template, estilos e bindings. A lógica vive em integracoes.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { estadoDe, rotuloAmbiente, rotuloProvedor } from './integracoes.const';
import { IntegracoesStore } from './integracoes.store';

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
            Provedores de pagamento do site e canais de comunicação — credenciais cifradas, webhooks
            e padrões por escopo.
          </p>
        </div>
      </div>

      @if (carregando()) {
        <div class="grade">
          @for (s of skel; track s) {
            <div class="card-prov" aria-hidden="true">
              <span class="skel sk-t"></span>
              <span class="skel sk-l"></span>
              <span class="skel sk-l"></span>
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
        <div class="faixa-padrao" [class.sem]="!padraoSite()">
          <mat-icon>{{ padraoSite() ? 'check_circle' : 'info' }}</mat-icon>
          <div>
            <strong>Novas cobranças do site</strong>
            <span>{{ descricaoPadrao() }}</span>
          </div>
        </div>

        @for (sec of secoes(); track sec.categoria) {
          <section class="secao" [attr.aria-label]="sec.rotulo">
            <h3 class="secao-t">{{ sec.rotulo }}</h3>
            <div class="grade">
              @for (g of sec.grupos; track g.provedor) {
                <section class="card-prov">
                  <header class="prov-cab">
                    <div>
                      <h3 class="prov-nome">{{ rotuloProvedor(g.provedor) }}</h3>
                      <p class="prov-desc">{{ descriptorDe(g.provedor) }}</p>
                    </div>
                  </header>

                  <div class="prov-linhas">
                    @for (i of [g.producao, g.teste]; track $index) {
                      @if (i) {
                        <a
                          class="env-linha"
                          [routerLink]="['/integracoes', i.provedor, i.ambiente]"
                          [attr.aria-label]="
                            'Abrir ' + rotuloProvedor(i.provedor) + ' ' + rotuloAmbiente(i.ambiente)
                          "
                        >
                          <span class="env" [class.env-teste]="i.ambiente === 'teste'">
                            {{ rotuloAmbiente(i.ambiente) }}
                          </span>

                          <span class="env-meio">
                            <span class="env-pills">
                              <span [class]="'pill ' + estadoDe(i.estado).pill">
                                {{ estadoDe(i.estado).rotulo }}
                              </span>
                              @if (i.provedor === 'zapi' && i.estado !== 'nao_configurada') {
                                <span
                                  class="pill"
                                  [class.pill-ok]="sessaoConectada(i)"
                                  [class.pill-warn]="!sessaoConectada(i)"
                                >
                                  {{ sessaoConectada(i) ? 'Conectado' : 'Aguardando pareamento' }}
                                </span>
                              }
                              @if (i.padrao_site) {
                                <span class="pill pill-gold">
                                  <mat-icon>star</mat-icon>
                                  {{ i.provedor === 'zapi' ? 'Padrão WhatsApp' : 'Padrão' }}
                                </span>
                              }
                            </span>
                            <span class="env-info">
                              @if (i.verificacao_status === 'falha' && i.verificacao_erro) {
                                {{ i.verificacao_erro }}
                              } @else {
                                {{ resumoDe(i) }}
                              }
                            </span>
                          </span>

                          <mat-icon class="env-seta">chevron_right</mat-icon>
                        </a>
                      }
                    }
                  </div>
                </section>
              }
            </div>
          </section>
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

    /* ---------- faixa do padrão de cobrança ---------- */
    .faixa-padrao {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(25, 135, 84, 0.07);
      border: 1px solid rgba(25, 135, 84, 0.22);
      border-radius: 10px;
      padding: 10px 14px;
    }
    .faixa-padrao.sem {
      background: rgba(26, 111, 138, 0.05);
      border-color: rgba(26, 111, 138, 0.18);
    }
    .faixa-padrao mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #17703f;
      flex: none;
    }
    .faixa-padrao.sem mat-icon {
      color: #1a6f8a;
    }
    .faixa-padrao strong {
      display: block;
      font-size: 0.78rem;
      color: #054054;
    }
    .faixa-padrao span {
      font-size: 0.78rem;
      color: #5d6d7e;
    }

    /* ---------- seções por categoria ---------- */
    .secao {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .secao-t {
      margin: 0;
      font-size: 0.74rem;
      font-weight: 700;
      color: #4b95ab;
      text-transform: uppercase;
      letter-spacing: 0.09em;
    }

    /* ---------- grade de provedores ---------- */
    .grade {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .card-prov {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      overflow: hidden;
    }
    .prov-cab {
      padding: 14px 16px 12px;
      border-bottom: 1px solid #f0f4f6;
    }
    .prov-nome {
      margin: 0;
      font-size: 0.98rem;
      font-weight: 700;
      color: #054054;
    }
    .prov-desc {
      margin: 2px 0 0;
      font-size: 0.74rem;
      color: #7d97a1;
    }

    .prov-linhas {
      display: flex;
      flex-direction: column;
    }
    .env-linha {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      color: inherit;
      cursor: pointer;
      transition: background 0.12s;
    }
    .env-linha + .env-linha {
      border-top: 1px solid #f0f4f6;
    }
    .env-linha:hover {
      background: #f7fafb;
    }
    .env-linha:focus-visible {
      outline: 2px solid #1a6f8a;
      outline-offset: -2px;
    }

    .env {
      flex: none;
      width: 72px;
      text-align: center;
      font-size: 0.64rem;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: #054054;
      background: #e4eef2;
      border-radius: 6px;
      padding: 4px 0;
    }
    .env-teste {
      color: #8a6210;
      background: rgba(181, 129, 31, 0.12);
    }

    .env-meio {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .env-pills {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .env-info {
      font-size: 0.74rem;
      color: #7d97a1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .env-seta {
      flex: none;
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #8fa3ab;
    }
    .env-linha:hover .env-seta {
      color: #1a6f8a;
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
      margin: 14px 16px;
    }
    .sk-t {
      width: 120px;
      height: 16px;
    }
    .sk-l {
      height: 44px;
      margin-top: 0;
    }

    @media (max-width: 720px) {
      .grade {
        grid-template-columns: 1fr;
      }
      .env {
        width: 62px;
      }
    }
  `,
})
export class IntegracoesComponent extends IntegracoesStore {}
