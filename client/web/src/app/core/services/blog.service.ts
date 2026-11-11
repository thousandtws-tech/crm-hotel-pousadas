import { Injectable, signal, computed } from '@angular/core';

export interface BlogSection {
  titulo: string;
  paragrafos: string[];
}

export interface BlogPost {
  slug: string;
  titulo: string;
  resumo: string;
  categoria: string;
  data: string;
  tempoLeitura: string;
  imagem: string;
  imagemAlt: string;
  secoes: BlogSection[];
  keywords: string;
}

const POSTS: BlogPost[] = [
  {
    slug: 'o-que-fazer-na-praia-do-pero',
    titulo: 'O que fazer na Praia do Peró: guia completo do bairro',
    resumo:
      'Águas cristalinas, dunas preservadas e estrutura de quiosques — conheça a praia mais procurada de Cabo Frio e o que fazer a poucos metros da pousada.',
    categoria: 'Praias',
    data: '2026-10-15',
    tempoLeitura: '6 min',
    imagem:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85',
    imagemAlt: 'Praia do Peró em Cabo Frio com águas claras e faixa de areia extensa',
    keywords:
      'praia do peró, o que fazer no peró, cabo frio praias, quiosques praia do peró, dunas do peró',
    secoes: [
      {
        titulo: 'Por que a Praia do Peró é tão procurada',
        paragrafos: [
          'A Praia do Peró é um dos cartões-postais de Cabo Frio: uma faixa extensa de areia clara e fina, com águas conhecidas pela transparência — em dias de mar calmo é possível enxergar os pés dentro da água. O bairro homônimo cresceu ao redor da praia e mantém clima residencial, mais tranquilo que o agito do centro e da Praia do Forte.',
          'A faixa de areia larga favorece caminhadas no fim de tarde, e a presença de dunas preservadas em alguns trechos dá à paisagem um visual diferente das praias urbanas da região.',
        ],
      },
      {
        titulo: 'Quiosques e estrutura na orla',
        paragrafos: [
          'Ao longo da orla funcionam quiosques com cadeiras, guarda-sóis e serviço de praia — petiscos, frutos do mar e bebidas servidos direto na areia. Nos fins de semana e na alta temporada eles concentram o movimento, com música ao vivo em alguns pontos.',
          'Para quem prefere trechos mais vazios, basta caminhar alguns minutos para os lados: a praia tem vários quilômetros e sempre há espaço para estender a canga com tranquilidade.',
        ],
      },
      {
        titulo: 'Esportes e atividades',
        paragrafos: [
          'O Peró é um dos points de surf e bodyboard de Cabo Frio, especialmente nos trechos com formação de ondas mais constante. Em períodos de vento favorável, a praia também recebe praticantes de kitesurf.',
          'Para famílias com crianças, os trechos de mar mais calmo — geralmente próximos aos quiosques centrais — são os mais indicados. Vale sempre observar a sinalização dos guarda-vidas.',
        ],
      },
      {
        titulo: 'Dicas práticas',
        paragrafos: [
          'Chegue cedo em feriados e alta temporada para garantir vaga nos quiosques. Leve protetor solar e reaplique — o reflexo da areia clara intensifica o sol. No fim da tarde, o pôr do sol visto da faixa de areia é um dos mais bonitos da cidade.',
          'Hospedando-se na Pousada Espírito do Mar, você fica a cerca de 200 metros da praia — dá para ir a pé, voltar para o almoço e retornar sem se preocupar com deslocamento.',
        ],
      },
    ],
  },
  {
    slug: 'guia-completo-cabo-frio-regiao-dos-lagos',
    titulo: 'Guia completo de Cabo Frio: praias, história e gastronomia',
    resumo:
      'Da Praia do Forte ao Forte São Mateus, do centro histórico aos restaurantes do Bairro da Passagem — o que conhecer em Cabo Frio além da sua praia favorita.',
    categoria: 'Destino',
    data: '2026-10-10',
    tempoLeitura: '8 min',
    imagem:
      'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=1600&q=85',
    imagemAlt: 'Orla de Cabo Frio com areia clara e mar azul',
    keywords:
      'cabo frio o que fazer, praias de cabo frio, região dos lagos, bairro da passagem, forte são mateus',
    secoes: [
      {
        titulo: 'As praias de Cabo Frio',
        paragrafos: [
          'A Praia do Forte é a mais famosa: extensa, com a areia branca característica da cidade e o Forte São Mateus ao fundo. Já a Praia do Peró, onde fica a pousada, oferece clima mais residencial e quiosques na orla.',
          'Outros trechos que valem a visita: as Conchas, enseada menor e protegida de ventos, ideal para crianças; e a Praia Brava, mais selvagem e procurada por surfistas.',
        ],
      },
      {
        titulo: 'Centro histórico e Forte São Mateus',
        paragrafos: [
          'O Bairro da Passagem é o núcleo histórico da cidade: casario colonial, igreja de São Benedito e o canal que liga a Lagoa de Araruama ao mar. À noite, a região concentra restaurantes e bares com vista para o canal.',
          'O Forte São Mateus, construção de 1618 na ponta da Praia do Forte, é aberto à visitação e rende fotos com vista panorâmica da orla — um passeio curto que vale muito.',
        ],
      },
      {
        titulo: 'Gastronomia: o que comer',
        paragrafos: [
          'Cabo Frio é referência em frutos do mar. Os clássicos da cidade incluem o camarão (servido em diferentes preparos), peixes grelhados e lula. No Bairro da Passagem há opções que vão do quilo simples a restaurantes mais elaborados.',
          'Não deixe de provar os quiosques de beira de praia — o pastel de camarão e a porção de lula à dorê são unanimidade. Para o café da manhã fora da pousada, padarias no comércio local do Peró funcionam desde cedo.',
        ],
      },
      {
        titulo: 'Como se deslocar',
        paragrafos: [
          'Do bairro Peró ao centro são poucos minutos de carro. Quem vem sem veículo pode usar aplicativos de transporte, que funcionam bem na cidade, ou ônibus locais que ligam o Peró ao centro e a outros bairros.',
          'Para conhecer Arraial do Cabo e Búzios no mesmo roteiro, as duas cidades ficam a cerca de 15 e 35 minutos de carro — dá para fazer bate-volta com tranquilidade.',
        ],
      },
    ],
  },
  {
    slug: 'melhor-epoca-visitar-regiao-dos-lagos',
    titulo: 'Qual a melhor época para visitar Cabo Frio e a Região dos Lagos?',
    resumo:
      'Alta temporada, clima, vento e preços: quando vale mais a pena planejar a viagem para aproveitar as praias da Região dos Lagos.',
    categoria: 'Planejamento',
    data: '2026-10-05',
    tempoLeitura: '5 min',
    imagem:
      'https://images.unsplash.com/photo-1505142468610-359e7d316be0?auto=format&fit=crop&w=1600&q=85',
    imagemAlt: 'Mar azul e céu limpo em praia da Região dos Lagos',
    keywords:
      'melhor época cabo frio, clima região dos lagos, alta temporada cabo frio, quando ir cabo frio',
    secoes: [
      {
        titulo: 'Clima na Região dos Lagos',
        paragrafos: [
          'A Região dos Lagos tem clima tropical seco, com sol na maior parte do ano — é uma das regiões com mais dias de céu limpo do estado do Rio. O verão (dezembro a março) é quente, com temperaturas entre 25°C e 32°C.',
          'O vento é uma marca registrada: no segundo semestre sopra mais forte, o que atrai praticantes de kitesurf, mas pode deixar o mar mais agitado em alguns dias.',
        ],
      },
      {
        titulo: 'Alta temporada x. baixa temporada',
        paragrafos: [
          'Dezembro, janeiro, Carnaval e feriadões são o auge do movimento: praias cheias, quiosques disputados e tarifas mais altas em toda a região. Quem busca agito e vida noturna, é a época certa — mas reserve com antecedência.',
          'Março a junho e agosto a novembro são o chamado "meio de temporada": clima ainda ótimo para praia, tarifas mais acessíveis e a cidade mais tranquila. Para quem prefere descanso, é a melhor janela.',
        ],
      },
      {
        titulo: 'Julho: vale a pena?',
        paragrafos: [
          'Julho é férias escolares e o movimento aumenta, mas sem o calor intenso do verão. As temperaturas ficam agradáveis durante o dia (a noite pode esfriar — leve um agasalho) e o mar costuma ficar mais cristalino no inverno.',
          'É uma das épocas favoritas de quem volta todo ano: dias de sol, praia tranquila e restaurantes funcionando normalmente.',
        ],
      },
      {
        titulo: 'Resumindo',
        paragrafos: [
          'Sol e agito: dezembro a fevereiro. Custo-benefício e sossego: março a junho e setembro a novembro. Mar mais cristalino e famílias: julho.',
          'Em qualquer época, a Pousada Espírito do Mar fica a 200m da Praia do Peró — consulte a disponibilidade para as datas do seu roteiro.',
        ],
      },
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class BlogService {
  private readonly _posts = signal<BlogPost[]>(POSTS);

  public readonly posts = this._posts.asReadonly();

  public readonly destaques = computed(() => this._posts());

  public getBySlug(slug: string): BlogPost | undefined {
    return this._posts().find((p) => p.slug === slug);
  }

  public relacionados(slug: string, limite = 2): BlogPost[] {
    return this._posts().filter((p) => p.slug !== slug).slice(0, limite);
  }
}
