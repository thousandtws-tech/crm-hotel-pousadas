// Lógica e estado de cms — separada da camada de UI (cms.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, computed, OnInit, effect, ElementRef, Directive } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { CmsApi } from '@core/api/cms.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num.utils';
import { AuthStore } from '@core/services/auth.store';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { TourService } from '@core/services/tour.service';
import * as M from '@core/models';
import type { Signal } from '@angular/core';

interface ComodidadeForm {
  name: string;
  icon: string;
  highlight: boolean;
}

const PRESETS_COMODIDADES: ComodidadeForm[] = [
  { name: 'Ar-condicionado', icon: 'wind', highlight: true },
  { name: 'Banheiro privativo com chuveiro', icon: 'bath', highlight: true },
  { name: 'Televisão de tela plana', icon: 'tv', highlight: true },
  { name: 'Frigobar', icon: 'coffee', highlight: false },
  { name: 'Wi-Fi nas áreas da pousada', icon: 'wifi', highlight: false },
  { name: 'Varanda privativa', icon: 'sun', highlight: true },
  { name: 'Roupa de cama e toalhas', icon: 'sparkles', highlight: false },
  { name: 'Acesso à piscina externa', icon: 'waves', highlight: false },
];

export const ICONES_SITE: { id: string; label: string }[] = [
  { id: 'wind', label: 'Ar-condicionado (wind)' },
  { id: 'bath', label: 'Banheiro / Chuveiro (bath)' },
  { id: 'tv', label: 'Televisão (tv)' },
  { id: 'coffee', label: 'Frigobar / Café (coffee)' },
  { id: 'wifi', label: 'Wi-Fi (wifi)' },
  { id: 'sun', label: 'Varanda / Sol (sun)' },
  { id: 'sparkles', label: 'Conforto / Enxoval (sparkles)' },
  { id: 'waves', label: 'Piscina / Mar (waves)' },
  { id: 'users', label: 'Capacidade / Família (users)' },
  { id: 'bed', label: 'Cama (bed)' },
  { id: 'maximize', label: 'Espaço / Área (maximize)' },
  { id: 'eye', label: 'Vista (eye)' },
  { id: 'star', label: 'Destaque (star)' },
  { id: 'check', label: 'Item incluso (check)' },
];

type FiltroPub = 'todos' | 'pub' | 'rasc';
type AbaCms = 'quartos' | 'site' | 'widget';

@Directive()
export abstract class CmsStore implements OnInit {
  declare protected readonly lightboxEl: Signal<ElementRef<HTMLElement> | undefined>;
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly cmsApi = inject(CmsApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmService);
  private readonly tour = inject(TourService);
  protected readonly rt = inject(RealtimeService);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly aba = signal<AbaCms>('quartos');
  protected readonly items = signal<M.AcomodacaoCmsView[]>([]);
  protected readonly tipos = signal<M.TipoAcomodacao[]>([]);
  protected readonly carregando = signal(true);
  protected readonly modalAberto = signal(false);
  protected readonly modoNovo = signal(false);
  protected readonly editando = signal<M.AcomodacaoCmsView | null>(null);
  protected readonly editandoMidias = signal<M.Midia[]>([]);
  protected readonly thumbs = signal<Record<number, string>>({});
  protected readonly midiaBlobs = signal<Record<number, string>>({});
  protected readonly enviando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly comodidades = signal<ComodidadeForm[]>([]);
  protected readonly termo = signal('');
  protected readonly filtro = signal<FiltroPub>('todos');
  protected readonly buscaFoco = signal(false);
  protected readonly previewIdx = signal<number | null>(null);
  protected readonly preview = computed<M.Midia | null>(() => {
    const i = this.previewIdx();
    return i === null ? null : (this.editandoMidias()[i] ?? null);
  });

  protected readonly skel = [0, 1, 2, 3];

  protected readonly num = num;
  protected readonly Number = Number;
  protected readonly presets = PRESETS_COMODIDADES;
  protected readonly iconesSite = ICONES_SITE;

  protected readonly totalPublicados = computed(
    () => this.items().filter((a) => a.ativo && a.cms?.status === 'publicado').length,
  );
  protected readonly totalRascunhos = computed(() => this.items().length - this.totalPublicados());
  protected readonly semFotos = computed(
    () => this.items().filter((a) => !a.midias.some((m) => m.tipo === 'foto')).length,
  );
  protected readonly filtrados = computed(() => {
    const t = this.termo().trim().toLowerCase();
    const f = this.filtro();
    return this.items().filter((a) => {
      if (f === 'pub' && !(a.ativo && a.cms?.status === 'publicado')) return false;
      if (f === 'rasc' && a.ativo && a.cms?.status === 'publicado') return false;
      if (!t) return true;
      return (
        a.nome.toLowerCase().includes(t) ||
        String(a.numero).includes(t) ||
        (a.cms?.slug ?? '').toLowerCase().includes(t) ||
        (a.cms?.subtitulo ?? '').toLowerCase().includes(t)
      );
    });
  });

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    numero: [101, [Validators.required, Validators.min(1)]],
    idtipo_acomodacao: [null as number | null],
    capacidade: [2, [Validators.required, Validators.min(1)]],
    valor: [0],
    slug: [''],
    subtitulo: ['', Validators.required],
    descricao_curta: [''],
    descricao_longa: [''],
    destaque_editorial: [''],
    camas: [''],
    banheiros: [1 as number | null],
    metragem: [null as number | null],
    vista: [''],
    andar: [''],
    ordem: [1],
    destaque: [true],
  });

  protected readonly widget = signal<{ url: string; qr_svg: string; snippet: string } | null>(null);
  protected readonly siteUrl = computed(() => {
    const u = this.widget()?.url;
    return u ? u.replace(/\/reservar\/?$/, '') : '';
  });
  protected readonly qrSrc = computed(() => {
    const svg = this.widget()?.qr_svg;
    return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : '';
  });

  protected readonly siteForm = this.fb.nonNullable.group({
    hero_titulo: [''],
    hero_subtitulo: [''],
    seo_titulo: [''],
    seo_descricao: [''],
    seo_keywords: [''],
  });
  protected readonly faq = signal<{ pergunta: string; resposta: string }[]>([]);
  protected readonly salvandoSite = signal(false);

  private cmsVersion = 0;
  private pmsVersion = 0;

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('acomodacao', 'acomodacao_cms', 'acomodacao_midia');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo && !this.modalAberto()) {
        ultimo = v;
        this.carregar();
      }
    });
    effect(() => {
      if (this.previewIdx() !== null) this.lightboxEl()?.nativeElement.focus();
    });
  }

  ngOnInit(): void {
    this.carregar();
    this.acomodacoesApi.listarTipos(true).subscribe({
      next: (ts) => this.tipos.set(ts),
      error: () => {},
    });
    this.reservasApi.widgetMotor().subscribe({
      next: (w) => this.widget.set(w),
      error: () => {},
    });
    this.carregarSite();
  }

  private carregarSite(): void {
    this.cmsApi.listarSiteSecoes().subscribe({
      next: (secoes) => {
        const por = new Map(secoes.map((s) => [s.secao, s.dados]));
        const str = (d: Record<string, unknown> | undefined, k: string, padrao = '') =>
          d ? (typeof d[k] === 'string' ? (d[k] as string) : '') : padrao;
        this.siteForm.patchValue({
          hero_titulo: str(
            por.get('hero'),
            'titulo',
            'Pousada Espírito do Mar: sua estadia pertinho da Praia do Peró',
          ),
          hero_subtitulo: str(
            por.get('hero'),
            'subtitulo',
            'Em Cabo Frio, aproveite dias de descanso em uma pousada acolhedora, com piscina e fácil acesso à Praia do Peró.',
          ),
          seo_titulo: str(
            por.get('seo'),
            'titulo',
            'Pousada Espírito do Mar | Hospedagem no Peró, Cabo Frio',
          ),
          seo_descricao: str(
            por.get('seo'),
            'descricao',
            'Conheça a Pousada Espírito do Mar, no Peró, em Cabo Frio. Explore as acomodações, conheça a estrutura e consulte a disponibilidade.',
          ),
          seo_keywords: str(
            por.get('seo'),
            'keywords',
            'Pousada Espírito do Mar, pousada no Peró, pousada em Cabo Frio, hospedagem perto da Praia do Peró, Cabo Frio RJ',
          ),
        });
        const itens = por.get('faq')?.['itens'];
        if (Array.isArray(itens)) {
          this.faq.set(
            itens
              .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
              .map((i) => ({
                pergunta: typeof i['pergunta'] === 'string' ? i['pergunta'] : '',
                resposta: typeof i['resposta'] === 'string' ? i['resposta'] : '',
              })),
          );
        }
      },
      error: () => {},
    });
  }

  private montarDadosSite(secao: 'hero' | 'seo' | 'faq'): M.CmsSecaoDados {
    const v = this.siteForm.getRawValue();
    if (secao === 'hero') {
      return { titulo: v.hero_titulo.trim(), subtitulo: v.hero_subtitulo.trim() };
    }
    if (secao === 'seo') {
      return {
        titulo: v.seo_titulo.trim(),
        descricao: v.seo_descricao.trim(),
        keywords: v.seo_keywords.trim(),
      };
    }
    return {
      itens: this.faq()
        .map((f) => ({ pergunta: f.pergunta.trim(), resposta: f.resposta.trim() }))
        .filter((f) => f.pergunta && f.resposta),
    };
  }

  protected salvarSite(secao: 'hero' | 'seo' | 'faq'): void {
    this.salvandoSite.set(true);
    this.cmsApi.salvarSiteSecao(secao, this.montarDadosSite(secao)).subscribe({
      next: () => {
        this.salvandoSite.set(false);
        this.notify.ok('Seção salva — o site já reflete a mudança.');
      },
      error: (e) => {
        this.salvandoSite.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected async salvarTudoSite(): Promise<void> {
    this.salvandoSite.set(true);
    try {
      await Promise.all([
        firstValueFrom(this.cmsApi.salvarSiteSecao('hero', this.montarDadosSite('hero'))),
        firstValueFrom(this.cmsApi.salvarSiteSecao('seo', this.montarDadosSite('seo'))),
        firstValueFrom(this.cmsApi.salvarSiteSecao('faq', this.montarDadosSite('faq'))),
      ]);
      this.notify.ok('Página inicial, SEO e FAQ salvos e publicados no site.');
    } catch (e) {
      this.notify.erro(e);
    } finally {
      this.salvandoSite.set(false);
    }
  }

  protected addFaq(): void {
    this.faq.update((l) => [...l, { pergunta: '', resposta: '' }]);
  }

  protected delFaq(i: number): void {
    this.faq.update((l) => l.filter((_, j) => j !== i));
  }

  protected setFaq(i: number, campo: 'pergunta' | 'resposta', ev: Event): void {
    const valor = (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.faq.update((l) => l.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
  }

  copiarWidget(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('Copiado.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }

  onEsc(): void {
    if (this.previewIdx() !== null) {
      this.fecharPreview();
      return;
    }
    if (this.modalAberto()) this.fecharEditor();
  }

  onSeta(dir: 1 | -1): void {
    if (this.previewIdx() !== null) this.navPreview(dir);
  }

  abrirPreview(i: number): void {
    this.previewIdx.set(i);
  }

  fecharPreview(): void {
    this.previewIdx.set(null);
  }

  navPreview(dir: 1 | -1): void {
    const n = this.editandoMidias().length;
    if (n < 2) return;
    this.previewIdx.update((i) => (i === null ? null : (i + dir + n) % n));
  }

  carregar(): void {
    this.cmsApi.listarCms().subscribe({
      next: (it) => {
        this.items.set(it);
        this.carregando.set(false);
        this.carregarThumbs(it);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erroMsg('Falha ao carregar os quartos do CMS.');
      },
    });
  }

  contar(a: M.AcomodacaoCmsView, tipo: string): number {
    return a.midias.filter((m) => m.tipo === tipo).length;
  }

  private carregarThumbs(it: M.AcomodacaoCmsView[]): void {
    for (const a of it) {
      const fotos = a.midias.filter((m) => m.tipo === 'foto');
      const capa = fotos.find((m) => m.capa) ?? fotos[0];
      if (capa) {
        this.cmsApi.midiaBlob(capa.id).subscribe({
          next: (b) => this.thumbs.update((t) => ({ ...t, [a.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      }
    }
  }

  midiaUrl(id: number): string {
    return this.midiaBlobs()[id] ?? '';
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  abrirNovo(): void {
    const proxNumero = this.items().reduce((m, a) => Math.max(m, a.numero), 100) + 1;
    const proxOrdem = this.items().length + 1;
    this.cmsVersion = 0;
    this.pmsVersion = 0;
    this.modoNovo.set(true);
    this.editando.set(null);
    this.editandoMidias.set([]);
    this.comodidades.set([
      { name: 'Ar-condicionado', icon: 'wind', highlight: true },
      { name: 'Banheiro privativo com chuveiro', icon: 'bath', highlight: true },
      { name: 'Televisão de tela plana', icon: 'tv', highlight: true },
      { name: 'Frigobar', icon: 'coffee', highlight: false },
      { name: 'Wi-Fi nas áreas da pousada', icon: 'wifi', highlight: false },
    ]);
    this.form.reset({
      nome: '',
      numero: proxNumero,
      idtipo_acomodacao: this.tipos()[0]?.id ?? null,
      capacidade: 2,
      valor: 0,
      slug: '',
      subtitulo: '',
      descricao_curta: '',
      descricao_longa: '',
      destaque_editorial: '',
      camas: '1 cama de casal',
      banheiros: 1,
      metragem: null,
      vista: 'Acesso às áreas internas da pousada',
      andar: 'Térreo ou piso superior',
      ordem: proxOrdem,
      destaque: true,
    });
    this.modalAberto.set(true);
  }

  abrirEditor(a: M.AcomodacaoCmsView): void {
    const c = a.cms;
    this.cmsVersion = c?.version ?? 0;
    this.pmsVersion = a.version;
    this.modoNovo.set(false);
    this.editando.set(a);
    this.form.reset({
      nome: a.nome,
      numero: a.numero,
      idtipo_acomodacao: a.idtipo_acomodacao,
      capacidade: a.capacidade,
      valor: Number(a.valor) || 0,
      slug: c?.slug ?? '',
      subtitulo: c?.subtitulo ?? a.descricao ?? '',
      descricao_curta: c?.descricao_curta ?? a.descricao ?? '',
      descricao_longa: c?.descricao_longa ?? '',
      destaque_editorial: c?.destaque_editorial ?? '',
      camas: c?.camas ?? '',
      banheiros: c?.banheiros ?? 1,
      metragem: c?.metragem ? Number(c.metragem) : null,
      vista: c?.vista ?? '',
      andar: c?.andar ?? '',
      ordem: c?.ordem ?? 1,
      destaque: c?.destaque ?? true,
    });
    this.comodidades.set(
      (c?.comodidades ?? []).map((x) => ({
        name: x.name,
        icon: x.icon || 'check',
        highlight: !!x.highlight,
      })),
    );
    this.editandoMidias.set([...a.midias].sort((x, y) => x.ordem - y.ordem || x.id - y.id));
    for (const m of a.midias) {
      if (!this.midiaBlobs()[m.id]) {
        this.cmsApi.midiaBlob(m.id).subscribe({
          next: (b) => this.midiaBlobs.update((t) => ({ ...t, [m.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      }
    }
    this.modalAberto.set(true);
  }

  fecharEditor(): void {
    this.previewIdx.set(null);
    this.modalAberto.set(false);
    this.editando.set(null);
  }

  temComodidade(name: string): boolean {
    return this.comodidades().some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  togglePreset(p: ComodidadeForm): void {
    if (this.temComodidade(p.name)) {
      this.comodidades.update((list) =>
        list.filter((c) => c.name.toLowerCase() !== p.name.toLowerCase()),
      );
    } else {
      this.comodidades.update((list) => [...list, { ...p }]);
    }
  }

  addComodidade(): void {
    this.comodidades.update((c) => [...c, { name: '', icon: 'check', highlight: false }]);
  }

  delComodidade(i: number): void {
    this.comodidades.update((c) => c.filter((_, x) => x !== i));
  }

  atualizarComodidadeNome(i: number, ev: Event): void {
    const val = (ev.target as HTMLInputElement).value;
    this.comodidades.update((list) =>
      list.map((item, idx) => (idx === i ? { ...item, name: val } : item)),
    );
  }

  atualizarComodidadeIcone(i: number, val: string): void {
    this.comodidades.update((list) =>
      list.map((item, idx) => (idx === i ? { ...item, icon: val } : item)),
    );
  }

  atualizarComodidadeDestaque(i: number, ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    this.comodidades.update((list) =>
      list.map((item, idx) => (idx === i ? { ...item, highlight: checked } : item)),
    );
  }

  async salvar(publicarDepois: boolean): Promise<void> {
    const v = this.form.getRawValue();
    if (!v.nome.trim()) {
      this.notify.erroMsg('Informe o nome do quarto.');
      return;
    }
    if (!v.subtitulo.trim()) {
      this.notify.erroMsg('Informe o subtítulo do quarto para o site.');
      return;
    }

    this.salvando.set(true);
    try {
      let acomId = this.editando()?.id;

      const acomInput: M.AcomodacaoInput = {
        idtipo_acomodacao: v.idtipo_acomodacao,
        nome: v.nome.trim(),
        numero: Number(v.numero) || 101,
        valor: Number(v.valor) || 0,
        capacidade: Number(v.capacidade) || 2,
        descricao: v.descricao_curta.trim() || v.subtitulo.trim(),
        cor: this.editando()?.cor ?? '#18181b',
        version: acomId ? this.pmsVersion : undefined,
      };

      if (!acomId) {
        const criada = await firstValueFrom(this.acomodacoesApi.criarAcomodacao(acomInput));
        acomId = criada.id;
        this.pmsVersion = criada.version;
        firstValueFrom(this.acomodacoesApi.criarQuarto(acomId, String(acomInput.numero))).catch(
          () => {},
        );
      } else {
        const atualizada = await firstValueFrom(
          this.acomodacoesApi.atualizarAcomodacao(acomId, acomInput),
        );
        this.pmsVersion = atualizada.version;
      }

      const cmsInput: M.CmsInput = {
        slug: v.slug.trim() || null,
        subtitulo: v.subtitulo.trim(),
        descricao_curta: v.descricao_curta.trim() || null,
        descricao_longa: v.descricao_longa.trim() || null,
        destaque_editorial: v.destaque_editorial.trim() || null,
        camas: v.camas.trim() || null,
        banheiros: v.banheiros,
        metragem: v.metragem,
        vista: v.vista.trim() || null,
        andar: v.andar.trim() || null,
        comodidades: this.comodidades().filter((c) => c.name.trim() !== ''),
        destaque: v.destaque,
        ordem: Number(v.ordem) || 0,
        version: this.cmsVersion || undefined,
      };

      const cmsSalvo = await firstValueFrom(this.cmsApi.salvarCms(acomId, cmsInput));
      this.cmsVersion = cmsSalvo.version;

      if (publicarDepois) {
        await firstValueFrom(this.cmsApi.statusCms(acomId, true));
        this.notify.ok('Quarto gravado e publicado no site em tempo real.');
      } else {
        this.notify.ok('Quarto gravado com sucesso.');
      }

      this.carregar();
      this.fecharEditor();
    } catch (e) {
      this.notify.erro(e);
    } finally {
      this.salvando.set(false);
    }
  }

  togglePublicacao(a: M.AcomodacaoCmsView, publicar: boolean): void {
    this.cmsApi.statusCms(a.id, publicar).subscribe({
      next: () => {
        this.notify.ok(publicar ? 'Quarto publicado no site.' : 'Quarto movido para rascunho.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  toggleAtivo(a: M.AcomodacaoCmsView): void {
    this.acomodacoesApi.statusAcomodacao(a.id, !a.ativo).subscribe({
      next: () => {
        this.notify.ok(!a.ativo ? 'Quarto ativado.' : 'Quarto desativado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async upload(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const files = inputEl.files ? Array.from(inputEl.files) : [];
    if (files.length === 0) return;

    let acomId = this.editando()?.id;

    if (!acomId) {
      const v = this.form.getRawValue();
      if (!v.nome.trim()) {
        this.notify.erroMsg('Preencha primeiro o Nome do quarto antes de enviar fotos.');
        inputEl.value = '';
        return;
      }
      try {
        this.enviando.set(true);
        const criada = await firstValueFrom(
          this.acomodacoesApi.criarAcomodacao({
            idtipo_acomodacao: v.idtipo_acomodacao,
            nome: v.nome.trim(),
            numero: Number(v.numero) || 101,
            valor: Number(v.valor) || 0,
            capacidade: Number(v.capacidade) || 2,
            descricao: v.subtitulo.trim() || v.nome.trim(),
            cor: '#18181b',
          }),
        );
        acomId = criada.id;
        this.pmsVersion = criada.version;
        this.modoNovo.set(false);
        this.editando.set({
          ...criada,
          cms: null,
          midias: [],
        });
      } catch (e) {
        this.enviando.set(false);
        this.notify.erro(e);
        return;
      }
    }

    this.enviando.set(true);
    for (const file of files) {
      try {
        const m = await firstValueFrom(this.cmsApi.uploadMidia(acomId, file));
        this.editandoMidias.update((l) => [...l, m]);
        this.cmsApi.midiaBlob(m.id).subscribe({
          next: (b) => this.midiaBlobs.update((t) => ({ ...t, [m.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      } catch (e) {
        this.notify.erro(e);
      }
    }
    this.enviando.set(false);
    inputEl.value = '';
    this.carregar();
  }

  async excluirQuarto(a: M.AcomodacaoCmsView): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o quarto ${a.nome} (Nº${a.numero})? Todo o conteúdo do site e as mídias armazenadas serão apagados.`,
      { titulo: 'Excluir quarto', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.acomodacoesApi.excluirAcomodacao(a.id).subscribe({
      next: (r) => {
        this.notify.ok(r.mensagem);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async removerMidia(m: M.Midia): Promise<void> {
    const ok = await this.confirm.perguntar('Remover esta mídia da galeria e do armazenamento?', {
      titulo: 'Remover mídia',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.fecharPreview();
    this.cmsApi.removerMidia(m.id).subscribe({
      next: () => {
        this.editandoMidias.update((l) => l.filter((x) => x.id !== m.id));
        this.carregar();
      },
      error: () => this.notify.erroMsg('Falha ao remover a mídia.'),
    });
  }

  capa(id: number): void {
    this.cmsApi.definirCapa(id).subscribe({
      next: () => {
        this.editandoMidias.update((l) => l.map((x) => ({ ...x, capa: x.id === id })));
        this.carregar();
      },
      error: () => this.notify.erroMsg('Falha ao definir a capa.'),
    });
  }

  mover(i: number, dir: number): void {
    const a = this.editando();
    const l = [...this.editandoMidias()];
    const j = i + dir;
    if (!a || j < 0 || j >= l.length) return;
    this.fecharPreview();
    [l[i], l[j]] = [l[j], l[i]];
    this.editandoMidias.set(l);
    this.cmsApi
      .ordenarMidias(
        a.id,
        l.map((m) => m.id),
      )
      .subscribe({
        error: () => this.notify.erroMsg('Falha ao reordenar.'),
      });
  }

  iniciarTour(): void {
    this.aba.set('quartos');
    this.tour.iniciar([
      {
        popover: {
          title: 'Conteúdo do site',
          description:
            'Gerencie as <b>acomodações</b>, a <b>página inicial / SEO</b> e a <b>integração do motor</b> em abas separadas.',
        },
      },

      {
        element: '#tour-resumo',
        popover: {
          title: 'Resumo da operação',
          description:
            'Acompanhe o total de acomodações, quantas estão publicadas, em rascunho ou sem fotos.',
          side: 'bottom',
        },
      },
      {
        element: '.cms-busca',
        popover: {
          title: 'Busca e filtros',
          description:
            'Filtre por nome, número ou slug e alterne entre todos, publicados e rascunhos.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de acomodações',
          description:
            'Alterne o status do sistema e da publicação direto na linha ou abra o editor completo.',
          side: 'top',
        },
      },
      {
        element: '#tour-novo',
        popover: {
          title: 'Editor unificado',
          description:
            'Cadastre dados e tarifa, textos editoriais, comodidades e galeria de fotos e vídeos.',
          side: 'bottom',
        },
      },
    ]);
  }
}
