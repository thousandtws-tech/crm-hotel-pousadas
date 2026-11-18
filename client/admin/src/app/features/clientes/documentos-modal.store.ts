// Lógica e estado de documentos-modal — separada da camada de UI (documentos-modal.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, input, signal, OnDestroy, OnInit, Directive } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, Validators } from '@angular/forms';
import { ClientesApi } from '@core/api/clientes.api';
import {
  Cliente,
  ClienteDocumento,
  DocumentoInput,
  TIPOS_DOCUMENTO,
  TipoDocumento,
} from '@core/models/clientes.models';
import { Fnrh } from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { Confirm } from '@core/services/confirm.service';
import { imprimirFnrh } from '@shared/utils/fnrh-print';
import type { InputSignal, OutputEmitterRef, Signal } from '@angular/core';

/** Largura máxima da imagem de scan normalizada (upload de arquivo). */
const LARGURA_SCAN = 1600;

const TIPOS = Object.entries(TIPOS_DOCUMENTO) as [TipoDocumento, string][];

/** Campos pertinentes a cada tipo de documento — espelha o que os PMS pedem
 *  (CPF não tem emissor/validade; passaporte pede país, não UF; etc.). */
interface CamposDoc {
  orgao: boolean;
  uf: boolean;
  pais: boolean;
  validade: boolean;
  numLabel: string;
  numPlaceholder: string;
  orgaoPlaceholder: string;
}

const CAMPOS_DOC: Record<TipoDocumento, CamposDoc> = {
  rg: {
    orgao: true,
    uf: true,
    pais: false,
    validade: false,
    numLabel: 'Número do RG',
    numPlaceholder: '00.000.000-0',
    orgaoPlaceholder: 'SSP, IFP…',
  },
  cpf: {
    orgao: false,
    uf: false,
    pais: false,
    validade: false,
    numLabel: 'Número do CPF',
    numPlaceholder: '000.000.000-00',
    orgaoPlaceholder: '',
  },
  cnh: {
    orgao: true,
    uf: true,
    pais: false,
    validade: true,
    numLabel: 'Número da CNH',
    numPlaceholder: 'Registro de 11 dígitos',
    orgaoPlaceholder: 'DETRAN',
  },
  passaporte: {
    orgao: false,
    uf: false,
    pais: true,
    validade: true,
    numLabel: 'Número do passaporte',
    numPlaceholder: 'AA000000',
    orgaoPlaceholder: '',
  },
  rne: {
    orgao: true,
    uf: false,
    pais: true,
    validade: true,
    numLabel: 'Número do RNE/CRNM',
    numPlaceholder: 'V000000-0',
    orgaoPlaceholder: 'Polícia Federal',
  },
  outro: {
    orgao: true,
    uf: true,
    pais: true,
    validade: true,
    numLabel: 'Número do documento',
    numPlaceholder: '',
    orgaoPlaceholder: 'Órgão emissor',
  },
};

@Directive()
export abstract class DocumentosModalStore implements OnInit, OnDestroy {
  declare protected readonly cliente: InputSignal<Cliente>;
  declare protected readonly fechou: OutputEmitterRef<void>;

  private readonly clientesApi = inject(ClientesApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(Confirm);

  protected readonly tipos = TIPOS;
  protected readonly docs = signal<ClienteDocumento[]>([]);
  protected readonly fichas = signal<Fnrh[]>([]);
  protected readonly carregando = signal(true);
  /** Documento em edição no form. */
  protected readonly editando = signal<ClienteDocumento | null>(null);
  /** Documento recebendo scan pela webcam. */
  protected readonly docScan = signal<ClienteDocumento | null>(null);
  /** Documento recebendo scan por arquivo. */
  private readonly alvoArquivo = signal<ClienteDocumento | null>(null);
  /** Scan ampliado (objectURL). */
  protected readonly ampliado = signal<string | null>(null);
  /** Miniaturas dos scans: id do documento → objectURL. */
  protected readonly scans = signal<ReadonlyMap<number, string>>(new Map());

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['rg' as TipoDocumento, Validators.required],
    numero: ['', Validators.required],
    orgao_emissor: [''],
    uf_emissor: [''],
    pais_emissor: [''],
    validade: [''],
  });

  /** Tipo selecionado no form — reage também ao `editar()`/`reset()`. */
  private readonly tipoSel = toSignal(this.form.controls.tipo.valueChanges, {
    initialValue: this.form.controls.tipo.value,
  });
  /** Campos pertinentes ao tipo escolhido (labels, placeholders, visibilidade). */
  protected readonly campos = computed(() => CAMPOS_DOC[this.tipoSel()]);
  /** Já há documento do mesmo tipo (fora o que está em edição)? */
  protected readonly duplicado = computed(() => {
    const ed = this.editando();
    return this.docs().some((d) => d.tipo === this.tipoSel() && d.id !== ed?.id);
  });

  ngOnInit(): void {
    this.clientesApi.listarDocumentos(this.cliente().id).subscribe({
      next: (docs) => {
        this.docs.set(docs);
        this.carregando.set(false);
        this.carregarScans(docs);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
    this.clientesApi.fnrhCliente(this.cliente().id).subscribe({
      next: (f) => this.fichas.set(f),
      error: () => undefined,
    });
  }

  ngOnDestroy(): void {
    for (const url of this.scans().values()) URL.revokeObjectURL(url);
    const ampliado = this.ampliado();
    if (ampliado && !ampliado.startsWith('blob:shared')) URL.revokeObjectURL(ampliado);
  }

  maiuscula(e: Event): void {
    const el = e.target as HTMLInputElement;
    const v = el.value.replace(/[^a-z]/gi, '').toUpperCase();
    if (v !== el.value) this.form.controls.uf_emissor.setValue(v);
  }

  /** Exibição com máscara para CPF/RG; demais tipos como digitados. */
  formatarNumero(d: ClienteDocumento): string {
    const n = d.numero.replace(/\D/g, '');
    if (d.tipo === 'cpf' && n.length === 11)
      return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.tipo === 'rg' && n.length === 9 && /^\d+$/.test(d.numero))
      return n.replace(/(\d{2})(\d{3})(\d{3})(\d)/, '$1.$2.$3-$4');
    return d.numero;
  }

  vencido(d: ClienteDocumento): boolean {
    if (!d.validade) return false;
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    return d.validade.slice(0, 10) < iso;
  }

  rotulo(t: TipoDocumento): string {
    return TIPOS_DOCUMENTO[t] ?? t;
  }

  emissor(d: ClienteDocumento): string {
    return [d.orgao_emissor, d.uf_emissor, d.pais_emissor].filter(Boolean).join('/') || '—';
  }

  editar(d: ClienteDocumento): void {
    this.editando.set(d);
    this.form.reset({
      tipo: d.tipo,
      numero: d.numero,
      orgao_emissor: d.orgao_emissor ?? '',
      uf_emissor: d.uf_emissor ?? '',
      pais_emissor: d.pais_emissor ?? '',
      validade: d.validade ?? '',
    });
  }

  cancelarEdicao(): void {
    this.editando.set(null);
    this.form.reset({ tipo: 'rg', numero: '' });
  }

  salvar(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const c = this.campos();
    const input: DocumentoInput = {
      tipo: v.tipo,
      numero: v.numero.trim(),
      // Campos ocultos para o tipo vão sempre como null — não guarda lixo.
      orgao_emissor: c.orgao ? v.orgao_emissor || null : null,
      uf_emissor: c.uf ? v.uf_emissor || null : null,
      pais_emissor: c.pais ? v.pais_emissor || null : null,
      validade: c.validade ? v.validade || null : null,
      version: this.editando()?.version,
    };
    const ed = this.editando();
    const op = ed
      ? this.clientesApi.atualizarDocumento(ed.id, input)
      : this.clientesApi.criarDocumento(this.cliente().id, input);
    op.subscribe({
      next: (salvo) => {
        this.docs.update((xs) =>
          ed ? xs.map((x) => (x.id === salvo.id ? salvo : x)) : [...xs, salvo],
        );
        this.cancelarEdicao();
        this.notify.ok(ed ? 'Documento atualizado.' : 'Documento adicionado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(d: ClienteDocumento): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o ${this.rotulo(d.tipo)} ${this.formatarNumero(d)}?`,
      {
        titulo: 'Excluir documento',
        confirmar: 'Excluir',
        detalhe: 'O scan vinculado também será apagado.',
      },
    );
    if (!ok) return;
    this.clientesApi.removerDocumento(d.id).subscribe({
      next: () => {
        this.liberarScan(d.id);
        this.docs.update((xs) => xs.filter((x) => x.id !== d.id));
        this.notify.ok('Documento excluído.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- scan -----------------------------------------------------------------

  scanCapturado(d: ClienteDocumento, blob: Blob): void {
    this.docScan.set(null);
    this.enviarScan(d, blob);
  }

  arquivoScan(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const doc = this.alvoArquivo();
    this.alvoArquivo.set(null);
    if (!file || !doc) return;
    // Normaliza para JPEG ≤1600px de largura, mantendo a proporção.
    createImageBitmap(file)
      .then((bmp) => {
        const escala = Math.min(1, LARGURA_SCAN / bmp.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * escala);
        canvas.height = Math.round(bmp.height * escala);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          bmp.close();
          return null;
        }
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close();
        return new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      })
      .then((blob) => {
        if (blob) this.enviarScan(doc, blob);
        else this.notify.aviso('Não foi possível processar a imagem escolhida.');
      })
      .catch(() => this.notify.aviso('Não foi possível ler a imagem escolhida.'));
  }

  async removerScan(d: ClienteDocumento): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover o scan do ${this.rotulo(d.tipo)}?`, {
      titulo: 'Remover scan',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.clientesApi.removerScanDocumento(d.id).subscribe({
      next: () => {
        this.liberarScan(d.id);
        this.docs.update((xs) => xs.map((x) => (x.id === d.id ? { ...x, tem_scan: false } : x)));
        this.notify.ok('Scan removido.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  imprimirFnrh(f: Fnrh): void {
    imprimirFnrh(f);
  }

  // -- internos ---------------------------------------------------------------

  private enviarScan(d: ClienteDocumento, blob: Blob): void {
    this.clientesApi.uploadScanDocumento(d.id, blob).subscribe({
      next: () => {
        this.docs.update((xs) => xs.map((x) => (x.id === d.id ? { ...x, tem_scan: true } : x)));
        this.liberarScan(d.id);
        this.carregarScans([{ ...d, tem_scan: true }]);
        this.notify.ok('Scan salvo.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  private carregarScans(lista: ClienteDocumento[]): void {
    for (const d of lista) {
      if (d.tem_scan && !this.scans().has(d.id)) {
        this.clientesApi.scanDocumento(d.id).subscribe({
          next: (b) =>
            this.scans.update((m) => {
              const n = new Map(m);
              n.set(d.id, URL.createObjectURL(b));
              return n;
            }),
          error: () => undefined,
        });
      }
    }
  }

  private liberarScan(id: number): void {
    const url = this.scans().get(id);
    if (url) URL.revokeObjectURL(url);
    this.scans.update((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
  }
}
