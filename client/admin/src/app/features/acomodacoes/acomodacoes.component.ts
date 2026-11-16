import { DecimalPipe, DatePipe } from '@angular/common';
import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { forkJoin } from 'rxjs';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { EstacionamentoApi } from '@core/api/estacionamento.api';
import { num } from '@core/utils/num';
import { Acomodacao, AcomodacaoInput, Quarto, TarifaOcupacaoInput, TipoAcomodacao } from '@core/models/catalogo.models';
import { TarifaHistorico } from '@core/models/comercial.models';
import { VagaEstacionamento } from '@core/models/estacionamento.models';
import { Notify } from '@core/services/notify.service';
import { Confirm } from '@core/services/confirm.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourGuiado } from '@core/services/tour.service';

type Modal = 'tipos' | 'quarto' | null;

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
          <h2 class="acm-titulo">Acomodações</h2>
          <span class="acm-contador" title="Total de acomodações cadastradas">
            {{ items().length }} {{ items().length === 1 ? 'acomodação' : 'acomodações' }}
          </span>
          <span class="acm-ativas" title="Acomodações ativas">
            {{ ativas() }} {{ ativas() === 1 ? 'ativa' : 'ativas' }}
          </span>
        </div>
        <div class="acm-head-acoes">
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
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
          <span class="acm-info-icone inf-teal"><mat-icon>hotel</mat-icon></span>
          <div class="acm-info-txt">
            <strong>O que é uma acomodação</strong>
            <p>
              Ela agrupa os quartos físicos — ex.: a “Suíte Master” pode ter os
              quartos 101, 102 e 103.
            </p>
          </div>
        </div>
        <div class="acm-info-card">
          <span class="acm-info-icone inf-gold"><mat-icon>meeting_room</mat-icon></span>
          <div class="acm-info-txt">
            <strong>Quartos físicos</strong>
            <p>
              No <b>olho teal</b> de cada linha você gerencia os quartos reais e
              o histórico de tarifas.
            </p>
          </div>
        </div>
        <div class="acm-info-card">
          <span class="acm-info-icone inf-navy"><mat-icon>palette</mat-icon></span>
          <div class="acm-info-txt">
            <strong>Tipos e cor do calendário</strong>
            <p>
              Os tipos organizam as acomodações; a cor escolhida aparece no
              calendário de reservas.
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
              ><mat-icon>close</mat-icon></button>
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
                        <span class="acm-dot" [style.background]="a.cor || '#66707e'"></span>
                        <span class="acm-cell-txt">
                          <strong>{{ a.nome }}</strong>
                          <small>
                            Nº {{ a.numero }}
                            @if (a.descricao) { · {{ a.descricao }} }
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
                          class="status-chip badge-toggle"
                          [class.bg-blue]="a.ativo"
                          [class.bg-gray]="!a.ativo"
                          [title]="a.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                          (click)="statusAcomodacao(a, !a.ativo)"
                        >
                          {{ a.ativo ? 'Ativo' : 'Inativo' }}
                        </button>
                      } @else {
                        <span
                          class="status-chip"
                          [class.bg-blue]="a.ativo"
                          [class.bg-gray]="!a.ativo"
                        >{{ a.ativo ? 'Ativo' : 'Inativo' }}</span>
                      }
                    </td>
                    <td class="tc acm-acoes">
                      <button
                        type="button"
                        class="badge-acao bg-yellow"
                        title="Editar"
                        aria-label="Editar acomodação"
                        (click)="abrirForm(a)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="badge-acao bg-blue acm-ver"
                        title="Quartos físicos e tarifas"
                        aria-label="Ver quartos físicos e tarifas"
                        (click)="visualizar(a)"
                      >
                        <mat-icon>visibility</mat-icon>
                      </button>
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="badge-acao bg-dark-blue"
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
                        {{ termo() || apenasAtivas()
                          ? 'Nenhuma acomodação encontrada para esses filtros.'
                          : 'Nenhuma acomodação cadastrada ainda.' }}
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
        <div class="modal-inn modal-detalhe" role="dialog" aria-modal="true" aria-labelledby="titulo-detalhe">
          <div class="modal-head">
            <h5 id="titulo-detalhe" class="det-titulo">
              <span class="acm-dot" [style.background]="a.cor || '#66707e'"></span>
              {{ a.nome }} — Nº {{ a.numero }}
              <span
                class="status-chip det-status"
                [class.bg-blue]="a.ativo"
                [class.bg-gray]="!a.ativo"
              >{{ a.ativo ? 'Ativa' : 'Inativa' }}</span>
            </h5>
            <button
              type="button"
              class="close"
              (click)="selecionada.set(null)"
              aria-label="Fechar"
            >&times;</button>
          </div>
          <div class="modal-body">
            <p class="det-desc">{{ a.descricao || 'Sem descrição cadastrada.' }}</p>

            <!-- Resumo da acomodação -->
            <div class="det-faixa">
              <span class="det-item">
                <span class="det-item-ic inf-teal"><mat-icon>category</mat-icon></span>
                <span class="det-item-txt">
                  <small>Tipo</small>
                  <strong>{{ tipoNome(a.idtipo_acomodacao) }}</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic inf-gold"><mat-icon>payments</mat-icon></span>
                <span class="det-item-txt">
                  <small>Diária</small>
                  <strong>
                    {{ a.valor !== null ? 'R$ ' + (num(a.valor) | number: '1.2-2') : '—' }}
                  </strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic inf-navy"><mat-icon>group</mat-icon></span>
                <span class="det-item-txt">
                  <small>Capacidade</small>
                  <strong>{{ a.capacidade }} {{ a.capacidade === 1 ? 'pessoa' : 'pessoas' }}</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic inf-teal"><mat-icon>meeting_room</mat-icon></span>
                <span class="det-item-txt">
                  <small>Quartos</small>
                  <strong>{{ quartosAtivos() }} de {{ quartos().length }} ativos</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic inf-gold"><mat-icon>local_parking</mat-icon></span>
                <span class="det-item-txt">
                  <small>Vagas</small>
                  <strong
                    [title]="vagasDaAcomodacao().map((v) => 'Vaga ' + v.numero).join(', ') || null"
                  >{{
                    vagasDaAcomodacao().length
                      ? vagasDaAcomodacao()
                          .map((v) => v.numero)
                          .join(', ')
                      : 'Nenhuma'
                  }}</strong>
                </span>
              </span>
            </div>

            <h4><mat-icon>meeting_room</mat-icon> Quartos físicos</h4>
            <p class="det-dica">
              Cada chip é um quarto real desta acomodação — clique no selo para
              ativar ou desativar.
            </p>
            <div class="quartos">
              @for (q of quartos(); track q.id) {
                <span class="chip">
                  <strong>{{ q.numero }}</strong>
                  <button
                    type="button"
                    class="status-chip badge-toggle"
                    [class.bg-blue]="q.ativo"
                    [class.bg-gray]="!q.ativo"
                    [title]="q.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                    (click)="statusQuarto(q, !q.ativo)"
                  >{{ q.ativo ? 'Ativo' : 'Inativo' }}</button>
                  @if (auth.isAdmin()) {
                    <button
                      type="button"
                      class="chip-del"
                      title="Excluir quarto"
                      aria-label="Excluir quarto {{ q.numero }}"
                      (click)="excluirQuarto(q)"
                    ><mat-icon>delete</mat-icon></button>
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
              Todas as diárias que já vigoraram — a tarifa atual aparece com o
              selo <b>vigente</b>.
            </p>
            <div class="tarifas-wrap">
              <table class="acm-tabela acm-tabela-mini">
                <thead>
                  <tr><th>Valor</th><th>Vigente desde</th><th>Até</th></tr>
                </thead>
                <tbody>
                  @for (t of tarifas(); track t.id) {
                    <tr>
                      <td><span class="acm-valor">R$ {{ num(t.valor) | number: '1.2-2' }}</span></td>
                      <td>{{ t.vigente_desde | date: 'dd/MM/yyyy' }}</td>
                      <td>
                        @if (t.vigente_ate) {
                          {{ t.vigente_ate | date: 'dd/MM/yyyy' }}
                        } @else {
                          <span class="status-chip bg-blue">vigente</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="3" class="muted tc">Sem histórico de tarifas.</td></tr>
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
              <p>{{ editando() ? 'Atualize os dados da acomodação' : 'Preencha os dados para cadastrar a acomodação' }}</p>
            </div>
            <button type="button" class="drawer-fechar" (click)="fecharDrawer()" aria-label="Fechar painel">
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
                      id="ac-nome" class="input-inn" type="text"
                      formControlName="nome" placeholder="Ex.: Suíte Master"
                      [class.inval]="invalido('nome')"
                    />
                    @if (invalido('nome')) {
                      <small class="erro-campo">Informe o nome da acomodação.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-numero">Número <small class="req">*</small></label>
                    <input
                      id="ac-numero" class="input-inn" type="number" min="0"
                      formControlName="numero" placeholder="Ex.: 1"
                      [class.inval]="invalido('numero')"
                    />
                    @if (invalido('numero')) {
                      <small class="erro-campo">Informe o número.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-andar">Andar</label>
                    <input
                      id="ac-andar" class="input-inn" type="number" min="0" max="99"
                      formControlName="andar" placeholder="0 = térreo"
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
                      id="ac-desc" class="input-inn" rows="3" maxlength="240"
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
                        id="ac-valor" class="input-inn" type="number" step="0.01" min="0"
                        formControlName="valor" placeholder="Ex.: 350,00"
                      />
                    </div>
                  </div>
                  <div class="campo">
                    <label class="lbl" for="ac-cap">Capacidade <small class="req">*</small></label>
                    <div class="input-group-inn">
                      <span class="addon"><mat-icon>group</mat-icon></span>
                      <input
                        id="ac-cap" class="input-inn" type="number" min="1"
                        formControlName="capacidade" placeholder="Ex.: 4"
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
                  <p class="dsec-sub">Opcional — vincule vagas livres do estacionamento a esta acomodação.</p>
                  <div class="check-inn">
                    <input
                      id="ac-vaga-check" type="checkbox"
                      [disabled]="vagasLivres().length === 0"
                      (change)="comVaga.set(chk($event))"
                    />
                    <label for="ac-vaga-check">
                      {{ vagasLivres().length
                        ? 'Vincular vaga(s) de estacionamento'
                        : 'Sem vagas livres no estacionamento' }}
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
                <button class="btn-green" type="submit">
                  <mat-icon>save</mat-icon> {{ editando() ? 'Salvar alterações' : 'Cadastrar acomodação' }}
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
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <div class="modal-body">
            <p class="modal-dica">
              Os tipos agrupam as acomodações (ex.: Suíte, Chalé, Apartamento) e
              facilitam a busca no cadastro.
            </p>
            <form class="input-group-inn mb" (submit)="$event.preventDefault(); criarTipo()">
              <input
                class="input-inn" type="text" [formControl]="novoTipo"
                placeholder="Ex.: Suíte" aria-label="Nome do tipo de acomodação"
              />
              <button class="btn-green" type="submit" [disabled]="novoTipo.invalid">Cadastrar</button>
            </form>
            <table class="plain bordered">
              <thead>
                <tr><th>#</th><th>Nome</th><th>Status</th><th class="tc">Ações</th></tr>
              </thead>
              <tbody>
                @for (t of tipos(); track t.id) {
                  <tr>
                    <td>{{ t.id }}</td>
                    <td>
                      @if (editandoTipo() === t.id) {
                        <input
                          class="input-inn" type="text" [formControl]="tipoNomeCtrl"
                          (keyup.enter)="salvarTipo(t)" aria-label="Nome do tipo"
                        />
                      } @else {
                        {{ t.nome }}
                      }
                    </td>
                    <td>
                      <button
                        type="button" class="status-chip badge-toggle"
                        [class.bg-blue]="t.ativo" [class.bg-gray]="!t.ativo"
                        [title]="t.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                        (click)="statusTipo(t, !t.ativo)"
                      >
                        {{ t.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc">
                      @if (editandoTipo() === t.id) {
                        <button type="button" class="badge-acao bg-blue" title="Salvar" (click)="salvarTipo(t)">
                          <mat-icon>check</mat-icon>
                        </button>
                        <button type="button" class="badge-acao bg-gray" title="Cancelar" (click)="editandoTipo.set(null)">
                          <mat-icon>close</mat-icon>
                        </button>
                      } @else {
                        <button
                          type="button" class="badge-acao bg-yellow" title="Editar"
                          (click)="editarTipo(t)"
                        >
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button
                          type="button" class="badge-acao bg-green" title="Preço por ocupação"
                          aria-label="Preço por ocupação" (click)="toggleTarifas(t)"
                        >
                          <mat-icon>attach_money</mat-icon>
                        </button>
                        <button
                          type="button" class="badge-acao bg-dark-blue" title="Excluir"
                          aria-label="Excluir tipo" (click)="excluirTipo(t)"
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
                          <p class="fx-tit">Diária por ocupação — {{ t.nome }}
                            <small class="muted">(criança conta como hóspede; sem faixa, usa o valor da acomodação)</small>
                          </p>
                          @for (f of faixas(); track $index) {
                            <div class="fx-linha">
                              <label class="dl">
                                <span>Hóspedes</span>
                                <input
                                  class="input-inn fx-inp" type="number" min="1" max="20"
                                  [value]="f.hospedes" aria-label="Número de hóspedes"
                                  (input)="faixaCampo($index, 'hospedes', $event)"
                                />
                              </label>
                              <label class="dl">
                                <span>Diária R$</span>
                                <input
                                  class="input-inn fx-inp" type="number" min="0" step="0.01"
                                  [value]="f.valor" aria-label="Valor da diária"
                                  (input)="faixaCampo($index, 'valor', $event)"
                                />
                              </label>
                              <button
                                type="button" class="badge-acao bg-gray" title="Remover faixa"
                                (click)="remFaixa($index)"
                              >
                                <mat-icon>close</mat-icon>
                              </button>
                            </div>
                          }
                          <div class="fx-acoes">
                            <button type="button" class="mc-btn" (click)="addFaixa()">+ faixa</button>
                            <button
                              type="button" class="btn-green" [disabled]="salvandoFaixas()"
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
                  <tr><td colspan="4" class="muted tc">Nenhum tipo cadastrado.</td></tr>
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
        <div class="modal-inn modal-sm" role="dialog" aria-modal="true" aria-labelledby="titulo-quarto">
          <div class="modal-head">
            <h5 id="titulo-quarto">Cadastrar quarto</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <form (submit)="$event.preventDefault(); criarQuarto()">
            <div class="modal-body">
              <p class="modal-dica">
                Número ou identificação do quarto físico dentro de
                <b>{{ selecionada()?.nome }}</b>.
              </p>
              <label class="lbl" for="quarto-num"> Número <small class="req">*</small> </label>
              <input
                id="quarto-num" class="input-inn" type="text"
                [formControl]="quartoNumero" placeholder="Ex.: 101"
                title="Número do quarto"
              />
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="quartoNumero.invalid">
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
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .acm-titulo-grupo { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .acm-titulo {
      margin: 0; font-size: 1.35rem; font-weight: 700;
      color: #20242c; letter-spacing: -0.01em;
    }
    .acm-contador {
      font-size: 0.78rem; font-weight: 600; color: #2457a7;
      background: rgba(36, 87, 167, 0.12);
      border-radius: 999px; padding: 3px 10px; white-space: nowrap;
    }
    .acm-ativas {
      font-size: 0.78rem; font-weight: 600; color: #b45309;
      background: rgba(180, 83, 9, 0.16);
      border-radius: 999px; padding: 3px 10px; white-space: nowrap;
    }
    .acm-head-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .acm-head-acoes button {
      display: inline-flex; align-items: center; gap: 6px;
    }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #3d6db5; background: #fff;
      color: #2457a7; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600;
      transition: background .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { background: #2457a7; color: #fff; border-color: #2457a7; }

    /* ---------- banners de informação ---------- */
    .acm-info {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 14px; margin-bottom: 16px;
    }
    .acm-info-card {
      display: flex; align-items: flex-start; gap: 12px;
      background: #fff; border: 1px solid #e9ecf0; border-radius: 12px;
      padding: 15px 16px;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }
    .acm-info-card:hover {
      box-shadow: 0 6px 18px rgba(61, 69, 82, 0.08);
      transform: translateY(-1px);
    }
    .acm-info-icone {
      width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .acm-info-icone mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .inf-teal { background: rgba(36, 87, 167, 0.12); color: #2457a7; }
    .inf-gold { background: rgba(180, 83, 9, 0.16); color: #b45309; }
    .inf-navy { background: rgba(61, 69, 82, 0.1); color: #20242c; }
    .acm-info-txt { min-width: 0; }
    .acm-info-txt strong {
      display: block; font-size: 0.9rem; font-weight: 700;
      color: #20242c; margin-bottom: 3px;
    }
    .acm-info-txt p {
      margin: 0; font-size: 0.8rem; line-height: 1.5; color: #66707e;
    }
    .acm-info-txt b { color: #3d4552; }
    @media (max-width: 960px) { .acm-info { grid-template-columns: 1fr; } }

    /* ---------- toolbar ---------- */
    .acm-card { padding-top: 14px; }
    .acm-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 28px; flex-wrap: wrap; margin-bottom: 18px; padding: 4px 2px;
    }
    .acm-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; min-width: 240px; max-width: 460px;
      background: #fff; border: 1px solid #dde2e8; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .acm-busca.foco {
      border-color: #2457a7;
      box-shadow: 0 0 0 3px rgba(36, 87, 167, 0.14);
    }
    .acm-busca-icone { color: #66707e; font-size: 20px; width: 20px; height: 20px; }
    .acm-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #3d4552; font-family: inherit; height: 100%;
    }
    .acm-busca-input::placeholder { color: #66707e; }
    .acm-busca-input::-webkit-search-cancel-button { display: none; }
    .acm-limpar {
      border: none; background: #f0f2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #55606d;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .acm-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .acm-limpar:hover { background: #dde2e8; }

    .acm-toggle {
      display: inline-flex; align-items: center; gap: 14px;
      border: 1px solid #dde2e8; background: #fff; border-radius: 999px;
      padding: 8px 20px 8px 12px; font-size: 0.84rem; font-weight: 600;
      color: #55606d; cursor: pointer; font-family: inherit;
      transition: border-color 0.15s, background 0.15s;
    }
    .acm-trilho {
      width: 34px; height: 19px; border-radius: 999px;
      background: #cbd2dc; position: relative; transition: background 0.18s;
      flex-shrink: 0;
    }
    .acm-bolinha {
      position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      transition: transform 0.18s;
    }
    .acm-toggle.on { border-color: #2457a7; color: #20242c; }
    .acm-toggle.on .acm-trilho { background: #2457a7; }
    .acm-toggle.on .acm-bolinha { transform: translateX(16px); }

    /* ---------- tabela ---------- */
    .acm-tabela-wrap { overflow-x: auto; border-radius: 8px; min-height: 42vh; }
    .acm-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .acm-tabela thead th {
      position: sticky; top: 0; z-index: 1;
      background: #f5f7fa; color: #3d4552;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; text-align: left;
      padding: 14px 14px; border-bottom: 1px solid #dde2e8;
      white-space: nowrap;
    }
    .acm-tabela tbody td {
      padding: 16px 14px; border-bottom: 1px solid #f0f2f5;
      color: #3d4552; vertical-align: middle; white-space: nowrap;
    }
    .acm-row { transition: background 0.12s; }
    .acm-row:hover { background: #f5f7fa; }
    .acm-row.sel { background: rgba(36, 87, 167, 0.07); }
    .acm-row:last-child td { border-bottom: none; }
    .tc { text-align: center; }
    .acm-th-nome { min-width: 260px; }

    .acm-cell { display: flex; align-items: center; gap: 12px; min-width: 220px; }
    .acm-dot {
      width: 14px; height: 14px; border-radius: 5px; flex-shrink: 0;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .acm-cell-txt { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
    .acm-cell-txt strong { color: #20242c; font-weight: 600; font-size: 0.95rem; }
    .acm-cell-txt small {
      color: #66707e; font-size: 0.8rem;
      max-width: 320px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .acm-tipo {
      font-size: 0.78rem; font-weight: 600; color: #2457a7;
      background: rgba(36, 87, 167, 0.1);
      border-radius: 999px; padding: 3px 10px; white-space: nowrap;
    }
    .acm-valor { font-variant-numeric: tabular-nums; font-weight: 600; color: #20242c; }
    .acm-cap {
      display: inline-flex; align-items: center; gap: 5px;
      color: #3d4552; font-size: 0.88rem;
    }
    .acm-cap mat-icon { font-size: 17px; width: 17px; height: 17px; color: #66707e; }

    .acm-tabela .badge-acao { padding: 0.5em 0.68em; }
    .acm-tabela .badge-acao mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .acm-tabela .status-chip { padding: 6px 14px; font-size: 0.8rem; }

    /* ---------- estado vazio ---------- */
    .acm-vazio {
      text-align: center; padding: 40px 16px !important; color: #66707e;
    }
    .acm-vazio mat-icon {
      font-size: 40px; width: 40px; height: 40px;
      color: #cbd2dc; margin-bottom: 8px;
    }
    .acm-vazio p { margin: 0 0 14px; font-size: 0.9rem; }

    /* ---------- skeleton ---------- */
    .skel-row td { border-bottom: 1px solid #f0f2f5; }
    .skel {
      display: inline-block; border-radius: 6px;
      background: linear-gradient(90deg, #f0f2f5 25%, #e9ecf0 50%, #f0f2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-dot { width: 14px; height: 14px; border-radius: 5px; }
    .skel-nome { width: 170px; height: 14px; margin-left: 10px; vertical-align: middle; }
    .skel-txt { width: 90px; height: 13px; }
    .skel-chip { width: 62px; height: 24px; border-radius: 999px; }
    .skel-acoes { width: 110px; height: 26px; }

    /* ---------- modal detalhe da acomodação ---------- */
    .modal-detalhe { max-width: 860px; width: calc(100vw - 32px); }
    .modal-detalhe .modal-body { max-height: 78vh; overflow-y: auto; }
    .det-titulo { display: flex; align-items: center; gap: 10px; }
    .det-desc {
      margin: 0 0 4px; font-size: 0.84rem; line-height: 1.5; color: #66707e;
    }
    .modal-detalhe h4 {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.82rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #2457a7; margin: 18px 0 10px;
    }
    .modal-detalhe h4 mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .det-dica {
      margin: -4px 0 10px; font-size: 0.76rem; color: #66707e; line-height: 1.5;
    }

    /* faixa-resumo dentro do modal — itens fluem, sem truncar */
    .det-status { margin-left: 2px; }
    .det-faixa {
      display: flex; flex-wrap: wrap; align-items: center;
      gap: 10px 24px;
      background: #f8f9fb;
      border: 1px solid #dbe9f5; border-radius: 12px;
      padding: 12px 18px; margin: 14px 0 4px;
    }
    .det-item {
      display: inline-flex; align-items: center; gap: 9px; min-width: 0;
    }
    .det-item-ic {
      width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .det-item-ic mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .det-item-txt { display: flex; flex-direction: column; line-height: 1.15; }
    .det-item-txt small {
      font-size: 0.66rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: #66707e;
    }
    .det-item-txt strong {
      font-size: 0.9rem; color: #20242c; font-weight: 700; white-space: nowrap;
    }
    .quartos {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    }
    .chip {
      display: inline-flex; align-items: center; gap: 8px;
      border: 1px solid #dde2e8; border-radius: 8px; padding: 6px 10px;
      background: #fff;
    }
    .chip strong { color: #20242c; font-size: 0.9rem; }
    .chip-del {
      display: inline-flex; align-items: center; justify-content: center;
      border: none; background: transparent; cursor: pointer;
      color: #66707e; padding: 0;
    }
    .chip-del mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .chip-del:hover { color: #20242c; }
    .btn-add-quarto {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 0.4rem 0.8rem; font-size: 0.84rem;
    }
    .btn-add-quarto mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tarifas-wrap { overflow-x: auto; }
    .acm-tabela-mini { font-size: 0.98rem; }
    .acm-tabela-mini thead th { padding: 14px 16px; font-size: 0.78rem; }
    .acm-tabela-mini tbody td { padding: 15px 16px; }

    /* ---------- modais pequenos (tipos / quarto) ---------- */
    .modal-sm { max-width: 360px; }
    .modal-dica {
      margin: 0 0 12px; font-size: 0.8rem; line-height: 1.5; color: #66707e;
    }
    .modal-foot {
      display: flex; justify-content: flex-end;
      padding: 10px 14px; border-top: 1px solid #dde2e8;
    }
    .modal-foot .btn-green { display: inline-flex; align-items: center; gap: 6px; }
    .modal-foot mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* ---------- drawer lateral ---------- */
    .drawer-backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(22, 26, 32, 0.45);
      animation: fadeIn 0.18s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; } }
    .drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 201;
      width: min(540px, 100vw);
      background: #f8f9fb;
      box-shadow: -12px 0 40px rgba(22, 26, 32, 0.28);
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
      background: #fff; border-bottom: 1px solid #e9ecf0;
      flex-shrink: 0;
    }
    .drawer-head-txt h5 { margin: 0; font-size: 1.1rem; font-weight: 700; color: #20242c; }
    .drawer-head-txt p { margin: 3px 0 0; font-size: 0.8rem; color: #66707e; }
    .drawer-fechar {
      border: none; background: #f0f2f5; border-radius: 8px;
      width: 34px; height: 34px; cursor: pointer; color: #55606d;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s;
    }
    .drawer-fechar:hover { background: #dde2e8; color: #20242c; }
    .drawer-fechar mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .drawer-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .drawer-body { flex: 1; overflow-y: auto; padding: 18px 22px; }
    .dsec {
      background: #fff; border: 1px solid #e9ecf0; border-radius: 10px;
      padding: 16px; margin-bottom: 14px;
    }
    .dsec-tit {
      display: flex; align-items: center; gap: 7px;
      font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #2457a7; margin-bottom: 12px;
    }
    .dsec-tit mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .dsec-sub { margin: -6px 0 12px; font-size: 0.76rem; color: #66707e; }
    .dsec-dica { display: block; margin-top: 6px; font-size: 0.74rem; color: #66707e; }
    .dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
    .dgrid .full { grid-column: 1 / -1; }
    .campo { display: flex; flex-direction: column; gap: 4px; }
    .campo .lbl { font-size: 0.8rem; font-weight: 600; color: #3d4552; }
    .campo .req, .drawer-req .req { color: #dc3545; }
    .erro-campo { color: #dc3545; font-size: 0.74rem; font-weight: 500; }
    .input-inn.inval { border-color: #dc3545; box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.12); }
    .cor { padding: 2px 4px; height: 38px; }

    .vagas-mat { margin-top: 10px; }

    .input-group-inn { display: flex; align-items: stretch; }
    .input-group-inn .addon {
      display: inline-flex; align-items: center;
      padding: 0 10px; font-size: 0.8rem;
      background: #55606d; color: #fff;
      border: 1px solid #55606d;
      border-radius: 4px 0 0 4px;
    }
    .input-group-inn .addon mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .input-group-inn .input-inn { border-radius: 0 4px 4px 0; flex: 1; }
    .input-group-inn.mb { margin-bottom: 12px; }
    .input-group-inn.mb .input-inn { border-radius: 4px 0 0 4px; border-right: 0; }
    .input-group-inn.mb .btn-green { border-radius: 0 4px 4px 0; }
    .check-inn { display: flex; align-items: center; gap: 6px; font-size: 0.84rem; color: #3d4552; }

    /* tarifa por ocupação — linha expansível na tabela de tipos */
    .fx-row td { background: #f8f9fb; border-top: none; }
    .fx-box { display: flex; flex-direction: column; gap: 8px; padding: 10px 6px; }
    .fx-tit { margin: 0; font-size: 0.85rem; color: #20242c; font-weight: 600; }
    .fx-linha { display: flex; align-items: flex-end; gap: 10px; }
    .fx-inp { width: 110px; }
    .fx-acoes { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
    .bg-green { background: #198754; }
    .dl { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: #55606d; }
    .mc-btn { font-size: 0.75rem; padding: 5px 12px; border: 1px solid #dde2e8; border-radius: 6px; background: #fff; color: #2457a7; cursor: pointer; }
    .mc-btn:hover { border-color: #2457a7; }

    .drawer-foot {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 13px 22px;
      background: #fff; border-top: 1px solid #e9ecf0;
      flex-shrink: 0;
    }
    .drawer-req { font-size: 0.76rem; color: #66707e; }
    .drawer-foot-acoes { display: flex; gap: 8px; }
    .drawer-foot-acoes .btn-green,
    .drawer-foot-acoes .btn-gray {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 1rem;
    }
    .drawer-foot-acoes mat-icon { font-size: 16px; width: 16px; height: 16px; }

    @media (max-width: 640px) {
      .acm-head { flex-direction: column; align-items: stretch; }
      .acm-head-acoes { justify-content: stretch; }
      .acm-head-acoes button { flex: 1; justify-content: center; }
      .acm-busca { max-width: none; }
    }
  `,
})
export class AcomodacoesComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('acomodacao', 'quarto', 'tipo_acomodacao', 'estacionamento');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarTipos();
      }
    });
    this.busca.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((v) => this.termo.set(v.trim().toLowerCase()));
  }
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly estacionamentoApi = inject(EstacionamentoApi);
  private readonly notify = inject(Notify);
  private readonly tour = inject(TourGuiado);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<Acomodacao[]>([]);
  protected readonly tipos = signal<TipoAcomodacao[]>([]);
  protected readonly quartos = signal<Quarto[]>([]);
  protected readonly tarifas = signal<TarifaHistorico[]>([]);
  /** Vagas de estacionamento vinculadas à acomodação aberta no modal. */
  protected readonly vagasDaAcomodacao = signal<VagaEstacionamento[]>([]);
  /** Quartos ativos da acomodação aberta no modal. */
  protected readonly quartosAtivos = computed(
    () => this.quartos().filter((q) => q.ativo).length,
  );
  protected readonly selecionada = signal<Acomodacao | null>(null);
  protected readonly carregando = signal(true);
  protected readonly busca = new FormControl('', { nonNullable: true });
  /** Termo da busca já normalizado — alimenta o filtro instantâneo. */
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly apenasAtivas = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4, 5];
  protected readonly num = num;

  protected readonly modal = signal<Modal>(null);
  protected readonly drawerAberto = signal(false);
  protected readonly editando = signal<Acomodacao | null>(null);
  /** Marca a 1ª tentativa de salvar — exibe os erros inline daí em diante. */
  protected readonly tentouSalvar = signal(false);
  protected readonly vagasLivres = signal<VagaEstacionamento[]>([]);
  protected readonly comVaga = signal(false);
  protected readonly vagasSel = signal<number[]>([]);
  protected readonly editandoTipo = signal<number | null>(null);
  protected readonly tarifasTipo = signal<number | null>(null);
  protected readonly faixas = signal<{ hospedes: number; valor: string }[]>([]);
  protected readonly salvandoFaixas = signal(false);
  protected readonly novoTipo = new FormControl('', [Validators.required]);
  protected readonly tipoNomeCtrl = new FormControl('', [Validators.required]);
  protected readonly quartoNumero = new FormControl('', [Validators.required]);

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    numero: [0, [Validators.required, Validators.min(0)]],
    andar: [0, [Validators.min(0), Validators.max(99)]],
    idtipo_acomodacao: [null as number | null, Validators.required],
    valor: [null as number | null],
    capacidade: [1, [Validators.required, Validators.min(1)]],
    descricao: [''],
    cor: ['#2457a7'],
  });

  /** Acomodações ativas — selo dourado do cabeçalho. */
  protected readonly ativas = computed(
    () => this.items().filter((a) => a.ativo).length,
  );

  /** Filtro instantâneo: nome, número ou nome do tipo. */
  protected readonly filtradas = computed(() => {
    const q = this.termo();
    return this.items().filter((a) => {
      if (this.apenasAtivas() && !a.ativo) return false;
      if (!q) return true;
      return (
        a.nome.toLowerCase().includes(q) ||
        String(a.numero).includes(q) ||
        this.tipoNome(a.idtipo_acomodacao).toLowerCase().includes(q)
      );
    });
  });

  ngOnInit(): void {
    this.carregar();
    this.carregarTipos();
  }

  carregar(): void {
    this.acomodacoesApi.listarAcomodacoes(1, 200).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregarTipos(): void {
    this.acomodacoesApi.listarTipos().subscribe({
      next: (t) => this.tipos.set(t),
      error: (e) => this.notify.erro(e),
    });
  }

  tipoNome(id: number | null): string {
    return this.tipos().find((t) => t.id === id)?.nome ?? '—';
  }

  visualizar(a: Acomodacao): void {
    this.selecionada.set(a);
    this.acomodacoesApi.listarQuartos(a.id).subscribe({
      next: (q) => this.quartos.set(q),
      error: () => undefined,
    });
    this.acomodacoesApi.tarifasAcomodacao(a.id).subscribe({
      next: (t) => this.tarifas.set(t),
      error: () => undefined,
    });
    this.estacionamentoApi.listarVagas().subscribe({
      next: (v) =>
        this.vagasDaAcomodacao.set(v.filter((x) => x.idacomodacao === a.id && x.ativo)),
      error: () => this.vagasDaAcomodacao.set([]),
    });
  }

  onEsc(): void {
    if (this.tour.ativo()) return;
    if (this.modal()) this.fecharModal();
    else if (this.selecionada()) this.selecionada.set(null);
    else if (this.drawerAberto()) this.fecharDrawer();
  }

  fecharDrawer(): void {
    this.drawerAberto.set(false);
    this.editando.set(null);
    document.body.style.overflow = '';
  }

  fecharModal(): void {
    this.modal.set(null);
    this.editandoTipo.set(null);
  }

  chk(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  invalido(ctrl: string): boolean {
    const c = this.form.get(ctrl);
    return !!c && c.invalid && (c.touched || this.tentouSalvar());
  }

  abrirForm(a?: Acomodacao): void {
    this.editando.set(a ?? null);
    this.comVaga.set(false);
    this.vagasSel.set([]);
    this.tentouSalvar.set(false);
    if (a) {
      this.form.patchValue({
        nome: a.nome,
        numero: a.numero,
        andar: a.andar ?? 0,
        idtipo_acomodacao: a.idtipo_acomodacao,
        valor: a.valor !== null ? Number(a.valor) : null,
        capacidade: a.capacidade,
        descricao: a.descricao ?? '',
        cor: a.cor ?? '#2457a7',
      });
    } else {
      this.form.reset({
        nome: '',
        numero: 0,
        andar: 0,
        idtipo_acomodacao: null,
        valor: null,
        capacidade: 1,
        descricao: '',
        cor: '#2457a7',
      });
      this.estacionamentoApi.listarVagas().subscribe({
        next: (v) => this.vagasLivres.set(v.filter((x) => x.ativo && x.idacomodacao === null)),
        error: () => this.vagasLivres.set([]),
      });
    }
    this.drawerAberto.set(true);
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('ac-nome')?.focus(), 260);
  }

  salvar(): void {
    if (this.form.invalid) {
      this.tentouSalvar.set(true);
      this.notify.aviso('Revise os campos destacados.');
      setTimeout(
        () => document.querySelector('.drawer .inval')?.scrollIntoView({ block: 'center' }),
        60,
      );
      return;
    }
    const v = this.form.getRawValue();
    const input: AcomodacaoInput = {
      nome: v.nome,
      numero: v.numero,
      andar: v.andar,
      idtipo_acomodacao: v.idtipo_acomodacao,
      valor: v.valor,
      capacidade: v.capacidade,
      descricao: v.descricao || null,
      cor: v.cor || null,
      version: this.editando()?.version,
    };
    const editando = this.editando();
    const op = editando
      ? this.acomodacoesApi.atualizarAcomodacao(editando.id, input)
      : this.acomodacoesApi.criarAcomodacao(input);
    op.subscribe({
      next: (salva) => {
        const vagas = this.vagasSel();
        if (!editando && vagas.length > 0) {
          forkJoin(vagas.map((id) => this.estacionamentoApi.vincularVaga(id, salva.id)))
            .subscribe({ error: (e) => this.notify.erro(e) });
        }
        this.notify.ok(editando ? 'Acomodação atualizada.' : 'Acomodação cadastrada.');
        this.fecharDrawer();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirTipos(): void {
    this.modal.set('tipos');
  }

  criarTipo(): void {
    const nome = this.novoTipo.value?.trim();
    if (!nome) return;
    this.acomodacoesApi.criarTipo(nome).subscribe({
      next: () => {
        this.novoTipo.reset();
        this.carregarTipos();
        this.notify.ok('Tipo criado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  editarTipo(t: TipoAcomodacao): void {
    this.editandoTipo.set(t.id);
    this.tipoNomeCtrl.setValue(t.nome);
  }

  // -- tarifa por ocupação -----------------------------------------------------

  toggleTarifas(t: TipoAcomodacao): void {
    if (this.tarifasTipo() === t.id) {
      this.tarifasTipo.set(null);
      return;
    }
    this.tarifasTipo.set(t.id);
    this.acomodacoesApi.tarifasOcupacao(t.id).subscribe({
      next: (lista) => {
        // Semente: faixas 1..3 sempre visíveis (spec), mescladas com o que já existe.
        const base = [1, 2, 3].map((h) => {
          const ex = lista.find((x) => x.hospedes === h);
          return { hospedes: h, valor: ex ? String(Number(ex.valor)) : '' };
        });
        const extras = lista
          .filter((x) => x.hospedes > 3)
          .map((x) => ({ hospedes: x.hospedes, valor: String(Number(x.valor)) }));
        this.faixas.set([...base, ...extras]);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  faixaCampo(i: number, campo: 'hospedes' | 'valor', ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.faixas.update((f) =>
      f.map((x, j) => (j === i ? { ...x, [campo]: campo === 'hospedes' ? Number(v) : v } : x)),
    );
  }

  addFaixa(): void {
    const prox = Math.max(0, ...this.faixas().map((f) => f.hospedes)) + 1;
    this.faixas.update((f) => [...f, { hospedes: prox, valor: '' }]);
  }

  remFaixa(i: number): void {
    this.faixas.update((f) => f.filter((_, j) => j !== i));
  }

  salvarFaixas(t: TipoAcomodacao): void {
    const payload: TarifaOcupacaoInput[] = this.faixas()
      .filter((f) => f.valor !== '' && Number(f.valor) > 0)
      .map((f) => ({ hospedes: f.hospedes, valor: Number(f.valor) }));
    this.salvandoFaixas.set(true);
    this.acomodacoesApi.salvarTarifasOcupacao(t.id, payload).subscribe({
      next: () => {
        this.salvandoFaixas.set(false);
        this.notify.ok(`Faixas de ocupação de '${t.nome}' salvas.`);
      },
      error: (e) => {
        this.salvandoFaixas.set(false);
        this.notify.erro(e);
      },
    });
  }

  salvarTipo(t: TipoAcomodacao): void {
    const nome = this.tipoNomeCtrl.value?.trim();
    if (!nome) return;
    this.acomodacoesApi.atualizarTipo(t.id, nome, t.version).subscribe({
      next: () => {
        this.editandoTipo.set(null);
        this.carregarTipos();
        this.notify.ok('Tipo atualizado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusTipo(t: TipoAcomodacao, ativo: boolean): void {
    this.acomodacoesApi.statusTipo(t.id, ativo).subscribe({
      next: () => this.carregarTipos(),
      error: (e) => this.notify.erro(e),
    });
  }

  statusAcomodacao(a: Acomodacao, ativo: boolean): void {
    this.acomodacoesApi.statusAcomodacao(a.id, ativo).subscribe({
      next: () => {
        this.notify.ok(ativo ? 'Acomodação ativada.' : 'Acomodação desativada.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirAcomodacao(a: Acomodacao): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a acomodação ${a.nome}? Quartos físicos, conteúdo do site e mídias serão apagados.`,
      { titulo: 'Excluir acomodação', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.acomodacoesApi.excluirAcomodacao(a.id).subscribe({
      next: (r) => {
        this.notify.ok(r.mensagem);
        if (this.selecionada()?.id === a.id) this.selecionada.set(null);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirTipo(t: TipoAcomodacao): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o tipo de acomodação "${t.nome}"?`,
      { titulo: 'Excluir tipo', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.acomodacoesApi.excluirTipo(t.id).subscribe({
      next: () => {
        this.notify.ok('Tipo excluído.');
        this.carregarTipos();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirQuarto(q: Quarto): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o quarto ${q.numero}?`,
      { titulo: 'Excluir quarto', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.acomodacoesApi.excluirQuarto(q.id).subscribe({
      next: () => {
        this.notify.ok('Quarto excluído.');
        const a = this.selecionada();
        if (a) this.visualizar(a);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirQuarto(): void {
    this.quartoNumero.reset();
    this.modal.set('quarto');
  }

  criarQuarto(): void {
    const a = this.selecionada();
    const numero = this.quartoNumero.value?.trim();
    if (!a || !numero) return;
    this.acomodacoesApi.criarQuarto(a.id, numero).subscribe({
      next: () => {
        this.fecharModal();
        this.visualizar(a);
        this.notify.ok('Quarto cadastrado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusQuarto(q: Quarto, ativo: boolean): void {
    this.acomodacoesApi.statusQuarto(q.id, ativo).subscribe({
      next: (novo) => {
        this.quartos.update((list) => list.map((x) => (x.id === novo.id ? novo : x)));
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js) — abre até o drawer de cadastro. */
  iniciarTour(): void {
    this.tour.iniciar(
      [
        {
          popover: {
            title: 'Bem-vindo à tela de Acomodações!',
            description:
              'Este tour rápido mostra cada parte da tela. Avance com <b>Próximo</b> ' +
              'e feche a qualquer momento no ✕ ou pela tecla Esc.',
          },
        },
        {
          element: '#tour-busca',
          popover: {
            title: 'Busca rápida',
            description:
              'Filtre por <b>nome</b>, <b>número</b> ou <b>tipo</b> — a lista ' +
              'filtra sozinha enquanto digita.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-ativas',
          popover: {
            title: 'Somente ativas',
            description:
              'Ligado, a lista mostra apenas acomodações ativas. Desligado, ' +
              'aparecem todas — inclusive as inativas.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-tipos',
          popover: {
            title: 'Tipos de acomodação',
            description:
              'Aqui você cria e organiza os <b>tipos</b> (Suíte, Chalé, ' +
              'Apartamento…) usados no cadastro de cada acomodação.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-nova',
          popover: {
            title: 'Nova acomodação',
            description:
              'Clique aqui para cadastrar. Um painel abre à direita com o ' +
              'formulário — vou abrir para você ver!',
            side: 'bottom',
            onNextClick: () => {
              this.abrirForm();
              setTimeout(() => this.tour.avancar(), 420);
            },
          },
        },
        {
          element: '.drawer',
          popover: {
            title: 'Painel de cadastro',
            description:
              'Campos com <b>*</b> são obrigatórios. Você ainda escolhe a ' +
              '<b>cor do calendário</b> e pode vincular vagas de estacionamento ' +
              'livres. Conclua em <b>Cadastrar</b> no rodapé.',
            side: 'left',
            onNextClick: () => {
              this.fecharDrawer();
              setTimeout(() => this.tour.avancar(), 120);
            },
            onPrevClick: () => {
              this.fecharDrawer();
              this.tour.voltar();
            },
          },
        },
        {
          element: '#tour-tabela',
          popover: {
            title: 'Lista de acomodações',
            description:
              'Cada linha mostra a <b>cor do calendário</b>, nome, tipo, diária ' +
              'e capacidade.',
            side: 'top',
          },
        },
        {
          element: 'tr.acm-row .acm-ver',
          skipMissingElement: true,
          popover: {
            title: 'Quartos físicos e tarifas',
            description:
              'O <b>olho teal</b> abre a janela da acomodação: cadastre quartos ' +
              'reais, ative/desative cada um e veja o histórico de tarifas.',
            side: 'left',
          },
        },
        {
          element: 'tr.acm-row .badge-toggle',
          skipMissingElement: true,
          popover: {
            title: 'Ativar / desativar',
            description:
              'Clique no selo para mudar o status: <b>teal = Ativo</b>, ' +
              '<b>cinza = Inativo</b>. Acomodações inativas não aparecem para reserva.',
            side: 'top',
          },
        },
        {
          element: 'tr.acm-row .acm-acoes',
          skipMissingElement: true,
          popover: {
            title: 'Ações da acomodação',
            description:
              '<b>Dourado</b> edita os dados · <b>olho teal</b> abre quartos e ' +
              'tarifas · <b>navy</b> exclui (apaga também quartos e fotos do site, ' +
              'sempre com confirmação).',
            side: 'left',
          },
        },
        {
          popover: {
            title: 'Pronto!',
            description:
              'Você já conhece a tela de Acomodações. Para rever, clique em ' +
              '<b>Tutorial</b> no topo a qualquer momento.',
          },
        },
      ],
      () => {
        if (this.drawerAberto()) this.fecharDrawer();
      },
    );
  }
}
