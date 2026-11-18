// Lógica e estado de clientes — separada da camada de UI (clientes.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import {
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  effect,
  DestroyRef,
  Directive,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { PageEvent } from '@angular/material/paginator';
import { ClientesApi } from '@core/api/clientes.api';
import { GeoApi } from '@core/api/geo.api';
import { Cliente, ClienteInput } from '@core/models/clientes.models';
import { NACIONALIDADES, PaisGeo } from '@core/models/geo.models';
import { Confirm } from '@core/services/confirm.service';
import { ExportacaoService, RelatorioCfg } from '@core/services/exportacao.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';

/** Recorte quadrado máximo usado também para normalizar uploads de arquivo. */
const LADO_FOTO = 640;

/** Normalização para busca de país — minúsculo e sem acentos. */
function normPais(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// -- página --------------------------------------------------------------------

@Directive()
export abstract class ClientesStore implements OnInit, OnDestroy {
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
  private readonly clientesApi = inject(ClientesApi);
  private readonly exp = inject(ExportacaoService);
  private readonly notify = inject(Notify);
  private readonly tour = inject(TourGuiado);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<Cliente[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly apenasAtivos = signal(false);
  protected readonly carregando = signal(false);
  protected readonly exportando = signal(false);
  protected readonly busca = this.fb.nonNullable.control('');
  protected readonly buscaFoco = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4, 5, 6];
  protected readonly modalAberto = signal(false);
  protected readonly editando = signal<Cliente | null>(null);
  /** Marca a 1ª tentativa de salvar — exibe os erros inline daí em diante. */
  protected readonly tentouSalvar = signal(false);
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

  // -- geografia: ViaCEP + seletor de país com bandeiras ---------------------
  private readonly geo = inject(GeoApi);
  protected readonly nacionalidades = NACIONALIDADES;
  protected readonly paises = signal<PaisGeo[]>([]);
  protected readonly paisAberto = signal(false);
  protected readonly paisBusca = this.fb.nonNullable.control('');
  protected readonly cepBuscando = signal(false);
  protected readonly cepErro = signal(false);
  private cepReq = 0;
  private ultimoCep = '';
  protected readonly paisValor = toSignal(this.form.controls.pais.valueChanges, {
    initialValue: '',
  });
  protected readonly paisBuscaValor = toSignal(this.paisBusca.valueChanges, { initialValue: '' });
  protected readonly paisSelecionado = computed(() => {
    const v = (this.paisValor() ?? '').trim().toLowerCase();
    return v ? (this.paises().find((p) => p.nome.toLowerCase() === v) ?? null) : null;
  });
  protected readonly ddiAtual = computed(() => this.paisSelecionado()?.ddi ?? null);
  protected readonly paisesFiltrados = computed(() => {
    const t = normPais(this.paisBuscaValor());
    const all = this.paises();
    return t ? all.filter((p) => normPais(p.nome).includes(t) || p.cca2.toLowerCase() === t) : all;
  });

  // -- nacionalidade: combobox filtrável (mesmo padrão do seletor de país) ---
  protected readonly nacAberto = signal(false);
  protected readonly nacIdx = signal(-1);
  protected readonly nacValor = toSignal(this.form.controls.nacionalidade.valueChanges, {
    initialValue: '',
  });
  protected readonly nacFiltradas = computed(() => {
    const t = normPais(this.nacValor());
    return t
      ? this.nacionalidades.filter((n) => normPais(n).includes(t))
      : [...this.nacionalidades];
  });

  ngOnInit(): void {
    this.carregar();
    // busca em tempo real — digita e a lista filtra sozinha (300 ms)
    this.busca.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recarregar());
    // sugestões instantâneas do smart search (150 ms — percebido como imediato)
    this.busca.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.buscarSugestoes(v));
  }

  limparBusca(): void {
    if (this.busca.value) this.busca.setValue('');
    this.sugestaoAberta.set(false);
    this.sugestoes.set([]);
    this.sugestaoIdx.set(-1);
  }

  // -- smart search (sugestões instantâneas) ---------------------------------

  protected readonly sugestaoAberta = signal(false);
  protected readonly sugestoes = signal<Cliente[]>([]);
  protected readonly sugestaoIdx = signal(-1);
  protected readonly buscandoSug = signal(false);
  protected readonly totalSug = signal(0);
  private sugestaoReq = 0;

  private buscarSugestoes(v: string): void {
    const termo = (v ?? '').trim();
    const req = ++this.sugestaoReq;
    if (termo.length < 2) {
      this.sugestaoAberta.set(false);
      this.sugestoes.set([]);
      this.buscandoSug.set(false);
      return;
    }
    this.sugestaoAberta.set(true);
    this.buscandoSug.set(true);
    this.clientesApi.listarClientes(termo, 1, 6, this.apenasAtivos()).subscribe({
      next: (p) => {
        if (req !== this.sugestaoReq) return;
        this.sugestoes.set(p.items);
        this.totalSug.set(p.total);
        this.sugestaoIdx.set(-1);
        this.buscandoSug.set(false);
        this.carregarFotos(p.items);
      },
      error: () => {
        if (req === this.sugestaoReq) this.buscandoSug.set(false);
      },
    });
  }

  /** ↓/↑ navega nas sugestões, Enter abre a selecionada, Esc fecha a lista. */
  teclaBusca(e: KeyboardEvent): void {
    const n = this.sugestoes().length;
    if (e.key === 'ArrowDown' && n > 0) {
      e.preventDefault();
      this.sugestaoAberta.set(true);
      this.sugestaoIdx.update((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && n > 0) {
      e.preventDefault();
      this.sugestaoIdx.update((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && this.sugestaoIdx() >= 0) {
      const s = this.sugestoes()[this.sugestaoIdx()];
      if (s) {
        e.preventDefault();
        this.selecionarSugestao(s);
      }
    } else if (e.key === 'Escape') {
      this.sugestaoAberta.set(false);
      this.sugestaoIdx.set(-1);
    }
  }

  /** Reabre a lista ao focar de volta no campo (se já houver sugestões). */
  reabrirSugestoes(): void {
    if ((this.busca.value ?? '').trim().length >= 2 && this.sugestoes().length) {
      this.sugestaoAberta.set(true);
    }
  }

  /** Fecha ao perder o foco — o delay deixa o clique na sugestão acontecer. */
  fecharSugestoes(): void {
    setTimeout(() => this.sugestaoAberta.set(false), 140);
  }

  /** Enter/click numa sugestão abre direto a ficha do cliente (caminho curto). */
  selecionarSugestao(s: Cliente): void {
    this.sugestaoAberta.set(false);
    this.sugestaoIdx.set(-1);
    this.abrirForm(s);
  }

  /** Quebra o texto no trecho que bate com a busca, para o <mark> do template. */
  partes(texto: string): { antes: string; meio: string; depois: string } {
    const t = (this.busca.value ?? '').trim();
    if (!t) return { antes: texto, meio: '', depois: '' };
    const i = texto.toLowerCase().indexOf(t.toLowerCase());
    if (i < 0) return { antes: texto, meio: '', depois: '' };
    return {
      antes: texto.slice(0, i),
      meio: texto.slice(i, i + t.length),
      depois: texto.slice(i + t.length),
    };
  }

  /** Iniciais para o avatar (ex.: "Ana Costa" → "AC"). */
  iniciais(nome: string): string {
    const partes = nome.trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '?';
    const a = partes[0].charAt(0);
    const b = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
    return (a + b).toUpperCase();
  }

  /** CPFs gerados automaticamente pelo site (SITE-…) viram selo amigável. */
  cpfSite(cpf: string | null | undefined): boolean {
    return !!cpf && cpf.startsWith('SITE-');
  }

  ngOnDestroy(): void {
    for (const url of this.fotos().values()) URL.revokeObjectURL(url);
    this.liberarPreview();
  }

  carregar(): void {
    this.carregando.set(true);
    this.clientesApi
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
    this.clientesApi.statusCliente(c.id, ativo).subscribe({
      next: (novo) => {
        this.items.update((xs) => xs.map((x) => (x.id === novo.id ? novo : x)));
        this.notify.ok(ativo ? 'Cliente ativado.' : 'Cliente desativado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** LGPD art. 18 — eliminação: apaga PII mantendo a trilha fiscal/FNRH
   *  que a lei obriga a reter (admin/gerente, confirmado em duas etapas). */
  async anonimizar(c: Cliente): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Anonimizar ${c.nome}? Nome, CPF, contatos e documentos viram dados \
irreversíveis — reservas e FNRH ficam preservadas por obrigação legal. \
Use para pedidos de eliminação do titular.`,
      { titulo: 'Anonimizar titular (LGPD)', confirmar: 'Anonimizar' },
    );
    if (!ok) return;
    this.clientesApi.anonimizarCliente(c.id).subscribe({
      next: () => {
        this.notify.ok('Titular anonimizado — dados pessoais removidos.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(c: Cliente): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o cliente ${c.nome}? Documentos e foto serão apagados.`,
      { titulo: 'Excluir cliente', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.clientesApi.excluirCliente(c.id).subscribe({
      next: () => {
        this.notify.ok('Cliente excluído.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Monta o relatório respeitando a busca e o filtro atuais e exporta. */
  async exportar(tipo: 'pdf' | 'xlsx' | 'doc' | 'email' | 'whats'): Promise<void> {
    this.exportando.set(true);
    try {
      const p = await new Promise<{ items: Cliente[]; total: number }>((resolve, reject) =>
        this.clientesApi
          .listarClientes(this.busca.value || null, 1, 500, this.apenasAtivos())
          .subscribe({ next: resolve, error: reject }),
      );

      const filtro = [
        this.busca.value ? `Busca: "${this.busca.value}"` : null,
        this.apenasAtivos() ? 'Somente ativos' : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const cfg: RelatorioCfg = {
        titulo: 'Relatório de Hóspedes',
        subtitulo: filtro || 'Todos os hóspedes cadastrados',
        nomeArquivo: 'hospedes',
        colunas: ['ID', 'Nome', 'CPF', 'Nascimento', 'E-mail', 'Telefone', 'Cidade/UF', 'Status'],
        linhas: p.items.map((c) => [
          c.id,
          c.nome,
          c.cpf || '—',
          c.data_nascimento ? c.data_nascimento.split('-').reverse().join('/') : '—',
          c.email ?? '—',
          c.telefone ?? '—',
          [c.cidade, c.estado].filter(Boolean).join('/') || '—',
          c.ativo ? 'Ativo' : 'Inativo',
        ]),
        resumo: [
          { rotulo: 'Hóspedes', valor: String(p.total) },
          { rotulo: 'Na listagem', valor: String(p.items.length) },
        ],
      };

      switch (tipo) {
        case 'pdf':
          await this.exp.pdf(cfg);
          break;
        case 'xlsx':
          await this.exp.excel(cfg);
          break;
        case 'doc':
          this.exp.word(cfg);
          break;
        case 'email':
          this.exp.email(cfg);
          break;
        case 'whats':
          this.exp.whatsapp(cfg);
          break;
      }
    } catch (e) {
      this.notify.erro(e);
    } finally {
      this.exportando.set(false);
    }
  }

  fecharModal(): void {
    this.modalAberto.set(false);
    this.paisAberto.set(false);
    this.editando.set(null);
    this.fotoPendente.set(null);
    this.fotoRemover.set(false);
    this.tentouSalvar.set(false);
    this.liberarPreview();
    document.body.style.overflow = '';
  }

  /** Esc fecha o seletor de país antes do drawer (e nunca durante o tour). */
  onEsc(): void {
    if (this.tour.ativo()) return;
    if (this.paisAberto()) {
      this.paisAberto.set(false);
      return;
    }
    if (this.nacAberto()) {
      this.nacAberto.set(false);
      return;
    }
    if (!this.modalAberto() || this.capturando() || this.docsCliente()) return;
    this.fecharModal();
  }

  /** Tour guiado da tela (driver.js) — abre até o drawer de cadastro. */
  iniciarTour(): void {
    this.tour.iniciar(
      [
        {
          popover: {
            title: 'Bem-vindo à tela de Clientes!',
            description:
              'Este tour rápido mostra cada parte da tela. Avance com <b>Próximo</b> ' +
              'e feche a qualquer momento no ✕ ou pela tecla Esc.',
          },
        },
        {
          element: '#tour-busca',
          popover: {
            title: 'Busca rápida',
            description:
              'Digite parte do <b>nome</b> ou do <b>CPF</b> — a lista filtra sozinha, ' +
              'sem apertar Enter. O ✕ dentro do campo limpa a busca.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-ativos',
          popover: {
            title: 'Somente ativos',
            description:
              'Ligado, a lista mostra apenas hóspedes ativos. Desligado, aparecem todos — ' +
              'inclusive os inativos.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-novo',
          popover: {
            title: 'Cadastrar novo hóspede',
            description:
              'Clique aqui para cadastrar um cliente. Um painel abre à direita com o ' +
              'formulário — vou abrir para você ver!',
            side: 'bottom',
            onNextClick: () => {
              this.abrirForm();
              setTimeout(() => this.tour.avancar(), 420);
            },
          },
        },
        {
          element: '.drawer',
          popover: {
            title: 'Painel de cadastro',
            description:
              'Preencha os dados do hóspede neste painel. Campos com <b>*</b> são obrigatórios ' +
              'e CPF, telefone e CEP ganham formatação automática ao digitar. ' +
              'Conclua em <b>Salvar</b> no rodapé.',
            side: 'left',
            onNextClick: () => {
              this.fecharModal();
              setTimeout(() => this.tour.avancar(), 120);
            },
            onPrevClick: () => {
              this.fecharModal();
              this.tour.voltar();
            },
          },
        },
        {
          element: '#tour-tabela',
          popover: {
            title: 'Lista de clientes',
            description:
              'Cada linha é um hóspede: foto ou iniciais, nome e e-mail, CPF, ' +
              'data de nascimento e telefone.',
            side: 'top',
          },
        },
        {
          element: 'tr.cli-row .st-chip',
          skipMissingElement: true,
          popover: {
            title: 'Ativar / desativar',
            description:
              'Clique no selo para alternar entre <b>Ativo</b> e <b>Inativo</b>. ' +
              'Clientes inativos não entram em novas reservas.',
            side: 'top',
          },
        },
        {
          element: 'tr.cli-row .cli-acoes',
          skipMissingElement: true,
          popover: {
            title: 'Ações do cliente',
            description:
              'Os ícones permitem <b>editar</b> os dados, abrir os <b>documentos e a ficha ' +
              'FNRH</b>, <b>anonimizar</b> (LGPD) e <b>excluir</b> o cadastro (sempre com confirmação).',
            side: 'left',
          },
        },
        {
          element: '#tour-pag',
          popover: {
            title: 'Paginação',
            description: 'Escolha quantos clientes aparecem por página e navegue com as setas.',
            side: 'top',
          },
        },
        {
          popover: {
            title: 'Pronto!',
            description:
              'Você já conhece a tela de Clientes. Para rever, clique em <b>Tutorial</b> ' +
              'no topo a qualquer momento.',
          },
        },
      ],
      () => {
        if (this.modalAberto()) this.fecharModal();
      },
    );
  }

  abrirForm(cliente?: Cliente): void {
    this.editando.set(cliente ?? null);
    this.fotoPendente.set(null);
    this.fotoRemover.set(false);
    this.tentouSalvar.set(false);
    this.paisAberto.set(false);
    this.paisBusca.setValue('');
    this.nacAberto.set(false);
    this.nacIdx.set(-1);
    this.cepBuscando.set(false);
    this.cepErro.set(false);
    this.ultimoCep = '';
    if (!this.paises().length) {
      this.geo.listarPaises().subscribe({
        next: (l) => this.paises.set(l),
        error: () => {},
      });
    }
    this.liberarPreview();
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('cli-nome')?.focus(), 260);
    if (cliente?.tem_foto) {
      this.clientesApi.fotoCliente(cliente.id).subscribe({
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
    if (this.form.invalid) {
      this.tentouSalvar.set(true);
      this.form.markAllAsTouched();
      const el = document.querySelector('.drawer-body .inval, .drawer-body .ng-invalid input');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.notify.erroMsg('Preencha os campos obrigatórios destacados.');
      return;
    }
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
      ? this.clientesApi.atualizarCliente(cliente.id, input)
      : this.clientesApi.criarCliente(input);
    op.subscribe({
      next: (salvo) => this.persistirFoto(salvo, cliente),
      error: (e) => this.notify.erro(e),
    });
  }

  /** Campo inválido que já foi tocado ou após tentativa de salvar. */
  invalido(campo: string): boolean {
    const c = this.form.get(campo);
    return !!c && c.invalid && (c.touched || this.tentouSalvar());
  }

  // -- máscaras de digitação -------------------------------------------------

  mascaraCpf(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 9) v = d.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
    else if (d.length > 6) v = d.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
    else if (d.length > 3) v = d.replace(/(\d{3})(\d{0,3})/, '$1.$2');
    this.form.controls.cpf.setValue(v, { emitEvent: false });
  }

  mascaraTelefone(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 10) v = d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    else if (d.length > 6) v = d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    else if (d.length > 2) v = d.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    else if (d.length > 0) v = `(${d}`;
    this.form.controls.telefone.setValue(v, { emitEvent: false });
  }

  mascaraCep(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    const v = d.length > 5 ? d.replace(/(\d{5})(\d{0,3})/, '$1-$2') : d;
    this.form.controls.cep.setValue(v, { emitEvent: false });
    if (d.length === 8) this.buscarCep(d);
    else this.ultimoCep = '';
  }

  /** CEP completo -> ViaCEP preenche endereço; falhas ficam manuais. */
  private buscarCep(digitos: string): void {
    if (digitos === this.ultimoCep) return;
    this.ultimoCep = digitos;
    const req = ++this.cepReq;
    this.cepBuscando.set(true);
    this.cepErro.set(false);
    this.geo.buscarCep(digitos).subscribe({
      next: (r) => {
        if (req !== this.cepReq) return;
        this.cepBuscando.set(false);
        if (r?.erro || !r?.localidade) {
          this.cepErro.set(true);
          return;
        }
        this.form.patchValue({
          logradouro: r.logradouro || this.form.controls.logradouro.value,
          bairro: r.bairro || this.form.controls.bairro.value,
          cidade: r.localidade || this.form.controls.cidade.value,
          estado: r.uf || this.form.controls.estado.value,
          pais: this.form.controls.pais.value || 'Brasil',
        });
        document.getElementById('cli-num')?.focus();
      },
      error: () => {
        if (req === this.cepReq) this.cepBuscando.set(false);
      },
    });
  }

  // -- país (bandeiras + DDI) -----------------------------------------------

  togglePais(): void {
    this.paisAberto.update((v) => !v);
    if (this.paisAberto()) {
      this.paisBusca.setValue('');
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('.pais-busca-wrap input');
        el?.focus();
      });
    }
  }

  selecionarPais(p: PaisGeo): void {
    this.form.controls.pais.setValue(p.nome);
    this.paisAberto.set(false);
    this.paisBusca.setValue('');
  }

  /** Bandeira 40px (retina via srcset 80px) do CDN público flagcdn. */
  bandeira(cca2: string, w = 40): string {
    return `https://flagcdn.com/w${w}/${cca2.toLowerCase()}.png`;
  }

  // -- nacionalidade: dropdown filtrável ------------------------------------

  abrirNac(): void {
    this.nacAberto.set(true);
    this.nacIdx.set(-1);
  }

  selecionarNac(n: string): void {
    this.form.controls.nacionalidade.setValue(n);
    this.nacAberto.set(false);
    this.nacIdx.set(-1);
  }

  teclaNac(e: KeyboardEvent): void {
    const lista = this.nacFiltradas();
    if (e.key === 'Escape') {
      this.nacAberto.set(false);
      return;
    }
    if (!this.nacAberto() || !lista.length) {
      if (e.key === 'ArrowDown') this.abrirNac();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.nacIdx.set(Math.min(this.nacIdx() + 1, lista.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.nacIdx.set(Math.max(this.nacIdx() - 1, 0));
    } else if (e.key === 'Enter' && this.nacIdx() >= 0 && this.nacIdx() < lista.length) {
      e.preventDefault();
      this.selecionarNac(lista[this.nacIdx()]);
    }
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
        return new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
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
      ? this.clientesApi.uploadFotoCliente(salvo.id, pendente)
      : removida
        ? this.clientesApi.removerFotoCliente(salvo.id)
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
        this.clientesApi.fotoCliente(c.id).subscribe({
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
