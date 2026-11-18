// UI de acomodacoes — template, estilos e bindings. A lógica vive em acomodacoes.store.ts.
import { DecimalPipe, DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { num } from '@core/utils/num';
import { Quarto } from '@core/models/catalogo.models';
import { AcomodacoesStore } from './acomodacoes.store';

@Component({
  selector: 'app-acomodacoes',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    DecimalPipe,
    DatePipe,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    ReactiveFormsModule,
  ],
  template: `
    <div class="page">
      <div class="acm-head">
        <div class="acm-titulo-grupo">
          <p class="eyebrow">Cadastro</p>
          <div class="acm-titulo-linha">
            <h2 class="acm-titulo">Acomodações</h2>
            <span class="acm-contador" title="Total de acomodações e quantas estão ativas">
              {{ items().length }} {{ items().length === 1 ? 'acomodação' : 'acomodações' }} ·
              {{ ativas() }} {{ ativas() === 1 ? 'ativa' : 'ativas' }}
            </span>
          </div>
        </div>
        <div class="acm-head-acoes">
          <button
            class="btn-tour"
            type="button"
            (click)="iniciarTour()"
            aria-label="Ver tutorial da tela"
          >
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-tipos" class="btn-gray" type="button" (click)="abrirTipos()">
            <mat-icon>category</mat-icon> Tipos
          </button>
          <button id="tour-nova" class="btn-dark-blue" type="button" (click)="abrirForm()">
            <mat-icon>add_box</mat-icon> Nova acomodação
          </button>
        </div>
      </div>

      <div class="acm-info">
        <div class="acm-info-card">
          <span class="acm-info-icone"><mat-icon>hotel</mat-icon></span>
          <div class="acm-info-txt">
            <strong>O que é uma acomodação</strong>
            <p>
              Ela agrupa os quartos físicos — ex.: a “Suíte Master” pode ter os quartos 101, 102 e
              103.
            </p>
          </div>
        </div>
        <div class="acm-info-card">
          <span class="acm-info-icone"><mat-icon>meeting_room</mat-icon></span>
          <div class="acm-info-txt">
            <strong>Quartos físicos</strong>
            <p>
              No <b>olho</b> de cada linha você gerencia os quartos reais e o histórico de tarifas.
            </p>
          </div>
        </div>
        <div class="acm-info-card">
          <span class="acm-info-icone"><mat-icon>palette</mat-icon></span>
          <div class="acm-info-txt">
            <strong>Tipos e cor do calendário</strong>
            <p>
              Os tipos organizam as acomodações; a cor escolhida aparece no calendário de reservas.
            </p>
          </div>
        </div>
      </div>

      <div class="inner-card acm-card">
        <div class="acm-toolbar">
          <div id="tour-busca" class="acm-busca" [class.foco]="buscaFoco()">
            <mat-icon class="acm-busca-icone">search</mat-icon>
            <input
              class="acm-busca-input"
              type="search"
              [formControl]="busca"
              placeholder="Buscar por nome, número ou tipo…"
              aria-label="Buscar acomodação"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button
                type="button"
                class="acm-limpar"
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
            class="acm-toggle"
            [class.on]="apenasAtivas()"
            role="switch"
            [attr.aria-checked]="apenasAtivas()"
            (click)="apenasAtivas.set(!apenasAtivas())"
          >
            <span class="acm-trilho"><span class="acm-bolinha"></span></span>
            Somente ativas
          </button>
        </div>

        <div id="tour-tabela" class="acm-tabela-wrap">
          <table class="acm-tabela">
            <thead>
              <tr>
                <th class="acm-th-nome">Acomodação</th>
                <th>Tipo</th>
                <th>Diária</th>
                <th>Capacidade</th>
                <th class="tc">Status</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td>
                      <span class="skel skel-dot"></span>
                      <span class="skel skel-nome"></span>
                    </td>
                    <td><span class="skel skel-txt"></span></td>
                    <td><span class="skel skel-txt"></span></td>
                    <td><span class="skel skel-txt"></span></td>
                    <td class="tc"><span class="skel skel-chip"></span></td>
                    <td class="tc"><span class="skel skel-acoes"></span></td>
                  </tr>
                }
              } @else {
                @for (a of filtradas(); track a.id) {
                  <tr class="acm-row" [class.sel]="selecionada()?.id === a.id">
                    <td>
                      <div class="acm-cell">
                        <span class="acm-dot" [style.background]="a.cor || '#8fa3ab'"></span>
                        <span class="acm-cell-txt">
                          <strong>{{ a.nome }}</strong>
                          <small>
                            Nº {{ a.numero }}
                            @if (a.descricao) {
                              · {{ a.descricao }}
                            }
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span class="acm-tipo">{{ tipoNome(a.idtipo_acomodacao) }}</span>
                    </td>
                    <td>
                      @if (a.valor !== null) {
                        <span class="acm-valor">R$ {{ num(a.valor) | number: '1.2-2' }}</span>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      <span class="acm-cap">
                        <mat-icon>group</mat-icon> {{ a.capacidade }}
                        {{ a.capacidade === 1 ? 'pessoa' : 'pessoas' }}
                      </span>
                    </td>
                    <td class="tc">
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="st-chip badge-toggle"
                          [class.off]="!a.ativo"
                          [title]="a.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                          (click)="statusAcomodacao(a, !a.ativo)"
                        >
                          {{ a.ativo ? 'Ativo' : 'Inativo' }}
                        </button>
                      } @else {
                        <span class="st-chip estatico" [class.off]="!a.ativo">{{
                          a.ativo ? 'Ativo' : 'Inativo'
                        }}</span>
                      }
                    </td>
                    <td class="tc acm-acoes">
                      <button
                        type="button"
                        class="acao-btn"
                        title="Editar"
                        aria-label="Editar acomodação"
                        (click)="abrirForm(a)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="acao-btn acm-ver"
                        title="Quartos físicos e tarifas"
                        aria-label="Ver quartos físicos e tarifas"
                        (click)="visualizar(a)"
                      >
                        <mat-icon>visibility</mat-icon>
                      </button>
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="acao-btn perigo"
                          title="Excluir"
                          aria-label="Excluir acomodação"
                          (click)="excluirAcomodacao(a)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="acm-vazio">
                      <mat-icon>hotel</mat-icon>
                      <p>
                        {{
                          termo() || apenasAtivas()
                            ? 'Nenhuma acomodação encontrada para esses filtros.'
                            : 'Nenhuma acomodação cadastrada ainda.'
                        }}
                      </p>
                      @if (!termo() && !apenasAtivas()) {
                        <button class="btn-dark-blue" type="button" (click)="abrirForm()">
                          <mat-icon>add_box</mat-icon> Cadastrar a primeira acomodação
                        </button>
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

    <!-- ============ Modal detalhe da acomodação ============ -->
    @if (selecionada(); as a) {
      <div class="overlay" (click.self)="selecionada.set(null)">
        <div
          class="modal-inn modal-detalhe"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-detalhe"
        >
          <div class="modal-head">
            <h5 id="titulo-detalhe" class="det-titulo">
              <span class="acm-dot" [style.background]="a.cor || '#8fa3ab'"></span>
              {{ a.nome }} — Nº {{ a.numero }}
              <span class="st-chip estatico det-status" [class.off]="!a.ativo">{{
                a.ativo ? 'Ativa' : 'Inativa'
              }}</span>
            </h5>
            <button type="button" class="close" (click)="selecionada.set(null)" aria-label="Fechar">
              &times;
            </button>
          </div>
          <div class="modal-body">
            <p class="det-desc">{{ a.descricao || 'Sem descrição cadastrada.' }}</p>

            <!-- Resumo da acomodação -->
            <div class="det-faixa">
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>category</mat-icon></span>
                <span class="det-item-txt">
                  <small>Tipo</small>
                  <strong>{{ tipoNome(a.idtipo_acomodacao) }}</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>payments</mat-icon></span>
                <span class="det-item-txt">
                  <small>Diária</small>
                  <strong>
                    {{ a.valor !== null ? 'R$ ' + (num(a.valor) | number: '1.2-2') : '—' }}
                  </strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>group</mat-icon></span>
                <span class="det-item-txt">
                  <small>Capacidade</small>
                  <strong
                    >{{ a.capacidade }} {{ a.capacidade === 1 ? 'pessoa' : 'pessoas' }}</strong
                  >
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>meeting_room</mat-icon></span>
                <span class="det-item-txt">
                  <small>Quartos</small>
                  <strong>{{ quartosAtivos() }} de {{ quartos().length }} ativos</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>local_parking</mat-icon></span>
                <span class="det-item-txt">
                  <small>Vagas</small>
                  <strong
                    [title]="
                      vagasDaAcomodacao()
                        .map((v) => 'Vaga ' + v.numero)
                        .join(', ') || null
                    "
                    >{{
                      vagasDaAcomodacao().length
                        ? vagasDaAcomodacao()
                            .map((v) => v.numero)
                            .join(', ')
                        : 'Nenhuma'
                    }}</strong
                  >
                </span>
              </span>
            </div>

            <h4><mat-icon>meeting_room</mat-icon> Quartos físicos</h4>
            <p class="det-dica">
              Cada chip é um quarto real desta acomodação — clique no selo para ativar ou desativar.
            </p>
            <div class="quartos">
              @for (q of quartos(); track q.id) {
                <span class="chip">
                  <strong>{{ q.numero }}</strong>
                  <button
                    type="button"
                    class="st-chip"
                    [class.off]="!q.ativo"
                    [title]="q.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                    (click)="statusQuarto(q, !q.ativo)"
                  >
                    {{ q.ativo ? 'Ativo' : 'Inativo' }}
                  </button>
                  @if (auth.isAdmin()) {
                    <button
                      type="button"
                      class="chip-del"
                      title="Excluir quarto"
                      aria-label="Excluir quarto {{ q.numero }}"
                      (click)="excluirQuarto(q)"
                    >
                      <mat-icon>delete</mat-icon>
                    </button>
                  }
                </span>
              } @empty {
                <span class="muted">Nenhum quarto cadastrado.</span>
              }
              <button class="btn-dark-blue btn-add-quarto" type="button" (click)="abrirQuarto()">
                <mat-icon>add</mat-icon> Quarto
              </button>
            </div>

            <h4><mat-icon>history</mat-icon> Histórico de tarifas</h4>
            <p class="det-dica">
              Todas as diárias que já vigoraram — a tarifa atual aparece com o selo <b>vigente</b>.
            </p>
            <div class="tarifas-wrap">
              <table class="acm-tabela acm-tabela-mini">
                <thead>
                  <tr>
                    <th>Valor</th>
                    <th>Vigente desde</th>
                    <th>Até</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of tarifas(); track t.id) {
                    <tr>
                      <td>
                        <span class="acm-valor">R$ {{ num(t.valor) | number: '1.2-2' }}</span>
                      </td>
                      <td>{{ t.vigente_desde | date: 'dd/MM/yyyy' }}</td>
                      <td>
                        @if (t.vigente_ate) {
                          {{ t.vigente_ate | date: 'dd/MM/yyyy' }}
                        } @else {
                          <span class="st-chip estatico">vigente</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="3" class="muted tc">Sem histórico de tarifas.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- ============ Drawer Acomodação (criar/editar) ============ -->
    @if (drawerAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharDrawer()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-drawer">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-drawer">{{ editando() ? 'Editar acomodação' : 'Nova acomodação' }}</h5>
              <p>
                {{
                  editando()
                    ? 'Atualize os dados da acomodação'
                    : 'Preencha os dados para cadastrar a acomodação'
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
              <!-- Identificação -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>hotel</mat-icon> Identificação</div>
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="ac-nome">Nome <small class="req">*</small></label>
                    <input
                      id="ac-nome"
                      class="input-inn"
                      type="text"
                      formControlName="nome"
                      placeholder="Ex.: Suíte Master"
                      [class.inval]="invalido('nome')"
                    />
                    @if (invalido('nome')) {
                      <small class="erro-campo">Informe o nome da acomodação.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-numero">Número <small class="req">*</small></label>
                    <input
                      id="ac-numero"
                      class="input-inn"
                      type="number"
                      min="0"
                      formControlName="numero"
                      placeholder="Ex.: 1"
                      [class.inval]="invalido('numero')"
                    />
                    @if (invalido('numero')) {
                      <small class="erro-campo">Informe o número.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-andar">Andar</label>
                    <input
                      id="ac-andar"
                      class="input-inn"
                      type="number"
                      min="0"
                      max="99"
                      formControlName="andar"
                      placeholder="0 = térreo"
                    />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-tipo">Tipo <small class="req">*</small></label>
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                      [class.err]="invalido('idtipo_acomodacao')"
                    >
                      <mat-select
                        id="ac-tipo"
                        formControlName="idtipo_acomodacao"
                        placeholder="Selecione…"
                      >
                        @for (t of tipos(); track t.id) {
                          @if (t.ativo || t.id === editando()?.idtipo_acomodacao) {
                            <mat-option [value]="t.id">{{ t.nome }}</mat-option>
                          }
                        }
                      </mat-select>
                    </mat-form-field>
                    @if (invalido('idtipo_acomodacao')) {
                      <small class="erro-campo">Escolha o tipo.</small>
                    }
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="ac-desc">Descrição</label>
                    <textarea
                      id="ac-desc"
                      class="input-inn"
                      rows="3"
                      maxlength="240"
                      formControlName="descricao"
                      placeholder="Ex.: Vista para o mar, varanda com rede…"
                    ></textarea>
                  </div>
                </div>
              </section>

              <!-- Diária & capacidade -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>payments</mat-icon> Diária &amp; capacidade</div>
                <div class="dgrid">
                  <div class="campo">
                    <label class="lbl" for="ac-valor">Valor da diária</label>
                    <div class="input-group-inn">
                      <span class="addon">R$</span>
                      <input
                        id="ac-valor"
                        class="input-inn"
                        type="number"
                        step="0.01"
                        min="0"
                        formControlName="valor"
                        placeholder="Ex.: 350,00"
                      />
                    </div>
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-cap">Capacidade <small class="req">*</small></label>
                    <div class="input-group-inn">
                      <span class="addon"><mat-icon>group</mat-icon></span>
                      <input
                        id="ac-cap"
                        class="input-inn"
                        type="number"
                        min="1"
                        formControlName="capacidade"
                        placeholder="Ex.: 4"
                        [class.inval]="invalido('capacidade')"
                      />
                    </div>
                    @if (invalido('capacidade')) {
                      <small class="erro-campo">Mínimo de 1 pessoa.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-cor">Cor no calendário</label>
                    <input id="ac-cor" class="input-inn cor" type="color" formControlName="cor" />
                  </div>
                </div>
              </section>

              <!-- Estacionamento (somente no cadastro) -->
              @if (!editando()) {
                <section class="dsec">
                  <div class="dsec-tit"><mat-icon>local_parking</mat-icon> Estacionamento</div>
                  <p class="dsec-sub">
                    Opcional — vincule vagas livres do estacionamento a esta acomodação.
                  </p>
                  <div class="check-inn">
                    <input
                      id="ac-vaga-check"
                      type="checkbox"
                      [disabled]="vagasLivres().length === 0"
                      (change)="comVaga.set(chk($event))"
                    />
                    <label for="ac-vaga-check">
                      {{
                        vagasLivres().length
                          ? 'Vincular vaga(s) de estacionamento'
                          : 'Sem vagas livres no estacionamento'
                      }}
                    </label>
                  </div>
                  @if (comVaga()) {
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat vagas-mat"
                    >
                      <mat-select
                        multiple
                        [value]="vagasSel()"
                        (selectionChange)="vagasSel.set($event.value)"
                        placeholder="Escolha as vagas"
                        aria-label="Vagas disponíveis"
                      >
                        @for (v of vagasLivres(); track v.id) {
                          <mat-option [value]="v.id">Vaga {{ v.numero }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <small class="dsec-dica">Você pode escolher mais de uma vaga.</small>
                  }
                </section>
              }
            </div>

            <footer class="drawer-foot">
              <span class="drawer-req"><small class="req">*</small> Campos obrigatórios</span>
              <div class="drawer-foot-acoes">
                <button class="btn-gray" type="button" (click)="fecharDrawer()">Cancelar</button>
                <button class="btn-dark-blue" type="submit">
                  <mat-icon>save</mat-icon>
                  {{ editando() ? 'Salvar alterações' : 'Cadastrar acomodação' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
    }

    <!-- ============ Modal Tipos de acomodação ============ -->
    @if (modal() === 'tipos') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-labelledby="titulo-tipos">
          <div class="modal-head">
            <h5 id="titulo-tipos">Tipos de acomodação</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">
              &times;
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-dica">
              Os tipos agrupam as acomodações (ex.: Suíte, Chalé, Apartamento) e facilitam a busca
              no cadastro.
            </p>
            <form class="input-group-inn mb" (submit)="$event.preventDefault(); criarTipo()">
              <input
                class="input-inn"
                type="text"
                [formControl]="novoTipo"
                placeholder="Ex.: Suíte"
                aria-label="Nome do tipo de acomodação"
              />
              <button class="btn-dark-blue" type="submit" [disabled]="novoTipo.invalid">
                Cadastrar
              </button>
            </form>
            <table class="plain bordered">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Status</th>
                  <th class="tc">Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (t of tipos(); track t.id) {
                  <tr>
                    <td>{{ t.id }}</td>
                    <td>
                      @if (editandoTipo() === t.id) {
                        <input
                          class="input-inn"
                          type="text"
                          [formControl]="tipoNomeCtrl"
                          (keyup.enter)="salvarTipo(t)"
                          aria-label="Nome do tipo"
                        />
                      } @else {
                        {{ t.nome }}
                      }
                    </td>
                    <td>
                      <button
                        type="button"
                        class="st-chip"
                        [class.off]="!t.ativo"
                        [title]="t.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                        (click)="statusTipo(t, !t.ativo)"
                      >
                        {{ t.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc">
                      @if (editandoTipo() === t.id) {
                        <button
                          type="button"
                          class="acao-btn"
                          title="Salvar"
                          (click)="salvarTipo(t)"
                        >
                          <mat-icon>check</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="acao-btn"
                          title="Cancelar"
                          (click)="editandoTipo.set(null)"
                        >
                          <mat-icon>close</mat-icon>
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="acao-btn"
                          title="Editar"
                          (click)="editarTipo(t)"
                        >
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="acao-btn"
                          title="Preço por ocupação"
                          aria-label="Preço por ocupação"
                          (click)="toggleTarifas(t)"
                        >
                          <mat-icon>attach_money</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="acao-btn perigo"
                          title="Excluir"
                          aria-label="Excluir tipo"
                          (click)="excluirTipo(t)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                  @if (tarifasTipo() === t.id) {
                    <tr class="fx-row">
                      <td colspan="4">
                        <div class="fx-box">
                          <p class="fx-tit">
                            Diária por ocupação — {{ t.nome }}
                            <small class="muted"
                              >(criança conta como hóspede; sem faixa, usa o valor da
                              acomodação)</small
                            >
                          </p>
                          @for (f of faixas(); track $index) {
                            <div class="fx-linha">
                              <label class="dl">
                                <span>Hóspedes</span>
                                <input
                                  class="input-inn fx-inp"
                                  type="number"
                                  min="1"
                                  max="20"
                                  [value]="f.hospedes"
                                  aria-label="Número de hóspedes"
                                  (input)="faixaCampo($index, 'hospedes', $event)"
                                />
                              </label>
                              <label class="dl">
                                <span>Diária R$</span>
                                <input
                                  class="input-inn fx-inp"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  [value]="f.valor"
                                  aria-label="Valor da diária"
                                  (input)="faixaCampo($index, 'valor', $event)"
                                />
                              </label>
                              <button
                                type="button"
                                class="acao-btn"
                                title="Remover faixa"
                                (click)="remFaixa($index)"
                              >
                                <mat-icon>close</mat-icon>
                              </button>
                            </div>
                          }
                          <div class="fx-acoes">
                            <button type="button" class="mc-btn" (click)="addFaixa()">
                              + faixa
                            </button>
                            <button
                              type="button"
                              class="btn-dark-blue"
                              [disabled]="salvandoFaixas()"
                              (click)="salvarFaixas(t)"
                            >
                              {{ salvandoFaixas() ? 'Salvando…' : 'Salvar faixas' }}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td colspan="4" class="muted tc">Nenhum tipo cadastrado.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }

    <!-- ============ Modal novo quarto ============ -->
    @if (modal() === 'quarto') {
      <div class="overlay" (click.self)="fecharModal()">
        <div
          class="modal-inn modal-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-quarto"
        >
          <div class="modal-head">
            <h5 id="titulo-quarto">Cadastrar quarto</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">
              &times;
            </button>
          </div>
          <form (submit)="$event.preventDefault(); criarQuarto()">
            <div class="modal-body">
              <p class="modal-dica">
                Número ou identificação do quarto físico dentro de
                <b>{{ selecionada()?.nome }}</b>.
              </p>
              <label class="lbl" for="quarto-num"> Número <small class="req">*</small> </label>
              <input
                id="quarto-num"
                class="input-inn"
                type="text"
                [formControl]="quartoNumero"
                placeholder="Ex.: 101"
                title="Número do quarto"
              />
            </div>
            <div class="modal-foot">
              <button class="btn-dark-blue" type="submit" [disabled]="quartoNumero.invalid">
                <mat-icon>save</mat-icon> Cadastrar
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho da página ---------- */
    .acm-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .acm-titulo-grupo {
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
    .acm-titulo-linha {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .acm-titulo {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      color: #054054;
      letter-spacing: -0.01em;
    }
    .acm-contador {
      font-size: 0.78rem;
      font-weight: 600;
      color: #054054;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .acm-head-acoes {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .acm-head-acoes button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
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
    .acm-info {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 16px;
    }
    .acm-info-card {
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
    .acm-info-card:hover {
      box-shadow: 0 6px 18px rgba(5, 64, 84, 0.08);
      transform: translateY(-1px);
    }
    .acm-info-icone {
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
    .acm-info-icone mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .acm-info-txt {
      min-width: 0;
    }
    .acm-info-txt strong {
      display: block;
      font-size: 0.9rem;
      font-weight: 700;
      color: #054054;
      margin-bottom: 3px;
    }
    .acm-info-txt p {
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .acm-info-txt b {
      color: #40525d;
    }
    @media (max-width: 960px) {
      .acm-info {
        grid-template-columns: 1fr;
      }
    }

    /* ---------- toolbar ---------- */
    .acm-card {
      padding-top: 14px;
    }
    .acm-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
      flex-wrap: wrap;
      margin-bottom: 18px;
      padding: 4px 2px;
    }
    .acm-busca {
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
    .acm-busca.foco {
      border-color: #054054;
      box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.12);
    }
    .acm-busca-icone {
      color: #7d97a1;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .acm-busca-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.9rem;
      color: #33424c;
      font-family: inherit;
      height: 100%;
    }
    .acm-busca-input::placeholder {
      color: #8fa3ab;
    }
    .acm-busca-input::-webkit-search-cancel-button {
      display: none;
    }
    .acm-limpar {
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
    .acm-limpar mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .acm-limpar:hover {
      background: #d7e0e6;
    }

    .acm-toggle {
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
    .acm-trilho {
      width: 34px;
      height: 19px;
      border-radius: 999px;
      background: #c3d2d9;
      position: relative;
      transition: background 0.18s;
      flex-shrink: 0;
    }
    .acm-bolinha {
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
    .acm-toggle.on {
      border-color: #054054;
      color: #054054;
    }
    .acm-toggle.on .acm-trilho {
      background: #054054;
    }
    .acm-toggle.on .acm-bolinha {
      transform: translateX(16px);
    }

    /* ---------- tabela ---------- */
    .acm-tabela-wrap {
      overflow-x: auto;
      border-radius: 8px;
      min-height: 42vh;
    }
    .acm-tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .acm-tabela thead th {
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
    .acm-tabela tbody td {
      padding: 16px 14px;
      border-bottom: 1px solid #eef2f5;
      color: #2c3a44;
      vertical-align: middle;
      white-space: nowrap;
    }
    .acm-row {
      transition: background 0.12s;
    }
    .acm-row:hover {
      background: #f4f8fa;
    }
    .acm-row.sel {
      background: #eef4f6;
    }
    .acm-row:last-child td {
      border-bottom: none;
    }
    .tc {
      text-align: center;
    }
    .acm-th-nome {
      min-width: 260px;
    }

    .acm-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 220px;
    }
    .acm-dot {
      width: 14px;
      height: 14px;
      border-radius: 5px;
      flex-shrink: 0;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .acm-cell-txt {
      display: flex;
      flex-direction: column;
      line-height: 1.3;
      min-width: 0;
    }
    .acm-cell-txt strong {
      color: #054054;
      font-weight: 600;
      font-size: 0.95rem;
    }
    .acm-cell-txt small {
      color: #7d97a1;
      font-size: 0.8rem;
      max-width: 320px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .acm-tipo {
      font-size: 0.78rem;
      font-weight: 600;
      color: #40525d;
      background: #eef2f5;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .acm-valor {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: #054054;
    }
    .acm-cap {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #40525d;
      font-size: 0.88rem;
    }
    .acm-cap mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
      color: #8fa3ab;
    }

    /* chip de status neutro — clicável só onde faz sentido */
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
    .st-chip.estatico {
      cursor: default;
    }
    .st-chip.estatico:hover {
      border-color: #d7e0e6;
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
    .acm-vazio {
      text-align: center;
      padding: 40px 16px !important;
      color: #7d97a1;
    }
    .acm-vazio mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #c3d2d9;
      margin-bottom: 8px;
    }
    .acm-vazio p {
      margin: 0 0 14px;
      font-size: 0.9rem;
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
    .skel-dot {
      width: 14px;
      height: 14px;
      border-radius: 5px;
    }
    .skel-nome {
      width: 170px;
      height: 14px;
      margin-left: 10px;
      vertical-align: middle;
    }
    .skel-txt {
      width: 90px;
      height: 13px;
    }
    .skel-chip {
      width: 62px;
      height: 24px;
      border-radius: 999px;
    }
    .skel-acoes {
      width: 110px;
      height: 26px;
    }

    /* ---------- modal detalhe da acomodação ---------- */
    .modal-detalhe {
      max-width: 860px;
      width: calc(100vw - 32px);
    }
    .modal-detalhe .modal-body {
      max-height: 78vh;
      overflow-y: auto;
    }
    .det-titulo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .det-desc {
      margin: 0 0 4px;
      font-size: 0.84rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .modal-detalhe h4 {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #40525d;
      margin: 18px 0 10px;
    }
    .modal-detalhe h4 mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .det-dica {
      margin: -4px 0 10px;
      font-size: 0.76rem;
      color: #8a99a4;
      line-height: 1.5;
    }

    /* faixa-resumo dentro do modal — itens fluem, sem truncar */
    .det-status {
      margin-left: 2px;
    }
    .det-faixa {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 24px;
      background: #f7fafb;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 12px 18px;
      margin: 14px 0 4px;
    }
    .det-item {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }
    .det-item-ic {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #eef4f6;
      color: #054054;
    }
    .det-item-ic mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .det-item-txt {
      display: flex;
      flex-direction: column;
      line-height: 1.15;
    }
    .det-item-txt small {
      font-size: 0.66rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #7d97a1;
    }
    .det-item-txt strong {
      font-size: 0.9rem;
      color: #054054;
      font-weight: 700;
      white-space: nowrap;
    }
    .quartos {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 6px 10px;
      background: #fff;
    }
    .chip strong {
      color: #054054;
      font-size: 0.9rem;
    }
    .chip-del {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #8fa3ab;
      padding: 0;
    }
    .chip-del mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .chip-del:hover {
      color: #b3261e;
    }
    .btn-add-quarto {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0.4rem 0.8rem;
      font-size: 0.84rem;
    }
    .btn-add-quarto mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .tarifas-wrap {
      overflow-x: auto;
    }
    .acm-tabela-mini {
      font-size: 0.98rem;
    }
    .acm-tabela-mini thead th {
      padding: 14px 16px;
      font-size: 0.78rem;
    }
    .acm-tabela-mini tbody td {
      padding: 15px 16px;
    }

    /* ---------- modais pequenos (tipos / quarto) ---------- */
    .modal-sm {
      max-width: 360px;
    }
    .modal-dica {
      margin: 0 0 12px;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .modal-foot {
      display: flex;
      justify-content: flex-end;
      padding: 10px 14px;
      border-top: 1px solid #d7e0e6;
    }
    .modal-foot .btn-dark-blue {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .modal-foot mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    /* modais da tela acima da sidebar (110) e da bolha MAR IA (300);
       confirm global sobe para 400 no styles.css */
    .overlay {
      z-index: 310;
    }

    /* ---------- drawer lateral ---------- */
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
      z-index: 321;
      width: min(540px, 100vw);
      background: #f7fafb;
      box-shadow: -12px 0 40px rgba(3, 32, 43, 0.28);
      display: flex;
      flex-direction: column;
      animation: drawerIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
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
      color: #40525d;
      margin-bottom: 12px;
    }
    .dsec-tit mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .dsec-sub {
      margin: -6px 0 12px;
      font-size: 0.76rem;
      color: #8a99a4;
    }
    .dsec-dica {
      display: block;
      margin-top: 6px;
      font-size: 0.74rem;
      color: #8a99a4;
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
    .cor {
      padding: 2px 4px;
      height: 38px;
    }

    .vagas-mat {
      margin-top: 10px;
    }

    .input-group-inn {
      display: flex;
      align-items: stretch;
    }
    .input-group-inn .addon {
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.8rem;
      background: #5d6d7e;
      color: #fff;
      border: 1px solid #5d6d7e;
      border-radius: 4px 0 0 4px;
    }
    .input-group-inn .addon mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .input-group-inn .input-inn {
      border-radius: 0 4px 4px 0;
      flex: 1;
    }
    .input-group-inn.mb {
      margin-bottom: 12px;
    }
    .input-group-inn.mb .input-inn {
      border-radius: 4px 0 0 4px;
      border-right: 0;
    }
    .input-group-inn.mb .btn-dark-blue {
      border-radius: 0 4px 4px 0;
    }
    .check-inn {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.84rem;
      color: #40525d;
    }

    /* tarifa por ocupação — linha expansível na tabela de tipos */
    .fx-row td {
      background: #f7fafb;
      border-top: none;
    }
    .fx-box {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 6px;
    }
    .fx-tit {
      margin: 0;
      font-size: 0.85rem;
      color: #054054;
      font-weight: 600;
    }
    .fx-linha {
      display: flex;
      align-items: flex-end;
      gap: 10px;
    }
    .fx-inp {
      width: 110px;
    }
    .fx-acoes {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: 4px;
    }
    .dl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.78rem;
      color: #5d6d7e;
    }
    .mc-btn {
      font-size: 0.75rem;
      padding: 5px 12px;
      border: 1px solid #d7e0e6;
      border-radius: 6px;
      background: #fff;
      color: #40525d;
      cursor: pointer;
    }
    .mc-btn:hover {
      border-color: #054054;
      color: #054054;
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
      .acm-head {
        flex-direction: column;
        align-items: stretch;
      }
      .acm-head-acoes {
        justify-content: stretch;
      }
      .acm-head-acoes button {
        flex: 1;
        justify-content: center;
      }
      .acm-busca {
        max-width: none;
      }
    }
  `,
})
export class AcomodacoesComponent extends AcomodacoesStore {}
