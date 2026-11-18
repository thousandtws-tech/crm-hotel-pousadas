// Lógica e estado de integracao-spedy — separada da camada de UI (integracao-spedy.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, OnInit, inject, signal, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';
import { CAMPOS_POR_PROVEDOR, ROTULO_EVENTO, CampoCredencial, estadoDe } from './integracoes.const';

interface SpedyCfg {
  empresa_id?: string;
  empresa_cnpj?: string;
  empresa_razao?: string;
  empresa_cnpj_divergente?: boolean;
  municipio_codigo?: string;
  municipio_nome?: string;
  fiscal_service_code?: string;
  fiscal_city_service_code?: string;
  fiscal_cnae?: string;
  fiscal_nbs?: string;
  fiscal_national_taxation_code?: string;
  fiscal_taxation_type?: string;
  fiscal_iss_rate?: string;
  fiscal_descricao?: string;
  /** Ambiente do MODELO fiscal — independente do host da API (sandbox ≠ teste). */
  fiscal_ambiente?: string;
  fiscal_issue_type?: string;
  webhook_registrado?: boolean;
}

function cfg(i: M.IntegracaoView | null): SpedyCfg {
  return (i?.config ?? {}) as SpedyCfg;
}

/**
 * Detalhe Spedy (categoria Fiscal) — NFS-e de hospedagem e serviços.
 * Dois ambientes de API (producao/sandbox), e o ambiente do modelo fiscal
 * é configurável à parte: sandbox pode emitir nota REAL se o modelo estiver
 * em produção — a tela alerta explicitamente antes de salvar.
 */
@Directive()
export abstract class IntegracaoSpedyStore implements OnInit {
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(NotifyService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
  protected readonly carregando = signal(true);
  protected readonly falhou = signal(false);
  protected readonly eventos = signal<M.EventoIntegracaoView[]>([]);
  protected readonly carregandoEventos = signal(false);
  protected readonly salvando = signal(false);
  protected readonly salvandoCfg = signal(false);
  protected readonly alternando = signal(false);
  protected readonly testando = signal(false);
  protected readonly teste = signal<M.TesteIntegracao | null>(null);
  protected readonly vinculando = signal(false);
  protected readonly consultandoMun = signal(false);
  protected readonly registrandoHook = signal(false);
  protected readonly conflito = signal(false);
  protected readonly limpar = signal<Record<string, boolean>>({});
  protected readonly municipio = signal<M.SpedyMunicipioSettings | null>(null);

  protected readonly campos: CampoCredencial[] = CAMPOS_POR_PROVEDOR['spedy'];
  protected readonly estadoDe = estadoDe;
  protected readonly cfgDe = cfg;

  protected readonly fNomeConta = this.fb.nonNullable.control('');
  protected readonly fIbge = this.fb.nonNullable.control('');
  protected readonly fServiceCode = this.fb.nonNullable.control('');
  protected readonly fCityServiceCode = this.fb.nonNullable.control('');
  protected readonly fCnae = this.fb.nonNullable.control('');
  protected readonly fNbs = this.fb.nonNullable.control('');
  protected readonly fNatTax = this.fb.nonNullable.control('');
  protected readonly fTaxType = this.fb.nonNullable.control('');
  protected readonly fIssRate = this.fb.nonNullable.control('');
  protected readonly fFiscalAmbiente = this.fb.nonNullable.control('');
  protected readonly fDescricao = this.fb.nonNullable.control('');
  private readonly controles: Record<string, FormControl<string>> = {};

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      const a = p.get('ambiente') === 'teste' ? 'teste' : 'producao';
      this.ambiente.set(a);
      for (const c of this.campos) this.controle(c.nome);
      this.carregar();
    });
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
    this.api.buscar('spedy', this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.preencherForm(i);
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

  private preencherForm(i: M.IntegracaoView): void {
    const c = cfg(i);
    this.fNomeConta.setValue(i.nome_conta ?? '');
    this.fIbge.setValue(c.municipio_codigo ?? '');
    this.fServiceCode.setValue(c.fiscal_service_code ?? '');
    this.fCityServiceCode.setValue(c.fiscal_city_service_code ?? '');
    this.fCnae.setValue(c.fiscal_cnae ?? '');
    this.fNbs.setValue(c.fiscal_nbs ?? '');
    this.fNatTax.setValue(c.fiscal_national_taxation_code ?? '');
    this.fTaxType.setValue(c.fiscal_taxation_type ?? '');
    this.fIssRate.setValue(c.fiscal_iss_rate ?? '');
    this.fFiscalAmbiente.setValue(c.fiscal_ambiente ?? '');
    this.fDescricao.setValue(c.fiscal_descricao ?? '');
    for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
    this.limpar.set({});
    this.municipio.set(null);
  }

  private carregarEventos(): void {
    this.carregandoEventos.set(true);
    this.api.eventos('spedy', this.ambiente()).subscribe({
      next: (l) => {
        this.eventos.set(l);
        this.carregandoEventos.set(false);
      },
      error: () => this.carregandoEventos.set(false),
    });
  }

  private salvarInput(input: M.IntegracaoInput, okMsg: string): void {
    const i = this.i();
    if (!i) return;
    this.salvandoCfg.set(true);
    this.api.salvar('spedy', this.ambiente(), input).subscribe({
      next: (nova) => {
        this.salvandoCfg.set(false);
        this.salvando.set(false);
        this.i.set(nova);
        this.notify.ok(okMsg);
      },
      error: (e) => {
        this.salvandoCfg.set(false);
        this.salvando.set(false);
        this.tratarErroSalvar(e);
      },
    });
  }

  private tratarErroSalvar(e: unknown): void {
    if (e instanceof HttpErrorResponse && e.status === 409) {
      this.conflito.set(true);
      this.notify.aviso(
        'Integração alterada por outro administrador — recarregue antes de salvar.',
      );
    } else {
      this.notify.erro(e);
    }
  }

  /** Credenciais + nome — segredos write-only, `""` remove, ausente mantém. */
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
    };
    if (Object.keys(segredos).length) input.segredos = segredos;
    this.salvando.set(true);
    this.salvarInput(input, 'Credenciais salvas.');
  }

  /** Parametrização fiscal + município — merge por chave em `config`. */
  protected salvarConfig(): void {
    const i = this.i();
    if (!i) return;
    const trim = (v: string) => {
      const t = v.trim();
      return t === '' ? null : t;
    };
    this.salvarInput(
      {
        versao: i.versao,
        config: {
          fiscal_service_code: trim(this.fServiceCode.value),
          fiscal_city_service_code: trim(this.fCityServiceCode.value),
          fiscal_cnae: trim(this.fCnae.value),
          fiscal_nbs: trim(this.fNbs.value),
          fiscal_national_taxation_code: trim(this.fNatTax.value),
          fiscal_taxation_type: trim(this.fTaxType.value),
          fiscal_iss_rate: trim(this.fIssRate.value),
          fiscal_ambiente: trim(this.fFiscalAmbiente.value),
          fiscal_descricao: trim(this.fDescricao.value),
        },
      },
      'Parametrização fiscal salva.',
    );
  }

  protected usarMunicipio(): void {
    const i = this.i();
    const m = this.municipio();
    if (!i || !m) return;
    const nome = (m['cityName'] ?? m['name'] ?? '') as string;
    this.salvarInput(
      {
        versao: i.versao,
        config: {
          municipio_codigo: this.fIbge.value.trim(),
          municipio_nome: nome || null,
          municipio_provedores: m['providers'] ?? null,
        },
      },
      'Município de emissão definido.',
    );
  }

  protected vincularEmpresa(): void {
    this.vinculando.set(true);
    this.api.spedyEmpresa(this.ambiente()).subscribe({
      next: (emp) => {
        this.vinculando.set(false);
        const i = this.i();
        if (i) {
          this.salvarInput(
            {
              versao: i.versao,
              config: {
                empresa_id: emp.id,
                empresa_cnpj: emp.cnpj,
                empresa_razao: emp.razao_social,
              },
            },
            `Empresa vinculada: ${emp.razao_social ?? emp.id}`,
          );
        }
      },
      error: (e) => {
        this.vinculando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected consultarMunicipio(): void {
    const ibge = this.fIbge.value.trim();
    if (!ibge) return;
    this.consultandoMun.set(true);
    this.municipio.set(null);
    this.api.spedyMunicipio(this.ambiente(), ibge).subscribe({
      next: (m) => {
        this.consultandoMun.set(false);
        this.municipio.set(m);
      },
      error: (e) => {
        this.consultandoMun.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected registrarWebhook(): void {
    this.registrandoHook.set(true);
    this.api.spedyConfigurarWebhook(this.ambiente()).subscribe({
      next: (r) => {
        this.registrandoHook.set(false);
        this.i.update((v) => (v ? { ...v, config: { ...v.config, webhook_registrado: true } } : v));
        this.notify.ok(`Webhook registrado: ${r.webhook_url}`);
      },
      error: (e) => {
        this.registrandoHook.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected alternarHabilitado(i: M.IntegracaoView): void {
    this.alternando.set(true);
    this.api.habilitacao('spedy', i.ambiente, !i.habilitado).subscribe({
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
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar('spedy', this.ambiente()).subscribe({
      next: (t) => {
        this.testando.set(false);
        this.teste.set(t);
        this.api.buscar('spedy', this.ambiente()).subscribe({
          next: (nova) => this.i.set(nova),
        });
      },
      error: (e) => {
        this.testando.set(false);
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
