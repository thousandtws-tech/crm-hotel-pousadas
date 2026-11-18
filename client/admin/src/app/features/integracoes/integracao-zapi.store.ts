// Lógica e estado de integracao-zapi — separada da camada de UI (integracao-zapi.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { HttpErrorResponse } from '@angular/common/http';
import { OnInit, computed, effect, inject, input, signal, Directive } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  ROTULO_EVENTO,
  CampoCredencial,
  callbacksEsperados,
  estadoDe,
  instanceIdZapi,
  rotuloEventoZapi,
  sessaoZapi,
  webhooksConfigurados,
} from './integracoes.const';

/**
 * Detalhe Z-API (categoria Comunicação, só Produção) — WhatsApp Business.
 * Dois estados independentes convivem aqui: a integração credenciada
 * (estado efetivo) e a sessão pareada do WhatsApp (`config.sessao`).
 * Segredos são write-only; `webhook_segredo` é gerado pelo servidor.
 */
@Directive()
export abstract class IntegracaoZapiStore implements OnInit {
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);

  /** `:ambiente` da rota — via withComponentInputBinding. Só 'producao' é válido. */
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
  /** 409 do PUT — outro admin salvou depois do nosso carregamento. */
  protected readonly conflito = signal(false);
  /** campos marcados para remoção — enviam `""` no PUT. */
  protected readonly limpar = signal<Record<string, boolean>>({});

  /** Área do QR — aberta por ação manual, polling também manual. */
  protected readonly qrAberto = signal(false);
  protected readonly qrCarregando = signal(false);
  protected readonly qr = signal<M.ZapiQrCode | null>(null);
  protected readonly qrErro = signal<string | null>(null);
  protected readonly configurandoWh = signal(false);
  protected readonly whResultado = signal<number | null>(null);
  protected readonly enviandoMsg = signal(false);
  protected readonly msgErro = signal<string | null>(null);
  protected readonly msgResultado = signal<M.ZapiTesteResultado | null>(null);
  protected readonly desconectando = signal(false);

  protected readonly campos = CAMPOS_POR_PROVEDOR['zapi'];
  protected readonly estadoDe = estadoDe;

  protected readonly fNomeConta = this.fb.nonNullable.control('');
  protected readonly fInstanceId = this.fb.nonNullable.control('');
  protected readonly fTelefone = this.fb.nonNullable.control('');
  protected readonly fTextoMsg = this.fb.nonNullable.control('');
  private readonly controles: Record<string, FormControl<string>> = {};

  /** `config.sessao` — null quando a sessão nunca foi observada. */
  protected readonly sessao = computed<M.ZapiSessao | null>(() => {
    const v = this.i();
    return v ? sessaoZapi(v) : null;
  });

  protected readonly sessaoConectada = computed(() => this.sessao()?.conectado === true);

  constructor() {
    effect(() => {
      // Z-API só existe em produção — qualquer outro ambiente é rota inválida.
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

  /** Controle reativo do segredo — vazio = manter valor atual. */
  protected controle(nome: string): FormControl<string> {
    return this.controles[nome] ?? (this.controles[nome] = this.fb.nonNullable.control(''));
  }

  protected configurado(c: CampoCredencial): boolean {
    return this.i()?.segredos.campos[c.nome] === true;
  }

  /** `webhook_segredo` é gerado pelo servidor — nunca digitado aqui. */
  protected segredoWebhook(): boolean {
    return this.i()?.segredos.campos['webhook_segredo'] === true;
  }

  protected alternarLimpar(nome: string): void {
    this.limpar.update((m) => ({ ...m, [nome]: !m[nome] }));
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.falhou.set(false);
    this.conflito.set(false);
    this.teste.set(null);
    this.api.buscar('zapi', this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.fNomeConta.setValue(i.nome_conta ?? '');
        this.fInstanceId.setValue(instanceIdZapi(i));
        for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
        this.limpar.set({});
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

  /** Releitura silenciosa — atualiza a view sem mexer no formulário. */
  private atualizarView(): void {
    this.api.buscar('zapi', this.ambiente()).subscribe({
      next: (nova) => this.i.set(nova),
    });
  }

  private carregarEventos(): void {
    this.carregandoEventos.set(true);
    this.api.eventos('zapi', this.ambiente()).subscribe({
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
    const input: M.IntegracaoInput = {
      versao: i.versao,
      nome_conta: this.fNomeConta.value.trim(),
      // instance_id é config não-secreta — campo visível, envia o valor atual.
      config: { instance_id: this.fInstanceId.value.trim() },
    };
    if (Object.keys(segredos).length) input.segredos = segredos;

    this.salvando.set(true);
    this.api.salvar('zapi', i.ambiente, input).subscribe({
      next: (nova) => {
        this.salvando.set(false);
        this.i.set(nova);
        this.fInstanceId.setValue(instanceIdZapi(nova));
        for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
        this.limpar.set({});
        this.notify.ok('Credenciais salvas.');
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

  /** "Testar conexão" e "Atualizar status" — o backend grava `config.sessao`. */
  protected testar(): void {
    const i = this.i();
    if (!i) return;
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar('zapi', i.ambiente).subscribe({
      next: (t) => {
        this.testando.set(false);
        this.teste.set(t);
        // A verificação atualiza a sessão no backend — recarrega a visão.
        this.atualizarView();
      },
      error: (e) => {
        this.testando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected abrirQr(): void {
    this.qrAberto.set(true);
    this.buscarQr();
  }

  protected fecharQr(): void {
    this.qrAberto.set(false);
    this.qr.set(null);
    this.qrErro.set(null);
  }

  protected buscarQr(): void {
    this.qrCarregando.set(true);
    this.qrErro.set(null);
    this.api.qrCode(this.ambiente()).subscribe({
      next: (q) => {
        this.qrCarregando.set(false);
        this.qr.set(q);
      },
      error: (e) => {
        this.qrCarregando.set(false);
        this.qr.set(null);
        this.qrErro.set(this.mensagemErro(e));
      },
    });
  }

  protected configurarWebhooks(): void {
    this.configurandoWh.set(true);
    this.whResultado.set(null);
    this.api.configurarWebhooks(this.ambiente()).subscribe({
      next: (r) => {
        this.configurandoWh.set(false);
        this.whResultado.set(r.callbacks_configurados);
        this.notify.ok(`${r.callbacks_configurados} callbacks configurados.`);
        this.atualizarView();
      },
      error: (e) => {
        this.configurandoWh.set(false);
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
    const input: M.ZapiTesteInput = { telefone: digitos };
    const texto = this.fTextoMsg.value.trim();
    if (texto) input.texto = texto;
    this.api.enviarTeste(this.ambiente(), input).subscribe({
      next: (r) => {
        this.enviandoMsg.set(false);
        this.msgResultado.set(r);
        this.notify.ok('Mensagem de teste enviada.');
      },
      error: (e) => {
        this.enviandoMsg.set(false);
        this.notify.erro(e);
      },
    });
  }

  /** Desconectar é destrutivo — pede confirmação e mantém as credenciais. */
  protected async desconectar(): Promise<void> {
    const ok = await this.confirm.perguntar(
      'Desconectar a sessão do WhatsApp? O número será desvinculado da instância e será preciso ' +
        'ler um novo QR Code para reconectar. As credenciais são mantidas.',
      { titulo: 'Desconectar sessão', confirmar: 'Desconectar' },
    );
    if (!ok) return;
    this.desconectando.set(true);
    this.api.desconectar(this.ambiente()).subscribe({
      next: () => {
        this.desconectando.set(false);
        this.notify.ok('Sessão desconectada.');
        this.atualizarView();
      },
      error: (e) => {
        this.desconectando.set(false);
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
        this.notify.ok('Instância definida como padrão do WhatsApp.');
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
      .then(() => this.notify.ok('URL do webhook copiada.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }

  protected webhooksDe(i: M.IntegracaoView): number {
    return webhooksConfigurados(i);
  }

  protected esperadosDe(i: M.IntegracaoView): number {
    return callbacksEsperados(i);
  }

  /** `event_type` dos callbacks Z-API → rótulo; desconhecidos passam crus. */
  protected rotuloEvento(tipo: string): string {
    return rotuloEventoZapi(tipo);
  }

  protected rotuloStatusEvento(status: string): string {
    return ROTULO_EVENTO[status]?.rotulo ?? status;
  }

  protected pillEvento(status: string): string {
    return ROTULO_EVENTO[status]?.pill ?? 'pill-off';
  }

  /** Mesma extração do NotifyService.erro — para exibir a falha dentro da área do QR. */
  private mensagemErro(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      const body = e.error as { erro?: { mensagem?: string } } | undefined;
      return body?.erro?.mensagem ?? `Falha na requisição (HTTP ${e.status}).`;
    }
    return 'Erro inesperado. Tente novamente.';
  }
}
