// Lógica e estado de integracao-infobip — separada da camada de UI
// (integracao-infobip.component.ts). O componente herda os membros.
import { HttpErrorResponse } from '@angular/common/http';
import { OnInit, computed, effect, inject, input, signal, Directive } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';
import { CAMPOS_POR_PROVEDOR, ROTULO_EVENTO, CampoCredencial, estadoDe } from './integracoes.const';

/** Toggle da matriz pós-reserva — mesmo template do backend. */
export const EVENTOS_SMS = [
  { chave: 'reserva_aguardando', rotulo: 'Reserva aguardando (pendência)' },
  { chave: 'reserva_confirmada', rotulo: 'Reserva confirmada' },
  { chave: 'reserva_cancelada', rotulo: 'Reserva cancelada' },
] as const;

/**
 * Detalhe Infobip (Comunicação, só Produção) — SMS transacional.
 * `api_key` é write-only; `webhook_secret` é gerado pelo servidor na 1ª
 * gravação e compõe o path do DLR (`config.callback_url`). O toggle de
 * eventos decide quais avisos pós-reserva saem por SMS.
 */
@Directive()
export abstract class IntegracaoInfobipStore implements OnInit {
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);

  readonly ambiente = input<M.AmbienteIntegracao>('producao');
  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly eventos = signal<M.EventoIntegracaoView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly falhou = signal(false);
  protected readonly carregandoEventos = signal(false);
  protected readonly salvando = signal(false);
  protected readonly alternando = signal(false);
  protected readonly testando = signal(false);
  protected readonly teste = signal<M.TesteIntegracao | null>(null);
  protected readonly definindo = signal(false);
  protected readonly conflito = signal(false);
  protected readonly limpar = signal<Record<string, boolean>>({});

  protected readonly enviandoMsg = signal(false);
  protected readonly msgErro = signal<string | null>(null);
  protected readonly msgResultado = signal<M.InfobipTesteResultado | null>(null);

  protected readonly campos = CAMPOS_POR_PROVEDOR['infobip'];
  protected readonly eventosSms = EVENTOS_SMS;
  protected readonly estadoDe = estadoDe;

  protected readonly fNomeConta = this.fb.nonNullable.control('');
  protected readonly fBaseUrl = this.fb.nonNullable.control('');
  protected readonly fRemetente = this.fb.nonNullable.control('');
  protected readonly fLimiteSegmentos = this.fb.nonNullable.control('3');
  protected readonly fDestinatarios = this.fb.nonNullable.control('');
  protected readonly fEnvioPausado = this.fb.nonNullable.control(false);
  protected readonly fEventos: Record<string, FormControl<boolean>> = {};
  protected readonly fTelefone = this.fb.nonNullable.control('');
  protected readonly fTextoMsg = this.fb.nonNullable.control('');
  private readonly controles: Record<string, FormControl<string>> = {};

  /** DLR configurado na conta — path carrega o segredo gerado. */
  protected readonly callbackUrl = computed(() => {
    const v = this.i()?.config?.['callback_url'];
    return typeof v === 'string' && v ? v : null;
  });

  constructor() {
    for (const e of EVENTOS_SMS) {
      this.fEventos[e.chave] = this.fb.nonNullable.control(false);
    }
    effect(() => {
      // Infobip só existe em produção — outro ambiente é rota inválida.
      if (this.ambiente() !== 'producao') {
        this.carregando.set(false);
        this.falhou.set(true);
        return;
      }
      this.carregar();
    });
  }

  ngOnInit(): void {
    for (const c of this.campos) {
      this.controles[c.nome] = this.fb.nonNullable.control('');
    }
  }

  protected controle(nome: string): FormControl<string> {
    return this.controles[nome] ?? (this.controles[nome] = this.fb.nonNullable.control(''));
  }

  protected configurado(c: CampoCredencial): boolean {
    return this.i()?.segredos.campos[c.nome] === true;
  }

  protected alternarLimpar(nome: string): void {
    this.limpar.update((m) => ({ ...m, [nome]: !m[nome] }));
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.falhou.set(false);
    this.conflito.set(false);
    this.teste.set(null);
    this.api.buscar('infobip', this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.preencheForm(i);
        this.carregando.set(false);
        this.carregarEventos();
      },
      error: () => {
        this.carregando.set(false);
        this.falhou.set(true);
        this.notify.erroMsg('Falha ao carregar a integração.');
      },
    });
  }

  private preencheForm(i: M.IntegracaoView): void {
    this.fNomeConta.setValue(i.nome_conta ?? '');
    this.fBaseUrl.setValue((i.config?.['base_url'] as string) ?? '');
    this.fRemetente.setValue((i.config?.['remetente'] as string) ?? '');
    const lim = i.config?.['limite_segmentos'];
    this.fLimiteSegmentos.setValue(String(typeof lim === 'number' ? lim : 3));
    this.fEnvioPausado.setValue(i.config?.['envio_pausado'] === true);
    const ev = i.config?.['eventos'];
    for (const e of EVENTOS_SMS) {
      const ativo = ev !== null && typeof ev === 'object' && (ev as Record<string, unknown>)[e.chave] === true;
      this.fEventos[e.chave].setValue(ativo);
    }
    const lista = i.config?.['destinatarios_teste'];
    this.fDestinatarios.setValue(Array.isArray(lista) ? lista.filter((v): v is string => typeof v === 'string').join(', ') : '');
    for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
    this.limpar.set({});
  }

  private atualizarView(): void {
    this.api.buscar('infobip', this.ambiente()).subscribe({
      next: (nova) => this.i.set(nova),
    });
  }

  private carregarEventos(): void {
    this.carregandoEventos.set(true);
    this.api.eventos('infobip', this.ambiente()).subscribe({
      next: (l) => {
        this.eventos.set(l);
        this.carregandoEventos.set(false);
      },
      error: () => this.carregandoEventos.set(false),
    });
  }

  protected salvar(): void {
    const i = this.i();
    if (!i) return;
    const lim = this.limpar();
    const segredos: Record<string, string> = {};
    for (const c of this.campos) {
      const v = this.controle(c.nome).value.trim();
      if (lim[c.nome]) segredos[c.nome] = '';
      else if (v) segredos[c.nome] = v;
    }
    const limite = parseInt(this.fLimiteSegmentos.value, 10);
    const destinatarios = this.fDestinatarios.value
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    const eventos: Record<string, boolean> = {};
    for (const e of EVENTOS_SMS) eventos[e.chave] = this.fEventos[e.chave].value;
    const input: M.IntegracaoInput = {
      versao: i.versao,
      nome_conta: this.fNomeConta.value.trim(),
      config: {
        base_url: this.fBaseUrl.value.trim(),
        remetente: this.fRemetente.value.trim(),
        limite_segmentos: Number.isFinite(limite) ? limite : 3,
        envio_pausado: this.fEnvioPausado.value,
        eventos,
        destinatarios_teste: destinatarios,
      },
    };
    if (Object.keys(segredos).length) input.segredos = segredos;

    this.salvando.set(true);
    this.api.salvar('infobip', i.ambiente, input).subscribe({
      next: (nova) => {
        this.salvando.set(false);
        this.i.set(nova);
        for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
        this.limpar.set({});
        this.notify.ok('Configuração salva.');
      },
      error: (e) => {
        this.salvando.set(false);
        if (e instanceof HttpErrorResponse && e.status === 409) {
          this.conflito.set(true);
          this.notify.aviso(
            'Esta integração foi alterada por outro administrador — recarregue antes de salvar.',
          );
        } else {
          this.notify.erro(e);
        }
      },
    });
  }

  protected testar(): void {
    const i = this.i();
    if (!i) return;
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar('infobip', i.ambiente).subscribe({
      next: (t) => {
        this.testando.set(false);
        this.teste.set(t);
        this.atualizarView();
      },
      error: (e) => {
        this.testando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected enviarTeste(): void {
    const digitos = this.fTelefone.value.replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 15) {
      this.msgErro.set('Informe o telefone com DDI e DDD — 10 a 15 dígitos.');
      return;
    }
    this.msgErro.set(null);
    this.msgResultado.set(null);
    this.enviandoMsg.set(true);
    const input: M.InfobipTesteInput = { telefone: digitos };
    const texto = this.fTextoMsg.value.trim();
    if (texto) input.texto = texto;
    this.api.infobipTeste(this.ambiente(), input).subscribe({
      next: (r) => {
        this.enviandoMsg.set(false);
        this.msgResultado.set(r);
        this.notify.ok(r.enviado ? 'SMS de teste enviado.' : 'SMS aceito — aguardando confirmação.');
      },
      error: (e) => {
        this.enviandoMsg.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected alternarHabilitado(i: M.IntegracaoView): void {
    this.alternando.set(true);
    this.api.habilitacao(i.provedor, i.ambiente, !i.habilitado).subscribe({
      next: (nova) => {
        this.alternando.set(false);
        this.i.set(nova);
        this.notify.ok(nova.habilitado ? 'Integração habilitada.' : 'Integração desabilitada.');
      },
      error: (e) => {
        this.alternando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected definirPadrao(): void {
    const i = this.i();
    if (!i) return;
    this.definindo.set(true);
    this.api.definirPadrao(i.provedor, i.ambiente).subscribe({
      next: () => {
        this.definindo.set(false);
        this.i.update((v) => (v ? { ...v, padrao_site: true } : v));
        this.notify.ok('Conta definida como padrão do canal SMS.');
      },
      error: (e) => {
        this.definindo.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected copiar(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('URL copiada.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }

  protected rotuloStatusEvento(status: string): string {
    return ROTULO_EVENTO[status]?.rotulo ?? status;
  }

  protected pillEvento(status: string): string {
    return ROTULO_EVENTO[status]?.pill ?? 'pill-off';
  }
}
