import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '@core/services/api.service';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import * as M from '@core/models/api.models';

// Réplica de hospedagem/index.php: dois cards lado a lado
// ("Dados da Hospedagem" + "Endereço da Hospedagem") com labels acima
// dos inputs e botão "Gravar" azul; extra: card da impressora térmica.
@Component({
  selector: 'app-estabelecimento',
  imports: [ReactiveFormsModule, MatIconModule],
  template: `
    <div class="page">
      <button class="btn-dark-blue" type="button" (click)="abrirLogo()">
        <mat-icon>edit</mat-icon> Alterar Logo
      </button>

      <div class="row-cards">
        <!-- ===== Dados da Hospedagem ===== -->
        <div class="inner-card">
          <div class="inner-card-header">
            <h4><mat-icon>badge</mat-icon> Dados da Hospedagem</h4>
          </div>
          <div class="inner-card-body">
            <form [formGroup]="dados" class="form">
              <label class="lbl">
                CNPJ
                <input class="input-inn" type="text" formControlName="cnpj" />
              </label>
              <label class="lbl">
                Razão social
                <input class="input-inn" type="text" formControlName="razao_social" />
              </label>
              <label class="lbl">
                E-mail
                <input class="input-inn" type="email" formControlName="email" />
              </label>
              <label class="lbl">
                Site
                <input class="input-inn" type="text" formControlName="site" />
              </label>
              <div class="duo">
                <label class="lbl">
                  Telefone
                  <input class="input-inn" type="text" formControlName="telefone" />
                </label>
                <label class="lbl">
                  Celular
                  <input class="input-inn" type="text" formControlName="celular" />
                </label>
              </div>
              <div class="end">
                <button class="btn-primary" type="button" (click)="salvarDados()" [disabled]="salvando()">
                  <mat-icon>save</mat-icon> Gravar
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- ===== Endereço da Hospedagem ===== -->
        <div class="inner-card">
          <div class="inner-card-header">
            <h4><mat-icon>location_on</mat-icon> Endereço da Hospedagem</h4>
          </div>
          <div class="inner-card-body">
            <form [formGroup]="endereco" class="form">
              <label class="lbl">
                CEP
                <input class="input-inn" type="text" formControlName="cep" />
              </label>
              <label class="lbl">
                Logradouro
                <input class="input-inn" type="text" formControlName="logradouro" />
              </label>
              <div class="num-comp">
                <label class="lbl num">
                  Número
                  <input class="input-inn" type="text" formControlName="numero" />
                </label>
                <label class="lbl comp">
                  Complemento
                  <input class="input-inn" type="text" formControlName="complemento" />
                </label>
              </div>
              <label class="lbl">
                Cidade
                <input class="input-inn" type="text" formControlName="cidade" />
              </label>
              <label class="lbl">
                Bairro
                <input class="input-inn" type="text" formControlName="bairro" />
              </label>
              <div class="end">
                <button class="btn-primary" type="button" (click)="salvarEndereco()" [disabled]="salvando()">
                  <mat-icon>save</mat-icon> Gravar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- ===== Impressoras por setor (roteamento KOT) ===== -->
      <div class="inner-card">
        <div class="inner-card-header imp-head">
          <h4><mat-icon>print</mat-icon> Impressoras por setor</h4>
          <button class="btn-dark-blue" type="button" (click)="abrirImpressora()">
            <mat-icon>add</mat-icon> Nova Impressora
          </button>
        </div>
        <div class="inner-card-body">
          <p class="muted" style="margin: 0 0 10px">
            Comprovantes saem na impressora <strong>padrão</strong>; pedidos de
            consumo saem na impressora do setor da categoria do item.
          </p>
          <div class="tbl-wrap">
            <table class="plain bordered">
              <thead>
                <tr>
                  <th>#</th><th>Nome</th><th>Setor</th><th>IP : Porta</th>
                  <th class="tc">Padrão</th><th class="tc">Status</th><th class="tc">Ação</th>
                </tr>
              </thead>
              <tbody>
                @for (p of impressoras(); track p.id) {
                  <tr>
                    <td>{{ p.id }}</td>
                    <td>{{ p.nome }}</td>
                    <td>{{ p.setor }}</td>
                    <td>{{ p.ip }}:{{ p.porta }}</td>
                    <td class="tc">
                      @if (p.padrao) {
                        <span class="status-chip bg-info">Comprovantes</span>
                      }
                    </td>
                    <td class="tc">
                      <button
                        class="status-chip clickable"
                        [class.on]="p.ativa"
                        [class.off]="!p.ativa"
                        type="button"
                        (click)="statusImpressora(p)"
                      >{{ p.ativa ? 'Ativo' : 'Inativo' }}</button>
                    </td>
                    <td class="tc">
                      <button class="acao bg-print" type="button" title="Testar impressão"
                              (click)="testar(p)"><mat-icon>print</mat-icon></button>
                      <button class="acao bg-warn" type="button" title="Editar"
                              (click)="abrirImpressora(p)"><mat-icon>edit</mat-icon></button>
                      <button class="acao bg-danger" type="button" title="Excluir"
                              (click)="removerImpressora(p)"><mat-icon>delete</mat-icon></button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="muted tc">Nenhuma impressora cadastrada.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== modal Nova/Editar Impressora ===== -->
    @if (modalImp()) {
      <div class="overlay" (click.self)="modalImp.set(false)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Impressora">
          <div class="modal-head">
            <h5>{{ impEditando() ? 'Editar' : 'Nova' }} Impressora</h5>
            <button class="close" type="button" (click)="modalImp.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <form [formGroup]="impForm" class="form">
              <label class="lbl">
                Nome
                <input class="input-inn" type="text" formControlName="nome" placeholder="Cozinha" />
              </label>
              <label class="lbl">
                Setor
                <input class="input-inn" type="text" formControlName="setor" list="setores" placeholder="cozinha" />
                <datalist id="setores">
                  <option value="cozinha"></option><option value="churrasqueira"></option>
                  <option value="bar"></option><option value="balcao"></option><option value="caixa"></option>
                </datalist>
              </label>
              <div class="duo">
                <label class="lbl">
                  IP
                  <input class="input-inn" type="text" formControlName="ip" placeholder="192.168.0.50" />
                </label>
                <label class="lbl">
                  Porta
                  <input class="input-inn" type="number" formControlName="porta" />
                </label>
              </div>
              <label class="lbl check">
                <input type="checkbox" formControlName="padrao" />
                Impressora padrão de comprovantes
              </label>
              <label class="lbl check">
                <input type="checkbox" formControlName="ativa" />
                Ativa
              </label>
              <div class="end" style="margin-top: 4px">
                <button class="btn-green" type="button" [disabled]="salvando()" (click)="salvarImpressora()">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    }

    <!-- ===== modal Alterar Logo (mLogo.php) ===== -->
    @if (modalLogo()) {
      <div class="overlay" (click.self)="modalLogo.set(false)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Alterar logo">
          <div class="modal-head">
            <h5>Alterar Logo</h5>
            <button class="close" type="button" (click)="modalLogo.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <div class="logo-box">
              @if (logoPreview()) {
                <img class="logo-img" [src]="logoPreview()" alt="Logo do estabelecimento" />
              } @else {
                <mat-icon class="logo-ph">image</mat-icon>
              }
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              (change)="selecionarLogo($event)"
              aria-label="Arquivo da logo"
            />
            <small class="muted">PNG, JPG, WEBP ou SVG — máx. 2 MB.</small>
            <div class="end" style="margin-top: 12px">
              <button
                class="btn-green"
                type="button"
                [disabled]="!logoArquivo() || enviando()"
                (click)="enviarLogo()"
              >Salvar</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .row-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 1rem;
      margin: 1rem 0;
    }
    .inner-card-header h4 { display: flex; align-items: center; gap: 6px; }
    .form { display: flex; flex-direction: column; gap: 10px; }
    .form .lbl {
      display: flex; flex-direction: column; gap: 4px;
      font-size: 0.85rem; font-weight: 600; color: #374151;
    }
    .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .num-comp { display: grid; grid-template-columns: 130px 1fr; gap: 10px; }
    .end { display: flex; justify-content: flex-end; }
    .check { flex-direction: row !important; align-items: center; gap: 8px; font-weight: 500 !important; }

    /* impressoras por setor */
    .imp-head { display: flex; align-items: center; justify-content: space-between; }
    .imp-head h4 { display: flex; align-items: center; gap: 6px; }
    .tbl-wrap { overflow-x: auto; }
    .acao {
      border: none; border-radius: 0.2rem; color: #fff; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0.3em 0.55em; margin-right: 4px; transition: 0.15s;
    }
    .acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .acao:hover { filter: brightness(0.9); }
    .bg-print { background: #274259; }
    .bg-warn { background: #ffc107; }
    .bg-danger { background: #dc3545; }
    .status-chip.bg-info { background: #17a2b8; }
    .status-chip.clickable { cursor: pointer; border: none; font-family: inherit; }
    .status-chip.on { background: #28a745; }
    .status-chip.off { background: #dc3545; }

    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(0, 0, 0, 0.5);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 2rem 1rem;
    }
    .modal-inn {
      background: #fff; border-radius: 0.3rem; width: 100%; max-width: 460px;
      box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
      animation: in 0.15s ease-out;
    }
    @keyframes in { from { transform: translateY(-12px); opacity: 0; } }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; border-bottom: 1px solid #dee2e6;
    }
    .modal-head h5 { margin: 0; font-size: 1rem; font-weight: 600; }
    .modal-head .close {
      border: none; background: none; cursor: pointer; color: #555;
      display: inline-flex; padding: 2px;
    }
    .modal-body {
      padding: 1rem; display: flex; flex-direction: column; gap: 8px;
    }
    .logo-box {
      border: 1px dashed #cbd5e1; border-radius: 6px;
      min-height: 120px; display: flex; align-items: center; justify-content: center;
      background: #f8fafc; padding: 12px;
    }
    .logo-img { max-height: 140px; max-width: 100%; }
    .logo-ph { font-size: 48px; width: 48px; height: 48px; color: #94a3b8; }
  `,
})
export class EstabelecimentoComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('impressora', 'categoria_estoque');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregarImpressoras();
      }
    });
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder);

  protected readonly salvando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly modalLogo = signal(false);
  protected readonly logoPreview = signal<string | null>(null);
  protected readonly logoArquivo = signal<File | null>(null);
  protected readonly impressoras = signal<M.Impressora[]>([]);
  protected readonly modalImp = signal(false);
  protected readonly impEditando = signal<M.Impressora | null>(null);

  protected readonly impForm = this.fb.nonNullable.group({
    nome: [''],
    setor: [''],
    ip: [''],
    porta: [9100],
    padrao: [false],
    ativa: [true],
  });

  protected readonly dados = this.fb.nonNullable.group({
    cnpj: [''],
    razao_social: [''],
    site: [''],
    email: [''],
    telefone: [''],
    celular: [''],
    impressora_ip: [''],
    impressora_porta: [9100],
    impressora_ativa: [false],
  });
  private readonly dadosVersion = signal<number | undefined>(undefined);
  private readonly endVersion = signal<number | undefined>(undefined);
  protected readonly endereco = this.fb.nonNullable.group({
    logradouro: [''],
    numero: [''],
    complemento: [''],
    bairro: [''],
    cidade: [''],
    cep: [''],
  });

  ngOnInit(): void {
    this.api.obterEstabelecimento().subscribe({
      next: (e) => {
        this.dadosVersion.set(e.version);
        this.dados.patchValue({
          cnpj: e.cnpj ?? '',
          razao_social: e.razao_social ?? '',
          site: e.site ?? '',
          email: e.email ?? '',
          telefone: e.telefone ?? '',
          celular: e.celular ?? '',
          impressora_ip: e.impressora_ip ?? '',
          impressora_porta: e.impressora_porta ?? 9100,
          impressora_ativa: e.impressora_ativa ?? false,
        });
      },
      error: () => undefined,
    });
    this.carregarImpressoras();
    this.api.obterEndereco().subscribe({
      next: (e) => {
        this.endVersion.set(e.version);
        this.endereco.patchValue({
          logradouro: e.logradouro ?? '',
          numero: e.numero ?? '',
          complemento: e.complemento ?? '',
          bairro: e.bairro ?? '',
          cidade: e.cidade ?? '',
          cep: e.cep ?? '',
        });
      },
      error: () => undefined,
    });
  }

  salvarDados(): void {
    this.salvando.set(true);
    const v = this.dados.getRawValue();
    const empty = (s: string) => s || null;
    this.api
      .salvarEstabelecimento({
        cnpj: empty(v.cnpj),
        razao_social: empty(v.razao_social),
        site: empty(v.site),
        email: empty(v.email),
        telefone: empty(v.telefone),
        celular: empty(v.celular),
        impressora_ip: empty(v.impressora_ip),
        impressora_porta: v.impressora_porta || 9100,
        impressora_ativa: v.impressora_ativa,
        version: this.dadosVersion(),
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.notify.ok('Dados salvos.');
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e);
        },
      });
  }

  salvarEndereco(): void {
    this.salvando.set(true);
    const v = this.endereco.getRawValue();
    const empty = (s: string) => s || null;
    this.api
      .salvarEndereco({
        logradouro: empty(v.logradouro),
        numero: empty(v.numero),
        complemento: empty(v.complemento),
        bairro: empty(v.bairro),
        cidade: empty(v.cidade),
        cep: empty(v.cep),
        version: this.endVersion(),
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.notify.ok('Endereço salvo.');
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e);
        },
      });
  }

  // -- logo -----------------------------------------------------------------

  abrirLogo(): void {
    this.logoArquivo.set(null);
    this.logoPreview.set(null);
    // logo atual via GET /estabelecimento/logo (404 = não configurada)
    this.api.logoAtual().subscribe({
      next: (b) => this.logoPreview.set(URL.createObjectURL(b)),
      error: () => undefined,
    });
    this.modalLogo.set(true);
  }

  selecionarLogo(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.logoArquivo.set(f);
    if (f) {
      URL.revokeObjectURL(this.logoPreview() ?? '');
      this.logoPreview.set(URL.createObjectURL(f));
    }
  }

  enviarLogo(): void {
    const f = this.logoArquivo();
    if (!f) return;
    this.enviando.set(true);
    this.api.uploadLogo(f).subscribe({
      next: () => {
        this.enviando.set(false);
        this.modalLogo.set(false);
        this.notify.ok('Logo atualizada.');
      },
      error: (err) => {
        this.enviando.set(false);
        this.notify.erro(err);
      },
    });
  }

  // -- impressoras por setor --------------------------------------------------

  private carregarImpressoras(): void {
    this.api.listarImpressoras().subscribe({
      next: (l) => this.impressoras.set(l),
      error: () => undefined,
    });
  }

  abrirImpressora(p?: M.Impressora): void {
    this.impEditando.set(p ?? null);
    this.impForm.reset({
      nome: p?.nome ?? '',
      setor: p?.setor ?? '',
      ip: p?.ip ?? '',
      porta: p?.porta ?? 9100,
      padrao: p?.padrao ?? false,
      ativa: p?.ativa ?? true,
    });
    this.modalImp.set(true);
  }

  salvarImpressora(): void {
    const v = this.impForm.getRawValue();
    this.salvando.set(true);
    const edit = this.impEditando();
    const req = edit
      ? this.api.atualizarImpressora(edit.id, { ...v, version: edit.version })
      : this.api.criarImpressora(v);
    req.subscribe({
      next: () => {
        this.salvando.set(false);
        this.modalImp.set(false);
        this.carregarImpressoras();
        this.notify.ok('Impressora salva.');
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  statusImpressora(p: M.Impressora): void {
    this.api.statusImpressora(p.id, !p.ativa).subscribe({
      next: () => this.carregarImpressoras(),
      error: (e) => this.notify.erro(e),
    });
  }

  testar(p: M.Impressora): void {
    this.api.testarImpressora(p.id).subscribe({
      next: () => this.notify.ok(`Ticket de teste enviado para '${p.nome}'.`),
      error: (e) => this.notify.erro(e),
    });
  }

  async removerImpressora(p: M.Impressora): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover a impressora '${p.nome}'?`, {
      titulo: 'Remover impressora',
      confirmar: 'Remover',
      detalhe: 'Categorias roteadas para ela deixarão de imprimir pedidos.',
    });
    if (!ok) return;
    this.api.removerImpressora(p.id).subscribe({
      next: () => {
        this.carregarImpressoras();
        this.notify.ok('Impressora removida.');
      },
      error: (e) => this.notify.erro(e),
    });
  }
}
