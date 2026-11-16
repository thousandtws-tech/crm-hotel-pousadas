import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideNativeDateAdapter } from '@angular/material/core';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num';
import { Acomodacao, Grupo, GrupoUnidadeView } from '@core/models/catalogo.models';
import { StatusReserva } from '@core/models/comum.models';
import { Bloqueio, MapaQuarto, ReservaResumo } from '@core/models/reservas.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourGuiado } from '@core/services/tour.service';
import { NovaReservaDialogComponent } from './nova-reserva-dialog.component';

const DIA_MS = 86_400_000;
/** Largura de cada coluna-dia no mapa de ocupação. */
const COL_W = 52;
/** Quantidade de dias visíveis no mapa. */
const JANELA_DIAS = 14;

type Visao = 'lista' | 'cal' | 'mapa' | 'grupos';

/** Reservas — central de reservas com 4 visões: lista, calendário, mapa e grupos. */
@Component({
  selector: 'app-reservas',
  providers: [provideNativeDateAdapter()],
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    MatPaginatorModule,
    MatIconModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    NovaReservaDialogComponent,
  ],
  template: `
    <div class="rv">
      <!-- ============================ cabeçalho ============================ -->
      <header class="rv-head">
        <div>
          <p class="eyebrow">Central de reservas</p>
          <h2 class="titulo">Reservas</h2>
          <p class="sub">{{ hojeExtenso }}</p>
        </div>
        <div class="rv-acoes">
          <button class="btn-ghost" type="button" (click)="iniciarTour()" title="Ver tutorial da tela" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon>
          </button>
          <button class="btn-ghost" type="button" (click)="atualizar()" [disabled]="carregando()" title="Atualizar" aria-label="Atualizar">
            <mat-icon>refresh</mat-icon>
          </button>
          <button id="tour-nova" class="btn-pri" type="button" (click)="novaReserva()">
            <mat-icon>add</mat-icon> Nova reserva
          </button>
        </div>
      </header>

      <!-- ============================ KPIs do dia ============================ -->
      <div id="tour-kpis" class="stats">
        <button type="button" class="stat stat-btn" (click)="atalho('chegadas')" title="Ver chegadas previstas para hoje">
          <div class="stat-txt">
            <span class="stat-l">Chegadas hoje</span>
            <p><strong [class.stat-warn]="chegadasHoje() > 0">{{ chegadasHoje() }}</strong>
              <small>{{ chegadasHoje() === 1 ? 'reserva' : 'reservas' }}</small></p>
          </div>
          <span class="stat-ico ico-in"><mat-icon>luggage</mat-icon></span>
        </button>
        <button type="button" class="stat stat-btn" (click)="atalho('saidas')" title="Ver hospedados com saída hoje">
          <div class="stat-txt">
            <span class="stat-l">Saídas hoje</span>
            <p><strong [class.stat-warn]="saidasHoje() > 0">{{ saidasHoje() }}</strong>
              <small>{{ saidasHoje() === 1 ? 'saída' : 'saídas' }}</small></p>
          </div>
          <span class="stat-ico ico-out"><mat-icon>meeting_room</mat-icon></span>
        </button>
        <button type="button" class="stat stat-btn" (click)="atalho('hospedados')" title="Ver hóspedes na pousada agora">
          <div class="stat-txt">
            <span class="stat-l">Hospedados</span>
            <p><strong>{{ hospedados() }}</strong>
              <small>{{ hospedados() === 1 ? 'reserva ativa' : 'reservas ativas' }}</small></p>
          </div>
          <span class="stat-ico ico-casa"><mat-icon>king_bed</mat-icon></span>
        </button>
        <button type="button" class="stat stat-btn" (click)="atalho('pendentes')" title="Ver reservas pendentes">
          <div class="stat-txt">
            <span class="stat-l">Pendentes</span>
            <p><strong>{{ pendentes() }}</strong>
              <small>{{ pendentes() === 1 ? 'reserva' : 'reservas' }}</small></p>
          </div>
          <span class="stat-ico ico-atn"><mat-icon>schedule</mat-icon></span>
        </button>
      </div>

      <!-- ============================ card principal ============================ -->
      <section class="fd-card rv-card">
        <div class="rv-toolbar">
          <div id="tour-visao" class="seg" role="tablist" aria-label="Alternar visualização">
            @for (v of visoes; track v.id) {
              <button
                type="button"
                role="tab"
                class="seg-btn"
                [class.ativo]="visao() === v.id"
                [attr.aria-selected]="visao() === v.id"
                (click)="mudarVisao(v.id)"
              >
                <mat-icon>{{ v.icone }}</mat-icon> {{ v.rotulo }}
              </button>
            }
          </div>

          @if (visao() === 'lista') {
            <div id="tour-busca" class="rv-busca" [class.foco]="buscaFoco()">
              <mat-icon class="rv-busca-icone">search</mat-icon>
              <input
                class="rv-busca-input"
                type="search"
                [formControl]="fBusca"
                placeholder="Hóspede, acomodação ou nº da reserva…"
                aria-label="Buscar reserva"
                autocomplete="off"
                (focus)="buscaFoco.set(true)"
                (blur)="buscaFoco.set(false)"
              />
              @if (fBusca.value) {
                <button
                  type="button"
                  class="rv-limpar"
                  aria-label="Limpar busca"
                  (click)="fBusca.setValue('')"
                ><mat-icon>close</mat-icon></button>
              }
            </div>
            <mat-form-field
              appearance="outline"
              subscriptSizing="dynamic"
              class="campo-mat rs-range"
            >
              <mat-date-range-input [rangePicker]="picker" [formGroup]="range">
                <input matStartDate formControlName="inicio" placeholder="Entrada" aria-label="Entrada a partir de" />
                <input matEndDate formControlName="fim" placeholder="Saída" aria-label="Saída até" />
              </mat-date-range-input>
              <mat-datepicker-toggle matIconSuffix [for]="picker" />
              <mat-date-range-picker #picker />
            </mat-form-field>
            @if (rangeAtiva()) {
              <button
                type="button" class="btn-linha"
                (click)="limparRange()" title="Limpar período"
              >
                <mat-icon>date_range</mat-icon> Limpar
              </button>
            }
          } @else if (visao() === 'cal') {
            <div class="rv-nav">
              <button type="button" class="rv-nav-btn" (click)="nav(-7)" aria-label="Voltar 7 dias">
                <mat-icon>chevron_left</mat-icon>
              </button>
              <button type="button" class="rv-nav-hoje" (click)="irHoje()">
                <mat-icon>today</mat-icon> Hoje
              </button>
              <button type="button" class="rv-nav-btn" (click)="nav(7)" aria-label="Avançar 7 dias">
                <mat-icon>chevron_right</mat-icon>
              </button>
              <span class="rv-nav-periodo">
                {{ dias()[0] | date: 'dd/MM' }} — {{ dias()[JANELA_DIAS - 1] | date: 'dd/MM/yyyy' }}
              </span>
            </div>
          }
        </div>

        @if (visao() === 'lista') {
          <div id="tour-status" class="pills" role="group" aria-label="Filtrar por status">
            @for (s of statusFiltro; track s.id) {
              <button
                type="button"
                class="pf"
                [class.on]="fStatus() === s.id"
                [attr.aria-pressed]="fStatus() === s.id"
                (click)="filtrarStatus(s.id)"
              >{{ s.rotulo }}</button>
            }
          </div>
        }

        <!-- ==================== VISÃO: LISTA ==================== -->
        @if (visao() === 'lista') {
          <div id="tour-tabela" class="rv-tabela-wrap">
            <table class="rv-tabela">
              <thead>
                <tr>
                  <th>Hóspede</th>
                  <th>Acomodação</th>
                  <th>Período</th>
                  <th>Diária</th>
                  <th class="tc">Status</th>
                  <th class="tc">Ações</th>
                </tr>
              </thead>
              <tbody>
                @if (carregando()) {
                  @for (s of skel; track s) {
                    <tr class="skel-row">
                      <td>
                        <span class="skel skel-av"></span>
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
                  @for (r of items(); track r.id) {
                    <tr class="rs-row">
                      <td>
                        <div class="rv-cell">
                          <span class="rv-avatar">{{ iniciais(r.cliente_nome) }}</span>
                          <span class="rv-cell-txt">
                            <strong>{{ r.cliente_nome }}</strong>
                            <small>
                              Reserva Nº{{ r.id }} ·
                              {{ r.quantidade_hospedes }}
                              {{ r.quantidade_hospedes === 1 ? 'hóspede' : 'hóspedes' }}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div class="rv-cell">
                          <span
                            class="rv-dot"
                            [style.background]="r.acomodacao_cor || '#8fa3ab'"
                          ></span>
                          <span class="rv-cell-txt">
                            <strong class="rv-acom-nome">{{ r.acomodacao_nome }}</strong>
                            <small>Nº {{ r.acomodacao_numero }}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div class="rv-periodo">
                          <strong>
                            {{ parseDia(r.entradaprevista) | date: 'dd/MM' }}
                            <mat-icon>arrow_forward</mat-icon>
                            {{ parseDia(r.saidaprevista) | date: 'dd/MM/yyyy' }}
                          </strong>
                          <small>
                            {{ noites(r) }} {{ noites(r) === 1 ? 'noite' : 'noites' }}
                            @if (emCurso(r)) { · <b class="rv-hj">em curso</b> }
                            @if (chegaHoje(r)) { · <b class="rv-hj">chega hoje</b> }
                          </small>
                        </div>
                      </td>
                      <td>
                        <span class="rv-valor">R$ {{ num(r.valordiaria) | number: '1.2-2' }}</span>
                        @if (r.valor_estadia !== null) {
                          <small class="rv-total">
                            total R$ {{ num(r.valor_estadia) | number: '1.2-2' }}
                          </small>
                        }
                      </td>
                      <td class="tc">
                        <span
                          class="rv-st"
                          [style.background]="st(r.status).bg"
                          [style.color]="st(r.status).fg"
                        >{{ st(r.status).rotulo }}</span>
                      </td>
                      <td class="tc rv-acoes">
                        @if (chegaHoje(r)) {
                          <button
                            type="button"
                            class="btn-ck"
                            title="Fazer check-in"
                            aria-label="Fazer check-in de {{ r.cliente_nome }}"
                            [disabled]="aguardando() === r.id"
                            (click)="checkin(r)"
                          >
                            <mat-icon>key</mat-icon>
                            {{ aguardando() === r.id ? '…' : 'Check-in' }}
                          </button>
                        }
                        <a
                          class="badge-acao bg-blue rs-ver"
                          title="Abrir reserva"
                          aria-label="Abrir reserva de {{ r.cliente_nome }}"
                          [routerLink]="['/reservas', r.id]"
                        >
                          <mat-icon>visibility</mat-icon>
                        </a>
                        @if (auth.isAdmin() && (r.status === 'p' || r.status === 'c')) {
                          <button
                            type="button"
                            class="badge-acao bg-dark-blue"
                            title="Excluir"
                            aria-label="Excluir reserva"
                            (click)="excluir(r)"
                          >
                            <mat-icon>delete</mat-icon>
                          </button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="rv-vazio">
                        <mat-icon>event_busy</mat-icon>
                        <p>
                          {{ temFiltro()
                            ? 'Nenhuma reserva encontrada para esses filtros.'
                            : 'Nenhuma reserva registrada ainda.' }}
                        </p>
                        @if (!temFiltro()) {
                          <button class="btn-pri" type="button" (click)="novaReserva()">
                            <mat-icon>add</mat-icon> Criar a primeira reserva
                          </button>
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>

          <mat-paginator
            [length]="total()"
            [pageSize]="24"
            [pageIndex]="pagina() - 1"
            (page)="mudouPagina($event)"
          />
        }

        <!-- ==================== VISÃO: CALENDÁRIO ==================== -->
        @if (visao() === 'cal') {
          <div id="tour-mapa" class="tape-wrap">
            <div class="tape">
              <div class="tape-head">
                <div class="tape-room tape-room-head">Acomodação</div>
                @for (d of dias(); track d.getTime()) {
                  <div
                    class="tape-dia"
                    [class.hj]="isoLocal(d) === hojeIso"
                    [class.fds]="d.getDay() === 0 || d.getDay() === 6"
                  >
                    <small>{{ d | date: 'EEE' }}</small>
                    <strong>{{ d | date: 'dd' }}</strong>
                  </div>
                }
              </div>
              @if (carregandoEventos()) {
                @for (a of acomodacoes(); track a.id) {
                  <div class="tape-row">
                    <div class="tape-room" [style.border-left-color]="a.cor || '#8fa3ab'">
                      <strong>{{ a.nome }}</strong>
                      <small>Nº {{ a.numero }}</small>
                    </div>
                    <div class="tape-track"><span class="skel skel-bar"></span></div>
                  </div>
                } @empty {
                  <div class="vazio">
                    <mat-icon>hotel</mat-icon>
                    <p>Nenhuma acomodação ativa cadastrada.</p>
                  </div>
                }
              } @else {
                @for (a of acomodacoes(); track a.id) {
                  <div class="tape-row">
                    <div class="tape-room" [style.border-left-color]="a.cor || '#8fa3ab'">
                      <strong>{{ a.nome }}</strong>
                      <small>Nº {{ a.numero }}</small>
                    </div>
                    <div class="tape-track">
                      @for (d of dias(); track d.getTime()) {
                        <span
                          class="tape-cel"
                          [class.hj]="isoLocal(d) === hojeIso"
                          [class.fds]="d.getDay() === 0 || d.getDay() === 6"
                        ></span>
                      }
                      @for (r of eventosDe(a.id); track r.id) {
                        @if (barGeo(r); as g) {
                          <a
                            class="tape-bar"
                            [class.can]="r.status === 'c'"
                            [style.left.px]="g.l"
                            [style.width.px]="g.w"
                            [style.background]="barCor(r)"
                            [routerLink]="['/reservas', r.id]"
                            [title]="
                              r.cliente_nome +
                              ' · ' +
                              st(r.status).rotulo +
                              ' (' +
                              (parseDia(r.entradaprevista) | date: 'dd/MM') +
                              ' → ' +
                              (parseDia(r.saidaprevista) | date: 'dd/MM') +
                              ')'
                            "
                          >
                            <span class="tape-bar-txt">{{ primeiroNome(r.cliente_nome) }}</span>
                          </a>
                        }
                      }
                    </div>
                  </div>
                } @empty {
                  <div class="vazio">
                    <mat-icon>hotel</mat-icon>
                    <p>Nenhuma acomodação ativa cadastrada.</p>
                  </div>
                }
              }
            </div>
            <div class="tape-legenda">
              <span><i class="lg lg-cor"></i> Cor da acomodação</span>
              <span><i class="lg lg-hj"></i> Hoje</span>
              <span><i class="lg lg-fds"></i> Fim de semana</span>
              <span><i class="lg lg-can"></i> Cancelada</span>
            </div>
          </div>
        }

        <!-- ==================== VISÃO: MAPA ==================== -->
        @if (visao() === 'mapa') {
          <div class="leg" role="list" aria-label="Legenda de status">
            <span role="listitem"><i class="dt lv"></i>Livre</span>
            <span role="listitem"><i class="dt oc"></i>Ocupado</span>
            <span role="listitem"><i class="dt pd"></i>Chega hoje</span>
            <span role="listitem"><i class="dt bq"></i>Bloqueado</span>
            <span role="listitem"><i class="dt lm"></i>Limpeza</span>
            <span role="listitem"><i class="dt mn"></i>Manutenção</span>
          </div>

          @if (carregandoMapa()) {
            <div class="qt-grid">
              @for (s of skelMapa; track s) { <div class="skel skel-qt"></div> }
            </div>
          } @else {
            @for (f of andares(); track f.andar) {
              <div class="andar">
                <span class="andar-lbl">
                  {{ f.andar === 0 ? 'Térreo' : f.andar + 'º andar' }}
                  <em>{{ f.quartos.length }} {{ f.quartos.length === 1 ? 'quarto' : 'quartos' }}</em>
                </span>
                <div class="qt-grid">
                  @for (a of f.quartos; track a.id) {
                    <div class="qt" [class]="'qt ' + statusQuarto(a)">
                      <div class="qt-topo">
                        <b>{{ a.numero }}</b>
                        <small>{{ a.nome }}</small>
                      </div>
                      <span class="qt-tipo">{{ a.tipo ?? '—' }}</span>
                      <span class="qt-tags">
                        @if (a.bloqueado) { <em class="tg tg-bloq"><mat-icon>lock</mat-icon>Bloqueado</em> }
                        @else if (a.status_hoje === 'i') { <em class="tg tg-ocup">Ocupado</em> }
                        @else if (a.status_hoje === 'p') { <em class="tg tg-pend">Chega hoje</em> }
                        @else { <em class="tg tg-livre">Livre</em> }
                        @if (a.limpeza_pendente > 0) {
                          <em class="tg tg-limp" title="Tarefas de limpeza pendentes">
                            <mat-icon>cleaning_services</mat-icon>{{ a.limpeza_pendente }}
                          </em>
                        }
                        @if (a.manut_aberta > 0) {
                          <em class="tg tg-man" title="OS de manutenção abertas">
                            <mat-icon>build</mat-icon>{{ a.manut_aberta }}
                          </em>
                        }
                      </span>
                      <span class="qt-acoes">
                        @if (a.idreserva_hoje) {
                          <a class="qt-btn" [routerLink]="['/reservas', a.idreserva_hoje]">
                            Reserva #{{ a.idreserva_hoje }}
                          </a>
                        }
                        @if (bloqueioDe(a.id); as b) {
                          <button type="button" class="qt-btn" (click)="desbloquear(b.id)">
                            <mat-icon>lock_open</mat-icon> Desbloquear
                          </button>
                        } @else {
                          <button type="button" class="qt-btn" (click)="abrirBloqueio(a)">
                            <mat-icon>lock</mat-icon> Bloquear
                          </button>
                        }
                      </span>
                    </div>
                  }
                </div>
              </div>
            } @empty {
              <p class="vazio"><mat-icon>hotel</mat-icon>Nenhuma acomodação ativa cadastrada.</p>
            }
          }
        }

        <!-- ==================== VISÃO: GRUPOS ==================== -->
        @if (visao() === 'grupos') {
          <div class="gr-wrap">
            <div class="gr-novo">
              <h3 class="gr-tit"><mat-icon>group</mat-icon> Novo grupo / evento</h3>
              <div class="gr-form">
                <input class="inp" placeholder="Nome do grupo *" [value]="gNome" (input)="gNome=$any($event.target).value" aria-label="Nome do grupo" />
                <input class="inp" placeholder="Contato" [value]="gContato" (input)="gContato=$any($event.target).value" aria-label="Contato" />
              </div>
              <mat-form-field
                appearance="outline"
                subscriptSizing="dynamic"
                class="campo-mat gr-range"
              >
                <mat-date-range-input [rangePicker]="gPicker" [formGroup]="gRange">
                  <input matStartDate formControlName="inicio" placeholder="Início" aria-label="Início do período do grupo" />
                  <input matEndDate formControlName="fim" placeholder="Fim" aria-label="Fim do período do grupo" />
                </mat-date-range-input>
                <mat-datepicker-toggle matIconSuffix [for]="gPicker" />
                <mat-date-range-picker #gPicker />
              </mat-form-field>
              <p class="gr-sub">Unidades (rooming list):</p>
              <div class="gr-units">
                @for (a of acomodacoes(); track a.id) {
                  <label class="gr-unit" [class.sel]="gSel().has(a.id)">
                    <input type="checkbox" [checked]="gSel().has(a.id)" (change)="toggleUnidade(a.id)" />
                    {{ a.numero }} · {{ a.nome }}
                  </label>
                }
              </div>
              <label class="gr-blk">
                <input type="checkbox" [checked]="gBloquear" (change)="gBloquear=!gBloquear" />
                Bloquear as unidades para venda no período
              </label>
              <button type="button" class="btn-pri gr-cta" [disabled]="salvandoGrupo()" (click)="criarGrupo()">
                <mat-icon>{{ salvandoGrupo() ? 'hourglass_top' : 'add' }}</mat-icon>
                {{ salvandoGrupo() ? 'Salvando…' : 'Criar grupo' }}
              </button>
            </div>

            <div class="gr-lista">
              @for (g of grupos(); track g.id) {
                <div class="gr-card">
                  <div class="gr-head">
                    <span class="gr-av"><mat-icon>groups</mat-icon></span>
                    <div class="gr-head-txt">
                      <strong>{{ g.nome }}</strong>
                      <small class="gr-datas">
                        <mat-icon>event</mat-icon>
                        {{ g.inicio | date:'dd/MM' }} → {{ g.fim | date:'dd/MM' }}
                      </small>
                    </div>
                    <button type="button" class="qt-btn" (click)="toggleRooming(g.id)">
                      {{ roomingAberto() === g.id ? 'Fechar' : 'Rooming' }}
                    </button>
                    <button type="button" class="qt-btn danger" (click)="removerGrupo(g)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                  @if (g.contato) { <p class="gr-contato"><mat-icon>person</mat-icon> {{ g.contato }}</p> }
                  @if (roomingAberto() === g.id) {
                    <table class="plain bordered gr-tb">
                      <thead><tr><th>Unidade</th><th>Hóspede</th><th>Status</th></tr></thead>
                      <tbody>
                        @for (u of rooming(); track u.id) {
                          <tr>
                            <td>{{ u.acomodacao_numero }} · {{ u.acomodacao_nome }}</td>
                            <td>{{ u.hospede ?? '—' }}</td>
                            <td>{{ u.reserva_status === 'i' ? 'Na casa' : (u.reserva_status === 'p' ? 'Reservado' : '—') }}</td>
                          </tr>
                        } @empty {
                          <tr><td colspan="3" class="muted tc">Sem unidades.</td></tr>
                        }
                      </tbody>
                    </table>
                  }
                </div>
              } @empty {
                <p class="vazio"><mat-icon>groups</mat-icon>Nenhum grupo cadastrado — casamentos, retiros, excursões.</p>
              }
            </div>
          </div>
        }
      </section>
    </div>

    @if (bloqueioAlvo(); as alvo) {
      <div class="ovl" (click)="bloqueioAlvo.set(null)" (keydown.escape)="bloqueioAlvo.set(null)">
        <div class="dlg" role="dialog" aria-modal="true" aria-label="Bloquear acomodação">
          <h3><mat-icon>lock</mat-icon> Bloquear {{ alvo.nome }} — Nº {{ alvo.numero }}</h3>
          <mat-form-field
            appearance="outline"
            subscriptSizing="dynamic"
            class="campo-mat"
          >
            <mat-date-range-input [rangePicker]="bPicker" [formGroup]="bRange">
              <input matStartDate formControlName="inicio" placeholder="Início" aria-label="Início do bloqueio" />
              <input matEndDate formControlName="fim" placeholder="Fim" aria-label="Fim do bloqueio" />
            </mat-date-range-input>
            <mat-datepicker-toggle matIconSuffix [for]="bPicker" />
            <mat-date-range-picker #bPicker />
          </mat-form-field>
          <label class="dl">Motivo <input type="text" class="inp" placeholder="reforma, uso próprio…" [value]="bMot" (input)="bMot=$any($event.target).value"></label>
          <div class="dlg-acoes">
            <button type="button" class="qt-btn" (click)="bloqueioAlvo.set(null)">Cancelar</button>
            <button type="button" class="btn-pri" [disabled]="salvandoBloq()" (click)="confirmarBloqueio()">
              {{ salvandoBloq() ? 'Bloqueando…' : 'Confirmar bloqueio' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (modalNova()) {
      <app-nova-reserva-dialog
        (fechar)="modalNova.set(false)"
        (criada)="reservaCriada()"
      />
    }
  `,
  styles: `
    :host { display: block; }
    .rv { display: flex; flex-direction: column; gap: 16px; }

    /* ---------- cabeçalho ---------- */
    .rv-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
    }
    .eyebrow {
      margin: 0 0 4px; font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase; color: #4b95ab;
    }
    .titulo {
      margin: 0; font-family: var(--font-display);
      font-size: 1.9rem; font-weight: 600; color: #054054; line-height: 1.1;
      display: flex; align-items: center; gap: 12px;
    }
    .sub { margin: 4px 0 0; font-size: 0.86rem; color: #7d97a1; text-transform: capitalize; }

    .rv-acoes { display: flex; gap: 8px; align-items: center; }
    .btn-ghost {
      width: 40px; height: 40px; border-radius: 10px;
      border: 1px solid #d7e0e6; background: #fff; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: border-color 0.15s, color 0.15s;
    }
    .btn-ghost:hover:not(:disabled) { border-color: #1a6f8a; color: #1a6f8a; }
    .btn-ghost:disabled { opacity: 0.5; }
    .btn-pri {
      display: inline-flex; align-items: center; gap: 7px;
      background: #054054; color: #fff; border: none; border-radius: 10px;
      padding: 0 18px; height: 40px; font-family: inherit;
      font-size: 0.86rem; font-weight: 700; cursor: pointer;
      text-decoration: none; transition: background 0.15s;
    }
    .btn-pri:hover:not(:disabled) { background: #1a6f8a; color: #fff; }
    .btn-pri:disabled { opacity: 0.55; }
    .btn-ghost mat-icon, .stat-ico mat-icon, .gr-av mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .btn-pri mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn-linha mat-icon, .rv-nav-hoje mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn-linha {
      display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid #d7e0e6; background: #fff; border-radius: 8px;
      padding: 7px 12px; font-size: 0.78rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; font-family: inherit;
    }
    .btn-linha:hover { border-color: #1a6f8a; color: #1a6f8a; }

    /* ---------- KPIs ---------- */
    .stats {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    }
    .stat {
      background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 15px 16px; display: flex; align-items: flex-start;
      justify-content: space-between; gap: 10px;
    }
    .stat-btn {
      font-family: inherit; text-align: left; cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
    }
    .stat-btn:hover {
      border-color: #4b95ab; box-shadow: 0 4px 14px rgba(5, 64, 84, 0.1);
      transform: translateY(-1px);
    }
    .stat-txt { min-width: 0; }
    .stat-l {
      font-size: 0.72rem; font-weight: 700; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .stat p { margin: 7px 0 0; display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
    .stat strong {
      font-family: var(--font-display); font-size: 1.9rem; font-weight: 700;
      color: #054054; line-height: 1; font-variant-numeric: tabular-nums;
    }
    .stat-warn { color: #b5811f; }
    .stat small { font-size: 0.76rem; color: #8a99a4; }
    .stat-ico {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      background: #eef4f6; color: #054054;
      display: flex; align-items: center; justify-content: center;
    }
    .ico-in, .ico-out, .ico-casa, .ico-atn { background: #eef4f6; color: #054054; }

    /* ---------- card principal ---------- */
    .fd-card {
      background: #fff; border: 1px solid #e3eaef; border-radius: 14px;
      padding: 16px 18px; min-width: 0;
    }
    .rv-toolbar {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      margin-bottom: 14px;
    }

    /* segmented control — 4 visões */
    .seg {
      display: inline-flex; gap: 3px; flex-shrink: 0;
      background: #eef4f6; border-radius: 10px; padding: 3px;
    }
    .seg-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: none; background: transparent; border-radius: 8px;
      padding: 7px 14px; font-family: inherit;
      font-size: 0.82rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; transition: background 0.15s, color 0.15s, box-shadow 0.15s;
      white-space: nowrap;
    }
    .seg-btn:hover:not(.ativo) { color: #1a6f8a; }
    .seg-btn.ativo {
      background: #fff; color: #054054;
      box-shadow: 0 1px 4px rgba(5, 64, 84, 0.16);
    }

    /* ---------- busca ---------- */
    .rv-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; min-width: 220px; max-width: 400px;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 10px;
      padding: 0 10px; height: 40px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .rv-busca.foco {
      border-color: #1a6f8a;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14);
    }
    .rv-busca-icone { color: #7d97a1; font-size: 20px; width: 20px; height: 20px; }
    .rv-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #33424c; font-family: inherit; height: 100%;
    }
    .rv-busca-input::placeholder { color: #8fa3ab; }
    .rv-busca-input::-webkit-search-cancel-button { display: none; }
    .rv-limpar {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .rv-limpar:hover { background: #d7e0e6; }
    .rs-range { width: 250px; }

    /* ---------- pills de status ---------- */
    .pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .pf {
      border: 1px solid #d7e0e6; background: #fff; border-radius: 999px;
      padding: 6px 15px; font-family: inherit;
      font-size: 0.78rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; transition: all 0.15s;
    }
    .pf:hover:not(.on) { border-color: #4b95ab; color: #1a6f8a; }
    .pf.on { background: #054054; border-color: #054054; color: #fff; }

    /* nav do calendário */
    .rv-nav { display: inline-flex; align-items: center; gap: 8px; }
    .rv-nav-btn {
      width: 36px; height: 36px; border-radius: 10px;
      border: 1px solid #d7e0e6; background: #fff; cursor: pointer;
      color: #40525d; display: inline-flex; align-items: center; justify-content: center;
      transition: border-color 0.15s, color 0.15s;
    }
    .rv-nav-btn:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .rv-nav-hoje {
      display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid #d7e0e6; background: #fff; border-radius: 10px;
      padding: 8px 14px; font-size: 0.82rem; font-weight: 600; color: #40525d;
      cursor: pointer; font-family: inherit;
    }
    .rv-nav-hoje:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .rv-nav-periodo { font-size: 0.85rem; font-weight: 600; color: #054054; margin-left: 8px; }

    /* ---------- tabela ---------- */
    .rv-tabela-wrap { overflow-x: auto; border-radius: 8px; min-height: 42vh; }
    .rv-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .rv-tabela thead th {
      position: sticky; top: 0; z-index: 1;
      background: #f4f8fa; color: #40525d;
      font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 13px 16px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .rv-tabela tbody td {
      padding: 13px 16px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .rv-tabela tbody tr { transition: background 0.12s; }
    .rv-tabela tbody tr:hover { background: #f7fafb; }
    .rv-tabela .tc { text-align: center; }
    .rv-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .rv-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.82rem; font-weight: 700; letter-spacing: 0.02em;
    }
    .rv-cell-txt { display: flex; flex-direction: column; min-width: 0; }
    .rv-cell-txt strong {
      font-size: 0.93rem; color: #054054; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 260px;
    }
    .rv-cell-txt small { font-size: 0.75rem; color: #8a99a4; white-space: nowrap; }
    .rv-dot { width: 14px; height: 14px; border-radius: 5px; flex-shrink: 0; }
    .rv-acom-nome { max-width: 180px !important; }
    .rv-periodo { display: flex; flex-direction: column; }
    .rv-periodo strong {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.9rem; color: #33424c; font-weight: 600; white-space: nowrap;
    }
    .rv-periodo strong mat-icon { color: #8fa3ab; }
    .rv-periodo small { font-size: 0.74rem; color: #8a99a4; }
    .rv-hj { color: #b5811f; }
    .rv-valor { font-variant-numeric: tabular-nums; font-weight: 600; color: #054054; white-space: nowrap; }
    .rv-total { display: block; font-size: 0.73rem; color: #8a99a4; white-space: nowrap; }
    .rv-st {
      display: inline-block; border-radius: 999px;
      padding: 5px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap;
    }
    .rv-tabela .badge-acao { padding: 0.5em 0.68em; }
    .rs-ver { text-decoration: none; }
    .rv-acoes { display: flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-ck {
      display: inline-flex; align-items: center; gap: 5px;
      min-height: 30px; padding: 0 12px; border: none; border-radius: 8px;
      background: #054054; color: #fff; font-family: inherit;
      font-size: 0.76rem; font-weight: 700; cursor: pointer;
      transition: background 0.15s, transform 0.12s; white-space: nowrap;
    }
    .btn-ck:hover:not(:disabled) { background: #1a6f8a; transform: translateY(-1px); }
    .btn-ck:disabled { opacity: 0.55; }
    /* tamanhos de ícones compartilhados */
    .seg-btn mat-icon, .rv-tabela .badge-acao mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .rv-limpar mat-icon, .rv-periodo strong mat-icon, .qt-btn mat-icon,
    .gr-datas mat-icon, .btn-ck mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .gr-tit mat-icon, .dlg h3 mat-icon { font-size: 19px; width: 19px; height: 19px; }

    /* ---------- vazio / skeleton ---------- */
    .rv-vazio {
      text-align: center; padding: 44px 16px !important; color: #7d97a1;
    }
    .rv-vazio mat-icon {
      font-size: 40px; width: 40px; height: 40px;
      color: #c3d2d9; margin-bottom: 8px;
    }
    .rv-vazio p { margin: 0 0 14px; font-size: 0.9rem; }
    .vazio {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      margin: 0; padding: 40px 16px; color: #8fa3ab; font-size: 0.86rem;
      text-align: center;
    }
    .vazio mat-icon { font-size: 34px; width: 34px; height: 34px; color: #c3d2d9; }
    .skel-row td { border-bottom: 1px solid #eef2f5; }
    .skel {
      display: inline-block; border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #e3eaef 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-av { width: 40px; height: 40px; border-radius: 50%; }
    .skel-nome { width: 160px; height: 14px; margin-left: 12px; vertical-align: middle; }
    .skel-txt { width: 110px; height: 13px; }
    .skel-chip { width: 78px; height: 24px; border-radius: 999px; }
    .skel-acoes { width: 70px; height: 26px; }
    .skel-bar { width: 60%; height: 24px; border-radius: 6px; margin: 10px 0 10px 60px; }
    .skel-qt { height: 118px; }

    /* ---------- mapa por andar ---------- */
    .leg { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.72rem; color: #5d6d7e; margin-bottom: 6px; }
    .leg span { display: inline-flex; align-items: center; gap: 4px; }
    .dt { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .dt.lv { background: #2e9e5b; } .dt.oc { background: #4b95ab; }
    .dt.pd { background: #d4a017; } .dt.bq { background: #555f66; }
    .dt.lm { background: #7a5fb5; } .dt.mn { background: #e67e22; }
    .andar { margin-top: 14px; }
    .andar:first-of-type { margin-top: 4px; }
    .andar-lbl {
      display: flex; align-items: baseline; gap: 8px;
      font-size: 0.72rem; font-weight: 700; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 6px;
    }
    .andar-lbl em { font-style: normal; font-weight: 500; text-transform: none; letter-spacing: 0; }
    .qt-grid {
      display: grid; gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    }
    .qt {
      position: relative; padding: 10px 12px;
      border: 1px solid #e3eaef; border-left: 5px solid;
      border-radius: 10px; background: #fff;
      display: flex; flex-direction: column; gap: 5px;
      transition: box-shadow 0.14s, transform 0.14s;
    }
    .qt:hover { box-shadow: 0 5px 14px rgba(5, 64, 84, 0.12); transform: translateY(-1px); }
    .qt-topo { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .qt-topo b { font-size: 1.05rem; color: #054054; line-height: 1.1; }
    .qt-topo small {
      font-size: 0.7rem; color: #7d97a1;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .qt-tipo {
      font-size: 0.68rem; color: #8fa3ab;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .qt-tags { display: flex; gap: 5px; flex-wrap: wrap; }
    .tg {
      display: inline-flex; align-items: center; gap: 3px;
      font-style: normal; font-size: 0.66rem; font-weight: 700;
      border-radius: 8px; padding: 2px 8px;
    }
    .tg mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .tg-livre, .tg-ocup, .tg-pend, .tg-bloq, .tg-limp, .tg-man {
      background: #f0f2f4; color: #5d6d7e;
    }
    .qt-livre { border-left-color: #2e9e5b; }
    .qt-ocup { border-left-color: #4b95ab; }
    .qt-pend { border-left-color: #d4a017; }
    .qt-bloq { border-left-color: #555f66; opacity: 0.8; }
    .qt-bloq b, .qt-bloq small { color: #8a99a4; }
    .qt-acoes { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .qt-btn {
      display: inline-flex; align-items: center; gap: 4px;
      font-family: inherit; font-size: 0.72rem; font-weight: 600;
      padding: 4px 10px; border: 1px solid #d7e0e6; border-radius: 7px;
      background: #fff; color: #1a6f8a; cursor: pointer; text-decoration: none;
      transition: border-color 0.15s, color 0.15s;
    }
    .qt-btn:hover { border-color: #1a6f8a; }
    .qt-btn.danger { color: #a33; }
    .qt-btn.danger:hover { border-color: #a33; }

    /* ---------- modal ---------- */
    .ovl {
      position: fixed; inset: 0; background: rgba(5, 30, 40, 0.45);
      display: flex; align-items: center; justify-content: center; z-index: 50;
      backdrop-filter: blur(2px);
    }
    .dlg {
      background: #fff; border-radius: 14px; padding: 22px;
      min-width: 340px; max-width: 92vw;
      display: flex; flex-direction: column; gap: 12px;
      box-shadow: 0 18px 50px rgba(5, 30, 40, 0.3);
    }
    .dlg h3 {
      margin: 0; color: #054054; font-size: 1.05rem;
      display: flex; align-items: center; gap: 8px;
    }
    .dlg h3 mat-icon { color: #4b95ab; }
    .dl { display: flex; flex-direction: column; gap: 4px; font-size: 0.82rem; color: #5d6d7e; font-weight: 600; }
    .inp {
      border: 1px solid #d7e0e6; border-radius: 8px; padding: 8px 10px;
      font-size: 0.85rem; font-family: inherit; color: #33424c;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .inp:focus { outline: none; border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.12); }
    .dlg-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

    /* ---------- grupos / eventos ---------- */
    .gr-wrap { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .gr-novo {
      flex: 0 0 330px; background: #f8fbfc;
      border: 1px solid #e3eaef; border-radius: 12px; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .gr-tit {
      margin: 0; font-size: 0.95rem; color: #054054; font-weight: 700;
      display: flex; align-items: center; gap: 8px;
    }
    .gr-tit mat-icon { color: #4b95ab; }
    .gr-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .gr-sub { margin: 4px 0 0; font-size: 0.78rem; color: #5d6d7e; font-weight: 700; }
    .gr-units { display: flex; flex-direction: column; gap: 4px; max-height: 190px; overflow-y: auto; }
    .gr-unit {
      font-size: 0.8rem; padding: 6px 9px;
      border: 1px solid #e3eaef; border-radius: 8px; cursor: pointer;
      display: flex; gap: 7px; align-items: center; background: #fff;
      transition: border-color 0.14s, background 0.14s;
    }
    .gr-unit:hover { border-color: #4b95ab; }
    .gr-unit.sel { background: #e8f4f8; border-color: #1a6f8a; }
    .gr-blk { font-size: 0.8rem; color: #5d6d7e; display: flex; gap: 7px; align-items: center; }
    .gr-cta { justify-content: center; }
    .gr-lista { flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 10px; }
    .gr-card {
      background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 14px 16px;
    }
    .gr-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .gr-av {
      width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
      background: #e4eef5; color: #1a6f8a;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .gr-head-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .gr-head-txt strong { color: #054054; font-size: 0.94rem; }
    .gr-datas {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.76rem; color: #7d97a1;
    }
    .gr-contato {
      margin: 8px 0 0; font-size: 0.78rem; color: #8a99a4;
      display: inline-flex; align-items: center; gap: 5px;
    }
    .gr-contato mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .gr-tb { margin-top: 10px; font-size: 0.82rem; }
    .gr-tb th { font-size: 0.72rem; color: #8a99a4; text-transform: uppercase; }
    .muted { color: #8a99a4; }
    .tc { text-align: center; }

    /* ---------- mapa de ocupação (tape chart) ---------- */
    .tape-wrap { overflow-x: auto; border-radius: 8px; }
    .tape { min-width: 908px; }
    .tape-head {
      display: grid; grid-template-columns: 180px repeat(14, 52px);
      border-bottom: 2px solid #e3eaef;
    }
    .tape-dia {
      display: flex; flex-direction: column; align-items: center;
      padding: 8px 0 6px; background: #f4f8fa; border-left: 1px solid #e9eff3;
    }
    .tape-dia small {
      font-size: 0.62rem; font-weight: 600; text-transform: uppercase;
      color: #8fa3ab; letter-spacing: 0.03em;
    }
    .tape-dia strong { font-size: 0.85rem; color: #40525d; font-weight: 700; }
    .tape-dia.fds { background: #eef4f6; }
    .tape-dia.fds strong { color: #1a6f8a; }
    .tape-dia.hj { background: rgba(221, 165, 84, 0.18); }
    .tape-dia.hj small, .tape-dia.hj strong { color: #8a5f1d; }
    .tape-row {
      display: grid; grid-template-columns: 180px 1fr;
      border-bottom: 1px solid #eef2f5;
    }
    .tape-row:hover .tape-track { background: #fafcfd; }
    .tape-room {
      padding: 10px 12px; border-left: 4px solid transparent;
      display: flex; flex-direction: column; justify-content: center;
      background: #fff; border-right: 1px solid #e3eaef;
      position: sticky; left: 0; z-index: 2;
    }
    .tape-room-head { justify-content: center; background: #f4f8fa; border-left: 0; }
    .tape-room-head, .tape-head .tape-room {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #40525d;
    }
    .tape-room strong {
      font-size: 0.84rem; color: #054054; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tape-room small { font-size: 0.7rem; color: #8a99a4; }
    .tape-track { position: relative; height: 48px; display: flex; }
    .tape-cel {
      width: 52px; height: 100%; border-left: 1px solid #f0f4f6;
      flex-shrink: 0;
    }
    .tape-cel.fds { background: #f7fafb; }
    .tape-cel.hj { background: rgba(221, 165, 84, 0.1); }
    .tape-bar {
      position: absolute; top: 10px; height: 28px;
      border-radius: 7px; color: #fff; text-decoration: none;
      display: flex; align-items: center; padding: 0 10px;
      font-size: 0.78rem; font-weight: 600;
      box-shadow: 0 2px 6px rgba(5, 64, 84, 0.22);
      transition: transform 0.12s, box-shadow 0.12s, filter 0.12s;
      overflow: hidden; white-space: nowrap; cursor: pointer;
    }
    .tape-bar:hover {
      transform: translateY(-1px); filter: brightness(1.08);
      box-shadow: 0 4px 10px rgba(5, 64, 84, 0.3); z-index: 3;
    }
    .tape-bar.can {
      background: repeating-linear-gradient(
        45deg, #9aa8b0, #9aa8b0 6px, #8a98a1 6px, #8a98a1 12px
      );
      opacity: 0.75; text-decoration: line-through;
    }
    .tape-bar-txt { overflow: hidden; text-overflow: ellipsis; }
    .tape-legenda {
      display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
      padding: 10px 4px 2px; font-size: 0.74rem; color: #7d97a1;
    }
    .tape-legenda span { display: inline-flex; align-items: center; gap: 6px; }
    .lg { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
    .lg-cor { background: linear-gradient(135deg, #1a6f8a, #b5811f); }
    .lg-hj { background: rgba(221, 165, 84, 0.35); }
    .lg-fds { background: #eef4f6; border: 1px solid #dbe4e9; }
    .lg-can {
      background: repeating-linear-gradient(
        45deg, #9aa8b0, #9aa8b0 3px, #8a98a1 3px, #8a98a1 6px
      );
    }

    @media (prefers-reduced-motion: reduce) {
      .skel { animation: none; }
      .qt, .btn-ck, .stat-btn, .rv-tabela tbody tr { transition: none; }
    }
    @media (max-width: 700px) {
      .titulo { font-size: 1.55rem; }
      .rv-head { flex-direction: column; align-items: stretch; }
      .rv-acoes { justify-content: flex-end; }
      .rv-busca { max-width: none; }
      .rs-range { width: 100%; }
      .fd-card { padding: 14px; }
      .seg { width: 100%; }
      .seg-btn { flex: 1; justify-content: center; }
      .seg-btn mat-icon { display: none; }
    }
  `,
})
export class ReservasComponent implements OnInit {
  protected readonly JANELA_DIAS = JANELA_DIAS;
  protected readonly rt = inject(Realtime);
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly tour = inject(TourGuiado);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly modalNova = signal(false);
  protected readonly items = signal<ReservaResumo[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly carregando = signal(false);
  protected readonly aguardando = signal<number | null>(null);
  protected readonly num = num;
  protected readonly skel = [1, 2, 3, 4, 5, 6];
  protected readonly skelMapa = Array.from({ length: 12 }, (_, i) => i);
  protected readonly buscaFoco = signal(false);

  protected readonly fBusca = new FormControl('', { nonNullable: true });
  protected readonly fStatus = signal<StatusReserva | ''>('');
  protected readonly range = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });

  protected readonly visoes: { id: Visao; rotulo: string; icone: string }[] = [
    { id: 'lista', rotulo: 'Lista', icone: 'view_list' },
    { id: 'cal', rotulo: 'Calendário', icone: 'calendar_view_week' },
    { id: 'mapa', rotulo: 'Mapa', icone: 'map' },
    { id: 'grupos', rotulo: 'Grupos', icone: 'groups' },
  ];
  protected readonly statusFiltro: { id: StatusReserva | ''; rotulo: string }[] = [
    { id: '', rotulo: 'Todas' },
    { id: 'p', rotulo: 'Pendente' },
    { id: 'i', rotulo: 'Hospedado' },
    { id: 'f', rotulo: 'Finalizado' },
    { id: 'c', rotulo: 'Cancelada' },
  ];

  // ---- mapa de ocupação -------------------------------------------------------
  protected readonly visao = signal<Visao>('lista');
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly carregandoMapa = signal(false);
  protected readonly bloqueios = signal<Bloqueio[]>([]);
  protected readonly grupos = signal<Grupo[]>([]);
  protected readonly rooming = signal<GrupoUnidadeView[]>([]);
  protected readonly roomingAberto = signal<number | null>(null);
  protected readonly salvandoGrupo = signal(false);
  protected readonly gSel = signal<Set<number>>(new Set());
  protected gNome = '';
  protected gContato = '';
  protected readonly gRange = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });
  protected gBloquear = true;
  protected readonly bloqueioAlvo = signal<MapaQuarto | null>(null);
  protected readonly salvandoBloq = signal(false);
  protected readonly bRange = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });
  protected bMot = '';
  protected readonly andares = computed(() => {
    const por = new Map<number, MapaQuarto[]>();
    for (const q of this.mapa()) {
      const arr = por.get(q.andar) ?? [];
      arr.push(q);
      por.set(q.andar, arr);
    }
    return [...por.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([andar, quartos]) => ({ andar, quartos }));
  });
  protected readonly janelaInicio = signal<Date>(this.hoje());
  protected readonly dias = computed(() =>
    Array.from({ length: JANELA_DIAS }, (_, i) => this.addDias(this.janelaInicio(), i)),
  );
  protected readonly eventos = signal<ReservaResumo[]>([]);
  protected readonly eventosHoje = signal<ReservaResumo[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly carregandoEventos = signal(false);
  protected readonly pendentesTotal = signal(0);
  protected readonly hojeIso = this.isoLocal(new Date());
  /** "terça-feira, 27 de outubro de 2026" — subtítulo do cabeçalho. */
  protected readonly hojeExtenso = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  /** Eventos agrupados por acomodação — linhas do mapa. */
  protected readonly eventosPorAcom = computed(() => {
    const m = new Map<number, ReservaResumo[]>();
    for (const e of this.eventos()) {
      const l = m.get(e.idacomodacao) ?? [];
      l.push(e);
      m.set(e.idacomodacao, l);
    }
    return m;
  });

  // ---- KPIs -------------------------------------------------------------------
  protected readonly chegadasHoje = computed(
    () =>
      this.eventosHoje().filter(
        (e) => e.entradaprevista.slice(0, 10) === this.hojeIso && e.status === 'p',
      ).length,
  );
  protected readonly saidasHoje = computed(
    () =>
      this.eventosHoje().filter(
        (e) => e.saidaprevista.slice(0, 10) === this.hojeIso && e.status === 'i',
      ).length,
  );
  protected readonly hospedados = computed(
    () => this.eventosHoje().filter((e) => e.status === 'i').length,
  );
  protected readonly pendentes = computed(() => this.pendentesTotal());

  /** Status na paleta da pousada (o STATUS_RESERVA global é do legado). */
  private readonly STATUS: Record<StatusReserva, { rotulo: string; bg: string; fg: string }> = {
    p: { rotulo: 'Pendente', bg: '#eef2f5', fg: '#8a6200' },
    i: { rotulo: 'Hospedado', bg: '#eef2f5', fg: '#1a6f8a' },
    f: { rotulo: 'Finalizado', bg: '#eef2f5', fg: '#40525d' },
    c: { rotulo: 'Cancelada', bg: '#eef2f5', fg: '#7d97a1' },
  };

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido', 'adicional_consumo', 'acomodacao', 'bloqueio');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarKpis();
        if (this.visao() === 'cal') this.carregarEventos();
        if (this.visao() === 'mapa') this.carregarMapa();
        if (this.visao() === 'grupos') this.carregarGrupos();
      }
    });
    this.fBusca.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.recarregar());
    this.range.valueChanges
      .pipe(debounceTime(150), takeUntilDestroyed())
      .subscribe((v) => {
        if (v.inicio && v.fim) this.recarregar();
      });
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarKpis();
    this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
  }

  /** Recarrega a visão ativa + KPIs (botão de refresh do cabeçalho). */
  atualizar(): void {
    this.carregar();
    this.carregarKpis();
    if (this.visao() === 'cal') this.carregarEventos();
    if (this.visao() === 'mapa') this.carregarMapa();
    if (this.visao() === 'grupos') this.carregarGrupos();
  }

  // ---- lista -----------------------------------------------------------------

  carregar(): void {
    this.carregando.set(true);
    const { inicio, fim } = this.range.getRawValue();
    this.reservasApi.listarReservas({
        busca: this.fBusca.value?.trim() || null,
        status: this.fStatus() || null,
        inicio: inicio ? this.isoLocal(inicio) : null,
        fim: fim ? this.isoLocal(fim) : null,
        page: this.pagina(),
        porPagina: 24,
      })
      .subscribe({
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

  recarregar(): void {
    this.pagina.set(1);
    this.carregar();
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregar();
  }

  filtrarStatus(s: StatusReserva | ''): void {
    this.fStatus.set(s);
    this.recarregar();
  }

  limparRange(): void {
    this.range.reset({ inicio: null, fim: null }, { emitEvent: false });
    this.recarregar();
  }

  rangeAtiva(): boolean {
    const v = this.range.getRawValue();
    return !!(v.inicio || v.fim);
  }

  temFiltro(): boolean {
    return !!this.fBusca.value?.trim() || !!this.fStatus() || this.rangeAtiva();
  }

  /** Atalhos dos cartões de KPI — aplicam o filtro correspondente na lista. */
  atalho(k: 'chegadas' | 'saidas' | 'hospedados' | 'pendentes'): void {
    this.visao.set('lista');
    this.fBusca.setValue('', { emitEvent: false });
    const hoje = this.hoje();
    if (k === 'chegadas') {
      this.fStatus.set('p');
      this.range.setValue({ inicio: hoje, fim: hoje }, { emitEvent: false });
    } else if (k === 'saidas') {
      this.fStatus.set('i');
      this.range.setValue({ inicio: hoje, fim: hoje }, { emitEvent: false });
    } else {
      this.fStatus.set(k === 'hospedados' ? 'i' : 'p');
      this.range.reset({ inicio: null, fim: null }, { emitEvent: false });
    }
    this.recarregar();
  }

  novaReserva(): void {
    this.modalNova.set(true);
  }

  reservaCriada(): void {
    this.modalNova.set(false);
    this.notify.ok('Reserva criada.');
    this.carregar();
    this.carregarKpis();
  }

  /** Check-in direto da lista — reservas que chegam hoje. */
  checkin(r: ReservaResumo): void {
    this.aguardando.set(r.id);
    this.reservasApi.checkin(r.id, null, null).subscribe({
      next: () => {
        this.aguardando.set(null);
        this.notify.ok(`Check-in de ${r.cliente_nome} realizado.`);
        this.carregar();
        this.carregarKpis();
      },
      error: (e) => {
        this.aguardando.set(null);
        this.notify.erro(e);
      },
    });
  }

  async excluir(r: ReservaResumo): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a reserva Nº${r.id} de ${r.cliente_nome}? A conta de consumo vinculada também será removida.`,
      { titulo: 'Excluir reserva', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.reservasApi.excluirReserva(r.id).subscribe({
      next: () => {
        this.notify.ok('Reserva excluída.');
        this.carregar();
        this.carregarKpis();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // ---- KPIs / eventos ----------------------------------------------------------

  // ---------- mapa por andar + bloqueio ----------
  carregarMapa(): void {
    this.carregandoMapa.set(true);
    this.reservasApi.mapaQuartos().subscribe({
      next: (m) => {
        this.mapa.set(m);
        this.carregandoMapa.set(false);
      },
      error: () => this.carregandoMapa.set(false),
    });
    this.reservasApi.bloqueios().subscribe({ next: (b) => this.bloqueios.set(b), error: () => undefined });
  }

  statusQuarto(a: MapaQuarto): string {
    if (a.bloqueado) return 'qt-bloq';
    if (a.status_hoje === 'i') return 'qt-ocup';
    if (a.status_hoje === 'p') return 'qt-pend';
    return 'qt-livre';
  }

  bloqueioDe(idacomodacao: number): Bloqueio | undefined {
    const hoje = new Date().toISOString().slice(0, 10);
    return this.bloqueios().find(
      (b) => b.idacomodacao === idacomodacao && b.inicio <= hoje && b.fim >= hoje,
    );
  }

  // ---------- grupos / eventos ----------
  carregarGrupos(): void {
    this.reservasApi.grupos().subscribe({ next: (g) => this.grupos.set(g), error: () => undefined });
    if (!this.acomodacoes().length) {
      this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
        next: (p) => this.acomodacoes.set(p.items),
        error: () => undefined,
      });
    }
  }

  toggleUnidade(id: number): void {
    this.gSel.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  criarGrupo(): void {
    const { inicio, fim } = this.gRange.getRawValue();
    if (!this.gNome.trim() || !inicio || !fim || this.gSel().size === 0) {
      this.notify.aviso('Nome, período e ao menos uma unidade são obrigatórios.');
      return;
    }
    this.salvandoGrupo.set(true);
    this.reservasApi.criarGrupo({
        nome: this.gNome.trim(),
        contato: this.gContato.trim() || null,
        inicio: this.isoLocal(inicio),
        fim: this.isoLocal(fim),
        unidades: [...this.gSel()],
        bloquear: this.gBloquear,
      })
      .subscribe({
        next: () => {
          this.salvandoGrupo.set(false);
          this.gNome = '';
          this.gContato = '';
          this.gSel.set(new Set());
          this.gRange.reset({ inicio: null, fim: null }, { emitEvent: false });
          this.notify.ok('Grupo criado.');
          this.carregarGrupos();
        },
        error: (e) => {
          this.salvandoGrupo.set(false);
          this.notify.erro(e);
        },
      });
  }

  toggleRooming(id: number): void {
    if (this.roomingAberto() === id) {
      this.roomingAberto.set(null);
      return;
    }
    this.roomingAberto.set(id);
    this.reservasApi.grupoUnidades(id).subscribe({
      next: (u) => this.rooming.set(u),
      error: () => this.rooming.set([]),
    });
  }

  async removerGrupo(g: Grupo): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Remover o grupo '${g.nome}'? Os bloqueios vinculados são liberados; reservas permanecem.`,
      { titulo: 'Remover grupo', confirmar: 'Remover' },
    );
    if (!ok) return;
    this.reservasApi.removerGrupo(g.id).subscribe({
      next: () => {
        this.notify.ok('Grupo removido.');
        this.carregarGrupos();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirBloqueio(a: MapaQuarto): void {
    this.bRange.reset({ inicio: null, fim: null }, { emitEvent: false });
    this.bMot = '';
    this.bloqueioAlvo.set(a);
  }

  confirmarBloqueio(): void {
    const a = this.bloqueioAlvo();
    const { inicio, fim } = this.bRange.getRawValue();
    if (!a || !inicio || !fim || this.bMot.trim().length < 3) return;
    this.salvandoBloq.set(true);
    this.reservasApi.bloquear(a.id, this.isoLocal(inicio), this.isoLocal(fim), this.bMot.trim()).subscribe({
      next: () => {
        this.salvandoBloq.set(false);
        this.bloqueioAlvo.set(null);
        this.carregarMapa();
      },
      error: () => this.salvandoBloq.set(false),
    });
  }

  desbloquear(id: number): void {
    this.reservasApi.desbloquear(id).subscribe({ next: () => this.carregarMapa(), error: () => undefined });
  }

  carregarKpis(): void {
    this.reservasApi.eventosReserva(this.hojeIso, this.hojeIso).subscribe({
      next: (ev) => this.eventosHoje.set(ev),
      error: () => undefined,
    });
    this.reservasApi.listarReservas({ status: 'p', porPagina: 1 }).subscribe({
      next: (p) => this.pendentesTotal.set(p.total),
      error: () => undefined,
    });
  }

  // ---- mapa de ocupação ---------------------------------------------------------

  mudarVisao(v: Visao): void {
    this.visao.set(v);
    // Cada visão carrega seus dados sob demanda na primeira abertura.
    if (v === 'cal' && this.eventos().length === 0) this.carregarEventos();
    if (v === 'mapa' && this.mapa().length === 0) this.carregarMapa();
    if (v === 'grupos' && this.grupos().length === 0) this.carregarGrupos();
  }

  nav(d: number): void {
    this.janelaInicio.update((x) => this.addDias(x, d));
    this.carregarEventos();
  }

  irHoje(): void {
    this.janelaInicio.set(this.hoje());
    this.carregarEventos();
  }

  carregarEventos(): void {
    this.carregandoEventos.set(true);
    const ini = this.isoLocal(this.dias()[0]);
    const fim = this.isoLocal(this.addDias(this.dias()[0], JANELA_DIAS));
    this.reservasApi.eventosReserva(ini, fim).subscribe({
      next: (ev) => {
        this.eventos.set(ev);
        this.carregandoEventos.set(false);
      },
      error: (e) => {
        this.carregandoEventos.set(false);
        this.notify.erro(e);
      },
    });
  }

  eventosDe(idacomodacao: number): ReservaResumo[] {
    return this.eventosPorAcom().get(idacomodacao) ?? [];
  }

  /** Geometria da barra no mapa — null quando fora da janela visível. */
  barGeo(r: ReservaResumo): { l: number; w: number } | null {
    const ini = this.parseDia(r.entradaprevista);
    const fim = this.parseDia(r.saidaprevista);
    const jIni = this.janelaInicio();
    const jFim = this.addDias(jIni, JANELA_DIAS);
    if (fim <= jIni || ini >= jFim) return null;
    const s = ini > jIni ? ini : jIni;
    const e = fim < jFim ? fim : jFim;
    const l = ((s.getTime() - jIni.getTime()) / DIA_MS) * COL_W;
    const w = ((e.getTime() - s.getTime()) / DIA_MS) * COL_W - 3;
    return { l, w: Math.max(w, 18) };
  }

  barCor(r: ReservaResumo): string | null {
    return r.status === 'c' ? null : r.acomodacao_cor || '#1a6f8a';
  }

  // ---- helpers ----------------------------------------------------------------

  st(s: StatusReserva): { rotulo: string; bg: string; fg: string } {
    return this.STATUS[s];
  }

  /** 'YYYY-MM-DD' → Date local (meia-noite) — evita o dia anterior do fuso. */
  parseDia(s: string): Date {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  isoLocal(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  hoje(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  addDias(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  noites(r: ReservaResumo): number {
    const ms = this.parseDia(r.saidaprevista).getTime() - this.parseDia(r.entradaprevista).getTime();
    return Math.max(1, Math.round(ms / DIA_MS));
  }

  emCurso(r: ReservaResumo): boolean {
    const ini = r.entradaprevista.slice(0, 10);
    const fim = r.saidaprevista.slice(0, 10);
    return r.status === 'i' && ini <= this.hojeIso && fim > this.hojeIso;
  }

  chegaHoje(r: ReservaResumo): boolean {
    return r.status === 'p' && r.entradaprevista.slice(0, 10) === this.hojeIso;
  }

  iniciais(nome: string): string {
    const partes = nome.trim().split(/\s+/);
    const a = partes[0]?.[0] ?? '?';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  primeiroNome(nome: string): string {
    return nome.trim().split(/\s+/)[0] ?? nome;
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à Central de Reservas!',
          description:
            'A gestão de reservas da pousada em versão profissional — igual aos ' +
            'sistemas dos grandes hotéis. Avance com <b>Próximo</b> e feche no ✕ ou Esc.',
        },
      },
      {
        element: '#tour-kpis',
        popover: {
          title: 'Visão do dia',
          description:
            '<b>Chegadas</b> e <b>saídas</b> previstas para hoje, quem está ' +
            'hospedado e quantas reservas pendentes existem. Clicar num cartão ' +
            'já filtra a lista!',
          side: 'bottom',
        },
      },
      {
        element: '#tour-visao',
        popover: {
          title: 'Quatro visões',
          description:
            '<b>Lista</b> mostra a tabela detalhada · <b>Calendário</b> abre o ' +
            'mapa de ocupação · <b>Mapa</b> mostra os quartos por andar · ' +
            '<b>Grupos</b> gerencia eventos e rooming lists.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-busca',
        popover: {
          title: 'Busca instantânea',
          description:
            'Digite <b>nome do hóspede</b>, <b>acomodação</b> ou <b>nº da ' +
            'reserva</b> — a lista filtra sozinha, sem apertar botão.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-status',
        popover: {
          title: 'Filtro por status',
          description:
            '<b>Pendente</b> = reserva futura · <b>Hospedado</b> = check-in ' +
            'feito · <b>Finalizado</b> = check-out concluído · ' +
            '<b>Cancelada</b> = reserva desfeita.',
          side: 'bottom',
        },
      },
      {
        element: '.rs-range',
        popover: {
          title: 'Filtro por período',
          description:
            'Escolha <b>entrada e saída</b> no calendário para ver só reservas ' +
            'daquele intervalo — ótimo para fechar o mês.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-nova',
        popover: {
          title: 'Nova reserva',
          description:
            'Abre o assistente de reserva: escolha o hóspede, as datas e a ' +
            'acomodação — o sistema já mostra a <b>disponibilidade</b>.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de reservas',
          description:
            'Cada linha mostra hóspede, acomodação, período com <b>noites</b>, ' +
            'diária e status — com selo "em curso" e "chega hoje". Reservas que ' +
            'chegam hoje têm <b>check-in em um clique</b> direto na linha.',
          side: 'top',
        },
      },
      {
        element: 'tr.rs-row .rs-ver',
        skipMissingElement: true,
        popover: {
          title: 'Abrir a reserva',
          description:
            'O <b>olho teal</b> abre a ficha completa: check-in, consumo do ' +
            'frigobar, adicionais e check-out com forma de pagamento.',
          side: 'left',
        },
      },
      {
        popover: {
          title: 'Mapa de ocupação',
          description:
            'No botão <b>Calendário</b> cada barra colorida é uma reserva na ' +
            'cor da acomodação. Clique na barra para abrir a reserva e use ' +
            '‹ › para navegar pelas semanas.',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Você já conhece a Central de Reservas. Para rever, clique no ' +
            'ícone de <b>tutorial</b> no topo a qualquer momento.',
        },
      },
    ]);
  }
}
