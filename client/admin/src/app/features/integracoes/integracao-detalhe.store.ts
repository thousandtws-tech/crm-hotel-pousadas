// Lógica e estado de integracao-detalhe — separada da camada de UI (integracao-detalhe.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, OnInit, computed, inject, signal, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  ROTULO_EVENTO,
  CampoCredencial,
  estadoDe,
  rotuloAmbiente,
  rotuloProvedor,
} from './integracoes.const';

const PROVEDORES: M.ProvedorPagamento[] = ['stripe', 'pagbank', 'mercadopago'];
const AMBIENTES: M.AmbienteIntegracao[] = ['producao', 'teste'];

/**
 * Detalhe de um par (provedor × ambiente): credenciais write-only, webhook
 * para copiar, habilitação, teste ao vivo, padrão do site e eventos recebidos.
 * Segredos nunca são exibidos — só o estado configurado/não-configurado.
 */
@Directive()
export abstract class IntegracaoDetalheStore implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);

  protected readonly provedor = signal<M.ProvedorPagamento>('stripe');
  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
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

  protected readonly fNomeConta = this.fb.nonNullable.control('');
  private readonly controles: Record<string, FormControl<string>> = {};

  protected readonly campos = computed<CampoCredencial[]>(
    () => CAMPOS_POR_PROVEDOR[this.provedor()] ?? [],
  );

  protected readonly rotuloProvedor = rotuloProvedor;
  protected readonly rotuloAmbiente = rotuloAmbiente;
  protected readonly estadoDe = estadoDe;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      const provedor = p.get('provedor') as M.ProvedorPagamento;
      const ambiente = p.get('ambiente') as M.AmbienteIntegracao;
      if (!PROVEDORES.includes(provedor) || !AMBIENTES.includes(ambiente)) {
        this.carregando.set(false);
        this.falhou.set(true);
        return;
      }
      this.provedor.set(provedor);
      this.ambiente.set(ambiente);
      for (const c of CAMPOS_POR_PROVEDOR[provedor]) {
        this.controles[c.nome] = this.fb.nonNullable.control('');
      }
      this.carregar();
    });
  }

  /** Controle reativo do campo de credencial — vazio = manter valor atual. */
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
    this.api.buscar(this.provedor(), this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.fNomeConta.setValue(i.nome_conta ?? '');
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

  private carregarEventos(): void {
    this.carregandoEventos.set(true);
    this.api.eventos(this.provedor(), this.ambiente()).subscribe({
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
    for (const c of this.campos()) {
      const v = this.controle(c.nome).value.trim();
      if (lim[c.nome]) segredos[c.nome] = '';
      else if (v) segredos[c.nome] = v;
    }
    const input: M.IntegracaoInput = {
      versao: i.versao,
      nome_conta: this.fNomeConta.value.trim(),
    };
    if (Object.keys(segredos).length) input.segredos = segredos;

    this.salvando.set(true);
    this.api.salvar(i.provedor, i.ambiente, input).subscribe({
      next: (nova) => {
        this.salvando.set(false);
        this.i.set(nova);
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

  protected testar(): void {
    const i = this.i();
    if (!i) return;
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar(i.provedor, i.ambiente).subscribe({
      next: (t) => {
        this.testando.set(false);
        this.teste.set(t);
        // A verificação atualiza o estado no backend — recarrega a visão.
        this.api.buscar(i.provedor, i.ambiente).subscribe({
          next: (nova) => this.i.set(nova),
        });
      },
      error: (e) => {
        this.testando.set(false);
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
        this.notify.ok('Integração definida como padrão do site.');
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

  protected rotuloEvento(status: string): string {
    return ROTULO_EVENTO[status]?.rotulo ?? status;
  }

  protected pillEvento(status: string): string {
    return ROTULO_EVENTO[status]?.pill ?? 'pill-off';
  }
}
