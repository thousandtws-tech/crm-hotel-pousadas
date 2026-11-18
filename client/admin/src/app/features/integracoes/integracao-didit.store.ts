// Lógica e estado de integracao-didit — separada da camada de UI (integracao-didit.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormControl, FormBuilder } from '@angular/forms';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { VerificacaoApi } from '@core/api/verificacao.api';
import { Notify } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  CampoCredencial,
  ROTULO_AMBIENTE,
  estadoDe,
} from './integracoes.const';

@Directive()
export abstract class IntegracaoDiditStore implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(IntegracoesApi);
  private readonly verificacao = inject(VerificacaoApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
  protected readonly carregando = signal(true);
  protected readonly salvando = signal(false);
  protected readonly salvandoCfg = signal(false);
  protected readonly alternando = signal(false);
  protected readonly testando = signal(false);
  protected readonly registrandoHook = signal(false);
  protected readonly teste = signal<M.TesteIntegracao | null>(null);
  protected readonly limpar = signal<Record<string, boolean>>({});

  protected readonly campos: CampoCredencial[] = CAMPOS_POR_PROVEDOR['didit'];
  protected readonly estadoDe = estadoDe;
  private readonly controles = new Map<string, FormControl<string>>();

  protected readonly fWorkflow = this.fb.nonNullable.control('');
  protected readonly fCallback = this.fb.nonNullable.control('');
  protected readonly fExigir = this.fb.nonNullable.control(false);

  protected get rotuloAmb(): string {
    return ROTULO_AMBIENTE[this.ambiente()];
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.ambiente.set(p.get('ambiente') === 'teste' ? 'teste' : 'producao');
      this.carregar();
    });
  }

  protected controle(nome: string): FormControl<string> {
    let c = this.controles.get(nome);
    if (!c) {
      c = this.fb.nonNullable.control('');
      this.controles.set(nome, c);
    }
    return c;
  }

  protected configurado(c: CampoCredencial): boolean {
    return this.i()?.segredos.campos[c.nome] === true;
  }

  protected toggleLimpar(nome: string): void {
    this.limpar.update((l) => ({ ...l, [nome]: !l[nome] }));
  }

  private carregar(): void {
    this.carregando.set(true);
    this.api.buscar('didit', this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.fWorkflow.setValue((i?.config?.['workflow_id'] as string) ?? '');
        this.fCallback.setValue((i?.config?.['callback_url'] as string) ?? '');
        this.fExigir.setValue(i?.config?.['exigir_verificacao'] === true);
        this.carregando.set(false);
      },
      error: () => {
        this.i.set(null);
        this.carregando.set(false);
      },
    });
  }

  protected salvar(): void {
    const segredos: Record<string, string> = {};
    for (const c of this.campos) {
      const v = this.controle(c.nome).value.trim();
      if (this.limpar()[c.nome]) segredos[c.nome] = '';
      else if (v) segredos[c.nome] = v;
    }
    if (!Object.keys(segredos).length) {
      this.notify.aviso('Nada para salvar — preencha um campo ou marque Limpar.');
      return;
    }
    this.salvando.set(true);
    this.api
      .salvar('didit', this.ambiente(), { versao: this.i()?.versao ?? 0, segredos })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          for (const c of this.campos) this.controle(c.nome).setValue('');
          this.limpar.set({});
          this.notify.ok('Credenciais salvas.');
          this.carregar();
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e?.error?.message ?? 'Falha ao salvar.');
        },
      });
  }

  protected salvarConfig(): void {
    this.salvandoCfg.set(true);
    this.verificacao
      .configurar(this.ambiente(), {
        workflowId: this.fWorkflow.value.trim(),
        callbackUrl: this.fCallback.value.trim(),
        exigirVerificacao: this.fExigir.value,
      })
      .subscribe({
        next: () => {
          this.salvandoCfg.set(false);
          this.notify.ok('Configuração salva.');
          this.carregar();
        },
        error: (e) => {
          this.salvandoCfg.set(false);
          this.notify.erro(e?.error?.message ?? 'Falha ao salvar.');
        },
      });
  }

  protected alternar(int: M.IntegracaoView): void {
    this.alternando.set(true);
    this.api.habilitacao(int.provedor, int.ambiente, !int.habilitado).subscribe({
      next: () => {
        this.alternando.set(false);
        this.carregar();
      },
      error: (e) => {
        this.alternando.set(false);
        this.notify.erro(e?.error?.message ?? 'Falha ao alterar.');
      },
    });
  }

  protected testar(): void {
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar('didit', this.ambiente()).subscribe({
      next: (t) => {
        this.teste.set(t);
        this.testando.set(false);
      },
      error: (e) => {
        this.testando.set(false);
        this.teste.set({
          verificacao_status: 'falha',
          nome_conta: null,
          mensagem: e?.error?.message ?? 'Falha.',
        });
      },
    });
  }

  protected registrarWebhook(): void {
    this.registrandoHook.set(true);
    this.verificacao.registrarWebhook(this.ambiente()).subscribe({
      next: () => {
        this.registrandoHook.set(false);
        this.notify.ok('Webhook registrado — segredo capturado e guardado.');
        this.carregar();
      },
      error: (e) => {
        this.registrandoHook.set(false);
        this.notify.erro(e?.error?.message ?? 'Falha ao registrar webhook.');
      },
    });
  }

  protected copiar(texto: string): void {
    navigator.clipboard.writeText(texto).then(() => this.notify.ok('URL copiada.'));
  }
}
