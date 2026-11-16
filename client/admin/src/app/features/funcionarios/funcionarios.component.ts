import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FuncionariosApi } from '@core/api/funcionarios.api';
import { Funcionario, FuncionarioInput, FuncionarioUpdate } from '@core/models/funcionarios.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourGuiado } from '@core/services/tour.service';
import { DateInputComponent } from '@shared/components/date-input.component';

// Gestão da equipe: contas de acesso ao sistema (Recepção / Gerente / Administrador).
@Component({
  selector: 'app-funcionarios',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    RouterLink,
    MatPaginatorModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    DateInputComponent,
  ],
  template: `
    <div class="page">
      <!-- ================= Cabeçalho ================= -->
      <div class="fn-head">
        <div>
          <h2 class="fn-titulo">Funcionários</h2>
          <p class="fn-sub">Equipe com acesso ao sistema — cada pessoa entra com login e senha próprios</p>
        </div>
        <div class="fn-acoes">
          <a class="btn-tour" routerLink="/auditoria">
            <mat-icon>history</mat-icon> Auditoria
          </a>
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-novo" class="btn-dark-blue" type="button" (click)="abrirNovo()">
            <mat-icon>person_add</mat-icon> Novo funcionário
          </button>
        </div>
      </div>

      <!-- ================= Banners ================= -->
      <div class="fn-banners">
        <div class="fn-banner">
          <span class="fn-banner-ic tint-teal"><mat-icon>badge</mat-icon></span>
          <div>
            <strong>Três níveis de acesso</strong>
            <p><b>Recepção</b> opera o dia a dia · <b>Gerente</b> acompanha relatórios · <b>Administrador</b> tem acesso total ao sistema.</p>
          </div>
        </div>
        <div class="fn-banner">
          <span class="fn-banner-ic tint-gold"><mat-icon>key</mat-icon></span>
          <div>
            <strong>Conta individual e rastreável</strong>
            <p>Cada ação no sistema fica registrada com o nome de quem fez — por isso cada pessoa tem seu próprio login. Nunca compartilhe senhas.</p>
          </div>
        </div>
        <div class="fn-banner">
          <span class="fn-banner-ic tint-navy"><mat-icon>shield</mat-icon></span>
          <div>
            <strong>Você está protegido</strong>
            <p>O sistema não deixa você desativar nem excluir a sua própria conta — evita bloquear o acesso por engano.</p>
          </div>
        </div>
      </div>

      <!-- ================= Barra de números ================= -->
      <div class="fn-resumo">
        <div class="fn-est">
          <span class="fn-est-num">{{ total() }}</span>
          <span class="fn-est-lbl"><mat-icon>groups</mat-icon> Funcionários</span>
        </div>
        <div class="fn-est">
          <span class="fn-est-num">{{ ativos() }}</span>
          <span class="fn-est-lbl"><mat-icon>check_circle</mat-icon> Ativos</span>
        </div>
        <div class="fn-est">
          <span class="fn-est-num">{{ porNivel(3) }}</span>
          <span class="fn-est-lbl"><mat-icon>room_service</mat-icon> Recepção</span>
        </div>
        <div class="fn-est">
          <span class="fn-est-num">{{ porNivel(2) }}</span>
          <span class="fn-est-lbl"><mat-icon>manage_accounts</mat-icon> Gerentes</span>
        </div>
        <div class="fn-est">
          <span class="fn-est-num">{{ porNivel(1) }}</span>
          <span class="fn-est-lbl"><mat-icon>admin_panel_settings</mat-icon> Admins</span>
        </div>
      </div>

      <!-- ================= Lista ================= -->
      <div class="inner-card fn-card" id="tour-tabela">
        <div class="fn-toolbar">
          <div class="fn-busca" [class.foco]="buscaFoco()">
            <mat-icon class="fn-busca-icone">search</mat-icon>
            <input
              class="fn-busca-input"
              type="search"
              [value]="termo()"
              (input)="termo.set(valorDe($event)); pagina.set(0)"
              placeholder="Buscar por nome, login ou CPF…"
              aria-label="Buscar funcionário"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button type="button" class="fn-limpar" aria-label="Limpar busca" (click)="termo.set(''); pagina.set(0)">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          <span class="fn-contagem">{{ filtrados().length }} de {{ items().length }}</span>
        </div>

        <div class="fn-tabela-wrap">
          <table class="fn-tabela">
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>CPF</th>
                <th class="tc">Função</th>
                <th class="tc">Status</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td>
                      <span class="skel-cell"><span class="skel sk-av"></span><span class="skel sk-txt-l"></span></span>
                    </td>
                    <td><span class="skel sk-txt"></span></td>
                    <td><span class="skel sk-chip"></span></td>
                    <td><span class="skel sk-chip"></span></td>
                    <td><span class="skel sk-acoes"></span></td>
                  </tr>
                }
              } @else {
                @for (f of paginados(); track f.id) {
                  <tr>
                    <td>
                      <div class="fn-cell">
                        <span class="fn-avatar" [class.eu]="f.id === auth.user()?.id">{{ iniciais(f.nome) }}</span>
                        <div class="fn-cell-txt">
                          <strong>
                            {{ f.nome }}
                            @if (f.id === auth.user()?.id) {
                              <span class="fn-voce">você</span>
                            }
                          </strong>
                          <small><mat-icon>alternate_email</mat-icon>{{ f.login }}</small>
                        </div>
                      </div>
                    </td>
                    <td class="td-cpf">{{ f.cpf || '—' }}</td>
                    <td class="tc">
                      <span class="fn-nivel" [class]="'n' + f.nivel">
                        <mat-icon>{{ nivelIcone(f.nivel) }}</mat-icon>
                        {{ nivelNome(f.nivel) }}
                      </span>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="status-chip badge-toggle"
                        [class.on]="f.ativo"
                        [class.off]="!f.ativo"
                        [disabled]="f.id === auth.user()?.id"
                        [title]="f.id === auth.user()?.id ? 'Você não pode desativar a si mesmo' : (f.ativo ? 'Clique para desativar' : 'Clique para ativar')"
                        (click)="status(f, !f.ativo)"
                      >{{ f.ativo ? 'Ativo' : 'Inativo' }}</button>
                    </td>
                    <td class="tc">
                      <div class="fn-acoes-linha">
                        <button
                          type="button" class="acao gold" title="Editar"
                          aria-label="Editar funcionário"
                          (click)="abrirEdicao(f)"
                        ><mat-icon>edit</mat-icon></button>
                        <button
                          type="button" class="acao navy"
                          [disabled]="f.id === auth.user()?.id"
                          (click)="excluir(f)"
                          aria-label="Excluir funcionário"
                          [title]="f.id === auth.user()?.id ? 'Você não pode excluir a si mesmo' : 'Excluir'"
                        ><mat-icon>delete</mat-icon></button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="fn-vazio">
                      <mat-icon>badge</mat-icon>
                      {{ termo() ? 'Nenhum funcionário encontrado para a busca.' : 'Nenhum funcionário cadastrado — clique em Novo funcionário.' }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        <mat-paginator
          [length]="filtrados().length"
          [pageSize]="pageSize()"
          [pageIndex]="pagina()"
          [pageSizeOptions]="[10, 20, 50]"
          (page)="mudouPagina($event)"
        />
      </div>
    </div>

    <!-- ================= Drawer: funcionário (criar/editar) ================= -->
    @if (drawerAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharDrawer()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-drawer">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-drawer">{{ editando() ? 'Editar funcionário' : 'Novo funcionário' }}</h5>
              <p>{{ editando() ? 'Atualize os dados de ' + editando()!.nome : 'Cadastre um membro da equipe e sua conta de acesso' }}</p>
            </div>
            <button type="button" class="drawer-fechar" (click)="fecharDrawer()" aria-label="Fechar painel">
              <mat-icon>close</mat-icon>
            </button>
          </header>

          <form [formGroup]="form" (ngSubmit)="salvar()" autocomplete="off" class="drawer-form">
            <div class="drawer-body">
              <!-- Dados pessoais -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>badge</mat-icon> Dados pessoais</div>
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="fu-nome">Nome completo <small class="req">*</small></label>
                    <input
                      id="fu-nome" class="input-inn" type="text"
                      formControlName="nome" placeholder="Ex.: Maria Silva Souza"
                      [class.inval]="invalido('nome')"
                    />
                    @if (invalido('nome')) {
                      <small class="erro-campo">Informe o nome completo.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-nasc">Data de nascimento <small class="req">*</small></label>
                    <app-date formControlName="data_nascimento" />
                    @if (invalido('data_nascimento')) {
                      <small class="erro-campo">Informe a data de nascimento.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-cpf">CPF <small class="req">*</small></label>
                    <input
                      id="fu-cpf" class="input-inn" type="text"
                      formControlName="cpf" placeholder="000.000.000-00"
                      [class.inval]="invalido('cpf')"
                    />
                    @if (invalido('cpf')) {
                      <small class="erro-campo">Informe o CPF.</small>
                    }
                  </div>
                </div>
              </section>

              <!-- Função & acesso -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>key</mat-icon> Função &amp; acesso</div>
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="fu-nivel">Função <small class="req">*</small></label>
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                      [class.err]="invalido('nivel')"
                    >
                      <mat-select id="fu-nivel" formControlName="nivel" placeholder="Selecione…">
                        <mat-option [value]="3">Recepção — opera o dia a dia</mat-option>
                        <mat-option [value]="2">Gerente — recepção + relatórios</mat-option>
                        <mat-option [value]="1">Administrador — acesso total</mat-option>
                      </mat-select>
                    </mat-form-field>
                    @if (invalido('nivel')) {
                      <small class="erro-campo">Escolha a função.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-login">Login <small class="req">*</small></label>
                    <input
                      id="fu-login" class="input-inn" type="text"
                      formControlName="login" placeholder="Ex.: maria.s"
                      [class.inval]="invalido('login')"
                    />
                    @if (invalido('login')) {
                      <small class="erro-campo">Informe o login.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-senha">
                      Senha
                      @if (!editando()) { <small class="req">*</small> }
                    </label>
                    @if (editando() && !trocaSenha()) {
                      <label class="check-senha">
                        <input type="checkbox" (change)="alternarSenha()" />
                        Alterar senha atual
                      </label>
                    }
                    <input
                      id="fu-senha" class="input-inn" type="password"
                      formControlName="senha"
                      [placeholder]="editando() ? 'Nova senha (mín. 8)' : 'Mínimo 8 caracteres'"
                      autocomplete="new-password"
                      [disabled]="!!editando() && !trocaSenha()"
                      [class.inval]="invalido('senha')"
                    />
                    @if (invalido('senha')) {
                      <small class="erro-campo">Senha obrigatória, mínimo de 8 caracteres.</small>
                    }
                  </div>
                </div>
              </section>

              <section class="dsec dica-sec">
                <div class="dsec-tit"><mat-icon>lightbulb</mat-icon> Boas práticas</div>
                <ul class="dicas">
                  <li>Login curto e sem acentos — ex.: <b>maria.s</b></li>
                  <li>Senha com pelo menos 8 caracteres, misturando letras e números</li>
                  <li><b>Recepção</b> é a função certa para quem só opera check-in, reservas e consumo</li>
                </ul>
              </section>
            </div>

            <footer class="drawer-foot">
              <span class="drawer-req"><small class="req">*</small> Campos obrigatórios</span>
              <div class="drawer-foot-acoes">
                <button class="btn-gray" type="button" (click)="fecharDrawer()">Cancelar</button>
                <button class="btn-green" type="submit">
                  <mat-icon>save</mat-icon> {{ editando() ? 'Salvar alterações' : 'Cadastrar funcionário' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .fn-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .fn-titulo { margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054; letter-spacing: -0.02em; }
    .fn-sub { margin: 2px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .fn-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .fn-acoes button, .fn-acoes a { display: inline-flex; align-items: center; gap: 6px; }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #d7e0e6; background: #fff;
      color: #5d6d7e; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600; font-family: inherit;
      text-decoration: none;
      transition: border-color .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { border-color: #1a6f8a; color: #1a6f8a; }

    /* ---------- banners ---------- */
    .fn-banners {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 960px) { .fn-banners { grid-template-columns: 1fr; } }
    .fn-banner {
      display: flex; gap: 12px; align-items: flex-start;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 14px 16px;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .fn-banner:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(5, 64, 84, 0.07); }
    .fn-banner-ic {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .fn-banner-ic mat-icon { font-size: 21px; width: 21px; height: 21px; }
    .tint-teal { background: rgba(26, 111, 138, 0.1); color: #1a6f8a; }
    .tint-gold { background: rgba(221, 165, 84, 0.14); color: #b5811f; }
    .tint-navy { background: rgba(5, 64, 84, 0.08); color: #054054; }
    .fn-banner strong { display: block; font-size: 0.88rem; color: #054054; margin-bottom: 3px; }
    .fn-banner p { margin: 0; font-size: 0.78rem; color: #7d97a1; line-height: 1.45; }

    /* ---------- resumo ---------- */
    .fn-resumo {
      display: flex; align-items: center;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      margin-bottom: 16px; overflow-x: auto;
    }
    .fn-est {
      display: flex; flex-direction: column; gap: 3px;
      padding: 12px 26px; min-width: 140px;
      border-left: 1px solid #eef2f5;
    }
    .fn-est:first-child { border-left: none; }
    .fn-est-num {
      font-size: 1.5rem; font-weight: 800; color: #054054;
      line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
    }
    .fn-est-lbl {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; font-weight: 600; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap;
    }
    .fn-est-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; color: #a5b6bf; }

    /* ---------- toolbar ---------- */
    .fn-card { padding-top: 14px; }
    .fn-toolbar {
      display: flex; align-items: center; gap: 14px;
      padding: 4px 2px 14px;
    }
    .fn-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; max-width: 420px;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color .15s, box-shadow .15s;
    }
    .fn-busca.foco { border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14); }
    .fn-busca-icone { color: #7d97a1; font-size: 20px; width: 20px; height: 20px; }
    .fn-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #33424c; font-family: inherit; height: 100%;
    }
    .fn-busca-input::placeholder { color: #8fa3ab; }
    .fn-busca-input::-webkit-search-cancel-button { display: none; }
    .fn-limpar {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .fn-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .fn-limpar:hover { background: #d7e0e6; }
    .fn-contagem { font-size: 0.78rem; color: #8a99a4; margin-left: auto; white-space: nowrap; }

    /* ---------- tabela ---------- */
    .fn-tabela-wrap { overflow-x: auto; min-height: 42vh; }
    .fn-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .fn-tabela thead th {
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 14px 16px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .fn-tabela tbody td {
      padding: 12px 16px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .fn-tabela tbody tr:hover { background: #f7fafb; }
    .fn-tabela .tc { text-align: center; }
    .fn-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .fn-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.82rem; font-weight: 700; letter-spacing: 0.02em;
    }
    .fn-avatar.eu { background: linear-gradient(135deg, #b5811f, #c98f3e); color: #fff; }
    .fn-cell-txt { display: flex; flex-direction: column; min-width: 0; }
    .fn-cell-txt strong {
      font-size: 0.93rem; color: #054054; font-weight: 700;
      display: flex; align-items: center; gap: 7px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px;
    }
    .fn-voce {
      background: rgba(221, 165, 84, 0.16); color: #b5811f;
      font-size: 0.65rem; font-weight: 700; padding: 1px 8px; border-radius: 999px;
    }
    .fn-cell-txt small {
      font-size: 0.74rem; color: #8a99a4;
      display: inline-flex; align-items: center; gap: 3px;
    }
    .fn-cell-txt small mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .td-cpf { font-variant-numeric: tabular-nums; white-space: nowrap; color: #5d6d7e; }
    .fn-nivel {
      display: inline-flex; align-items: center; gap: 5px;
      border-radius: 999px; padding: 4px 12px;
      font-size: 0.78rem; font-weight: 700; white-space: nowrap;
    }
    .fn-nivel mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .fn-nivel.n1 { background: #054054; color: #fff; }
    .fn-nivel.n2 { background: #1a6f8a; color: #fff; }
    .fn-nivel.n3 { background: #eef4f6; color: #1a6f8a; }
    .status-chip.clickable, .status-chip.badge-toggle { cursor: pointer; border: none; font-family: inherit; }
    .status-chip.on, .status-chip.bg-blue { background: #1a6f8a; color: #fff; }
    .status-chip.off, .status-chip.bg-gray { background: #7d97a1; color: #fff; }
    .status-chip:disabled { opacity: 0.55; cursor: not-allowed; }
    .fn-acoes-linha { display: inline-flex; gap: 5px; }
    .acao {
      display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 6px; width: 30px; height: 30px;
      cursor: pointer; transition: filter .14s;
    }
    .acao mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .acao:hover:not(:disabled) { filter: brightness(1.12); }
    .acao:disabled { opacity: 0.4; cursor: not-allowed; }
    .acao.gold { background: #b5811f; color: #054054; }
    .acao.navy { background: #054054; color: #fff; }
    .fn-vazio {
      text-align: center; color: #8a99a4; padding: 40px !important; font-size: 0.86rem;
    }
    .fn-vazio mat-icon { display: block; margin: 0 auto 8px; font-size: 32px; width: 32px; height: 32px; color: #c3d2d9; }

    /* ---------- skeleton ---------- */
    .skel-row td { padding: 14px 16px; }
    .skel {
      display: block; border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-cell { display: flex; align-items: center; gap: 12px; }
    .sk-av { width: 40px; height: 40px; border-radius: 50%; }
    .sk-txt-l { width: 170px; height: 15px; }
    .sk-txt { width: 110px; height: 14px; }
    .sk-chip { width: 80px; height: 24px; border-radius: 999px; margin: 0 auto; }
    .sk-acoes { width: 68px; height: 28px; margin: 0 auto; }

    /* ---------- drawer ---------- */
    .drawer-backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(5, 32, 43, 0.45);
      animation: fadeIn 0.18s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; } }
    .drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 201;
      width: min(540px, 100vw);
      background: #f7fafb;
      box-shadow: -12px 0 40px rgba(3, 32, 43, 0.28);
      display: flex; flex-direction: column;
      animation: drawerIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    @keyframes drawerIn {
      from { transform: translateX(64px); opacity: 0.4; }
      to { transform: none; opacity: 1; }
    }
    .drawer-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; padding: 18px 22px;
      background: #fff; border-bottom: 1px solid #e3eaef; flex-shrink: 0;
    }
    .drawer-head-txt h5 { margin: 0; font-size: 1.1rem; font-weight: 700; color: #054054; }
    .drawer-head-txt p { margin: 3px 0 0; font-size: 0.8rem; color: #7d97a1; }
    .drawer-fechar {
      border: none; background: #eef2f5; border-radius: 8px;
      width: 34px; height: 34px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s;
    }
    .drawer-fechar:hover { background: #d7e0e6; color: #054054; }
    .drawer-fechar mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .drawer-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .drawer-body { flex: 1; overflow-y: auto; padding: 18px 22px; }
    .dsec {
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 16px; margin-bottom: 14px;
    }
    .dsec-tit {
      display: flex; align-items: center; gap: 7px;
      font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #1a6f8a; margin-bottom: 12px;
    }
    .dsec-tit mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
    .dgrid .full { grid-column: 1 / -1; }
    .campo { display: flex; flex-direction: column; gap: 4px; }
    .campo .lbl { font-size: 0.8rem; font-weight: 600; color: #40525d; }
    .campo .req, .drawer-req .req { color: #dc3545; }
    .erro-campo { color: #dc3545; font-size: 0.74rem; font-weight: 500; }
    .input-inn.inval { border-color: #dc3545; box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.12); }
    .check-senha {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.78rem; color: #40525d; font-weight: 500; margin-bottom: 6px;
      cursor: pointer;
    }
    .dica-sec { background: #fbf7ef; border-color: #efe4cd; }
    .dica-sec .dsec-tit { color: #b5811f; }
    .dicas { margin: 0; padding-left: 18px; font-size: 0.8rem; color: #6b5d40; line-height: 1.7; }
    .drawer-foot {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 13px 22px;
      background: #fff; border-top: 1px solid #e3eaef; flex-shrink: 0;
    }
    .drawer-req { font-size: 0.76rem; color: #8a99a4; }
    .drawer-foot-acoes { display: flex; gap: 8px; }
    .drawer-foot-acoes .btn-green,
    .drawer-foot-acoes .btn-gray {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 1rem;
    }
    .drawer-foot-acoes mat-icon { font-size: 16px; width: 16px; height: 16px; }
    @media (max-width: 640px) {
      .fn-head { flex-direction: column; align-items: stretch; }
      .fn-acoes { justify-content: stretch; }
      .fn-acoes button, .fn-acoes a { flex: 1; justify-content: center; }
      .dgrid { grid-template-columns: 1fr; }
    }
  `,
})
export class FuncionariosComponent implements OnInit {
  private readonly funcionariosApi = inject(FuncionariosApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly rt = inject(Realtime);
  private readonly fb = inject(FormBuilder);
  private readonly tour = inject(TourGuiado);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<Funcionario[]>([]);
  protected readonly total = signal(0);
  protected readonly carregando = signal(true);
  protected readonly pagina = signal(0);
  protected readonly editando = signal<Funcionario | null>(null);
  protected readonly trocaSenha = signal(false);
  protected readonly drawerAberto = signal(false);
  protected readonly tentou = signal(false);
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly skel = [0, 1, 2, 3, 4];

  /** Formulário único — criar e editar usam o mesmo drawer. */
  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    data_nascimento: ['', Validators.required],
    cpf: ['', Validators.required],
    nivel: [3, Validators.required],
    login: ['', Validators.required],
    senha: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly ativos = computed(() => this.items().filter((f) => f.ativo).length);
  protected readonly porNivel = (n: number) =>
    this.items().filter((f) => f.nivel === n && f.ativo).length;

  protected readonly filtrados = computed(() => {
    const t = this.termo().trim().toLowerCase();
    if (!t) return this.items();
    return this.items().filter(
      (f) =>
        f.nome.toLowerCase().includes(t) ||
        f.login.toLowerCase().includes(t) ||
        (f.cpf ?? '').includes(t),
    );
  });

  protected readonly pageSize = signal(10);
  protected readonly paginados = computed(() => {
    const ini = this.pagina() * this.pageSize();
    return this.filtrados().slice(ini, ini + this.pageSize());
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('funcionario');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
  }

  ngOnInit(): void {
    this.carregar();
  }

  onEsc(): void {
    if (this.drawerAberto()) this.fecharDrawer();
  }

  carregar(): void {
    this.funcionariosApi.listarFuncionarios(1, 500).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.total.set(p.total);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex);
    this.pageSize.set(e.pageSize);
  }

  nivelNome(n: number): string {
    return n === 1 ? 'Administrador' : n === 2 ? 'Gerente' : 'Recepção';
  }
  nivelIcone(n: number): string {
    return n === 1 ? 'admin_panel_settings' : n === 2 ? 'manage_accounts' : 'room_service';
  }

  iniciais(nome: string | null | undefined): string {
    if (!nome) return '?';
    const p = nome.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  invalido(campo: string): boolean {
    const c = this.form.get(campo);
    return !!c && c.invalid && (c.touched || this.tentou());
  }

  status(f: Funcionario, ativo: boolean): void {
    this.funcionariosApi.statusFuncionario(f.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(f: Funcionario): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o funcionário ${f.nome}? A conta de acesso será apagada.`,
      { titulo: 'Excluir funcionário', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.funcionariosApi.excluirFuncionario(f.id).subscribe({
      next: () => {
        this.notify.ok('Funcionário excluído.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirNovo(): void {
    this.editando.set(null);
    this.trocaSenha.set(false);
    this.tentou.set(false);
    this.form.controls.senha.enable();
    this.form.controls.senha.setValidators([Validators.required, Validators.minLength(8)]);
    this.form.controls.senha.updateValueAndValidity();
    this.form.reset({ nome: '', data_nascimento: '', cpf: '', nivel: 3, login: '', senha: '' });
    this.drawerAberto.set(true);
    setTimeout(() => document.getElementById('fu-nome')?.focus(), 250);
  }

  abrirEdicao(f: Funcionario): void {
    this.editando.set(f);
    this.trocaSenha.set(false);
    this.tentou.set(false);
    this.form.controls.senha.disable();
    this.form.controls.senha.setValidators([Validators.minLength(8)]);
    this.form.controls.senha.updateValueAndValidity();
    this.form.reset({
      nome: f.nome,
      data_nascimento: f.data_nascimento ?? '',
      cpf: f.cpf ?? '',
      nivel: f.nivel,
      login: f.login,
      senha: '',
    });
    this.drawerAberto.set(true);
  }

  fecharDrawer(): void {
    this.drawerAberto.set(false);
    this.editando.set(null);
  }

  /** Habilita/desabilita o campo de senha na edição (checkbox "Alterar senha"). */
  alternarSenha(): void {
    const on = !this.trocaSenha();
    this.trocaSenha.set(on);
    const ctrl = this.form.controls.senha;
    if (on) {
      ctrl.enable();
      ctrl.setValidators([Validators.required, Validators.minLength(8)]);
    } else {
      ctrl.disable();
      ctrl.setValue('');
      ctrl.setValidators([Validators.minLength(8)]);
    }
    ctrl.updateValueAndValidity();
  }

  salvar(): void {
    this.tentou.set(true);
    if (this.form.invalid) {
      setTimeout(
        () => document.querySelector('.drawer .inval')?.scrollIntoView({ block: 'center' }),
        60,
      );
      return;
    }
    const v = this.form.getRawValue();
    const f = this.editando();

    if (!f) {
      const input: FuncionarioInput = {
        nome: v.nome,
        login: v.login,
        senha: v.senha,
        cpf: v.cpf || null,
        data_nascimento: v.data_nascimento || null,
        nivel: v.nivel,
      };
      this.funcionariosApi.criarFuncionario(input).subscribe({
        next: () => {
          this.notify.ok('Funcionário cadastrado.');
          this.fecharDrawer();
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
    } else {
      const input: FuncionarioUpdate = {
        nome: v.nome,
        login: v.login,
        cpf: v.cpf || null,
        data_nascimento: v.data_nascimento || null,
        nivel: v.nivel,
        version: f.version,
      };
      if (v.senha) input.senha = v.senha;
      this.funcionariosApi.atualizarFuncionario(f.id, input).subscribe({
        next: () => {
          this.notify.ok('Funcionário salvo.');
          this.fecharDrawer();
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
    }
  }

  /** Tour guiado da tela (driver.js) — abre o drawer no meio do caminho. */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à tela de Funcionários!',
          description:
            'Aqui você cadastra a <b>equipe</b> que acessa o sistema e ' +
            'define o que cada um pode fazer. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '.fn-resumo',
        popover: {
          title: 'Sua equipe em números',
          description:
            'Total de funcionários, quantos estão <b>ativos</b> e a ' +
            'distribuição por função: Recepção, Gerentes e Administradores.',
          side: 'bottom',
        },
      },
      {
        element: '.fn-busca',
        popover: {
          title: 'Busca instantânea',
          description:
            'Digite <b>nome, login ou CPF</b> — a lista filtra sozinha, ' +
            'sem apertar botão.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista da equipe',
          description:
            'O selo de <b>função</b> indica o nível de acesso. O selo ' +
            '<b>Status</b> ativa/desativa a conta. Você não pode mexer na ' +
            'sua própria conta — segurança.',
          side: 'top',
        },
      },
      {
        element: '#tour-novo',
        popover: {
          title: 'Novo funcionário',
          description:
            'Abre o painel lateral de cadastro. Vou abrir agora para você ver…',
          side: 'bottom',
        },
      },
      {
        element: '.drawer',
        popover: {
          title: 'Cadastro em 2 etapas',
          description:
            '<b>Dados pessoais</b> (nome, nascimento, CPF) e <b>Função & ' +
            'acesso</b> (nível, login e senha). Na edição, a senha só muda se ' +
            'você marcar "Alterar senha atual".',
          side: 'left',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Equipe configurada. Cada ação fica registrada em ' +
            '<b>Auditoria</b> com o nome de quem fez — transparência total.',
        },
      },
    ]);
    setTimeout(() => this.abrirNovo(), 600);
  }
}
