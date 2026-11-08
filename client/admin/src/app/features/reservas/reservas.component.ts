import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideNativeDateAdapter } from '@angular/material/core';
import { ApiService, num } from '@core/services/api.service';
import { Acomodacao, ReservaResumo, StatusReserva } from '@core/models/api.models';
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
    MatButtonToggleModule,
    MatChipsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    NovaReservaDialogComponent,
  ],
  template: `
    <div class="page">
      <div class="rs-head">
        <div class="rs-titulo-grupo">
          <h2 class="rs-titulo">Reservas</h2>
          <p class="rs-data">{{ hojeExtenso }}</p>
        </div>
        <div class="rs-head-acoes">
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-nova" class="btn-dark-blue" type="button" (click)="novaReserva()">
            <mat-icon>calendar_month</mat-icon> Nova reserva
          </button>
        </div>
      </div>

      <!-- Resumo operacional do dia — recepção de hotel -->
      <div id="tour-kpis" class="rs-resumo">
        <button type="button" class="rs-est" (click)="atalho('chegadas')" title="Ver chegadas previstas para hoje">
          <span class="rs-est-num">{{ chegadasHoje() }}</span>
          <span class="rs-est-lbl"><mat-icon>login</mat-icon> Chegadas hoje</span>
        </button>
        <button type="button" class="rs-est" (click)="atalho('saidas')" title="Ver hospedados com saída hoje">
          <span class="rs-est-num">{{ saidasHoje() }}</span>
          <span class="rs-est-lbl"><mat-icon>logout</mat-icon> Saídas hoje</span>
        </button>
        <button type="button" class="rs-est" (click)="atalho('hospedados')" title="Ver hóspedes na pousada agora">
          <span class="rs-est-num">{{ hospedados() }}</span>
          <span class="rs-est-lbl"><mat-icon>hotel</mat-icon> Hospedados</span>
        </button>
        <button type="button" class="rs-est" (click)="atalho('pendentes')" title="Ver reservas pendentes">
          <span class="rs-est-num">{{ pendentes() }}</span>
          <span class="rs-est-lbl"><mat-icon>schedule</mat-icon> Pendentes</span>
        </button>
        <span class="rs-resumo-info">
          <mat-icon>info</mat-icon> Clique num número para filtrar
        </span>
      </div>

      <div class="inner-card rs-card">
        <div class="rs-toolbar">
          <mat-button-toggle-group
            id="tour-visao"
            class="rs-visao"
            [value]="visao()"
            (change)="mudarVisao($event.value)"
            aria-label="Alternar visualização"
          >
            <mat-button-toggle value="lista">
              <mat-icon>view_list</mat-icon> Lista
            </mat-button-toggle>
            <mat-button-toggle value="cal">
              <mat-icon>calendar_view_week</mat-icon> Calendário
            </mat-button-toggle>
          </mat-button-toggle-group>

          @if (visao() === 'lista') {
            <div id="tour-busca" class="rs-busca" [class.foco]="buscaFoco()">
              <mat-icon class="rs-busca-icone">search</mat-icon>
              <input
                class="rs-busca-input"
                type="search"
                [formControl]="fBusca"
                placeholder="Buscar por hóspede, acomodação ou nº da reserva…"
                aria-label="Buscar reserva"
                autocomplete="off"
                (focus)="buscaFoco.set(true)"
                (blur)="buscaFoco.set(false)"
              />
              @if (fBusca.value) {
                <button
                  type="button"
                  class="rs-limpar"
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
                type="button" class="rs-limpa-range"
                (click)="limparRange()" title="Limpar período"
              >
                <mat-icon>date_range</mat-icon> Limpar período
              </button>
            }
          } @else {
            <div class="rs-nav">
              <button type="button" class="rs-nav-btn" (click)="nav(-7)" aria-label="Voltar 7 dias">
                <mat-icon>chevron_left</mat-icon>
              </button>
              <button type="button" class="rs-nav-hoje" (click)="irHoje()">
                <mat-icon>today</mat-icon> Hoje
              </button>
              <button type="button" class="rs-nav-btn" (click)="nav(7)" aria-label="Avançar 7 dias">
                <mat-icon>chevron_right</mat-icon>
              </button>
              <span class="rs-nav-periodo">
                {{ dias()[0] | date: 'dd/MM' }} — {{ dias()[JANELA_DIAS - 1] | date: 'dd/MM/yyyy' }}
              </span>
            </div>
          }
        </div>

        @if (visao() === 'lista') {
          <mat-chip-listbox
            id="tour-status"
            class="rs-status"
            [value]="fStatus()"
            (change)="filtrarStatus($event.value ?? '')"
            aria-label="Filtrar por status"
          >
            <mat-chip-option value="">Todas</mat-chip-option>
            <mat-chip-option value="p">Pendente</mat-chip-option>
            <mat-chip-option value="i">Hospedado</mat-chip-option>
            <mat-chip-option value="f">Finalizado</mat-chip-option>
            <mat-chip-option value="c">Cancelada</mat-chip-option>
          </mat-chip-listbox>
        }

        <!-- ==================== VISÃO: LISTA ==================== -->
        @if (visao() === 'lista') {
          <div id="tour-tabela" class="rs-tabela-wrap">
            <table class="rs-tabela">
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
                        <div class="rs-cell">
                          <span class="rs-avatar">{{ iniciais(r.cliente_nome) }}</span>
                          <span class="rs-cell-txt">
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
                        <div class="rs-cell">
                          <span
                            class="rs-dot"
                            [style.background]="r.acomodacao_cor || '#8fa3ab'"
                          ></span>
                          <span class="rs-cell-txt">
                            <strong class="rs-acom-nome">{{ r.acomodacao_nome }}</strong>
                            <small>Nº {{ r.acomodacao_numero }}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div class="rs-periodo">
                          <strong>
                            {{ parseDia(r.entradaprevista) | date: 'dd/MM' }}
                            <mat-icon>arrow_forward</mat-icon>
                            {{ parseDia(r.saidaprevista) | date: 'dd/MM/yyyy' }}
                          </strong>
                          <small>
                            {{ noites(r) }} {{ noites(r) === 1 ? 'noite' : 'noites' }}
                            @if (emCurso(r)) { · <b class="rs-hj">em curso</b> }
                            @if (chegaHoje(r)) { · <b class="rs-hj">chega hoje</b> }
                          </small>
                        </div>
                      </td>
                      <td>
                        <span class="rs-valor">R$ {{ num(r.valordiaria) | number: '1.2-2' }}</span>
                        @if (r.valor_estadia !== null) {
                          <small class="rs-total">
                            total R$ {{ num(r.valor_estadia) | number: '1.2-2' }}
                          </small>
                        }
                      </td>
                      <td class="tc">
                        <span
                          class="rs-st"
                          [style.background]="st(r.status).bg"
                          [style.color]="st(r.status).fg"
                        >{{ st(r.status).rotulo }}</span>
                      </td>
                      <td class="tc rs-acoes">
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
                      <td colspan="6" class="rs-vazio">
                        <mat-icon>event_busy</mat-icon>
                        <p>
                          {{ temFiltro()
                            ? 'Nenhuma reserva encontrada para esses filtros.'
                            : 'Nenhuma reserva registrada ainda.' }}
                        </p>
                        @if (!temFiltro()) {
                          <button class="btn-dark-blue" type="button" (click)="novaReserva()">
                            <mat-icon>calendar_month</mat-icon> Criar a primeira reserva
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
                  <div class="tape-vazio">
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
                  <div class="tape-vazio">
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
      </div>
    </div>

    @if (modalNova()) {
      <app-nova-reserva-dialog
        (fechar)="modalNova.set(false)"
        (criada)="reservaCriada()"
      />
    }
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .rs-head {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; margin-bottom: 16px;
      padding-bottom: 14px; border-bottom: 1px solid #e3eaef;
    }
    .rs-titulo-grupo { display: flex; flex-direction: column; gap: 2px; }
    .rs-titulo {
      margin: 0; font-size: 1.5rem; font-weight: 700;
      color: #054054; letter-spacing: -0.015em; line-height: 1.15;
    }
    .rs-data {
      margin: 0; font-size: 0.82rem; color: #7d97a1;
      font-weight: 400; letter-spacing: 0.01em;
    }
    .rs-head-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .rs-head-acoes button { display: inline-flex; align-items: center; gap: 6px; }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #d7e0e6; background: #fff;
      color: #5d6d7e; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600;
      transition: border-color .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { border-color: #1a6f8a; color: #1a6f8a; }

    /* ---------- resumo do dia ---------- */
    .rs-resumo {
      display: flex; align-items: center;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      margin-bottom: 16px; overflow-x: auto;
    }
    .rs-est {
      display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
      padding: 12px 26px; min-width: 148px;
      background: none; border: none; cursor: pointer;
      font-family: inherit; text-align: left;
      border-left: 1px solid #eef2f5;
      transition: background 0.14s ease;
    }
    .rs-est:first-child { border-left: none; }
    .rs-est:hover { background: #f7fafb; }
    .rs-est:hover .rs-est-num { color: #1a6f8a; }
    .rs-est-num {
      font-size: 1.55rem; font-weight: 800; color: #054054;
      line-height: 1; letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      transition: color 0.14s ease;
    }
    .rs-est-lbl {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; font-weight: 600; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap;
    }
    .rs-est-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; color: #a5b6bf; }
    .rs-resumo-info {
      margin-left: auto; padding: 0 20px;
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.72rem; color: #a5b6bf; white-space: nowrap;
    }
    .rs-resumo-info mat-icon { font-size: 14px; width: 14px; height: 14px; }
    @media (max-width: 820px) { .rs-resumo-info { display: none; } }

    /* ---------- toolbar ---------- */
    .rs-card { padding-top: 14px; }
    .rs-toolbar {
      display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
      margin-bottom: 14px; padding: 4px 2px;
    }
    .rs-visao {
      flex-shrink: 0;
      --mat-button-toggle-selected-state-background-color: #1a6f8a;
      --mat-button-toggle-selected-state-text-color: #fff;
      --mat-button-toggle-text-color: #40525d;
      --mat-button-toggle-height: 40px;
    }
    .rs-visao mat-button-toggle mat-icon {
      font-size: 17px; width: 17px; height: 17px; vertical-align: -3px; margin-right: 4px;
    }
    .rs-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; min-width: 220px; max-width: 420px;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .rs-busca.foco {
      border-color: #1a6f8a;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14);
    }
    .rs-busca-icone { color: #7d97a1; font-size: 20px; width: 20px; height: 20px; }
    .rs-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #33424c; font-family: inherit; height: 100%;
    }
    .rs-busca-input::placeholder { color: #8fa3ab; }
    .rs-busca-input::-webkit-search-cancel-button { display: none; }
    .rs-limpar {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .rs-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .rs-limpar:hover { background: #d7e0e6; }
    .rs-range { width: 250px; }
    .rs-limpa-range {
      display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid #d7e0e6; background: #fff; border-radius: 6px;
      padding: 7px 12px; font-size: 0.78rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; font-family: inherit;
    }
    .rs-limpa-range mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .rs-limpa-range:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .rs-status {
      margin-bottom: 12px; display: block;
      --mdc-chip-elevated-container-color: #fff;
      --mdc-chip-elevated-selected-container-color: #1a6f8a;
      --mdc-chip-selected-label-text-color: #fff;
      --mdc-chip-label-text-color: #40525d;
      --mdc-chip-outline-color: #d7e0e6;
    }

    /* nav do calendário */
    .rs-nav { display: inline-flex; align-items: center; gap: 8px; }
    .rs-nav-btn {
      width: 34px; height: 34px; border-radius: 8px;
      border: 1px solid #d7e0e6; background: #fff; cursor: pointer;
      color: #40525d; display: inline-flex; align-items: center; justify-content: center;
      transition: border-color 0.15s, color 0.15s;
    }
    .rs-nav-btn:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .rs-nav-hoje {
      display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid #d7e0e6; background: #fff; border-radius: 8px;
      padding: 7px 14px; font-size: 0.82rem; font-weight: 600; color: #40525d;
      cursor: pointer; font-family: inherit;
    }
    .rs-nav-hoje mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .rs-nav-hoje:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .rs-nav-periodo { font-size: 0.85rem; font-weight: 600; color: #054054; margin-left: 8px; }

    /* ---------- tabela ---------- */
    .rs-tabela-wrap { overflow-x: auto; border-radius: 8px; min-height: 42vh; }
    .rs-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .rs-tabela thead th {
      position: sticky; top: 0; z-index: 1;
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 14px 16px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .rs-tabela tbody td {
      padding: 14px 16px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .rs-tabela tbody tr:hover { background: #f7fafb; }
    .rs-tabela .tc { text-align: center; }
    .rs-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .rs-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.82rem; font-weight: 700; letter-spacing: 0.02em;
    }
    .rs-cell-txt { display: flex; flex-direction: column; min-width: 0; }
    .rs-cell-txt strong {
      font-size: 0.93rem; color: #054054; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 260px;
    }
    .rs-cell-txt small { font-size: 0.75rem; color: #8a99a4; white-space: nowrap; }
    .rs-dot { width: 14px; height: 14px; border-radius: 5px; flex-shrink: 0; }
    .rs-acom-nome { max-width: 180px !important; }
    .rs-periodo { display: flex; flex-direction: column; }
    .rs-periodo strong {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.9rem; color: #33424c; font-weight: 600; white-space: nowrap;
    }
    .rs-periodo strong mat-icon { font-size: 14px; width: 14px; height: 14px; color: #8fa3ab; }
    .rs-periodo small { font-size: 0.74rem; color: #8a99a4; }
    .rs-hj { color: #b5811f; }
    .rs-valor { font-variant-numeric: tabular-nums; font-weight: 600; color: #054054; white-space: nowrap; }
    .rs-total { display: block; font-size: 0.73rem; color: #8a99a4; white-space: nowrap; }
    .rs-st {
      display: inline-block; border-radius: 999px;
      padding: 5px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap;
    }
    .rs-tabela .badge-acao { padding: 0.5em 0.68em; }
    .rs-tabela .badge-acao mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .rs-ver { text-decoration: none; }

    /* ---------- vazio / skeleton ---------- */
    .rs-vazio {
      text-align: center; padding: 40px 16px !important; color: #7d97a1;
    }
    .rs-vazio mat-icon {
      font-size: 40px; width: 40px; height: 40px;
      color: #c3d2d9; margin-bottom: 8px;
    }
    .rs-vazio p { margin: 0 0 14px; font-size: 0.9rem; }
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
    .tape-vazio {
      text-align: center; padding: 40px 16px; color: #7d97a1;
    }
    .tape-vazio mat-icon {
      font-size: 40px; width: 40px; height: 40px; color: #c3d2d9;
    }

    @media (max-width: 700px) {
      .rs-head { flex-direction: column; align-items: stretch; }
      .rs-head-acoes { justify-content: stretch; }
      .rs-head-acoes button { flex: 1; justify-content: center; }
      .rs-busca { max-width: none; }
      .rs-range { width: 100%; }
    }
  `,
})
export class ReservasComponent implements OnInit {
  protected readonly JANELA_DIAS = JANELA_DIAS;
  private readonly rt = inject(Realtime);
  private readonly api = inject(ApiService);
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
  protected readonly num = num;
  protected readonly skel = [1, 2, 3, 4, 5, 6];
  protected readonly buscaFoco = signal(false);

  protected readonly fBusca = new FormControl('', { nonNullable: true });
  protected readonly fStatus = signal<StatusReserva | ''>('');
  protected readonly range = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });

  // ---- mapa de ocupação -------------------------------------------------------
  protected readonly visao = signal<'lista' | 'cal'>('lista');
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
    p: { rotulo: 'Pendente', bg: '#b5811f', fg: '#3d2c10' },
    i: { rotulo: 'Hospedado', bg: '#4b95ab', fg: '#fff' },
    f: { rotulo: 'Finalizado', bg: '#1a6f8a', fg: '#fff' },
    c: { rotulo: 'Cancelada', bg: '#7d97a1', fg: '#fff' },
  };

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido', 'adicional_consumo', 'acomodacao');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarKpis();
        if (this.visao() === 'cal') this.carregarEventos();
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
    this.api.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
  }

  // ---- lista -----------------------------------------------------------------

  carregar(): void {
    this.carregando.set(true);
    const { inicio, fim } = this.range.getRawValue();
    this.api
      .listarReservas({
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

  async excluir(r: ReservaResumo): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a reserva Nº${r.id} de ${r.cliente_nome}? A conta de consumo vinculada também será removida.`,
      { titulo: 'Excluir reserva', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.api.excluirReserva(r.id).subscribe({
      next: () => {
        this.notify.ok('Reserva excluída.');
        this.carregar();
        this.carregarKpis();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // ---- KPIs / eventos ----------------------------------------------------------

  carregarKpis(): void {
    this.api.eventosReserva(this.hojeIso, this.hojeIso).subscribe({
      next: (ev) => this.eventosHoje.set(ev),
      error: () => undefined,
    });
    this.api.listarReservas({ status: 'p', porPagina: 1 }).subscribe({
      next: (p) => this.pendentesTotal.set(p.total),
      error: () => undefined,
    });
  }

  // ---- mapa de ocupação ---------------------------------------------------------

  mudarVisao(v: 'lista' | 'cal'): void {
    this.visao.set(v);
    if (v === 'cal' && this.eventos().length === 0) this.carregarEventos();
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
    this.api.eventosReserva(ini, fim).subscribe({
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
          title: 'Bem-vindo à tela de Reservas!',
          description:
            'A recepção da pousada em versão profissional — igual aos sistemas ' +
            'dos grandes hotéis. Avance com <b>Próximo</b> e feche no ✕ ou Esc.',
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
          title: 'Duas visões',
          description:
            '<b>Lista</b> mostra a tabela detalhada · <b>Calendário</b> abre o ' +
            'mapa de ocupação, aquele quadro de barras dos grandes hotéis.',
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
            'diária e status — com selo "em curso" e "chega hoje".',
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
            'Você já conhece a tela de Reservas. Para rever, clique em ' +
            '<b>Tutorial</b> no topo a qualquer momento.',
        },
      },
    ]);
  }
}
