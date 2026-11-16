import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { EstacionamentoApi } from '@core/api/estacionamento.api';
import { Acomodacao } from '@core/models/catalogo.models';
import { VagaEstacionamento } from '@core/models/estacionamento.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourGuiado } from '@core/services/tour.service';

@Component({
  selector: 'app-estacionamento',
  imports: [ReactiveFormsModule, MatIconModule, MatSelectModule],
  template: `
    <div class="page">
      <div class="est-head">
        <div class="est-titulo-grupo">
          <h2 class="est-titulo">Estacionamento</h2>
          <span class="est-contador" title="Total de vagas cadastradas">
            {{ vagas().length }} {{ vagas().length === 1 ? 'vaga' : 'vagas' }}
          </span>
          <span class="est-livres" title="Vagas sem acomodação vinculada">
            {{ livres() }} {{ livres() === 1 ? 'livre' : 'livres' }}
          </span>
        </div>
        <div class="est-head-acoes">
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
        </div>
      </div>

      <div class="est-info">
        <div class="est-info-card">
          <span class="est-info-icone inf-teal"><mat-icon>local_parking</mat-icon></span>
          <div class="est-info-txt">
            <strong>Uma vaga por acomodação</strong>
            <p>
              Vincule cada vaga a uma acomodação para saber qual quarto está
              usando aquela vaga.
            </p>
          </div>
        </div>
        <div class="est-info-card">
          <span class="est-info-icone inf-gold"><mat-icon>link</mat-icon></span>
          <div class="est-info-txt">
            <strong>Vínculo rápido</strong>
            <p>
              No seletor da linha você troca o dono da vaga na hora — ou deixa
              como <b>Livre</b>.
            </p>
          </div>
        </div>
        <div class="est-info-card">
          <span class="est-info-icone inf-navy"><mat-icon>toggle_on</mat-icon></span>
          <div class="est-info-txt">
            <strong>Desative em vez de excluir</strong>
            <p>
              Vagas inativas não aparecem na hora da reserva. Prefira desativar
              no selo “Status” a excluir.
            </p>
          </div>
        </div>
      </div>

      <div class="inner-card est-card">
        <!-- Cadastro rápido -->
        <form id="tour-form" class="est-form" (submit)="$event.preventDefault(); criar()" autocomplete="off">
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
              ><mat-icon>close</mat-icon></button>
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
                        class="status-chip badge-toggle"
                        [class.bg-blue]="v.ativo"
                        [class.bg-gray]="!v.ativo"
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
                          class="badge-acao bg-dark-blue"
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
                        {{ termo() || apenasAtivas()
                          ? 'Nenhuma vaga encontrada para esses filtros.'
                          : 'Nenhuma vaga cadastrada ainda.' }}
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
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .est-titulo-grupo { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .est-titulo {
      margin: 0; font-size: 1.35rem; font-weight: 700;
      color: #20242c; letter-spacing: -0.01em;
    }
    .est-contador {
      font-size: 0.78rem; font-weight: 600; color: #2457a7;
      background: rgba(36, 87, 167, 0.12);
      border-radius: 999px; padding: 3px 10px; white-space: nowrap;
    }
    .est-livres {
      font-size: 0.78rem; font-weight: 600; color: #b45309;
      background: rgba(180, 83, 9, 0.16);
      border-radius: 999px; padding: 3px 10px; white-space: nowrap;
    }
    .est-head-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
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
    .est-info {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 14px; margin-bottom: 16px;
    }
    .est-info-card {
      display: flex; align-items: flex-start; gap: 12px;
      background: #fff; border: 1px solid #e9ecf0; border-radius: 12px;
      padding: 15px 16px;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }
    .est-info-card:hover {
      box-shadow: 0 6px 18px rgba(61, 69, 82, 0.08);
      transform: translateY(-1px);
    }
    .est-info-icone {
      width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .est-info-icone mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .inf-teal { background: rgba(36, 87, 167, 0.12); color: #2457a7; }
    .inf-gold { background: rgba(180, 83, 9, 0.16); color: #b45309; }
    .inf-navy { background: rgba(61, 69, 82, 0.1); color: #20242c; }
    .est-info-txt { min-width: 0; }
    .est-info-txt strong {
      display: block; font-size: 0.9rem; font-weight: 700;
      color: #20242c; margin-bottom: 3px;
    }
    .est-info-txt p {
      margin: 0; font-size: 0.8rem; line-height: 1.5; color: #66707e;
    }
    .est-info-txt b { color: #3d4552; }
    @media (max-width: 960px) { .est-info { grid-template-columns: 1fr; } }

    /* ---------- cadastro rápido ---------- */
    .est-card { padding-top: 14px; }
    .est-form {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      background: #f5f7fa; border: 1px dashed #cbd2dc;
      border-radius: 10px; padding: 12px 14px; margin-bottom: 16px;
    }
    .est-form-icone {
      width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
      background: rgba(36, 87, 167, 0.12); color: #2457a7;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .est-form-icone mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .est-form-txt { display: flex; flex-direction: column; line-height: 1.25; margin-right: auto; }
    .est-form-txt strong { font-size: 0.9rem; font-weight: 700; color: #20242c; }
    .est-form-txt small { font-size: 0.76rem; color: #66707e; }
    .est-num { width: 170px; }
    .est-form .btn-dark-blue {
      display: inline-flex; align-items: center; gap: 6px;
    }
    .est-form .btn-dark-blue mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* ---------- toolbar ---------- */
    .est-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 28px; flex-wrap: wrap; margin-bottom: 18px; padding: 4px 2px;
    }
    .est-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; min-width: 240px; max-width: 460px;
      background: #fff; border: 1px solid #dde2e8; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .est-busca.foco {
      border-color: #2457a7;
      box-shadow: 0 0 0 3px rgba(36, 87, 167, 0.14);
    }
    .est-busca-icone { color: #66707e; font-size: 20px; width: 20px; height: 20px; }
    .est-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #3d4552; font-family: inherit; height: 100%;
    }
    .est-busca-input::placeholder { color: #66707e; }
    .est-busca-input::-webkit-search-cancel-button { display: none; }
    .est-limpar {
      border: none; background: #f0f2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #55606d;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .est-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .est-limpar:hover { background: #dde2e8; }

    .est-toggle {
      display: inline-flex; align-items: center; gap: 14px;
      border: 1px solid #dde2e8; background: #fff; border-radius: 999px;
      padding: 8px 20px 8px 12px; font-size: 0.84rem; font-weight: 600;
      color: #55606d; cursor: pointer; font-family: inherit;
      transition: border-color 0.15s, background 0.15s;
    }
    .est-trilho {
      width: 34px; height: 19px; border-radius: 999px;
      background: #cbd2dc; position: relative; transition: background 0.18s;
      flex-shrink: 0;
    }
    .est-bolinha {
      position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      transition: transform 0.18s;
    }
    .est-toggle.on { border-color: #2457a7; color: #20242c; }
    .est-toggle.on .est-trilho { background: #2457a7; }
    .est-toggle.on .est-bolinha { transform: translateX(16px); }

    /* ---------- tabela ---------- */
    .est-tabela-wrap { overflow-x: auto; border-radius: 8px; min-height: 36vh; }
    .est-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .est-tabela thead th {
      position: sticky; top: 0; z-index: 1;
      background: #f5f7fa; color: #3d4552;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; text-align: left;
      padding: 14px 14px; border-bottom: 1px solid #dde2e8;
      white-space: nowrap;
    }
    .est-tabela tbody td {
      padding: 16px 14px; border-bottom: 1px solid #f0f2f5;
      color: #3d4552; vertical-align: middle; white-space: nowrap;
    }
    .est-row { transition: background 0.12s; }
    .est-row:hover { background: #f5f7fa; }
    .est-row:last-child td { border-bottom: none; }
    .tc { text-align: center; }
    .est-th-vaga { min-width: 220px; }

    .est-cell { display: flex; align-items: center; gap: 12px; min-width: 180px; }
    .est-vaga-icone {
      width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;
      background: rgba(61, 69, 82, 0.08); color: #20242c;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .est-vaga-icone mat-icon { font-size: 23px; width: 23px; height: 23px; }
    .est-cell-txt { display: flex; flex-direction: column; line-height: 1.3; }
    .est-cell-txt strong { color: #20242c; font-weight: 600; font-size: 0.95rem; }
    .est-cell-txt small { color: #66707e; font-size: 0.8rem; }

    .est-vinc { display: flex; align-items: center; gap: 9px; }
    .est-dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: #cbd2dc; flex-shrink: 0;
    }
    .est-dot.on { background: #2457a7; }

    /* (mat-select estilizado globalmente em styles.css) */

    .est-tabela .badge-acao { padding: 0.5em 0.68em; }
    .est-tabela .badge-acao mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .est-tabela .status-chip { padding: 6px 14px; font-size: 0.8rem; }

    /* ---------- estado vazio ---------- */
    .est-vazio {
      text-align: center; padding: 40px 16px !important; color: #66707e;
    }
    .est-vazio mat-icon {
      font-size: 40px; width: 40px; height: 40px;
      color: #cbd2dc; margin-bottom: 8px;
    }
    .est-vazio p { margin: 0 0 6px; font-size: 0.9rem; }
    .est-vazio-dica { font-size: 0.82rem !important; color: #66707e; }

    /* ---------- skeleton ---------- */
    .skel-row td { border-bottom: 1px solid #f0f2f5; }
    .skel {
      display: inline-block; border-radius: 6px;
      background: linear-gradient(90deg, #f0f2f5 25%, #e9ecf0 50%, #f0f2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-icone { width: 42px; height: 42px; border-radius: 10px; }
    .skel-nome { width: 110px; height: 14px; margin-left: 10px; vertical-align: middle; }
    .skel-sel { width: 200px; height: 38px; border-radius: 8px; }
    .skel-chip { width: 62px; height: 24px; border-radius: 999px; }
    .skel-acoes { width: 40px; height: 26px; }

    @media (max-width: 640px) {
      .est-head { flex-direction: column; align-items: stretch; }
      .est-form-txt { margin-right: 0; }
      .est-num { flex: 1; }
      .est-busca { max-width: none; }
    }
  `,
})
export class EstacionamentoComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('estacionamento', 'acomodacao');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
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
  protected readonly auth = inject(AuthStore);

  protected readonly vagas = signal<VagaEstacionamento[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly carregando = signal(true);
  protected readonly busca = new FormControl('', { nonNullable: true });
  /** Termo da busca já normalizado — alimenta o filtro instantâneo. */
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly apenasAtivas = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4];
  protected readonly numero = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(1),
  ]);

  /** Vagas sem acomodação vinculada — exibidas no selo dourado do cabeçalho. */
  protected readonly livres = computed(
    () => this.vagas().filter((v) => !v.idacomodacao).length,
  );

  /** Filtro instantâneo: número da vaga, nome/número da acomodação ou "livre". */
  protected readonly vagasFiltradas = computed(() => {
    const q = this.termo();
    return this.vagas().filter((v) => {
      if (this.apenasAtivas() && !v.ativo) return false;
      if (!q) return true;
      const acomod = this.acomodacoes().find((a) => a.id === v.idacomodacao);
      return (
        v.numero.toLowerCase().includes(q) ||
        (acomod ? `${acomod.nome} ${acomod.numero}`.toLowerCase().includes(q) : false) ||
        (q === 'livre' && !v.idacomodacao)
      );
    });
  });

  ngOnInit(): void {
    this.carregar();
    this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.estacionamentoApi.listarVagas().subscribe({
      next: (v) => {
        this.vagas.set(v);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  criar(): void {
    const n = this.numero.value;
    if (n == null || n < 1) return;
    this.estacionamentoApi.criarVaga(String(n)).subscribe({
      next: () => {
        this.numero.reset();
        this.notify.ok('Vaga cadastrada.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  vincular(v: VagaEstacionamento, idacomodacao: number | null): void {
    this.estacionamentoApi.vincularVaga(v.id, idacomodacao).subscribe({
      next: () => {
        this.notify.ok('Vínculo atualizado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  status(v: VagaEstacionamento, ativo: boolean): void {
    this.estacionamentoApi.statusVaga(v.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  async remover(v: VagaEstacionamento): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover a vaga ${v.numero}?`, {
      titulo: 'Remover vaga',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.estacionamentoApi.removerVaga(v.id).subscribe({
      next: () => {
        this.notify.ok('Vaga removida.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à tela de Estacionamento!',
          description:
            'Este tour rápido mostra cada parte da tela. Avance com <b>Próximo</b> ' +
            'e feche a qualquer momento no ✕ ou pela tecla Esc.',
        },
      },
      {
        element: '#tour-form',
        popover: {
          title: 'Cadastrar nova vaga',
          description:
            'Digite o <b>número da vaga física</b> e clique em <b>Cadastrar</b>. ' +
            'A vaga entra na lista na hora.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-busca',
        popover: {
          title: 'Busca rápida',
          description:
            'Filtre por <b>número da vaga</b> ou pelo <b>nome da acomodação</b> — ' +
            'a lista filtra sozinha enquanto digita. Dica: digite <b>livre</b> para ' +
            'ver só as vagas sem dono.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-ativas',
        popover: {
          title: 'Somente ativas',
          description:
            'Ligado, a lista mostra apenas vagas ativas. Desligado, aparecem ' +
            'todas — inclusive as inativas.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de vagas',
          description:
            'Cada linha é uma vaga: número, acomodação dona da vaga e o status.',
          side: 'top',
        },
      },
      {
        element: 'tr.est-row .est-vinc',
        skipMissingElement: true,
        popover: {
          title: 'Vincular a uma acomodação',
          description:
            'Use o seletor para escolher qual <b>acomodação</b> fica com a vaga. ' +
            'A bolinha fica <b>teal quando vinculada</b> e cinza quando livre. ' +
            'A troca salva na hora.',
          side: 'top',
        },
      },
      {
        element: 'tr.est-row .badge-toggle',
        skipMissingElement: true,
        popover: {
          title: 'Ativar / desativar',
          description:
            'Clique no selo para mudar o status: <b>teal = Ativo</b>, ' +
            '<b>cinza = Inativo</b>. Vagas inativas não aparecem na hora da reserva.',
          side: 'top',
        },
      },
      {
        element: 'tr.est-row .badge-acao',
        skipMissingElement: true,
        popover: {
          title: 'Excluir vaga',
          description:
            'O botão <b>navy</b> exclui a vaga — sempre pedindo confirmação ' +
            'antes. Disponível apenas para administradores.',
          side: 'left',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Você já conhece a tela de Estacionamento. Para rever, clique em ' +
            '<b>Tutorial</b> no topo a qualquer momento.',
        },
      },
    ]);
  }
}
