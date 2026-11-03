import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Socket, Channel } from 'phoenix';
import { Accommodation, Amenity } from '../models/accommodation.model';
import { environment } from '../../../environments/environment';

// -----------------------------------------------------------------------------
// Formas do payload público da API (`GET /publico/acomodacoes`) — snake_case.
// Só chegam acomodações com CMS `publicado` + acomodação ativa no PMS.
// -----------------------------------------------------------------------------

interface MidiaApi {
  id: number;
  tipo: 'foto' | 'video';
  url: string;
  capa: boolean;
  ordem: number;
}

interface AcomodacaoPublica {
  id: number;
  slug: string;
  nome: string;
  numero: number;
  valor: string;
  capacidade: number;
  cor: string | null;
  subtitulo: string | null;
  descricao_curta: string | null;
  descricao_longa: string | null;
  destaque_editorial: string | null;
  camas: string | null;
  banheiros: number | null;
  metragem: string | null;
  vista: string | null;
  andar: string | null;
  comodidades: { name: string; icon: string; highlight?: boolean }[];
  destaque: boolean;
  ordem: number;
  midias: MidiaApi[];
}

const API = environment.apiUrl;
const API_ORIGIN = API.replace(/\/api\/v\d+\/?$/, '');

function absolutize(url: string): string {
  return url.startsWith('http') ? url : `${API_ORIGIN}${url}`;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function mapItem(a: AcomodacaoPublica): Accommodation {
  const fotos = a.midias.filter((m) => m.tipo === 'foto').sort((x, y) => x.ordem - y.ordem);
  const capa = fotos.find((m) => m.capa) ?? fotos[0];
  const valor = Number(a.valor);
  const temPreco = Number.isFinite(valor) && valor > 0;
  return {
    id: String(a.id),
    slug: a.slug,
    name: a.nome,
    subtitle: a.subtitulo ?? a.descricao_curta ?? '',
    shortDescription: a.descricao_curta ?? a.subtitulo ?? '',
    description: a.descricao_longa ?? a.descricao_curta ?? '',
    editorialQuote: a.destaque_editorial ?? undefined,
    price: temPreco ? valor : null,
    priceLabel: temPreco ? `${brl.format(valor)} / noite` : 'Sob consulta',
    guests: a.capacidade,
    beds: a.camas ?? 'Consulte a recepção',
    bathrooms: a.banheiros ?? 1,
    size: a.metragem ? Number(a.metragem) : null,
    view: a.vista ?? '',
    floor: a.andar ?? '',
    coverImage: capa ? absolutize(capa.url) : '',
    images: fotos.map((m) => absolutize(m.url)),
    videos: a.midias.filter((m) => m.tipo === 'video').map((m) => absolutize(m.url)),
    amenities: a.comodidades.map((c, i) => ({
      id: String(i + 1), name: c.name, icon: c.icon, highlight: c.highlight,
    })),
    featured: a.destaque,
    order: a.ordem,
  };
}

// Conteúdo de contingência (cache embutido): usado apenas se a API estiver
// indisponível — mantém a página apresentável em vez de uma seção vazia.
const FALLBACK: Accommodation[] = [
  {
    id: 'acc-1',
    slug: 'quarto-duplo-standard',
    name: 'Quarto Duplo Standard',
    subtitle: 'Conforto e praticidade para casais ou duas pessoas no Peró',
    shortDescription:
      'Acomodação climatizada para até 2 hóspedes, equipada com ar-condicionado, TV, frigobar e banheiro privativo.',
    description:
      'O Quarto Duplo Standard oferece um ambiente funcional e acolhedor para descansar após aproveitar a Praia do Peró. A unidade conta com ar-condicionado, televisão, frigobar e banheiro privativo com chuveiro. Disponível em configurações com cama de casal ou duas camas de solteiro, conforme disponibilidade no momento da reserva.',
    editorialQuote:
      'Praticidade e descanso a poucos minutos de caminhada da Praia do Peró, em Cabo Frio.',
    price: null,
    priceLabel: 'Sob consulta',
    guests: 2,
    beds: '1 cama de casal ou 2 camas de solteiro (sob consulta)',
    bathrooms: 1,
    size: null,
    view: 'Acesso às áreas internas da pousada',
    floor: 'Unidades no térreo ou piso superior (acesso por escadas)',
    coverImage:
      'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1600&q=85',
    images: [
      'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1600&q=85',
      'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1600&q=85'
    ],
    amenities: [
      { id: '1', name: 'Ar-condicionado', icon: 'wind', highlight: true },
      { id: '2', name: 'Banheiro privativo com chuveiro', icon: 'bath', highlight: true },
      { id: '3', name: 'Televisão de tela plana', icon: 'tv', highlight: true },
      { id: '4', name: 'Frigobar', icon: 'coffee' },
      { id: '5', name: 'Roupa de cama e toalhas (confirme itens na reserva)', icon: 'sparkles' },
      { id: '6', name: 'Wi-Fi nas áreas da pousada', icon: 'wifi' }
    ],
    featured: true,
    order: 1
  },
  {
    id: 'acc-2',
    slug: 'quarto-triplo-com-varanda',
    name: 'Quarto Triplo com Varanda',
    subtitle: 'Acomodação arejada com varanda para até 3 hóspedes',
    shortDescription:
      'Unidade para até 3 pessoas que conta com varanda, ar-condicionado, TV, frigobar e banheiro privativo.',
    description:
      'Ideal para pequenos grupos ou famílias de até 3 pessoas que valorizam um espaço externo privativo. Além de ar-condicionado, televisão, frigobar e banheiro privativo, esta categoria pertence às unidades específicas da pousada que dispõem de varanda. Como o número de quartos com varanda é limitado, recomendamos consultar a disponibilidade com antecedência.',
    editorialQuote:
      'Aproveite a brisa do bairro Peró em uma unidade equipada com varanda privativa.',
    price: null,
    priceLabel: 'Sob consulta',
    guests: 3,
    beds: '1 cama de casal e 1 cama de solteiro (sob consulta)',
    bathrooms: 1,
    size: null,
    view: 'Unidade com varanda',
    floor: 'Categoria específica sujeita à disponibilidade',
    coverImage:
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85',
    images: [
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85',
      'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1600&q=85'
    ],
    amenities: [
      { id: '1', name: 'Varanda privativa (categoria específica)', icon: 'sun', highlight: true },
      { id: '2', name: 'Ar-condicionado', icon: 'wind', highlight: true },
      { id: '3', name: 'Banheiro privativo', icon: 'bath', highlight: true },
      { id: '4', name: 'Televisão de tela plana', icon: 'tv' },
      { id: '5', name: 'Frigobar', icon: 'coffee' },
      { id: '6', name: 'Acesso à piscina externa da pousada', icon: 'waves' }
    ],
    featured: true,
    order: 2
  },
  {
    id: 'acc-3',
    slug: 'quarto-triplo-standard',
    name: 'Quarto Triplo Standard',
    subtitle: 'Hospedagem prática em Cabo Frio para até 3 pessoas',
    shortDescription:
      'Quarto climatizado para até 3 hóspedes, equipado com ar-condicionado, TV, frigobar e banheiro privativo.',
    description:
      'Pensado para famílias pequenas ou amigos que visitam Cabo Frio, o Quarto Triplo Standard reúne os itens essenciais para uma estadia tranquila no bairro Peró: ar-condicionado, televisão, frigobar e banheiro privativo, com fácil acesso à área da piscina e à Praia do Peró.',
    editorialQuote:
      'Conforto essencial para aproveitar os dias de sol na Região dos Lagos.',
    price: null,
    priceLabel: 'Sob consulta',
    guests: 3,
    beds: '1 cama de casal e 1 cama de solteiro (sob consulta)',
    bathrooms: 1,
    size: null,
    view: 'Acesso às áreas internas da pousada',
    floor: 'Térreo ou piso superior (conforme disponibilidade)',
    coverImage:
      'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1600&q=85',
    images: [
      'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1600&q=85',
      'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1600&q=85'
    ],
    amenities: [
      { id: '1', name: 'Ar-condicionado', icon: 'wind', highlight: true },
      { id: '2', name: 'Banheiro privativo', icon: 'bath', highlight: true },
      { id: '3', name: 'Televisão de tela plana', icon: 'tv' },
      { id: '4', name: 'Frigobar', icon: 'coffee' },
      { id: '5', name: 'Wi-Fi nas áreas da pousada', icon: 'wifi' }
    ],
    featured: true,
    order: 3
  },
  {
    id: 'acc-4',
    slug: 'quarto-quadruplo-standard',
    name: 'Quarto Quádruplo Standard',
    subtitle: 'Espaço funcional para famílias ou grupos de até 4 hóspedes',
    shortDescription:
      'Acomodação familiar para até 4 pessoas, com ar-condicionado, TV, frigobar e banheiro privativo.',
    description:
      'O Quarto Quádruplo Standard atende famílias e grupos de até 4 pessoas que desejam se hospedar próximos à Praia do Peró. Conta com ar-condicionado, televisão, frigobar e banheiro privativo. Consulte diretamente a recepção para confirmar a disposição das camas disponível para o período da sua viagem.',
    editorialQuote:
      'Ambiente acolhedor para reunir a família em Cabo Frio.',
    price: null,
    priceLabel: 'Sob consulta',
    guests: 4,
    beds: '1 cama de casal e 2 camas de solteiro (sob consulta)',
    bathrooms: 1,
    size: null,
    view: 'Acesso às áreas internas da pousada',
    floor: 'Térreo ou piso superior (conforme disponibilidade)',
    coverImage:
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1600&q=85',
    images: [
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1600&q=85',
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85'
    ],
    amenities: [
      { id: '1', name: 'Capacidade para até 4 hóspedes', icon: 'users', highlight: true },
      { id: '2', name: 'Ar-condicionado', icon: 'wind', highlight: true },
      { id: '3', name: 'Banheiro privativo', icon: 'bath', highlight: true },
      { id: '4', name: 'Televisão de tela plana', icon: 'tv' },
      { id: '5', name: 'Frigobar', icon: 'coffee' },
      { id: '6', name: 'Acesso à piscina externa', icon: 'waves' }
    ],
    featured: true,
    order: 4
  }
];

@Injectable({ providedIn: 'root' })
export class AccommodationService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly accommodationsState = signal<Accommodation[]>(FALLBACK);
  private socket: Socket | null = null;
  private canal: Channel | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;

  public readonly accommodations = this.accommodationsState.asReadonly();
  public readonly featuredAccommodations = computed(() =>
    this.accommodationsState().filter((item) => item.featured).sort((a, b) => a.order - b.order)
  );

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      void this.carregar();
      this.conectarStream();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.carregar();
      });
    }
  }

  /** Refetch completo do catálogo público. Sempre reflete o estado publicado no CMS. */
  private async carregar(): Promise<void> {
    try {
      const res = await fetch(`${API}/publico/acomodacoes`, { cache: 'no-store' });
      if (!res.ok) return;
      const dados = (await res.json()) as AcomodacaoPublica[];
      this.accommodationsState.set(dados.map(mapItem));
    } catch {
      // API indisponível → mantém o estado atual (ou FALLBACK inicial).
    }
  }

  /**
   * Realtime público (hub Phoenix, tópico `site:deltas`): qualquer delta de
   * acomodacao/cms/mídia refaz o fetch na hora. Sem auth — o hub só publica
   * nesse tópico tabelas da whitelist pública.
   */
  private conectarStream(): void {
    try {
      const socket = new Socket(environment.realtimeUrl, {
        reconnectAfterMs: (t) => Math.min(1000 * 2 ** t, 15000),
      });
      this.socket = socket;
      socket.onOpen(() => void this.carregar());
      this.canal = socket.channel('site:deltas');
      this.canal.on('delta', () => this.agendarRefetch());
      this.canal.join();
      socket.connect();
    } catch {
      // Sem realtime → conteúdo estático da última carga.
    }
  }

  /** Debounce curto: rajadas de deltas (upload + salvar + publicar) viram 1 fetch rápido. */
  private agendarRefetch(): void {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => void this.carregar(), 250);
  }

  public getBySlug(slug: string): Accommodation | undefined {
    return this.accommodationsState().find((item) => item.slug === slug);
  }

  public getById(id: string): Accommodation | undefined {
    return this.accommodationsState().find((item) => item.id === id);
  }
}
