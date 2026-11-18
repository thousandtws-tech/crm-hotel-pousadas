// UI de estacionamento — template, estilos e bindings. A lógica vive em estacionamento.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { EstacionamentoStore } from './estacionamento.store';

@Component({
  selector: 'app-estacionamento',
  imports: [ReactiveFormsModule, MatIconModule, MatSelectModule],
  template: `
    <div class="page">
      <div class="est-head">
        <div class="est-titulo-grupo">
          <p class="eyebrow">Cadastro</p>
          <div class="est-titulo-linha">
            <h2 class="est-titulo">Estacionamento</h2>
            <span class="est-contador" title="Total de vagas e quantas estão livres">
              {{ vagas().length }} {{ vagas().length === 1 ? 'vaga' : 'vagas' }} · {{ livres() }}
              {{ livres() === 1 ? 'livre' : 'livres' }}
            </span>
          </div>
        </div>
        <div class="est-head-acoes">
          <button
            class="btn-tour"
            type="button"
            (click)="iniciarTour()"
            aria-label="Ver tutorial da tela"
          >
            <mat-icon>school</mat-icon> Tutorial
          </button>
        </div>
      </div>

      <div class="est-info">
        <div class="est-info-card">
          <span class="est-info-icone"><mat-icon>local_parking</mat-icon></span>
          <div class="est-info-txt">
            <strong>Uma vaga por acomodação</strong>
            <p>
              Vincule cada vaga a uma acomodação para saber qual quarto está usando aquela vaga.
            </p>
          </div>
        </div>
        <div class="est-info-card">
          <span class="est-info-icone"><mat-icon>link</mat-icon></span>
          <div class="est-info-txt">
            <strong>Vínculo rápido</strong>
            <p>
              No seletor da linha você troca o dono da vaga na hora — ou deixa como <b>Livre</b>.
            </p>
          </div>
        </div>
        <div class="est-info-card">
          <span class="est-info-icone"><mat-icon>toggle_on</mat-icon></span>
          <div class="est-info-txt">
            <strong>Desative em vez de excluir</strong>
            <p>
              Vagas inativas não aparecem na hora da reserva. Prefira desativar no selo “Status” a
              excluir.
            </p>
          </div>
        </div>
      </div>

      <div class="inner-card est-card">
        <!-- Cadastro rápido -->
        <form
          id="tour-form"
          class="est-form"
          (submit)="$event.preventDefault(); criar()"
          autocomplete="off"
        >
          <span class="est-form-icone"><mat-icon>local_parking</mat-icon></span>
          <div class="est-form-txt">
            <strong>Nova vaga</strong>
            <small>Digite o número da vaga física e cadastre — depois vincule na lista.</small>
          </div>
          <input
            id="numero-vaga"
            class="input-inn est-num"
            type="number"
            min="1"
            required
            [formControl]="numero"
            placeholder="Nº da vaga (ex.: 12)"
            title="Número da vaga"
            aria-label="Número da vaga"
          />
          <button class="btn-dark-blue" type="submit" [disabled]="numero.invalid">
            <mat-icon>add</mat-icon> Cadastrar
          </button>
        </form>

        <div class="est-toolbar">
          <div id="tour-busca" class="est-busca" [class.foco]="buscaFoco()">
            <mat-icon class="est-busca-icone">search</mat-icon>
            <input
              class="est-busca-input"
              type="search"
              [formControl]="busca"
              placeholder="Buscar por número ou acomodação… (dica: “livre”)"
              aria-label="Buscar vaga"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button
                type="button"
                class="est-limpar"
                aria-label="Limpar busca"
                (click)="busca.setValue('')"
              >
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          <button
            id="tour-ativas"
            type="button"
            class="est-toggle"
            [class.on]="apenasAtivas()"
            role="switch"
            [attr.aria-checked]="apenasAtivas()"
            (click)="apenasAtivas.set(!apenasAtivas())"
          >
            <span class="est-trilho"><span class="est-bolinha"></span></span>
            Somente ativas
          </button>
        </div>

        <div id="tour-tabela" class="est-tabela-wrap">
          <table class="est-tabela">
            <thead>
              <tr>
                <th class="est-th-vaga">Vaga</th>
                <th>Acomodação vinculada</th>
                <th class="tc">Status</th>
                @if (auth.isAdmin()) {
                  <th class="tc">Ações</th>
                }
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td>
                      <span class="skel skel-icone"></span>
                      <span class="skel skel-nome"></span>
                    </td>
                    <td><span class="skel skel-sel"></span></td>
                    <td class="tc"><span class="skel skel-chip"></span></td>
                    @if (auth.isAdmin()) {
                      <td class="tc"><span class="skel skel-acoes"></span></td>
                    }
                  </tr>
                }
              } @else {
                @for (v of vagasFiltradas(); track v.id) {
                  <tr class="est-row">
                    <td>
                      <div class="est-cell">
                        <span class="est-vaga-icone"><mat-icon>local_parking</mat-icon></span>
                        <span class="est-cell-txt">
                          <strong>Vaga {{ v.numero }}</strong>
                          <small>#{{ v.id }}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="est-vinc">
                        <span
                          class="est-dot"
                          [class.on]="v.idacomodacao"
                          [title]="v.idacomodacao ? 'Vinculada' : 'Livre'"
                        ></span>
                        <mat-select
                          class="mat-sel est-sel"
                          [class.vago]="!v.idacomodacao"
                          [value]="v.idacomodacao"
                          (selectionChange)="vincular(v, $event.value)"
                          aria-label="Acomodação vinculada"
                          placeholder="Livre"
                        >
                          <mat-option [value]="null">Livre</mat-option>
                          @for (a of acomodacoes(); track a.id) {
                            <mat-option [value]="a.id">{{ a.nome }} ({{ a.numero }})</mat-option>
                          }
                        </mat-select>
                      </div>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="st-chip"
                        [class.off]="!v.ativo"
                        [title]="v.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                        (click)="status(v, !v.ativo)"
                      >
                        {{ v.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    @if (auth.isAdmin()) {
                      <td class="tc">
                        <button
                          type="button"
                          class="acao-btn perigo"
                          title="Excluir vaga"
                          aria-label="Excluir vaga"
                          (click)="remover(v)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      </td>
                    }
                  </tr>
                } @empty {
                  <tr>
                    <td [attr.colspan]="auth.isAdmin() ? 4 : 3" class="est-vazio">
                      <mat-icon>local_parking</mat-icon>
                      <p>
                        {{
                          termo() || apenasAtivas()
                            ? 'Nenhuma vaga encontrada para esses filtros.'
                            : 'Nenhuma vaga cadastrada ainda.'
                        }}
                      </p>
                      @if (!termo() && !apenasAtivas()) {
                        <p class="est-vazio-dica">
                          Use o campo <b>Nova vaga</b> acima para cadastrar a primeira.
                        </p>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: `
    /* ---------- cabeçalho da página ---------- */
    .est-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .est-titulo-grupo {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .eyebrow {
      margin: 0;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #8fa3ab;
    }
    .est-titulo-linha {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .est-titulo {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      color: #054054;
      letter-spacing: -0.01em;
    }
    .est-contador {
      font-size: 0.78rem;
      font-weight: 600;
      color: #054054;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .est-head-acoes {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn-tour {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #d7e0e6;
      background: #fff;
      color: #5d6d7e;
      border-radius: 4px;
      padding: 0 14px;
      min-height: 34px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition:
        background 0.15s ease,
        color 0.15s ease,
        border-color 0.15s ease;
    }
    .btn-tour mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .btn-tour:hover {
      border-color: #054054;
      color: #054054;
    }

    /* ---------- banners de informação ---------- */
    .est-info {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 16px;
    }
    .est-info-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 15px 16px;
      transition:
        box-shadow 0.15s ease,
        transform 0.15s ease;
    }
    .est-info-card:hover {
      box-shadow: 0 6px 18px rgba(5, 64, 84, 0.08);
      transform: translateY(-1px);
    }
    .est-info-icone {
      width: 38px;
      height: 38px;
      border-radius: 9px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #eef4f6;
      color: #054054;
    }
    .est-info-icone mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .est-info-txt {
      min-width: 0;
    }
    .est-info-txt strong {
      display: block;
      font-size: 0.9rem;
      font-weight: 700;
      color: #054054;
      margin-bottom: 3px;
    }
    .est-info-txt p {
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .est-info-txt b {
      color: #40525d;
    }
    @media (max-width: 960px) {
      .est-info {
        grid-template-columns: 1fr;
      }
    }

    /* ---------- cadastro rápido ---------- */
    .est-card {
      padding-top: 14px;
    }
    .est-form {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      background: #f4f8fa;
      border: 1px dashed #c3d4dc;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 16px;
    }
    .est-form-icone {
      width: 38px;
      height: 38px;
      border-radius: 9px;
      flex-shrink: 0;
      background: #eef4f6;
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .est-form-icone mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .est-form-txt {
      display: flex;
      flex-direction: column;
      line-height: 1.25;
      margin-right: auto;
    }
    .est-form-txt strong {
      font-size: 0.9rem;
      font-weight: 700;
      color: #054054;
    }
    .est-form-txt small {
      font-size: 0.76rem;
      color: #7d97a1;
    }
    .est-num {
      width: 170px;
    }
    .est-form .btn-dark-blue {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .est-form .btn-dark-blue mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    /* ---------- toolbar ---------- */
    .est-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
      flex-wrap: wrap;
      margin-bottom: 18px;
      padding: 4px 2px;
    }
    .est-busca {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 240px;
      max-width: 460px;
      background: #fff;
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 0 10px;
      height: 40px;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .est-busca.foco {
      border-color: #054054;
      box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.12);
    }
    .est-busca-icone {
      color: #7d97a1;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .est-busca-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.9rem;
      color: #33424c;
      font-family: inherit;
      height: 100%;
    }
    .est-busca-input::placeholder {
      color: #8fa3ab;
    }
    .est-busca-input::-webkit-search-cancel-button {
      display: none;
    }
    .est-limpar {
      border: none;
      background: #eef2f5;
      border-radius: 50%;
      width: 22px;
      height: 22px;
      cursor: pointer;
      color: #5d6d7e;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .est-limpar mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .est-limpar:hover {
      background: #d7e0e6;
    }

    .est-toggle {
      display: inline-flex;
      align-items: center;
      gap: 14px;
      border: 1px solid #d7e0e6;
      background: #fff;
      border-radius: 999px;
      padding: 8px 20px 8px 12px;
      font-size: 0.84rem;
      font-weight: 600;
      color: #5d6d7e;
      cursor: pointer;
      font-family: inherit;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    .est-trilho {
      width: 34px;
      height: 19px;
      border-radius: 999px;
      background: #c3d2d9;
      position: relative;
      transition: background 0.18s;
      flex-shrink: 0;
    }
    .est-bolinha {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      transition: transform 0.18s;
    }
    .est-toggle.on {
      border-color: #054054;
      color: #054054;
    }
    .est-toggle.on .est-trilho {
      background: #054054;
    }
    .est-toggle.on .est-bolinha {
      transform: translateX(16px);
    }

    /* ---------- tabela ---------- */
    .est-tabela-wrap {
      overflow-x: auto;
      border-radius: 8px;
      min-height: 36vh;
    }
    .est-tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .est-tabela thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-align: left;
      padding: 14px 14px;
      border-bottom: 1px solid #d7e0e6;
      white-space: nowrap;
    }
    .est-tabela tbody td {
      padding: 16px 14px;
      border-bottom: 1px solid #eef2f5;
      color: #2c3a44;
      vertical-align: middle;
      white-space: nowrap;
    }
    .est-row {
      transition: background 0.12s;
    }
    .est-row:hover {
      background: #f4f8fa;
    }
    .est-row:last-child td {
      border-bottom: none;
    }
    .tc {
      text-align: center;
    }
    .est-th-vaga {
      min-width: 220px;
    }

    .est-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 180px;
    }
    .est-vaga-icone {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      flex-shrink: 0;
      background: rgba(5, 64, 84, 0.08);
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .est-vaga-icone mat-icon {
      font-size: 23px;
      width: 23px;
      height: 23px;
    }
    .est-cell-txt {
      display: flex;
      flex-direction: column;
      line-height: 1.3;
    }
    .est-cell-txt strong {
      color: #054054;
      font-weight: 600;
      font-size: 0.95rem;
    }
    .est-cell-txt small {
      color: #7d97a1;
      font-size: 0.8rem;
    }

    .est-vinc {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .est-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #c3d2d9;
      flex-shrink: 0;
    }
    .est-dot.on {
      background: #054054;
    }

    /* (mat-select estilizado globalmente em styles.css) */

    .st-chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid #d7e0e6;
      border-radius: 999px;
      background: #eef4f6;
      color: #054054;
      padding: 6px 14px;
      font-size: 0.8rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    .st-chip:hover {
      border-color: #054054;
    }
    .st-chip.off {
      background: #f4f6f8;
      color: #7d97a1;
    }

    .acao-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      margin: 0 2px;
      border: 1px solid #d7e0e6;
      border-radius: 7px;
      background: #fff;
      color: #5d6d7e;
      cursor: pointer;
      transition:
        border-color 0.15s,
        color 0.15s,
        background 0.15s;
    }
    .acao-btn mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .acao-btn:hover {
      border-color: #054054;
      color: #054054;
    }
    .acao-btn.perigo:hover {
      border-color: #b3261e;
      color: #b3261e;
      background: #fdf3f2;
    }

    /* ---------- estado vazio ---------- */
    .est-vazio {
      text-align: center;
      padding: 40px 16px !important;
      color: #7d97a1;
    }
    .est-vazio mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #c3d2d9;
      margin-bottom: 8px;
    }
    .est-vazio p {
      margin: 0 0 6px;
      font-size: 0.9rem;
    }
    .est-vazio-dica {
      font-size: 0.82rem !important;
      color: #8fa3ab;
    }

    /* ---------- skeleton ---------- */
    .skel-row td {
      border-bottom: 1px solid #eef2f5;
    }
    .skel {
      display: inline-block;
      border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #e3eaef 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer {
      to {
        background-position: -200% 0;
      }
    }
    .skel-icone {
      width: 42px;
      height: 42px;
      border-radius: 10px;
    }
    .skel-nome {
      width: 110px;
      height: 14px;
      margin-left: 10px;
      vertical-align: middle;
    }
    .skel-sel {
      width: 200px;
      height: 38px;
      border-radius: 8px;
    }
    .skel-chip {
      width: 62px;
      height: 24px;
      border-radius: 999px;
    }
    .skel-acoes {
      width: 40px;
      height: 26px;
    }

    @media (max-width: 640px) {
      .est-head {
        flex-direction: column;
        align-items: stretch;
      }
      .est-form-txt {
        margin-right: 0;
      }
      .est-num {
        flex: 1;
      }
      .est-busca {
        max-width: none;
      }
    }
  `,
})
export class EstacionamentoComponent extends EstacionamentoStore {}
