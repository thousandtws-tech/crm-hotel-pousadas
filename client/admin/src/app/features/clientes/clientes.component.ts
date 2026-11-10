import { Component, inject, signal, OnInit, OnDestroy, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { ApiService } from '@core/services/api.service';
import { Cliente, ClienteInput } from '@core/models/api.models';
import { Confirm } from '@core/services/confirm.service';
import { ExportacaoService, RelatorioCfg } from '@core/services/exportacao.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FotoCaptureComponent } from '@shared/components/foto-capture.component';
import { DocumentosModalComponent } from './documentos-modal.component';

/** Recorte quadrado máximo usado também para normalizar uploads de arquivo. */
const LADO_FOTO = 640;

// -- página --------------------------------------------------------------------

@Component({
  selector: 'app-clientes',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    DatePipe,
    MatPaginatorModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    ReactiveFormsModule,
    DateInputComponent,
    FotoCaptureComponent,
    DocumentosModalComponent,
  ],
  template: `
    <div class="page">
      <div class="cli-head">
        <div class="cli-titulo-grupo">
          <h2 class="cli-titulo">Clientes</h2>
          <span class="cli-contador" title="Total de clientes cadastrados">
            {{ total() }} {{ total() === 1 ? 'hóspede' : 'hóspedes' }}
          </span>
        </div>
        <div class="cli-head-acoes">
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button class="btn-gray" type="button" [matMenuTriggerFor]="menuRel" [disabled]="exportando()">
            <mat-icon>description</mat-icon> Relatório
            <mat-icon class="rel-seta">expand_more</mat-icon>
          </button>
          <mat-menu #menuRel="matMenu" class="menu-rel">
            <button mat-menu-item (click)="exportar('pdf')" id="tour-rel-pdf">
              <mat-icon class="rel-ic ic-pdf">picture_as_pdf</mat-icon>
              <span>PDF <small>documento formatado</small></span>
            </button>
            <button mat-menu-item (click)="exportar('xlsx')">
              <mat-icon class="rel-ic ic-xls">table</mat-icon>
              <span>Excel <small>planilha .xlsx</small></span>
            </button>
            <button mat-menu-item (click)="exportar('doc')">
              <mat-icon class="rel-ic ic-doc">article</mat-icon>
              <span>Word <small>documento .doc</small></span>
            </button>
            <mat-divider />
            <button mat-menu-item (click)="exportar('email')">
              <mat-icon class="rel-ic ic-mail">mail</mat-icon>
              <span>E-mail <small>abre seu app de e-mail</small></span>
            </button>
            <button mat-menu-item (click)="exportar('whats')">
              <mat-icon class="rel-ic ic-whats">chat</mat-icon>
              <span>WhatsApp <small>resumo formatado</small></span>
            </button>
          </mat-menu>
          <button id="tour-novo" class="btn-dark-blue" type="button" (click)="abrirForm()">
            <mat-icon>person_add</mat-icon> Cadastrar Cliente
          </button>
        </div>
      </div>

      <div class="cli-info">
        <div class="cli-info-card">
          <span class="cli-info-icone inf-teal"><mat-icon>badge</mat-icon></span>
          <div class="cli-info-txt">
            <strong>Cadastro completo</strong>
            <p>
              Nome, CPF, contatos, endereço, foto e ficha FNRH de cada hóspede
              reunidos em um só lugar.
            </p>
          </div>
        </div>
        <div class="cli-info-card">
          <span class="cli-info-icone inf-gold"><mat-icon>public</mat-icon></span>
          <div class="cli-info-txt">
            <strong>Hóspedes vindos do site</strong>
            <p>
              Quem reserva pelo site entra aqui automaticamente com o selo
              “Via site” — sem precisar digitar nada.
            </p>
          </div>
        </div>
        <div class="cli-info-card">
          <span class="cli-info-icone inf-navy"><mat-icon>shield</mat-icon></span>
          <div class="cli-info-txt">
            <strong>Exclusão protegida</strong>
            <p>
              Clientes com reservas ou FNRH não podem ser excluídos. Nesse caso,
              basta desativar no selo “Status”.
            </p>
          </div>
        </div>
      </div>

      <div class="inner-card cli-card">
        <div class="cli-toolbar">
          <div id="tour-busca" class="cli-busca" [class.foco]="buscaFoco()">
            <mat-icon class="cli-busca-icone">search</mat-icon>
            <input
              class="cli-busca-input"
              type="search"
              [formControl]="busca"
              placeholder="Buscar por nome, CPF ou e-mail…"
              aria-label="Buscar cliente"
              autocomplete="off"
              role="combobox"
              [attr.aria-expanded]="sugestaoAberta()"
              aria-controls="sug-lista"
              [attr.aria-activedescendant]="
                sugestaoIdx() >= 0 ? 'sug-' + sugestaoIdx() : null
              "
              (focus)="buscaFoco.set(true); reabrirSugestoes()"
              (blur)="fecharSugestoes(); buscaFoco.set(false)"
              (keydown)="teclaBusca($event)"
            />
            @if (busca.value) {
              <button
                type="button"
                class="cli-limpar"
                aria-label="Limpar busca"
                (click)="limparBusca()"
              ><mat-icon>close</mat-icon></button>
            }

            @if (sugestaoAberta()) {
              <div class="sug-dropdown" id="sug-lista" role="listbox">
                @if (buscandoSug()) {
                  @for (s of [1, 2, 3]; track s) {
                    <div class="sug-item sug-skel">
                      <span class="skel skel-avatar"></span>
                      <span class="skel skel-nome" style="margin-left: 0"></span>
                    </div>
                  }
                } @else if (!sugestoes().length) {
                  <div class="sug-vazio">
                    <mat-icon>search_off</mat-icon>
                    <span>Nenhum cliente para “{{ busca.value }}”</span>
                  </div>
                } @else {
                  <div class="sug-titulo">Clientes</div>
                  @for (s of sugestoes(); track s.id; let i = $index) {
                    <button
                      type="button"
                      role="option"
                      id="sug-{{ i }}"
                      class="sug-item"
                      [class.sel]="i === sugestaoIdx()"
                      [attr.aria-selected]="i === sugestaoIdx()"
                      (mousedown)="$event.preventDefault()"
                      (click)="selecionarSugestao(s)"
                    >
                      <span
                        class="avatar-sm sug-avatar"
                        [style.background]="avatarCor(s.id)"
                      >
                        @if (fotos().get(s.id); as url) {
                          <img [src]="url" alt="" />
                        } @else {
                          <span class="avatar-iniciais">{{ iniciais(s.nome) }}</span>
                        }
                      </span>
                      <span class="sug-txt">
                        <strong>
                          {{ partes(s.nome).antes
                          }}<mark>{{ partes(s.nome).meio }}</mark
                          >{{ partes(s.nome).depois }}
                        </strong>
                        <small>{{ s.email || '—' }}</small>
                      </span>
                      <span class="sug-cpf mono">
                        @if (cpfSite(s.cpf)) {
                          Via site
                        } @else {
                          {{ s.cpf }}
                        }
                      </span>
                      <mat-icon class="sug-go">arrow_forward</mat-icon>
                    </button>
                  }
                  <div class="sug-foot">
                    <span>{{ totalSug() }} resultado(s)</span>
                    <span class="sug-dica">↑↓ navegar · Enter abrir · Esc fechar</span>
                  </div>
                }
              </div>
            }
          </div>
          <button
            id="tour-ativos"
            type="button"
            class="cli-toggle"
            [class.on]="apenasAtivos()"
            role="switch"
            [attr.aria-checked]="apenasAtivos()"
            (click)="toggleAtivos(!apenasAtivos())"
          >
            <span class="cli-trilho"><span class="cli-bolinha"></span></span>
            Somente ativos
          </button>
        </div>

        <div id="tour-tabela" class="cli-tabela-wrap">
          <table class="cli-tabela">
            <thead>
              <tr>
                <th class="cli-th-nome">Cliente</th>
                <th>CPF</th>
                <th>Nascimento</th>
                <th>Telefone</th>
                <th class="tc">Status</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td><span class="skel skel-avatar"></span><span class="skel skel-nome"></span></td>
                    <td><span class="skel skel-txt"></span></td>
                    <td><span class="skel skel-txt"></span></td>
                    <td><span class="skel skel-txt"></span></td>
                    <td class="tc"><span class="skel skel-chip"></span></td>
                    <td class="tc"><span class="skel skel-acoes"></span></td>
                  </tr>
                }
              } @else {
                @for (c of items(); track c.id) {
                  <tr class="cli-row">
                    <td>
                      <div class="cli-cell">
                        <span class="avatar-sm" [style.background]="avatarCor(c.id)">
                          @if (fotos().get(c.id); as url) {
                            <img [src]="url" alt="" />
                          } @else {
                            <span class="avatar-iniciais">{{ iniciais(c.nome) }}</span>
                          }
                        </span>
                        <span class="cli-cell-txt">
                          <strong>{{ c.nome }}</strong>
                          <small>{{ c.email || '—' }}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      @if (cpfSite(c.cpf)) {
                        <span class="tag-site" title="Cadastro feito pelo site">
                          <mat-icon>public</mat-icon> Via site
                        </span>
                      } @else {
                        <span class="mono">{{ c.cpf }}</span>
                      }
                    </td>
                    <td>{{ c.data_nascimento | date: 'dd/MM/yyyy' }}</td>
                    <td>{{ c.telefone || '—' }}</td>
                    <td class="tc">
                      <button
                        type="button"
                        class="status-chip badge-toggle"
                        [class.bg-blue]="c.ativo"
                        [class.bg-gray]="!c.ativo"
                        [title]="c.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                        (click)="toggleStatus(c, !c.ativo)"
                      >
                        {{ c.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc cli-acoes">
                      <button
                        type="button"
                        class="badge-acao bg-yellow"
                        title="Editar"
                        aria-label="Editar cliente"
                        (click)="abrirForm(c)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="badge-acao bg-blue"
                        title="Documentos e fichas FNRH"
                        aria-label="Documentos e fichas FNRH"
                        (click)="docsCliente.set(c)"
                      >
                        <mat-icon>badge</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="badge-acao bg-purple"
                        title="Anonimizar dados (LGPD — direito de eliminação)"
                        aria-label="Anonimizar dados do cliente"
                        (click)="anonimizar(c)"
                      >
                        <mat-icon>privacy_tip</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="badge-acao bg-dark-blue"
                        title="Excluir"
                        aria-label="Excluir cliente"
                        (click)="excluir(c)"
                      >
                        <mat-icon>delete</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="cli-vazio">
                      <mat-icon>group_off</mat-icon>
                      <p>
                        {{ busca.value
                          ? 'Nenhum cliente encontrado para "' + busca.value + '".'
                          : 'Nenhum cliente cadastrado ainda.' }}
                      </p>
                      @if (!busca.value) {
                        <button class="btn-dark-blue" type="button" (click)="abrirForm()">
                          <mat-icon>person_add</mat-icon> Cadastrar o primeiro cliente
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
          id="tour-pag"
          [length]="total()"
          [pageSize]="20"
          [pageIndex]="pagina() - 1"
          (page)="mudouPagina($event)"
        />
      </div>
    </div>

    <!-- ============ Drawer Cliente (cadastrar/editar) ============ -->
    @if (modalAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharModal()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-drawer">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-drawer">{{ editando() ? 'Editar cliente' : 'Novo cliente' }}</h5>
              <p>{{ editando() ? 'Atualize os dados do hóspede' : 'Preencha os dados para cadastrar o hóspede' }}</p>
            </div>
            <button type="button" class="drawer-fechar" (click)="fecharModal()" aria-label="Fechar painel">
              <mat-icon>close</mat-icon>
            </button>
          </header>

          <form [formGroup]="form" (ngSubmit)="salvar()" autocomplete="off" class="drawer-form">
            <div class="drawer-body">
              <!-- Foto -->
              <section class="dsec">
                <div class="foto-linha">
                  <div class="avatar-lg">
                    @if (fotoPreview(); as url) {
                      <img [src]="url" alt="Foto do cliente" />
                    } @else {
                      <mat-icon>person</mat-icon>
                    }
                  </div>
                  <div class="foto-acoes">
                    <button type="button" class="btn-dark-blue btn-foto" (click)="capturando.set(true)">
                      <mat-icon>photo_camera</mat-icon> Tirar foto
                    </button>
                    <button type="button" class="btn-gray btn-foto" (click)="arq.click()">
                      <mat-icon>upload</mat-icon> Arquivo
                    </button>
                    @if (fotoPreview() || editando()?.tem_foto) {
                      <button type="button" class="btn-gray btn-foto" (click)="removerFoto()">
                        <mat-icon>delete</mat-icon> Remover
                      </button>
                    }
                  </div>
                  <input #arq type="file" accept="image/*" hidden (change)="arquivoFoto($event)" />
                </div>
              </section>

              <!-- Dados do hóspede -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>person</mat-icon> Dados do hóspede</div>
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="cli-nome">Nome completo <small class="req">*</small></label>
                    <input
                      id="cli-nome" class="input-inn" type="text"
                      formControlName="nome" placeholder="Ex.: Maria da Silva"
                      [class.inval]="invalido('nome')"
                    />
                    @if (invalido('nome')) {
                      <small class="erro-campo">Informe o nome completo.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-cpf">CPF <small class="req">*</small></label>
                    <input
                      id="cli-cpf" class="input-inn" type="text" inputmode="numeric"
                      formControlName="cpf" placeholder="000.000.000-00"
                      (input)="mascaraCpf($event)"
                      [class.inval]="invalido('cpf')"
                    />
                    @if (invalido('cpf')) {
                      <small class="erro-campo">Informe o CPF.</small>
                    }
                  </div>
                  <div class="campo">
                    <span class="lbl" id="lbl-nasc">Data de nascimento <small class="req">*</small></span>
                    <app-date formControlName="data_nascimento" aria-labelledby="lbl-nasc" />
                    @if (invalido('data_nascimento')) {
                      <small class="erro-campo">Informe a data de nascimento.</small>
                    }
                  </div>
                </div>
              </section>

              <!-- Contato -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>call</mat-icon> Contato</div>
                <div class="dgrid">
                  <div class="campo">
                    <label class="lbl" for="cli-email">E-mail</label>
                    <input
                      id="cli-email" class="input-inn" type="email"
                      formControlName="email" placeholder="hospede@email.com"
                    />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-fone">Telefone</label>
                    <input
                      id="cli-fone" class="input-inn" type="tel" inputmode="tel"
                      formControlName="telefone" placeholder="(00) 00000-0000"
                      (input)="mascaraTelefone($event)"
                    />
                  </div>
                </div>
              </section>

              <!-- FNRH / endereço -->
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>badge</mat-icon> Endereço &amp; FNRH</div>
                <p class="dsec-sub">Usados na ficha nacional de registro de hóspedes.</p>
                <div class="dgrid">
                  <div class="campo">
                    <label class="lbl" for="cli-nacio">Nacionalidade</label>
                    <input id="cli-nacio" class="input-inn" type="text" formControlName="nacionalidade" placeholder="Brasileira" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-natu">Naturalidade</label>
                    <input id="cli-natu" class="input-inn" type="text" formControlName="naturalidade" placeholder="Cidade de origem" />
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="cli-prof">Profissão</label>
                    <input id="cli-prof" class="input-inn" type="text" formControlName="profissao" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-cep">CEP</label>
                    <input
                      id="cli-cep" class="input-inn" type="text" inputmode="numeric"
                      formControlName="cep" placeholder="00000-000"
                      (input)="mascaraCep($event)"
                    />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-pais">País</label>
                    <input id="cli-pais" class="input-inn" type="text" formControlName="pais" placeholder="Brasil" />
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="cli-logr">Logradouro</label>
                    <input id="cli-logr" class="input-inn" type="text" formControlName="logradouro" placeholder="Rua, avenida…" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-num">Número</label>
                    <input id="cli-num" class="input-inn" type="text" formControlName="numero" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-compl">Complemento</label>
                    <input id="cli-compl" class="input-inn" type="text" formControlName="complemento" placeholder="Apto, bloco…" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-bairro">Bairro</label>
                    <input id="cli-bairro" class="input-inn" type="text" formControlName="bairro" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-cidade">Cidade</label>
                    <input id="cli-cidade" class="input-inn" type="text" formControlName="cidade" />
                  </div>
                  <div class="campo">
                    <label class="lbl" for="cli-uf">Estado</label>
                    <input id="cli-uf" class="input-inn" type="text" formControlName="estado" placeholder="UF" maxlength="2" />
                  </div>
                </div>
              </section>
            </div>

            <footer class="drawer-foot">
              <span class="drawer-req"><small class="req">*</small> Campos obrigatórios</span>
              <div class="drawer-foot-acoes">
                <button class="btn-gray" type="button" (click)="fecharModal()">Cancelar</button>
                <button class="btn-green" type="submit">
                  <mat-icon>save</mat-icon> {{ editando() ? 'Salvar alterações' : 'Cadastrar cliente' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
    }

    @if (capturando()) {
      <app-foto-capture
        (confirmada)="fotoCapturada($event)"
        (cancelada)="capturando.set(false)"
      />
    }

    @if (docsCliente(); as c) {
      <app-documentos-modal [cliente]="c" (fechou)="docsCliente.set(null)" />
    }
  `,
  styles: `
    /* ---------- cabeçalho da página ---------- */
    .cli-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .cli-titulo-grupo { display: flex; align-items: baseline; gap: 10px; }
    .cli-titulo {
      margin: 0; font-size: 1.35rem; font-weight: 700;
      color: #054054; letter-spacing: -0.01em;
    }
    .cli-contador {
      font-size: 0.78rem; font-weight: 600; color: #1a6f8a;
      background: rgba(26, 111, 138, 0.12);
      border-radius: 999px; padding: 3px 10px; white-space: nowrap;
    }
    .cli-head-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .rel-seta { font-size: 16px !important; width: 16px !important; height: 16px !important; margin-left: 2px; }
    .rel-ic { font-size: 19px !important; width: 19px !important; height: 19px !important; }
    .ic-pdf { color: #c0392b; }
    .ic-xls { color: #1e8449; }
    .ic-doc { color: #2e6da4; }
    .ic-mail { color: #1a6f8a; }
    .ic-whats { color: #25a244; }
    [mat-menu-item] small { display: block; font-size: 0.68rem; color: #8a99a4; font-weight: 400; line-height: 1.3; }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #4b95ab; background: #fff;
      color: #1a6f8a; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600;
      transition: background .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { background: #1a6f8a; color: #fff; border-color: #1a6f8a; }

    /* ---------- banners de informação ---------- */
    .cli-info {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 14px; margin-bottom: 16px;
    }
    .cli-info-card {
      display: flex; align-items: flex-start; gap: 12px;
      background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 15px 16px;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }
    .cli-info-card:hover {
      box-shadow: 0 6px 18px rgba(5, 64, 84, 0.08);
      transform: translateY(-1px);
    }
    .cli-info-icone {
      width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .cli-info-icone mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .inf-teal { background: rgba(26, 111, 138, 0.12); color: #1a6f8a; }
    .inf-gold { background: rgba(221, 165, 84, 0.16); color: #b5811f; }
    .inf-navy { background: rgba(5, 64, 84, 0.1); color: #054054; }
    .cli-info-txt { min-width: 0; }
    .cli-info-txt strong {
      display: block; font-size: 0.9rem; font-weight: 700;
      color: #054054; margin-bottom: 3px;
    }
    .cli-info-txt p {
      margin: 0; font-size: 0.8rem; line-height: 1.5; color: #7d97a1;
    }
    @media (max-width: 960px) { .cli-info { grid-template-columns: 1fr; } }

    /* ---------- toolbar ---------- */
    .cli-card { padding-top: 14px; }
    .cli-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 28px; flex-wrap: wrap; margin-bottom: 18px; padding: 4px 2px;
    }
    .cli-busca {
      position: relative;
      display: flex; align-items: center; gap: 8px;
      flex: 1; min-width: 240px; max-width: 460px;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color 0.15s, box-shadow 0.15s;
      margin-left: 1.3rem;
    }
    .cli-busca.foco {
      border-color: #1a6f8a;
      box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14);
    }
    .cli-busca-icone { color: #7d97a1; font-size: 20px; width: 20px; height: 20px; }
    .cli-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #33424c; font-family: inherit; height: 100%;
    }
    .cli-busca-input::placeholder { color: #8fa3ab; }
    .cli-busca-input::-webkit-search-cancel-button { display: none; }
    .cli-limpar {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .cli-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .cli-limpar:hover { background: #d7e0e6; }

    /* ---------- smart search: dropdown de sugestões ---------- */
    .sug-dropdown {
      position: absolute; top: calc(100% + 8px); left: 0; right: 0;
      min-width: 380px; max-height: 340px; overflow-y: auto;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 12px;
      box-shadow: 0 16px 44px rgba(2, 20, 27, 0.18);
      z-index: 60; padding: 6px;
      animation: sugIn 0.14s ease-out;
    }
    @keyframes sugIn {
      from { opacity: 0; transform: translateY(-4px); }
    }
    .sug-titulo {
      padding: 6px 10px 4px; font-size: 0.68rem; font-weight: 700;
      color: #8fa3ab; text-transform: uppercase; letter-spacing: 0.07em;
    }
    .sug-item {
      display: flex; align-items: center; gap: 12px; width: 100%;
      border: none; background: transparent; border-radius: 8px;
      padding: 8px 10px; cursor: pointer; text-align: left;
      font-family: inherit; transition: background 0.1s;
    }
    .sug-item:hover, .sug-item.sel { background: #eef5f8; }
    .sug-item.sel .sug-go { opacity: 1; color: #1a6f8a; }
    .sug-avatar { width: 36px; height: 36px; }
    .sug-txt {
      display: flex; flex-direction: column; line-height: 1.3;
      min-width: 0; flex: 1;
    }
    .sug-txt strong {
      color: #2c3a44; font-weight: 600; font-size: 0.88rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sug-txt mark {
      background: rgba(221, 165, 84, 0.35); color: #054054;
      border-radius: 3px; padding: 0 1px;
    }
    .sug-txt small { color: #7d97a1; font-size: 0.76rem; }
    .sug-cpf { font-size: 0.78rem; flex-shrink: 0; }
    .sug-go { opacity: 0; font-size: 17px; width: 17px; height: 17px; color: #8fa3ab; }
    .sug-item.skel { cursor: default; }
    .sug-vazio {
      display: flex; align-items: center; gap: 10px;
      padding: 18px 14px; color: #7d97a1; font-size: 0.85rem;
    }
    .sug-vazio mat-icon { color: #c3d2d9; }
    .sug-foot {
      display: flex; align-items: center; justify-content: space-between;
      border-top: 1px solid #eef2f5; margin-top: 4px;
      padding: 8px 10px 4px; font-size: 0.72rem; color: #8fa3ab;
    }
    .sug-dica { letter-spacing: 0.02em; }

    /* ---------- toggle "somente ativos" ---------- */
    .cli-toggle {
      display: inline-flex; align-items: center; gap: 14px;
      border: 1px solid #d7e0e6; background: #fff; border-radius: 999px;
      padding: 8px 20px 8px 12px; font-size: 0.84rem; font-weight: 600;
      color: #5d6d7e; cursor: pointer; font-family: inherit;
      transition: border-color 0.15s, background 0.15s;
      margin-right: 1.3rem;
    }
    .cli-trilho {
      width: 34px; height: 19px; border-radius: 999px;
      background: #c3d2d9; position: relative; transition: background 0.18s;
      flex-shrink: 0;
    }
    .cli-bolinha {
      position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      transition: transform 0.18s;
    }
    .cli-toggle.on { border-color: #1a6f8a; color: #054054; }
    .cli-toggle.on .cli-trilho { background: #1a6f8a; }
    .cli-toggle.on .cli-bolinha { transform: translateX(16px); }

    /* ---------- tabela ---------- */
    .cli-tabela-wrap { overflow-x: auto; border-radius: 8px; min-height: 48vh; }
    .cli-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .cli-tabela thead th {
      position: sticky; top: 0; z-index: 1;
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; text-align: left;
      padding: 14px 14px; border-bottom: 1px solid #d7e0e6;
      white-space: nowrap;
    }
    .cli-tabela tbody td {
      padding: 16px 14px; border-bottom: 1px solid #eef2f5;
      color: #2c3a44; vertical-align: middle; white-space: nowrap;
    }
    .cli-row { transition: background 0.12s; }
    .cli-row:hover { background: #f4f8fa; }
    .cli-row:last-child td { border-bottom: none; }
    .tc { text-align: center; }
    .cli-th-nome { min-width: 240px; }

    .cli-cell { display: flex; align-items: center; gap: 12px; min-width: 220px; }
    .cli-cell-txt { display: flex; flex-direction: column; line-height: 1.3; }
    .cli-cell-txt strong { color: #054054; font-weight: 600; font-size: 0.95rem; }
    .cli-cell-txt small { color: #7d97a1; font-size: 0.8rem; }

    .avatar-sm, .avatar-lg {
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%; overflow: hidden; flex-shrink: 0;
      color: #fff; font-weight: 700;
    }
    .avatar-sm { width: 42px; height: 42px; }
    .avatar-iniciais { font-size: 0.8rem; letter-spacing: 0.02em; }
    .avatar-lg { width: 72px; height: 72px; border: 1px solid #d7e0e6; background: #eef2f5; color: #adb5bd; }
    .avatar-lg mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .avatar-sm img, .avatar-lg img { width: 100%; height: 100%; object-fit: cover; }

    .mono { font-variant-numeric: tabular-nums; color: #40525d; }
    .tag-site {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.72rem; font-weight: 600; color: #1a6f8a;
      background: rgba(26, 111, 138, 0.1);
      border-radius: 999px; padding: 3px 9px;
    }
    .tag-site mat-icon { font-size: 13px; width: 13px; height: 13px; }

    .cli-acoes { white-space: nowrap; }
    .cli-tabela .badge-acao { padding: 0.5em 0.68em; }
    .cli-tabela .badge-acao mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .cli-tabela .status-chip { padding: 6px 14px; font-size: 0.8rem; }

    /* ---------- estado vazio ---------- */
    .cli-vazio {
      text-align: center; padding: 40px 16px !important; color: #7d97a1;
    }
    .cli-vazio mat-icon {
      font-size: 40px; width: 40px; height: 40px;
      color: #c3d2d9; margin-bottom: 8px;
    }
    .cli-vazio p { margin: 0 0 14px; font-size: 0.9rem; }

    /* ---------- skeleton ---------- */
    .skel-row td { border-bottom: 1px solid #eef2f5; }
    .skel {
      display: inline-block; border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #e3eaef 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-avatar { width: 42px; height: 42px; border-radius: 50%; }
    .skel-nome { width: 150px; height: 14px; margin-left: 10px; vertical-align: middle; }
    .skel-txt { width: 90px; height: 13px; }
    .skel-chip { width: 62px; height: 24px; border-radius: 999px; }
    .skel-acoes { width: 110px; height: 26px; }

    /* ---------- drawer lateral ---------- */
    .drawer-backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(5, 32, 43, 0.45);
      animation: fadeIn 0.18s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; } }
    .drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 201;
      width: min(560px, 100vw);
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
      background: #fff; border-bottom: 1px solid #e3eaef;
      flex-shrink: 0;
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
    .dsec-sub { margin: -6px 0 12px; font-size: 0.76rem; color: #8a99a4; }

    .dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
    .dgrid .full { grid-column: 1 / -1; }
    .campo { display: flex; flex-direction: column; gap: 4px; }
    .campo .lbl { font-size: 0.8rem; font-weight: 600; color: #40525d; }
    .campo .req { color: #dc3545; }
    .erro-campo { color: #dc3545; font-size: 0.74rem; font-weight: 500; }
    .input-inn.inval { border-color: #dc3545; box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.12); }

    .drawer-foot {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 13px 22px;
      background: #fff; border-top: 1px solid #e3eaef;
      flex-shrink: 0;
    }
    .drawer-req { font-size: 0.76rem; color: #8a99a4; }
    .drawer-req .req { color: #dc3545; }
    .drawer-foot-acoes { display: flex; gap: 8px; }
    .drawer-foot-acoes .btn-green,
    .drawer-foot-acoes .btn-gray {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 1rem;
    }
    .drawer-foot-acoes mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .foto-linha { display: flex; align-items: center; gap: 14px; }
    .foto-acoes { display: flex; flex-wrap: wrap; gap: 6px; }
    .btn-foto {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 0.3rem 0.6rem; font-size: 0.82rem;
    }
    .btn-foto mat-icon { font-size: 16px; width: 16px; height: 16px; }

    @media (max-width: 640px) {
      .cli-head { flex-direction: column; align-items: stretch; }
      .cli-head-acoes { justify-content: stretch; }
      .cli-head-acoes button { flex: 1; justify-content: center; }
      .cli-busca { max-width: none; }
    }
  `,
})
export class ClientesComponent implements OnInit, OnDestroy {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('cliente');
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
  private readonly api = inject(ApiService);
  private readonly exp = inject(ExportacaoService);
  private readonly notify = inject(Notify);
  private readonly tour = inject(TourGuiado);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<Cliente[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly apenasAtivos = signal(false);
  protected readonly carregando = signal(false);
  protected readonly exportando = signal(false);
  protected readonly busca = this.fb.nonNullable.control('');
  protected readonly buscaFoco = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4, 5, 6];
  protected readonly modalAberto = signal(false);
  protected readonly editando = signal<Cliente | null>(null);
  /** Marca a 1ª tentativa de salvar — exibe os erros inline daí em diante. */
  protected readonly tentouSalvar = signal(false);
  /** Miniaturas da listagem: id → objectURL do blob autenticado. */
  protected readonly fotos = signal<ReadonlyMap<number, string>>(new Map());
  /** Prévia exibida no modal (foto existente ou recém-capturada). */
  protected readonly fotoPreview = signal<string | null>(null);
  /** Foto nova aguardando o Salvar (webcam ou arquivo normalizado). */
  private readonly fotoPendente = signal<Blob | null>(null);
  /** Marca remoção da foto existente ao salvar. */
  private readonly fotoRemover = signal(false);
  protected readonly capturando = signal(false);
  /** Cliente com modal de documentos/FNRH aberto. */
  protected readonly docsCliente = signal<Cliente | null>(null);
  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    cpf: ['', Validators.required],
    data_nascimento: ['', Validators.required],
    email: [''],
    telefone: [''],
    estado: [''],
    cidade: [''],
    nacionalidade: [''],
    naturalidade: [''],
    profissao: [''],
    logradouro: [''],
    numero: [''],
    complemento: [''],
    bairro: [''],
    cep: [''],
    pais: [''],
  });

  ngOnInit(): void {
    this.carregar();
    // busca em tempo real — digita e a lista filtra sozinha (300 ms)
    this.busca.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recarregar());
    // sugestões instantâneas do smart search (150 ms — percebido como imediato)
    this.busca.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.buscarSugestoes(v));
  }

  limparBusca(): void {
    if (this.busca.value) this.busca.setValue('');
    this.sugestaoAberta.set(false);
    this.sugestoes.set([]);
    this.sugestaoIdx.set(-1);
  }

  // -- smart search (sugestões instantâneas) ---------------------------------

  protected readonly sugestaoAberta = signal(false);
  protected readonly sugestoes = signal<Cliente[]>([]);
  protected readonly sugestaoIdx = signal(-1);
  protected readonly buscandoSug = signal(false);
  protected readonly totalSug = signal(0);
  private sugestaoReq = 0;

  private buscarSugestoes(v: string): void {
    const termo = (v ?? '').trim();
    const req = ++this.sugestaoReq;
    if (termo.length < 2) {
      this.sugestaoAberta.set(false);
      this.sugestoes.set([]);
      this.buscandoSug.set(false);
      return;
    }
    this.sugestaoAberta.set(true);
    this.buscandoSug.set(true);
    this.api.listarClientes(termo, 1, 6, this.apenasAtivos()).subscribe({
      next: (p) => {
        if (req !== this.sugestaoReq) return;
        this.sugestoes.set(p.items);
        this.totalSug.set(p.total);
        this.sugestaoIdx.set(-1);
        this.buscandoSug.set(false);
        this.carregarFotos(p.items);
      },
      error: () => {
        if (req === this.sugestaoReq) this.buscandoSug.set(false);
      },
    });
  }

  /** ↓/↑ navega nas sugestões, Enter abre a selecionada, Esc fecha a lista. */
  teclaBusca(e: KeyboardEvent): void {
    const n = this.sugestoes().length;
    if (e.key === 'ArrowDown' && n > 0) {
      e.preventDefault();
      this.sugestaoAberta.set(true);
      this.sugestaoIdx.update((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && n > 0) {
      e.preventDefault();
      this.sugestaoIdx.update((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && this.sugestaoIdx() >= 0) {
      const s = this.sugestoes()[this.sugestaoIdx()];
      if (s) {
        e.preventDefault();
        this.selecionarSugestao(s);
      }
    } else if (e.key === 'Escape') {
      this.sugestaoAberta.set(false);
      this.sugestaoIdx.set(-1);
    }
  }

  /** Reabre a lista ao focar de volta no campo (se já houver sugestões). */
  reabrirSugestoes(): void {
    if ((this.busca.value ?? '').trim().length >= 2 && this.sugestoes().length) {
      this.sugestaoAberta.set(true);
    }
  }

  /** Fecha ao perder o foco — o delay deixa o clique na sugestão acontecer. */
  fecharSugestoes(): void {
    setTimeout(() => this.sugestaoAberta.set(false), 140);
  }

  /** Enter/click numa sugestão abre direto a ficha do cliente (caminho curto). */
  selecionarSugestao(s: Cliente): void {
    this.sugestaoAberta.set(false);
    this.sugestaoIdx.set(-1);
    this.abrirForm(s);
  }

  /** Quebra o texto no trecho que bate com a busca, para o <mark> do template. */
  partes(texto: string): { antes: string; meio: string; depois: string } {
    const t = (this.busca.value ?? '').trim();
    if (!t) return { antes: texto, meio: '', depois: '' };
    const i = texto.toLowerCase().indexOf(t.toLowerCase());
    if (i < 0) return { antes: texto, meio: '', depois: '' };
    return {
      antes: texto.slice(0, i),
      meio: texto.slice(i, i + t.length),
      depois: texto.slice(i + t.length),
    };
  }

  /** Iniciais para o avatar (ex.: "Ana Costa" → "AC"). */
  iniciais(nome: string): string {
    const partes = nome.trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '?';
    const a = partes[0].charAt(0);
    const b = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
    return (a + b).toUpperCase();
  }

  /** Cor estável do avatar a partir do id — tons da paleta da pousada. */
  avatarCor(id: number): string {
    const cores = ['#054054', '#1a6f8a', '#4b95ab', '#b5811f', '#2e7d5b', '#7c5cb8'];
    return cores[id % cores.length];
  }

  /** CPFs gerados automaticamente pelo site (SITE-…) viram selo amigável. */
  cpfSite(cpf: string | null | undefined): boolean {
    return !!cpf && cpf.startsWith('SITE-');
  }

  ngOnDestroy(): void {
    for (const url of this.fotos().values()) URL.revokeObjectURL(url);
    this.liberarPreview();
  }

  carregar(): void {
    this.carregando.set(true);
    this.api
      .listarClientes(this.busca.value || null, this.pagina(), 20, this.apenasAtivos())
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
          this.carregando.set(false);
          this.carregarFotos(p.items);
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

  toggleAtivos(v: boolean): void {
    this.apenasAtivos.set(v);
    this.recarregar();
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregar();
  }

  toggleStatus(c: Cliente, ativo: boolean): void {
    this.api.statusCliente(c.id, ativo).subscribe({
      next: (novo) => {
        this.items.update((xs) => xs.map((x) => (x.id === novo.id ? novo : x)));
        this.notify.ok(ativo ? 'Cliente ativado.' : 'Cliente desativado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** LGPD art. 18 — eliminação: apaga PII mantendo a trilha fiscal/FNRH
   *  que a lei obriga a reter (admin/gerente, confirmado em duas etapas). */
  async anonimizar(c: Cliente): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Anonimizar ${c.nome}? Nome, CPF, contatos e documentos viram dados \
irreversíveis — reservas e FNRH ficam preservadas por obrigação legal. \
Use para pedidos de eliminação do titular.`,
      { titulo: 'Anonimizar titular (LGPD)', confirmar: 'Anonimizar' },
    );
    if (!ok) return;
    this.api.anonimizarCliente(c.id).subscribe({
      next: () => {
        this.notify.ok('Titular anonimizado — dados pessoais removidos.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(c: Cliente): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o cliente ${c.nome}? Documentos e foto serão apagados.`,
      { titulo: 'Excluir cliente', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.api.excluirCliente(c.id).subscribe({
      next: () => {
        this.notify.ok('Cliente excluído.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Monta o relatório respeitando a busca e o filtro atuais e exporta. */
  async exportar(tipo: 'pdf' | 'xlsx' | 'doc' | 'email' | 'whats'): Promise<void> {
    this.exportando.set(true);
    try {
      const p = await new Promise<{ items: Cliente[]; total: number }>(
        (resolve, reject) =>
          this.api
            .listarClientes(this.busca.value || null, 1, 500, this.apenasAtivos())
            .subscribe({ next: resolve, error: reject }),
      );

      const filtro = [
        this.busca.value ? `Busca: "${this.busca.value}"` : null,
        this.apenasAtivos() ? 'Somente ativos' : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const cfg: RelatorioCfg = {
        titulo: 'Relatório de Hóspedes',
        subtitulo: filtro || 'Todos os hóspedes cadastrados',
        nomeArquivo: 'hospedes',
        colunas: ['ID', 'Nome', 'CPF', 'Nascimento', 'E-mail', 'Telefone', 'Cidade/UF', 'Status'],
        linhas: p.items.map((c) => [
          c.id,
          c.nome,
          c.cpf || '—',
          c.data_nascimento
            ? c.data_nascimento.split('-').reverse().join('/')
            : '—',
          c.email ?? '—',
          c.telefone ?? '—',
          [c.cidade, c.estado].filter(Boolean).join('/') || '—',
          c.ativo ? 'Ativo' : 'Inativo',
        ]),
        resumo: [
          { rotulo: 'Hóspedes', valor: String(p.total) },
          { rotulo: 'Na listagem', valor: String(p.items.length) },
        ],
      };

      switch (tipo) {
        case 'pdf':
          await this.exp.pdf(cfg);
          break;
        case 'xlsx':
          await this.exp.excel(cfg);
          break;
        case 'doc':
          this.exp.word(cfg);
          break;
        case 'email':
          this.exp.email(cfg);
          break;
        case 'whats':
          this.exp.whatsapp(cfg);
          break;
      }
    } catch (e) {
      this.notify.erro(e);
    } finally {
      this.exportando.set(false);
    }
  }

  fecharModal(): void {
    this.modalAberto.set(false);
    this.editando.set(null);
    this.fotoPendente.set(null);
    this.fotoRemover.set(false);
    this.tentouSalvar.set(false);
    this.liberarPreview();
    document.body.style.overflow = '';
  }

  /** Esc fecha o drawer (sem fechar modais por cima dele, nem durante o tour). */
  onEsc(): void {
    if (this.tour.ativo()) return;
    if (!this.modalAberto() || this.capturando() || this.docsCliente()) return;
    this.fecharModal();
  }

  /** Tour guiado da tela (driver.js) — abre até o drawer de cadastro. */
  iniciarTour(): void {
    this.tour.iniciar(
      [
        {
          popover: {
            title: 'Bem-vindo à tela de Clientes!',
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
              'Digite parte do <b>nome</b> ou do <b>CPF</b> — a lista filtra sozinha, ' +
              'sem apertar Enter. O ✕ dentro do campo limpa a busca.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-ativos',
          popover: {
            title: 'Somente ativos',
            description:
              'Ligado, a lista mostra apenas hóspedes ativos. Desligado, aparecem todos — ' +
              'inclusive os inativos.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-novo',
          popover: {
            title: 'Cadastrar novo hóspede',
            description:
              'Clique aqui para cadastrar um cliente. Um painel abre à direita com o ' +
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
              'Preencha os dados do hóspede neste painel. Campos com <b>*</b> são obrigatórios ' +
              'e CPF, telefone e CEP ganham formatação automática ao digitar. ' +
              'Conclua em <b>Salvar</b> no rodapé.',
            side: 'left',
            onNextClick: () => {
              this.fecharModal();
              setTimeout(() => this.tour.avancar(), 120);
            },
            onPrevClick: () => {
              this.fecharModal();
              this.tour.voltar();
            },
          },
        },
        {
          element: '#tour-tabela',
          popover: {
            title: 'Lista de clientes',
            description:
              'Cada linha é um hóspede: foto ou iniciais, nome e e-mail, CPF, ' +
              'data de nascimento e telefone.',
            side: 'top',
          },
        },
        {
          element: 'tr.cli-row .badge-toggle',
          skipMissingElement: true,
          popover: {
            title: 'Ativar / desativar',
            description:
              'Clique no selo para mudar o status: <b>teal = Ativo</b>, <b>cinza = Inativo</b>. ' +
              'Clientes inativos não entram em novas reservas.',
            side: 'top',
          },
        },
        {
          element: 'tr.cli-row .cli-acoes',
          skipMissingElement: true,
          popover: {
            title: 'Ações do cliente',
            description:
              '<b>Dourado</b> edita os dados · <b>teal</b> abre os documentos e a ficha ' +
              'FNRH · <b>navy</b> exclui o cadastro (sempre com confirmação).',
            side: 'left',
          },
        },
        {
          element: '#tour-pag',
          popover: {
            title: 'Paginação',
            description:
              'Escolha quantos clientes aparecem por página e navegue com as setas.',
            side: 'top',
          },
        },
        {
          popover: {
            title: 'Pronto!',
            description:
              'Você já conhece a tela de Clientes. Para rever, clique em <b>Tutorial</b> ' +
              'no topo a qualquer momento.',
          },
        },
      ],
      () => {
        if (this.modalAberto()) this.fecharModal();
      },
    );
  }

  abrirForm(cliente?: Cliente): void {
    this.editando.set(cliente ?? null);
    this.fotoPendente.set(null);
    this.fotoRemover.set(false);
    this.tentouSalvar.set(false);
    this.liberarPreview();
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('cli-nome')?.focus(), 260);
    if (cliente?.tem_foto) {
      this.api.fotoCliente(cliente.id).subscribe({
        next: (b) => this.definirPreview(URL.createObjectURL(b)),
        error: () => {},
      });
    }
    this.form.reset({
      nome: cliente?.nome ?? '',
      cpf: cliente?.cpf ?? '',
      data_nascimento: cliente?.data_nascimento ?? '',
      email: cliente?.email ?? '',
      telefone: cliente?.telefone ?? '',
      estado: cliente?.estado ?? '',
      cidade: cliente?.cidade ?? '',
      nacionalidade: cliente?.nacionalidade ?? '',
      naturalidade: cliente?.naturalidade ?? '',
      profissao: cliente?.profissao ?? '',
      logradouro: cliente?.logradouro ?? '',
      numero: cliente?.numero ?? '',
      complemento: cliente?.complemento ?? '',
      bairro: cliente?.bairro ?? '',
      cep: cliente?.cep ?? '',
      pais: cliente?.pais ?? '',
    });
    this.modalAberto.set(true);
  }

  salvar(): void {
    if (this.form.invalid) {
      this.tentouSalvar.set(true);
      this.form.markAllAsTouched();
      const el = document.querySelector('.drawer-body .inval, .drawer-body .ng-invalid input');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.notify.erroMsg('Preencha os campos obrigatórios destacados.');
      return;
    }
    const v = this.form.getRawValue();
    const input: ClienteInput = {
      nome: v.nome,
      cpf: v.cpf,
      data_nascimento: v.data_nascimento,
      email: v.email || null,
      telefone: v.telefone || null,
      estado: v.estado || null,
      cidade: v.cidade || null,
      nacionalidade: v.nacionalidade || null,
      naturalidade: v.naturalidade || null,
      profissao: v.profissao || null,
      logradouro: v.logradouro || null,
      numero: v.numero || null,
      complemento: v.complemento || null,
      bairro: v.bairro || null,
      cep: v.cep || null,
      pais: v.pais || null,
      version: this.editando()?.version,
    };
    const cliente = this.editando();
    const op = cliente
      ? this.api.atualizarCliente(cliente.id, input)
      : this.api.criarCliente(input);
    op.subscribe({
      next: (salvo) => this.persistirFoto(salvo, cliente),
      error: (e) => this.notify.erro(e),
    });
  }

  /** Campo inválido que já foi tocado ou após tentativa de salvar. */
  invalido(campo: string): boolean {
    const c = this.form.get(campo);
    return !!c && c.invalid && (c.touched || this.tentouSalvar());
  }

  // -- máscaras de digitação -------------------------------------------------

  mascaraCpf(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 9) v = d.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
    else if (d.length > 6) v = d.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
    else if (d.length > 3) v = d.replace(/(\d{3})(\d{0,3})/, '$1.$2');
    this.form.controls.cpf.setValue(v, { emitEvent: false });
  }

  mascaraTelefone(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 10) v = d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    else if (d.length > 6) v = d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    else if (d.length > 2) v = d.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    else if (d.length > 0) v = `(${d}`;
    this.form.controls.telefone.setValue(v, { emitEvent: false });
  }

  mascaraCep(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    const v = d.length > 5 ? d.replace(/(\d{5})(\d{0,3})/, '$1-$2') : d;
    this.form.controls.cep.setValue(v, { emitEvent: false });
  }

  // -- foto ---------------------------------------------------------------

  fotoCapturada(blob: Blob): void {
    this.capturando.set(false);
    this.definirPendente(blob);
  }

  /** Normaliza qualquer imagem escolhida para JPEG quadrado ≤ 640px. */
  arquivoFoto(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    createImageBitmap(file)
      .then((bmp) => {
        const lado = Math.min(bmp.width, bmp.height);
        const sx = (bmp.width - lado) / 2;
        const sy = (bmp.height - lado) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = LADO_FOTO;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bmp, sx, sy, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
        bmp.close();
        return new Promise<Blob | null>((r) =>
          canvas.toBlob(r, 'image/jpeg', 0.85),
        );
      })
      .then((blob) => {
        if (blob) this.definirPendente(blob);
        else this.notify.aviso('Não foi possível processar a imagem escolhida.');
      })
      .catch(() => this.notify.aviso('Não foi possível ler a imagem escolhida.'));
  }

  removerFoto(): void {
    this.fotoPendente.set(null);
    this.liberarPreview();
    if (this.editando()?.tem_foto) this.fotoRemover.set(true);
  }

  private definirPendente(blob: Blob): void {
    this.fotoPendente.set(blob);
    this.fotoRemover.set(false);
    this.definirPreview(URL.createObjectURL(blob));
  }

  /** Envia/remove a foto depois do cadastro salvo (precisa do id). */
  private persistirFoto(salvo: Cliente, anterior: Cliente | null): void {
    const pendente = this.fotoPendente();
    const removida = this.fotoRemover();
    const foto$: Observable<unknown> | null = pendente
      ? this.api.uploadFotoCliente(salvo.id, pendente)
      : removida
        ? this.api.removerFotoCliente(salvo.id)
        : null;
    if (!foto$) {
      this.finalizarSalvar(anterior);
      return;
    }
    foto$.subscribe({
      next: () => {
        this.invalidarFoto(salvo.id);
        this.finalizarSalvar(anterior);
      },
      error: () => {
        this.notify.ok(anterior ? 'Cliente atualizado.' : 'Cliente cadastrado.');
        this.notify.aviso('A foto não pôde ser salva — ajuste pelo cadastro.');
        this.fecharModal();
        this.carregar();
      },
    });
  }

  private finalizarSalvar(anterior: Cliente | null): void {
    this.notify.ok(anterior ? 'Cliente atualizado.' : 'Cliente cadastrado.');
    this.fecharModal();
    this.carregar();
  }

  private carregarFotos(lista: Cliente[]): void {
    for (const c of lista) {
      if (c.tem_foto && !this.fotos().has(c.id)) {
        this.api.fotoCliente(c.id).subscribe({
          next: (b) =>
            this.fotos.update((m) => {
              const n = new Map(m);
              n.set(c.id, URL.createObjectURL(b));
              return n;
            }),
          error: () => {},
        });
      }
    }
  }

  private invalidarFoto(id: number): void {
    const url = this.fotos().get(id);
    if (url) URL.revokeObjectURL(url);
    this.fotos.update((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
  }

  private definirPreview(url: string | null): void {
    this.liberarPreview();
    this.fotoPreview.set(url);
  }

  private liberarPreview(): void {
    const url = this.fotoPreview();
    if (url) URL.revokeObjectURL(url);
    this.fotoPreview.set(null);
  }
}
