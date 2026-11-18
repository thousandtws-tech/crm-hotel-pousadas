// Lógica e estado de reserva-fiscal — separada da camada de UI (reserva-fiscal.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, inject, signal, Directive } from '@angular/core';
import { FiscalApi } from '@core/api/fiscal.api';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import * as M from '@core/models';
import type { InputSignal, Signal } from '@angular/core';

const ROTULO_STATUS: Record<M.StatusFiscal, { rotulo: string; pill: string }> = {
  rascunho: { rotulo: 'Rascunho', pill: 'pill-off' },
  enfileirada: { rotulo: 'Na fila', pill: 'pill-info' },
  processando: { rotulo: 'Processando', pill: 'pill-info' },
  autorizada: { rotulo: 'Autorizada', pill: 'pill-ok' },
  rejeitada: { rotulo: 'Rejeitada', pill: 'pill-erro' },
  cancelamento_solicitado: { rotulo: 'Cancelamento solicitado', pill: 'pill-warn' },
  cancelada: { rotulo: 'Cancelada', pill: 'pill-off' },
  falha: { rotulo: 'Falha', pill: 'pill-erro' },
};

/**
 * Seção "Notas fiscais" do detalhe da reserva — emissão NFS-e via Spedy:
 * preparar (prévia) → revisar → confirmar (fila) → acompanhar → cancelar.
 * A emissão é assíncrona; o status final vem do webhook ou de "Atualizar".
 */
@Directive()
export abstract class ReservaFiscalStore implements OnInit {
  declare protected readonly idreserva: InputSignal<number>;
  /** Id da reserva — obrigatório. */

  private readonly api = inject(FiscalApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);

  protected readonly docs = signal<M.FiscalDocumento[]>([]);
  protected readonly previa = signal<M.PreparaNfse | null>(null);
  protected readonly carregando = signal(true);
  protected readonly preparando = signal(false);
  protected readonly confirmando = signal(false);
  protected readonly ocupado = signal(false);
  /** Integração configurada/habilitada — inferida quando a API responde. */
  protected readonly integracaoOk = signal(true);

  /** Emitir só faz sentido com a reserva existente e sem nota em andamento. */
  protected readonly podeEmitir = computed(() => {
    const ativos = this.docs().filter((d) => !['cancelada', 'rejeitada'].includes(d.status));
    return !this.previa() && ativos.length === 0;
  });

  ngOnInit(): void {
    this.carregar();
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.api.porReserva(this.idreserva()).subscribe({
      next: (l) => {
        this.docs.set(l);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.integracaoOk.set(false);
      },
    });
  }

  /** Ambiente de emissão — sandbox em homologação, produção em operação. */
  private ambiente(): M.AmbienteIntegracao {
    return 'producao';
  }

  protected preparar(): void {
    this.preparando.set(true);
    this.api.preparar(this.ambiente(), this.idreserva(), {}).subscribe({
      next: (p) => {
        this.preparando.set(false);
        this.previa.set(p);
      },
      error: (e) => {
        this.preparando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected confirmar(): void {
    const p = this.previa();
    if (!p) return;
    this.confirmando.set(true);
    this.api.confirmar(p.iddocumento).subscribe({
      next: () => {
        this.confirmando.set(false);
        this.previa.set(null);
        this.notify.ok('NFS-e enfileirada — o status chega em instantes.');
        this.carregar();
      },
      error: (e) => {
        this.confirmando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected descartar(): void {
    this.previa.set(null);
  }

  protected sincronizar(d: M.FiscalDocumento): void {
    this.ocupado.set(true);
    this.api.sincronizar(d.id).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected reprocessar(d: M.FiscalDocumento): void {
    this.ocupado.set(true);
    this.api.reprocessar(d.id).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Documento reenviado à fila.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected async cancelar(d: M.FiscalDocumento): Promise<void> {
    const ok = await this.confirm.perguntar(
      'O cancelamento é solicitado à prefeitura e pode ser recusado. ' +
        'A reserva e os pagamentos não são alterados.',
      {
        titulo: `Cancelar NFS-e${d.numero_nota ? ' nº ' + d.numero_nota : ''}?`,
        confirmar: 'Solicitar cancelamento',
      },
    );
    if (!ok) return;
    this.ocupado.set(true);
    this.api.cancelar(d.id, 'Cancelamento solicitado pelo operador').subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Cancelamento solicitado — acompanhe o status.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected arquivoUrl(id: number, tipo: 'pdf' | 'xml'): string {
    return this.api.arquivoUrl(id, tipo);
  }

  protected rotuloStatus(s: M.StatusFiscal): string {
    return ROTULO_STATUS[s]?.rotulo ?? s;
  }

  protected pillStatus(s: M.StatusFiscal): string {
    return ROTULO_STATUS[s]?.pill ?? 'pill-off';
  }

  protected tomadorNome(p: M.PreparaNfse): string {
    return (p.tomador['name'] ?? p.tomador['nome'] ?? '—') as string;
  }

  protected tomadorDoc(p: M.PreparaNfse): string {
    const doc = (p.tomador['federalTaxNumber'] ?? p.tomador['documento'] ?? '') as string;
    const email = (p.tomador['email'] ?? '') as string;
    return [doc, email].filter(Boolean).join(' · ');
  }
}
