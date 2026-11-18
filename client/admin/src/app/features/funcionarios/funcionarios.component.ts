// UI de funcionarios — template, estilos e bindings. A lógica vive em funcionarios.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import * as M from '@core/models';
import { Cargo } from '@core/models/funcionarios.models';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FuncionariosStore } from './funcionarios.store';

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
          <p class="eyebrow">Configurações</p>
          <h2 class="fn-titulo">Funcionários</h2>
          <p class="fn-sub">
            Equipe com acesso ao sistema — cada pessoa entra com login e senha próprios
          </p>
        </div>
        <div class="fn-acoes">
          <a class="btn-tour" routerLink="/auditoria"> <mat-icon>history</mat-icon> Auditoria </a>
          <button class="btn-tour" type="button" (click)="abrirCargos()" id="tour-cargos">
            <mat-icon>work</mat-icon> Cargos
          </button>
          <button
            class="btn-tour"
            type="button"
            (click)="iniciarTour()"
            aria-label="Ver tutorial da tela"
          >
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
          <span class="fn-banner-ic"><mat-icon>badge</mat-icon></span>
          <div>
            <strong>Três níveis de acesso</strong>
            <p>
              <b>Recepção</b> opera o dia a dia · <b>Gerente</b> acompanha relatórios ·
              <b>Administrador</b> tem acesso total ao sistema.
            </p>
          </div>
        </div>
        <div class="fn-banner">
          <span class="fn-banner-ic"><mat-icon>key</mat-icon></span>
          <div>
            <strong>Conta individual e rastreável</strong>
            <p>
              Cada ação no sistema fica registrada com o nome de quem fez — por isso cada pessoa tem
              seu próprio login. Nunca compartilhe senhas.
            </p>
          </div>
        </div>
        <div class="fn-banner">
          <span class="fn-banner-ic"><mat-icon>shield</mat-icon></span>
          <div>
            <strong>Você está protegido</strong>
            <p>
              O sistema não deixa você desativar nem excluir a sua própria conta — evita bloquear o
              acesso por engano.
            </p>
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
              <button
                type="button"
                class="fn-limpar"
                aria-label="Limpar busca"
                (click)="termo.set(''); pagina.set(0)"
              >
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
                <th class="tc">Identidade</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td>
                      <span class="skel-cell"
                        ><span class="skel sk-av"></span><span class="skel sk-txt-l"></span
                      ></span>
                    </td>
                    <td><span class="skel sk-txt"></span></td>
                    <td><span class="skel sk-chip"></span></td>
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
                        <span class="fn-avatar" [class.eu]="f.id === auth.user()?.id">{{
                          iniciais(f.nome)
                        }}</span>
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
                      <span class="fn-nivel n{{ f.nivel }}" [title]="nivelNome(f.nivel)">
                        <mat-icon>{{ nivelIcone(f.nivel) }}</mat-icon>
                        {{ cargoNome(f) }}
                      </span>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="st-chip"
                        [class.off]="!f.ativo"
                        [disabled]="f.id === auth.user()?.id"
                        [title]="
                          f.id === auth.user()?.id
                            ? 'Você não pode desativar a si mesmo'
                            : f.ativo
                              ? 'Clique para desativar'
                              : 'Clique para ativar'
                        "
                        (click)="status(f, !f.ativo)"
                      >
                        {{ f.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc">
                      <span
                        class="v-pill"
                        [class]="verificacaoDe(f.id).cls"
                        [title]="verificacaoDe(f.id).titulo"
                      >
                        <mat-icon class="v-pill-ic">{{ verificacaoDe(f.id).icone }}</mat-icon>
                        {{ verificacaoDe(f.id).rotulo }}
                      </span>
                      <button
                        type="button"
                        class="acao-btn v-link"
                        [disabled]="gerandoLink() === f.id"
                        [title]="'Gerar link de verificação Didit para ' + f.nome"
                        [attr.aria-label]="'Gerar link de verificação para ' + f.nome"
                        (click)="verificar(f)"
                      >
                        <mat-icon>{{ gerandoLink() === f.id ? 'hourglass_top' : 'link' }}</mat-icon>
                      </button>
                    </td>
                    <td class="tc">
                      <div class="fn-acoes-linha">
                        <button
                          type="button"
                          class="acao-btn"
                          title="Editar"
                          aria-label="Editar funcionário"
                          (click)="abrirEdicao(f)"
                        >
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="acao-btn perigo"
                          [disabled]="f.id === auth.user()?.id"
                          (click)="excluir(f)"
                          aria-label="Excluir funcionário"
                          [title]="
                            f.id === auth.user()?.id
                              ? 'Você não pode excluir a si mesmo'
                              : 'Excluir'
                          "
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="fn-vazio">
                      <mat-icon>badge</mat-icon>
                      {{
                        termo()
                          ? 'Nenhum funcionário encontrado para a busca.'
                          : 'Nenhum funcionário cadastrado — clique em Novo funcionário.'
                      }}
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

    <!-- ================= Modal: link de verificação ================= -->
    @if (linkVerificacao(); as lv) {
      <div class="vl-backdrop" (click)="linkVerificacao.set(null)" role="presentation">
        <div
          class="vl-modal"
          (click)="$event.stopPropagation()"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="'Link de verificação de ' + lv.nome"
        >
          <h3 class="vl-t"><mat-icon>verified_user</mat-icon> Verificação de identidade</h3>
          <p class="vl-sub">
            Envie este link para <strong>{{ lv.nome }}</strong> — a pessoa abre no celular, faz o
            KYC (documento + selfie) e o status aparece aqui sozinho.
          </p>
          <div class="vl-linha">
            <input class="vl-url" [value]="lv.url" readonly aria-label="URL de verificação" />
            <button type="button" class="btn-dark-blue" (click)="copiarLink()">
              <mat-icon>content_copy</mat-icon> Copiar
            </button>
          </div>
          <button type="button" class="vl-fechar" (click)="linkVerificacao.set(null)">
            Fechar
          </button>
        </div>
      </div>
    }

    <!-- ================= Drawer: funcionário (criar/editar) ================= -->
    @if (drawerAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharDrawer()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-drawer">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-drawer">
                {{ editando() ? 'Editar funcionário' : 'Novo funcionário' }}
              </h5>
              <p>
                {{
                  editando()
                    ? 'Atualize os dados de ' + editando()!.nome
                    : 'Cadastre um membro da equipe e sua conta de acesso'
                }}
              </p>
            </div>
            <button
              type="button"
              class="drawer-fechar"
              (click)="fecharDrawer()"
              aria-label="Fechar painel"
            >
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
                    <label class="lbl" for="fu-nome"
                      >Nome completo <small class="req">*</small></label
                    >
                    <input
                      id="fu-nome"
                      class="input-inn"
                      type="text"
                      formControlName="nome"
                      placeholder="Ex.: Maria Silva Souza"
                      [class.inval]="invalido('nome')"
                    />
                    @if (invalido('nome')) {
                      <small class="erro-campo">Informe o nome completo.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-nasc"
                      >Data de nascimento <small class="req">*</small></label
                    >
                    <app-date formControlName="data_nascimento" />
                    @if (invalido('data_nascimento')) {
                      <small class="erro-campo">Informe a data de nascimento.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-cpf">CPF <small class="req">*</small></label>
                    <input
                      id="fu-cpf"
                      class="input-inn"
                      type="text"
                      formControlName="cpf"
                      placeholder="000.000.000-00"
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
                    <label class="lbl" for="fu-cargo">Cargo <small class="req">*</small></label>
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                      [class.err]="invalido('cargo_id')"
                    >
                      <mat-select id="fu-cargo" formControlName="cargo_id" placeholder="Selecione…">
                        @for (c of cargos(); track c.id) {
                          @if (c.ativo || c.id === editando()?.cargo_id) {
                            <mat-option [value]="c.id">
                              {{ c.nome }} — {{ nivelNome(c.nivel).toLowerCase() }}
                            </mat-option>
                          }
                        }
                      </mat-select>
                    </mat-form-field>
                    @if (invalido('cargo_id')) {
                      <small class="erro-campo">Escolha o cargo.</small>
                    }
                    <button type="button" class="link-gerir" (click)="abrirCargos()">
                      <mat-icon>settings</mat-icon> Gerenciar cargos
                    </button>
                  </div>
                  <div class="campo">
                    <label class="lbl" for="fu-login">Login <small class="req">*</small></label>
                    <input
                      id="fu-login"
                      class="input-inn"
                      type="text"
                      formControlName="login"
                      placeholder="Ex.: maria.s"
                      [class.inval]="invalido('login')"
                    />
                    @if (invalido('login')) {
                      <small class="erro-campo">Informe o login.</small>
                    }
                  </div>
                  <div class="campo">
                    <span class="lbl">
                      Senha
                      @if (!editando()) {
                        <small class="req">*</small>
                      }
                    </span>
                    @if (editando()) {
                      <label class="senha-toggle" [class.on]="trocaSenha()">
                        <input
                          type="checkbox"
                          [checked]="trocaSenha()"
                          (change)="alternarSenha()"
                        />
                        <mat-icon>{{ trocaSenha() ? 'lock_reset' : 'lock' }}</mat-icon>
                        <span>{{ trocaSenha() ? 'Redefinindo senha' : 'Alterar senha' }}</span>
                      </label>
                    }
                    @if (!editando() || trocaSenha()) {
                      <div class="senha-wrap">
                        <input
                          id="fu-senha"
                          class="input-inn"
                          [type]="verSenha() ? 'text' : 'password'"
                          formControlName="senha"
                          [placeholder]="editando() ? 'Nova senha (mín. 8)' : 'Mínimo 8 caracteres'"
                          autocomplete="new-password"
                          [class.inval]="invalido('senha')"
                        />
                        <button
                          type="button"
                          class="senha-eye"
                          [attr.aria-label]="verSenha() ? 'Ocultar senha' : 'Mostrar senha'"
                          [title]="verSenha() ? 'Ocultar senha' : 'Mostrar senha'"
                          (click)="verSenha.set(!verSenha())"
                        >
                          <mat-icon>{{ verSenha() ? 'visibility_off' : 'visibility' }}</mat-icon>
                        </button>
                      </div>
                    } @else {
                      <small class="senha-hint">A senha atual será mantida.</small>
                    }
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
                  <li>
                    <b>Recepção</b> é a função certa para quem só opera check-in, reservas e consumo
                  </li>
                </ul>
              </section>
            </div>

            <footer class="drawer-foot">
              <span class="drawer-req"><small class="req">*</small> Campos obrigatórios</span>
              <div class="drawer-foot-acoes">
                <button class="btn-gray" type="button" (click)="fecharDrawer()">Cancelar</button>
                <button class="btn-dark-blue" type="submit">
                  <mat-icon>save</mat-icon>
                  {{ editando() ? 'Salvar alterações' : 'Cadastrar funcionário' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
    }

    <!-- ================= Drawer: cargos ================= -->
    @if (cargosAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharCargos()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-cargos">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-cargos">Cargos</h5>
              <p>Títulos da equipe — cada cargo define o nível de acesso do funcionário</p>
            </div>
            <button
              type="button"
              class="drawer-fechar"
              (click)="fecharCargos()"
              aria-label="Fechar painel"
            >
              <mat-icon>close</mat-icon>
            </button>
          </header>

          <div class="drawer-body">
            <!-- Criar / editar -->
            <section class="dsec">
              <div class="dsec-tit">
                <mat-icon>{{ editandoCargo() ? 'edit' : 'add' }}</mat-icon>
                {{ editandoCargo() ? 'Editar cargo' : 'Novo cargo' }}
              </div>
              <form [formGroup]="cargoForm" (ngSubmit)="salvarCargo()" autocomplete="off">
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="cg-nome">Nome <small class="req">*</small></label>
                    <input
                      id="cg-nome"
                      class="input-inn"
                      type="text"
                      formControlName="nome"
                      placeholder="Ex.: Camareira, Cozinheira, Manutenção"
                      [class.inval]="invalidoCargo('nome')"
                    />
                    @if (invalidoCargo('nome')) {
                      <small class="erro-campo">Informe o nome do cargo.</small>
                    }
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="cg-desc">Descrição</label>
                    <input
                      id="cg-desc"
                      class="input-inn"
                      type="text"
                      formControlName="descricao"
                      placeholder="Ex.: cuida da limpeza e arrumação dos quartos"
                    />
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="cg-nivel"
                      >Nível de acesso <small class="req">*</small></label
                    >
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                      [class.err]="invalidoCargo('nivel')"
                    >
                      <mat-select id="cg-nivel" formControlName="nivel">
                        <mat-option [value]="3">Recepção — opera o dia a dia</mat-option>
                        <mat-option [value]="2">Gerente — recepção + relatórios</mat-option>
                        <mat-option [value]="1">Administrador — acesso total</mat-option>
                      </mat-select>
                    </mat-form-field>
                    @if (editandoCargo()?.sistema) {
                      <small class="senha-hint"
                        >O nível de um cargo-base não pode ser alterado.</small
                      >
                    } @else {
                      <small class="senha-hint"
                        >Funcionários com este cargo entram no sistema com esse nível.</small
                      >
                    }
                  </div>
                </div>
                <div class="cg-acoes">
                  @if (editandoCargo()) {
                    <button class="btn-gray" type="button" (click)="cancelarCargo()">
                      Cancelar edição
                    </button>
                  }
                  <button class="btn-dark-blue" type="submit">
                    <mat-icon>save</mat-icon> {{ editandoCargo() ? 'Salvar cargo' : 'Criar cargo' }}
                  </button>
                </div>
              </form>
            </section>

            <!-- Lista -->
            <section class="dsec">
              <div class="dsec-tit"><mat-icon>list</mat-icon> Cargos cadastrados</div>
              <ul class="cg-lista">
                @for (c of cargos(); track c.id) {
                  <li class="cg-item" [class.inativo]="!c.ativo">
                    <div class="cg-info">
                      <strong>
                        {{ c.nome }}
                        @if (c.sistema) {
                          <span class="cg-sys">sistema</span>
                        }
                      </strong>
                      <small>
                        {{ nivelNome(c.nivel) }}{{ c.descricao ? ' · ' + c.descricao : '' }} ·
                        {{ c.total_funcionarios }}
                        {{ c.total_funcionarios === 1 ? 'pessoa' : 'pessoas' }}
                      </small>
                    </div>
                    <div class="cg-item-acoes">
                      <button
                        type="button"
                        class="st-chip"
                        [class.off]="!c.ativo"
                        [title]="c.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                        (click)="statusCargo(c, !c.ativo)"
                      >
                        {{ c.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                      <button
                        type="button"
                        class="acao-btn"
                        aria-label="Editar cargo"
                        title="Editar"
                        (click)="editarCargo(c)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="acao-btn perigo"
                        [disabled]="c.sistema || c.total_funcionarios > 0"
                        aria-label="Excluir cargo"
                        [title]="
                          c.sistema
                            ? 'Cargo-base do sistema não pode ser excluído'
                            : c.total_funcionarios > 0
                              ? 'Há funcionários com este cargo'
                              : 'Excluir'
                        "
                        (click)="excluirCargo(c)"
                      >
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </li>
                }
              </ul>
            </section>
          </div>
        </aside>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .fn-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
      padding-bottom: 14px;
      margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .fn-titulo {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 800;
      color: #054054;
      letter-spacing: -0.02em;
    }
    .fn-sub {
      margin: 2px 0 0;
      font-size: 0.82rem;
      color: #7d97a1;
    }
    .fn-acoes {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .fn-acoes button,
    .fn-acoes a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-tour {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #dce6ea;
      background: #fff;
      color: #536b73;
      border-radius: 6px;
      padding: 0 14px;
      min-height: 34px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      font-family: inherit;
      text-decoration: none;
      transition:
        border-color 0.15s ease,
        color 0.15s ease;
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

    /* ---------- banners ---------- */
    .fn-banners {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 960px) {
      .fn-banners {
        grid-template-columns: 1fr;
      }
    }
    .fn-banner {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .fn-banner-ic {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #eef4f6;
      color: #054054;
    }
    .fn-banner-ic mat-icon {
      font-size: 19px;
      width: 19px;
      height: 19px;
    }
    .fn-banner strong {
      display: block;
      font-size: 0.88rem;
      color: #054054;
      margin-bottom: 3px;
    }
    .fn-banner p {
      margin: 0;
      font-size: 0.78rem;
      color: #7d97a1;
      line-height: 1.45;
    }

    /* ---------- resumo ---------- */
    .fn-resumo {
      display: flex;
      align-items: center;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      margin-bottom: 16px;
      overflow-x: auto;
    }
    .fn-est {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 12px 26px;
      min-width: 140px;
      border-left: 1px solid #eef2f5;
    }
    .fn-est:first-child {
      border-left: none;
    }
    .fn-est-num {
      font-size: 1.5rem;
      font-weight: 800;
      color: #054054;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .fn-est-lbl {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.68rem;
      font-weight: 600;
      color: #7d97a1;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      white-space: nowrap;
    }
    .fn-est-lbl mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #8fa3ab;
    }

    /* ---------- toolbar ---------- */
    .fn-card {
      padding-top: 14px;
    }
    .fn-toolbar {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 4px 2px 14px;
    }
    .fn-busca {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      max-width: 420px;
      background: #fff;
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 0 10px;
      height: 40px;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .fn-busca.foco {
      border-color: #054054;
      box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.1);
    }
    .fn-busca-icone {
      color: #7d97a1;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .fn-busca-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.9rem;
      color: #33424c;
      font-family: inherit;
      height: 100%;
    }
    .fn-busca-input::placeholder {
      color: #8fa3ab;
    }
    .fn-busca-input::-webkit-search-cancel-button {
      display: none;
    }
    .fn-limpar {
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
    .fn-limpar mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .fn-limpar:hover {
      background: #d7e0e6;
    }
    .fn-contagem {
      font-size: 0.78rem;
      color: #8a99a4;
      margin-left: auto;
      white-space: nowrap;
    }

    /* ---------- tabela ---------- */
    .fn-tabela-wrap {
      overflow-x: auto;
      min-height: 42vh;
    }
    .fn-tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .fn-tabela thead th {
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 14px 16px;
      text-align: left;
      border-bottom: 2px solid #e3eaef;
      white-space: nowrap;
    }
    .fn-tabela tbody td {
      padding: 12px 16px;
      border-bottom: 1px solid #eef2f5;
      vertical-align: middle;
      color: #33424c;
    }
    .fn-tabela tbody tr:hover {
      background: #f7fafb;
    }
    .fn-tabela .tc {
      text-align: center;
    }
    .fn-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .fn-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .fn-avatar.eu {
      background: linear-gradient(135deg, #054054, #1a6f8a);
      color: #fff;
    }
    .fn-cell-txt {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .fn-cell-txt strong {
      font-size: 0.93rem;
      color: #054054;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 7px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 260px;
    }
    .fn-voce {
      background: #eef4f6;
      color: #054054;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 1px 8px;
      border-radius: 999px;
    }
    .fn-cell-txt small {
      font-size: 0.74rem;
      color: #8a99a4;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .fn-cell-txt small mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }
    .td-cpf {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: #5d6d7e;
    }
    .fn-nivel {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 0.78rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .fn-nivel mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .fn-nivel.n1,
    .fn-nivel.n2,
    .fn-nivel.n3 {
      background: #eef4f6;
      color: #054054;
    }
    .st-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 999px;
      padding: 4px 14px;
      background: #eef4f6;
      color: #054054;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: inherit;
    }
    .st-chip {
      cursor: pointer;
    }
    .st-chip.off {
      background: #f4f8fa;
      color: #8fa3ab;
    }
    .st-chip:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .fn-acoes-linha {
      display: inline-flex;
      gap: 4px;
    }
    .acao-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      border-radius: 6px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      color: #536b73;
      transition:
        background 0.14s,
        color 0.14s;
    }
    .acao-btn mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .acao-btn:hover:not(:disabled) {
      background: #eef4f6;
      color: #054054;
    }
    .acao-btn.perigo:hover:not(:disabled) {
      background: #fbeaea;
      color: #b3343a;
    }
    .acao-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .acao-btn.v-link {
      color: #4b95ab;
    }

    .v-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      vertical-align: middle;
    }
    .v-pill-ic {
      font-size: 14px;
      width: 14px;
      height: 14px;
      line-height: 14px;
    }
    .v-ok {
      background: #e6f4ea;
      color: #1e7d32;
    }
    .v-warn {
      background: #fff7e0;
      color: #8a5a00;
    }
    .v-erro {
      background: #fdecea;
      color: #b3261e;
    }
    .v-off {
      background: #eef2f4;
      color: #8aa0ac;
    }

    .vl-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(11, 36, 55, 0.5);
      display: grid;
      place-items: center;
      z-index: 60;
      padding: 16px;
    }
    .vl-modal {
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      width: min(520px, 100%);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
    }
    .vl-t {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 17px;
      font-weight: 700;
      color: #0b2437;
      margin: 0 0 8px;
    }
    .vl-t mat-icon {
      color: #054054;
    }
    .vl-sub {
      font-size: 13px;
      color: #5a6b76;
      line-height: 1.55;
      margin: 0 0 16px;
    }
    .vl-linha {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .vl-url {
      flex: 1;
      min-width: 220px;
      padding: 10px 12px;
      border: 1px solid #d5e0e6;
      border-radius: 10px;
      font-size: 13px;
      background: #f7fafb;
      color: #39464f;
    }
    .vl-fechar {
      margin-top: 16px;
      border: 0;
      background: none;
      color: #4b95ab;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .fn-vazio {
      text-align: center;
      color: #8a99a4;
      padding: 40px !important;
      font-size: 0.86rem;
    }
    .fn-vazio mat-icon {
      display: block;
      margin: 0 auto 8px;
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #c3d2d9;
    }

    /* ---------- skeleton ---------- */
    .skel-row td {
      padding: 14px 16px;
    }
    .skel {
      display: block;
      border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer {
      to {
        background-position: -200% 0;
      }
    }
    .skel-cell {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sk-av {
      width: 40px;
      height: 40px;
      border-radius: 50%;
    }
    .sk-txt-l {
      width: 170px;
      height: 15px;
    }
    .sk-txt {
      width: 110px;
      height: 14px;
    }
    .sk-chip {
      width: 80px;
      height: 24px;
      border-radius: 999px;
      margin: 0 auto;
    }
    .sk-acoes {
      width: 68px;
      height: 28px;
      margin: 0 auto;
    }

    /* ---------- drawer ---------- */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 320;
      background: rgba(5, 32, 43, 0.45);
      animation: fadeIn 0.18s ease-out;
    }
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
    }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(540px, 100vw);
      background: #f7fafb;
      box-shadow: -12px 0 40px rgba(3, 32, 43, 0.28);
      display: flex;
      flex-direction: column;
      animation: drawerIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
      z-index: 321;
    }
    @keyframes drawerIn {
      from {
        transform: translateX(64px);
        opacity: 0.4;
      }
      to {
        transform: none;
        opacity: 1;
      }
    }
    .drawer-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 22px;
      background: #fff;
      border-bottom: 1px solid #e3eaef;
      flex-shrink: 0;
    }
    .drawer-head-txt h5 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #054054;
    }
    .drawer-head-txt p {
      margin: 3px 0 0;
      font-size: 0.8rem;
      color: #7d97a1;
    }
    .drawer-fechar {
      border: none;
      background: #eef2f5;
      border-radius: 8px;
      width: 34px;
      height: 34px;
      cursor: pointer;
      color: #5d6d7e;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .drawer-fechar:hover {
      background: #d7e0e6;
      color: #054054;
    }
    .drawer-fechar mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .drawer-form {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 18px 22px;
    }
    .dsec {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .dsec-tit {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #054054;
      margin-bottom: 12px;
    }
    .dsec-tit mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .dgrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
    }
    .dgrid .full {
      grid-column: 1 / -1;
    }
    .campo {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .campo .lbl {
      font-size: 0.8rem;
      font-weight: 600;
      color: #40525d;
    }
    .campo .req,
    .drawer-req .req {
      color: #dc3545;
    }
    .erro-campo {
      color: #dc3545;
      font-size: 0.74rem;
      font-weight: 500;
    }
    .input-inn.inval {
      border-color: #dc3545;
      box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.12);
    }
    .senha-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: #40525d;
      font-weight: 600;
      padding: 7px 10px;
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      background: #f7fafc;
      width: fit-content;
      cursor: pointer;
      transition:
        border-color 0.15s,
        color 0.15s,
        background 0.15s;
    }
    .senha-toggle:hover {
      border-color: #4b95ab;
      color: #054054;
    }
    .senha-toggle.on {
      border-color: #054054;
      background: #eef6f8;
      color: #054054;
    }
    .senha-toggle input {
      accent-color: #054054;
      margin: 0;
    }
    .senha-toggle mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .senha-wrap {
      position: relative;
    }
    .senha-wrap .input-inn {
      width: 100%;
      padding-right: 38px;
    }
    .senha-eye {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #8aa0ac;
      cursor: pointer;
      padding: 5px;
      display: inline-flex;
      border-radius: 6px;
    }
    .senha-eye:hover {
      color: #054054;
      background: #eef4f6;
    }
    .senha-eye mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .senha-hint {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .dica-sec {
      background: #f4f8fa;
    }
    .dicas {
      margin: 0;
      padding-left: 18px;
      font-size: 0.8rem;
      color: #536b73;
      line-height: 1.7;
    }
    .link-gerir {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: none;
      padding: 0;
      margin-top: 2px;
      font-size: 0.76rem;
      font-weight: 600;
      color: #4b95ab;
      font-family: inherit;
      cursor: pointer;
    }
    .link-gerir:hover {
      color: #054054;
      text-decoration: underline;
    }
    .link-gerir mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    /* ---------- cargos ---------- */
    .cg-acoes {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    }
    .cg-acoes .btn-dark-blue,
    .cg-acoes .btn-gray {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0.45rem 0.9rem;
    }
    .cg-acoes mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .cg-lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    .cg-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 4px;
      border-bottom: 1px solid #eef2f5;
    }
    .cg-item:last-child {
      border-bottom: none;
    }
    .cg-item.inativo .cg-info {
      opacity: 0.55;
    }
    .cg-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .cg-info strong {
      font-size: 0.88rem;
      color: #054054;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .cg-sys {
      background: #eef4f6;
      color: #054054;
      font-size: 0.62rem;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cg-info small {
      font-size: 0.74rem;
      color: #8a99a4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cg-item-acoes {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .drawer-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 22px;
      background: #fff;
      border-top: 1px solid #e3eaef;
      flex-shrink: 0;
    }
    .drawer-req {
      font-size: 0.76rem;
      color: #8a99a4;
    }
    .drawer-foot-acoes {
      display: flex;
      gap: 8px;
    }
    .drawer-foot-acoes .btn-dark-blue,
    .drawer-foot-acoes .btn-gray {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0.5rem 1rem;
    }
    .drawer-foot-acoes mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    @media (max-width: 640px) {
      .fn-head {
        flex-direction: column;
        align-items: stretch;
      }
      .fn-acoes {
        justify-content: stretch;
      }
      .fn-acoes button,
      .fn-acoes a {
        flex: 1;
        justify-content: center;
      }
      .dgrid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class FuncionariosComponent extends FuncionariosStore {}
