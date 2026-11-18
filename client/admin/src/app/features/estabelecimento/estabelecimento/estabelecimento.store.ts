// Lógica e estado de estabelecimento — separada da camada de UI (estabelecimento.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, DestroyRef, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder } from '@angular/forms';
import { EstabelecimentoApi } from '@core/api/estabelecimento.api';
import { ImpressorasApi } from '@core/api/impressoras.api';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import * as M from '@core/models';

const SETORES = ['caixa', 'cozinha', 'bar', 'balcao', 'churrasqueira', 'recepcao'];

// Configurações do estabelecimento: dados fiscais, endereço, logo e
// impressoras térmicas por setor (roteamento de comprovantes e pedidos).
@Directive()
export abstract class EstabelecimentoStore implements OnInit {
  private readonly estabelecimentoApi = inject(EstabelecimentoApi);
  private readonly impressorasApi = inject(ImpressorasApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly rt = inject(Realtime);
  private readonly fb = inject(FormBuilder);
  private readonly tour = inject(TourGuiado);

  protected readonly salvando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly modalLogo = signal(false);
  protected readonly logoPreview = signal<string | null>(null);
  protected readonly logoArquivo = signal<File | null>(null);
  protected readonly logoOk = signal(false);
  protected readonly impressoras = signal<M.Impressora[]>([]);
  protected readonly modalImp = signal(false);
  protected readonly impEditando = signal<M.Impressora | null>(null);
  protected readonly descobertas = signal<M.ImpressoraDescoberta[]>([]);
  protected readonly modalReg = signal<M.ImpressoraDescoberta | null>(null);
  protected readonly regForm = this.fb.nonNullable.group({
    nome: [''],
    setor: [''],
    padrao: [false],
    etiqueta: [false],
  });

  protected readonly impForm = this.fb.nonNullable.group({
    nome: [''],
    setor: [''],
    ip: [''],
    porta: [9100],
    padrao: [false],
    etiqueta: [false],
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
    taxa_early: [0],
    taxa_late: [0],
    wifi_nome: [''],
    wifi_senha: [''],
    horario_checkin: [''],
    horario_checkout: [''],
    horario_cafe: [''],
    info_servicos: [''],
    cadastur: [''],
    dpo_email: [''],
    retencao_dados_anos: [5],
    fnrh_assinatura: [false],
    // CDC — faixas escalonadas: reembolso integral, parcial e nenhum.
    pol1_dias: [15],
    pol1_pct: [100],
    pol2_dias: [7],
    pol2_pct: [50],
    pol3_pct: [0],
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

  protected readonly dadosOk = signal(false);
  protected readonly endOk = signal(false);
  protected readonly impOk = computed(() => this.impressoras().some((p) => p.padrao && p.ativa));
  protected readonly setoresOpcoes = computed(() => {
    const atual = this.impForm.value.setor?.trim();
    return atual && !SETORES.includes(atual) ? [...SETORES, atual] : SETORES;
  });

  constructor() {
    const destroy = inject(DestroyRef);
    this.dados.valueChanges.pipe(takeUntilDestroyed(destroy)).subscribe((v) => {
      this.dadosOk.set(!!(v.razao_social?.trim() && v.cnpj?.trim()));
    });
    this.endereco.valueChanges.pipe(takeUntilDestroyed(destroy)).subscribe((v) => {
      this.endOk.set(!!(v.logradouro?.trim() && v.cidade?.trim() && v.cep?.trim()));
    });
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('impressora', 'categoria_estoque', 'impressora_descoberta');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregarImpressoras();
        this.carregarDescobertas();
      }
    });
  }

  ngOnInit(): void {
    this.estabelecimentoApi.obterEstabelecimento().subscribe({
      next: (e) => {
        this.dadosVersion.set(e.version);
        const faixas = (
          e.politica_cancelamento as { faixas?: { ate_dias: number; pct: number }[] } | null
        )?.faixas;
        const fx = (i: number) => faixas?.[i];
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
          taxa_early: Number(e.taxa_early ?? 0),
          taxa_late: Number(e.taxa_late ?? 0),
          wifi_nome: e.wifi_nome ?? '',
          wifi_senha: e.wifi_senha ?? '',
          horario_checkin: e.horario_checkin ?? '',
          horario_checkout: e.horario_checkout ?? '',
          horario_cafe: e.horario_cafe ?? '',
          info_servicos: e.info_servicos ?? '',
          cadastur: e.cadastur ?? '',
          dpo_email: e.dpo_email ?? '',
          retencao_dados_anos: e.retencao_dados_anos ?? 5,
          fnrh_assinatura: e.fnrh_assinatura ?? false,
          pol1_dias: fx(0)?.ate_dias ?? 15,
          pol1_pct: fx(0)?.pct ?? 100,
          pol2_dias: fx(1)?.ate_dias ?? 7,
          pol2_pct: fx(1)?.pct ?? 50,
          pol3_pct: fx(2)?.pct ?? 0,
        });
      },
      error: () => undefined,
    });
    this.carregarImpressoras();
    this.carregarDescobertas();
    this.estabelecimentoApi.logoAtual().subscribe({
      next: () => this.logoOk.set(true),
      error: () => this.logoOk.set(false),
    });
    this.estabelecimentoApi.obterEndereco().subscribe({
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

  onEsc(): void {
    if (this.modalImp()) this.modalImp.set(false);
    else if (this.modalLogo()) this.modalLogo.set(false);
  }

  salvarDados(): void {
    this.salvando.set(true);
    const v = this.dados.getRawValue();
    const empty = (s: string) => s || null;
    this.estabelecimentoApi
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
        taxa_early: Number(v.taxa_early) || 0,
        taxa_late: Number(v.taxa_late) || 0,
        wifi_nome: empty(v.wifi_nome),
        wifi_senha: empty(v.wifi_senha),
        horario_checkin: empty(v.horario_checkin),
        horario_checkout: empty(v.horario_checkout),
        horario_cafe: empty(v.horario_cafe),
        info_servicos: empty(v.info_servicos),
        cadastur: empty(v.cadastur),
        dpo_email: empty(v.dpo_email),
        retencao_dados_anos: Number(v.retencao_dados_anos) || 5,
        fnrh_assinatura: !!v.fnrh_assinatura,
        politica_cancelamento: {
          faixas: [
            { ate_dias: Number(v.pol1_dias) || 0, pct: Number(v.pol1_pct) || 0 },
            { ate_dias: Number(v.pol2_dias) || 0, pct: Number(v.pol2_pct) || 0 },
            { ate_dias: 0, pct: Number(v.pol3_pct) || 0 },
          ],
        },
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
    this.estabelecimentoApi
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
    this.estabelecimentoApi.logoAtual().subscribe({
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
    this.estabelecimentoApi.uploadLogo(f).subscribe({
      next: () => {
        this.enviando.set(false);
        this.modalLogo.set(false);
        this.logoOk.set(true);
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
    this.impressorasApi.listarImpressoras().subscribe({
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
      etiqueta: p?.etiqueta ?? false,
      ativa: p?.ativa ?? true,
    });
    this.modalImp.set(true);
  }

  salvarImpressora(): void {
    const v = this.impForm.getRawValue();
    this.salvando.set(true);
    const edit = this.impEditando();
    const req = edit
      ? this.impressorasApi.atualizarImpressora(edit.id, { ...v, version: edit.version })
      : this.impressorasApi.criarImpressora(v);
    req.subscribe({
      next: () => {
        this.salvando.set(false);
        this.modalImp.set(false);
        this.notify.ok(edit ? 'Impressora atualizada.' : 'Impressora cadastrada.');
        this.carregarImpressoras();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  statusImpressora(p: M.Impressora): void {
    this.impressorasApi.statusImpressora(p.id, !p.ativa).subscribe({
      next: () => this.carregarImpressoras(),
      error: (e) => this.notify.erro(e),
    });
  }

  testar(p: M.Impressora): void {
    this.impressorasApi.testarImpressora(p.id).subscribe({
      next: () => this.notify.ok('Teste de impressão enviado.'),
      error: (e) => this.notify.erro(e),
    });
  }

  async removerImpressora(p: M.Impressora): Promise<void> {
    const ok = await this.confirm.perguntar(`Excluir a impressora "${p.nome}" (${p.setor})?`, {
      titulo: 'Excluir impressora',
      confirmar: 'Excluir',
    });
    if (!ok) return;
    this.impressorasApi.removerImpressora(p.id).subscribe({
      next: () => {
        this.notify.ok('Impressora excluída.');
        this.carregarImpressoras();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- auto-descoberta (agente local) ----------------------------------------

  private carregarDescobertas(): void {
    this.impressorasApi.listarDescobertasImpressoras().subscribe({
      next: (l) => this.descobertas.set(l),
      error: () => undefined,
    });
  }

  abrirRegistro(d: M.ImpressoraDescoberta): void {
    this.modalReg.set(d);
    this.regForm.reset({ nome: d.modelo ?? '', setor: '', padrao: false, etiqueta: false });
  }

  registrar(): void {
    const d = this.modalReg();
    if (!d) return;
    const v = this.regForm.getRawValue();
    this.salvando.set(true);
    this.impressorasApi.registrarDescoberta(d.id, v).subscribe({
      next: () => {
        this.salvando.set(false);
        this.modalReg.set(null);
        this.notify.ok('Impressora registrada.');
        this.carregarImpressoras();
        this.carregarDescobertas();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  async ignorar(d: M.ImpressoraDescoberta): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Ignorar "${d.modelo ?? d.endereco}"? Novas varreduras podem reabri-la.`,
      { titulo: 'Ignorar dispositivo', confirmar: 'Ignorar' },
    );
    if (!ok) return;
    this.impressorasApi.ignorarDescoberta(d.id).subscribe({
      next: () => this.carregarDescobertas(),
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo às configurações da pousada!',
          description:
            'Aqui ficam os dados que aparecem em <b>comprovantes, documentos ' +
            'e na impressão térmica</b>. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '#tour-check',
        popover: {
          title: 'Checklist de configuração',
          description:
            'Os 4 itens essenciais: <b>dados fiscais</b>, <b>endereço</b>, ' +
            '<b>logo</b> e <b>impressora padrão</b>. O ícone verde indica ' +
            'item pronto; o de alerta indica pendência.',
          side: 'bottom',
        },
      },
      {
        element: '.est-secoes',
        popover: {
          title: 'Dados da pousada',
          description:
            'Razão social, CNPJ, contatos e endereço — tudo isso sai no ' +
            '<b>cabeçalho dos comprovantes</b> e na ficha do hóspede. ' +
            'Cada card grava separado.',
          side: 'top',
        },
      },
      {
        element: '#tour-imp',
        popover: {
          title: 'Impressoras por setor',
          description:
            'A impressora marcada como <b>padrão</b> recebe os comprovantes ' +
            'de check-out. Pedidos de consumo saem na impressora do ' +
            '<b>setor da categoria</b> (cozinha, bar…). O botão print testa na hora.',
          side: 'top',
        },
      },
      {
        element: '#tour-logo',
        popover: {
          title: 'Logo da pousada',
          description:
            'Envie a logo aqui — ela aparece nos <b>comprovantes ' +
            'impressos</b> e documentos do sistema.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Deixe os 4 itens do checklist verdes e a operação de ' +
            'impressão/documentos estará redonda.',
        },
      },
    ]);
  }
}
