import { Component, inject, signal, OnInit, OnDestroy, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@core/services/api.service';
import { Cliente, ClienteInput } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FotoCaptureComponent } from '@shared/components/foto-capture.component';
import { DocumentosModalComponent } from './documentos-modal.component';

/** Recorte quadrado máximo usado também para normalizar uploads de arquivo. */
const LADO_FOTO = 640;

// -- página --------------------------------------------------------------------

@Component({
  selector: 'app-clientes',
  imports: [
    DatePipe,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
    DateInputComponent,
    FotoCaptureComponent,
    DocumentosModalComponent,
  ],
  template: `
    <div class="page">
      <div class="acoes-topo">
        <button class="btn-dark-blue" type="button" (click)="abrirForm()">
          <mat-icon>person_add</mat-icon> Cadastrar Cliente
        </button>
        <button class="btn-gray" type="button" (click)="relatorio()">
          <mat-icon>description</mat-icon> Relatório de clientes
        </button>
      </div>

      <div class="inner-card">
        <div class="inner-card-header"><h4>Clientes</h4></div>
        <div class="inner-card-body">
          <div class="filtros">
            <mat-form-field appearance="outline" class="busca">
              <mat-label>Buscar por nome ou CPF</mat-label>
              <input
                matInput
                [formControl]="busca"
                (keyup.enter)="recarregar()"
              />
              <mat-icon matPrefix>search</mat-icon>
            </mat-form-field>
            <mat-checkbox
              [checked]="apenasAtivos()"
              (change)="toggleAtivos($event.checked)"
            >Somente ativos</mat-checkbox>
          </div>

          @if (carregando()) {
            <div class="center"><mat-spinner diameter="40" /></div>
          }
        <table mat-table [dataSource]="items()">
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>#</th>
            <td mat-cell *matCellDef="let c">{{ c.id }}</td>
          </ng-container>
          <ng-container matColumnDef="nome">
            <th mat-header-cell *matHeaderCellDef>Nome</th>
            <td mat-cell *matCellDef="let c">
              <span class="cli-nome">
                <span class="avatar-sm">
                  @if (fotos().get(c.id); as url) {
                    <img [src]="url" alt="" />
                  } @else {
                    <mat-icon>person</mat-icon>
                  }
                </span>
                {{ c.nome }}
              </span>
            </td>
          </ng-container>
          <ng-container matColumnDef="cpf">
            <th mat-header-cell *matHeaderCellDef>CPF</th>
            <td mat-cell *matCellDef="let c">{{ c.cpf }}</td>
          </ng-container>
          <ng-container matColumnDef="nascimento">
            <th mat-header-cell *matHeaderCellDef>Data de Nascimento</th>
            <td mat-cell *matCellDef="let c">
              {{ c.data_nascimento | date: 'dd/MM/yyyy' }}
            </td>
          </ng-container>
          <ng-container matColumnDef="email">
            <th mat-header-cell *matHeaderCellDef>Email</th>
            <td mat-cell *matCellDef="let c">{{ c.email ?? '—' }}</td>
          </ng-container>
          <ng-container matColumnDef="telefone">
            <th mat-header-cell *matHeaderCellDef>Telefone</th>
            <td mat-cell *matCellDef="let c">{{ c.telefone ?? '—' }}</td>
          </ng-container>
          <ng-container matColumnDef="ativo">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let c">
              <button
                type="button"
                class="status-chip badge-toggle"
                [class.bg-success]="c.ativo"
                [class.bg-danger]="!c.ativo"
                [title]="c.ativo ? 'Desativar' : 'Ativar'"
                (click)="toggleStatus(c, !c.ativo)"
              >
                {{ c.ativo ? 'Ativo' : 'Inativo' }}
              </button>
            </td>
          </ng-container>
          <ng-container matColumnDef="acoes">
            <th mat-header-cell *matHeaderCellDef>Ações</th>
            <td mat-cell *matCellDef="let c">
              <button
                type="button"
                class="badge-acao bg-yellow text-black-50"
                title="Editar"
                (click)="abrirForm(c)"
              >
                <mat-icon>edit</mat-icon>
              </button>
              <button
                type="button"
                class="badge-acao bg-dark-blue"
                title="Documentos e fichas FNRH"
                (click)="docsCliente.set(c)"
              >
                <mat-icon>badge</mat-icon>
              </button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="colunas"></tr>
          <tr mat-row *matRowDef="let row; columns: colunas"></tr>
        </table>
        @if (!carregando() && items().length === 0) {
          <p class="muted center-text">Nenhum cliente encontrado.</p>
        }
        <mat-paginator
          [length]="total()"
          [pageSize]="20"
          [pageIndex]="pagina() - 1"
          (page)="mudouPagina($event)"
        />
        </div>
      </div>
    </div>

    <!-- ============ Modal Cliente (cadastrar/editar) ============ -->
    @if (modalAberto()) {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn modal-md" role="dialog" aria-modal="true" aria-labelledby="titulo-cli">
          <div class="modal-head">
            <h5 id="titulo-cli">{{ editando() ? 'Editar cliente' : 'Novo cliente' }}</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <form [formGroup]="form" (ngSubmit)="salvar()" autocomplete="off">
            <div class="modal-body f-grid">
              <div class="campo full">
                <span class="lbl">Foto do cliente</span>
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
              </div>
              <div class="campo full">
                <label class="lbl" for="cli-nome"> Nome completo <small class="req">*</small> </label>
                <input id="cli-nome" class="input-inn" type="text" formControlName="nome" title="Nome do cliente" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-cpf"> CPF <small class="req">*</small> </label>
                <input id="cli-cpf" class="input-inn" type="text" formControlName="cpf" placeholder="000.000.000-00" title="CPF" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-nasc"> Data de nascimento <small class="req">*</small> </label>
                <app-date formControlName="data_nascimento" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-email"> E-mail </label>
                <input id="cli-email" class="input-inn" type="email" formControlName="email" title="E-mail" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-fone"> Telefone </label>
                <input id="cli-fone" class="input-inn" type="text" formControlName="telefone" title="Telefone" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-uf"> Estado </label>
                <input id="cli-uf" class="input-inn" type="text" formControlName="estado" title="Estado" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-cidade"> Cidade </label>
                <input id="cli-cidade" class="input-inn" type="text" formControlName="cidade" title="Cidade" />
              </div>

              <div class="campo full"><span class="sec-fn">Dados complementares (FNRH)</span></div>
              <div class="campo">
                <label class="lbl" for="cli-nacio"> Nacionalidade </label>
                <input id="cli-nacio" class="input-inn" type="text" formControlName="nacionalidade" title="Nacionalidade" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-natu"> Naturalidade </label>
                <input id="cli-natu" class="input-inn" type="text" formControlName="naturalidade" title="Naturalidade" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-prof"> Profissão </label>
                <input id="cli-prof" class="input-inn" type="text" formControlName="profissao" title="Profissão" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-cep"> CEP </label>
                <input id="cli-cep" class="input-inn" type="text" formControlName="cep" placeholder="00000-000" title="CEP" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-logr"> Logradouro </label>
                <input id="cli-logr" class="input-inn" type="text" formControlName="logradouro" title="Logradouro" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-num"> Número </label>
                <input id="cli-num" class="input-inn" type="text" formControlName="numero" title="Número" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-compl"> Complemento </label>
                <input id="cli-compl" class="input-inn" type="text" formControlName="complemento" title="Complemento" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-bairro"> Bairro </label>
                <input id="cli-bairro" class="input-inn" type="text" formControlName="bairro" title="Bairro" />
              </div>
              <div class="campo">
                <label class="lbl" for="cli-pais"> País </label>
                <input id="cli-pais" class="input-inn" type="text" formControlName="pais" title="País" />
              </div>
              <small class="req">* Obrigatório</small>
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="form.invalid">
                <mat-icon>save</mat-icon> Salvar
              </button>
            </div>
          </form>
        </div>
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
    .filtros { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
    .busca { width: 320px; }
    .center { display: grid; place-items: center; padding: 32px; }
    .center-text { text-align: center; padding: 16px; }
    .cli-nome { display: inline-flex; align-items: center; gap: 8px; }
    .avatar-sm, .avatar-lg {
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%; overflow: hidden; flex-shrink: 0;
      background: #e9ecef; color: #adb5bd;
    }
    .avatar-sm { width: 30px; height: 30px; }
    .avatar-sm mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .avatar-lg { width: 72px; height: 72px; border: 1px solid #dee2e6; }
    .avatar-lg mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .avatar-sm img, .avatar-lg img { width: 100%; height: 100%; object-fit: cover; }
    .sec-fn {
      font-size: 0.85rem; font-weight: 600; color: #374151;
      border-top: 1px solid #dee2e6; padding-top: 10px; display: block;
    }
    .foto-linha { display: flex; align-items: center; gap: 14px; }
    .foto-acoes { display: flex; flex-wrap: wrap; gap: 6px; }
    .btn-foto {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 0.3rem 0.6rem; font-size: 0.82rem;
    }
    .btn-foto mat-icon { font-size: 16px; width: 16px; height: 16px; }
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
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly colunas = [
    'id', 'nome', 'cpf', 'nascimento', 'email', 'telefone', 'ativo', 'acoes',
  ];
  protected readonly items = signal<Cliente[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly apenasAtivos = signal(false);
  protected readonly carregando = signal(false);
  protected readonly busca = this.fb.nonNullable.control('');
  protected readonly modalAberto = signal(false);
  protected readonly editando = signal<Cliente | null>(null);
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

  relatorio(): void {
    this.api
      .listarClientes(this.busca.value || null, 1, 200, this.apenasAtivos())
      .subscribe({
        next: (p) => {
          const cab = 'id;nome;cpf;data_nascimento;email;telefone;cidade;estado;status';
          const linhas = p.items.map((c) =>
            [
              c.id,
              c.nome,
              c.cpf,
              c.data_nascimento,
              c.email ?? '',
              c.telefone ?? '',
              c.cidade ?? '',
              c.estado ?? '',
              c.ativo ? 'Ativo' : 'Inativo',
            ]
              .map((v) => String(v).replaceAll(';', ','))
              .join(';'),
          );
          const blob = new Blob([cab + '\n' + linhas.join('\n')], {
            type: 'text/csv;charset=utf-8',
          });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'clientes.csv';
          a.click();
          URL.revokeObjectURL(a.href);
        },
        error: (e) => this.notify.erro(e),
      });
  }

  fecharModal(): void {
    this.modalAberto.set(false);
    this.editando.set(null);
    this.fotoPendente.set(null);
    this.fotoRemover.set(false);
    this.liberarPreview();
  }

  abrirForm(cliente?: Cliente): void {
    this.editando.set(cliente ?? null);
    this.fotoPendente.set(null);
    this.fotoRemover.set(false);
    this.liberarPreview();
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
    if (this.form.invalid) return;
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
