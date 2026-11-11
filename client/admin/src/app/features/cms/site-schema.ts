// Registro de páginas/seções editáveis do site institucional.
// Cada seção corresponde a uma linha `cms_site` (`secao` = chave; `dados` =
// objeto livre). O backend valida a chave numa allowlist — mantenha este
// arquivo sincronizado com SECOES_SITE (server/crates/application/src/services/cms.rs).

export type TipoCampo = 'texto' | 'longo' | 'cta' | 'midia' | 'itens' | 'select';

export interface CampoDef {
  /** Chave dentro de `dados`. `cta` grava `{key}_label` e `{key}_href`. */
  key: string;
  tipo: TipoCampo;
  label: string;
  hint?: string;
  max?: number;
  opcoes?: { value: string; label: string }[];
  /** Subcampos quando tipo === 'itens'. */
  subcampos?: CampoDef[];
  /** Placeholder/amostra do conteúdo atual do site (orienta o editor). */
  exemplo?: string;
}

export interface SecaoDef {
  secao: string;
  titulo: string;
  descricao: string;
  campos: CampoDef[];
}

export interface PaginaDef {
  pagina: string;
  titulo: string;
  secoes: SecaoDef[];
}

// -- blocos reutilizados ------------------------------------------------------

const CABECALHO: CampoDef[] = [
  { key: 'titulo', tipo: 'texto', label: 'Título da página' },
  { key: 'subtitulo', tipo: 'longo', label: 'Subtítulo' },
  { key: 'imagem', tipo: 'midia', label: 'Imagem de fundo', hint: 'Foto ou vídeo da biblioteca.' },
];

const SEO = (pagina: string): SecaoDef => ({
  secao: `${pagina}.seo`,
  titulo: 'SEO e buscadores',
  descricao: 'Metadados desta página para Google e redes sociais.',
  campos: [
    { key: 'titulo', tipo: 'texto', label: 'Título da página', max: 60 },
    { key: 'descricao', tipo: 'longo', label: 'Descrição (meta description)', max: 160 },
    { key: 'keywords', tipo: 'texto', label: 'Palavras-chave', hint: 'Separadas por vírgula.' },
  ],
});

const CTA = (key: string, label: string): CampoDef => ({ key, tipo: 'cta', label });

const EYEBROW: CampoDef = { key: 'eyebrow', tipo: 'texto', label: 'Selo (texto acima do título)' };

// -- registro -----------------------------------------------------------------

export const PAGINAS_SITE: PaginaDef[] = [
  {
    pagina: 'home',
    titulo: 'Página inicial',
    secoes: [
      {
        secao: 'hero',
        titulo: 'Abertura (Hero)',
        descricao: 'Primeira dobra do site — imagem de fundo, título, subtítulo e botões.',
        campos: [
          EYEBROW,
          { key: 'titulo', tipo: 'texto', label: 'Título principal' },
          { key: 'subtitulo', tipo: 'longo', label: 'Subtítulo' },
          { key: 'imagem', tipo: 'midia', label: 'Imagem de fundo' },
          CTA('cta1', 'Botão principal'),
          CTA('cta2', 'Link secundário'),
        ],
      },
      {
        secao: 'seo',
        titulo: 'SEO da página inicial',
        descricao: 'Metadados da home para Google e redes sociais.',
        campos: [
          { key: 'titulo', tipo: 'texto', label: 'Título da página', max: 60 },
          { key: 'descricao', tipo: 'longo', label: 'Descrição (meta description)', max: 160 },
          { key: 'keywords', tipo: 'texto', label: 'Palavras-chave', hint: 'Separadas por vírgula.' },
        ],
      },
      {
        secao: 'home.essence',
        titulo: 'Apresentação (essência)',
        descricao: 'Bloco editorial com foto e texto de boas-vindas.',
        campos: [
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto', hint: 'Separe parágrafos com linha em branco.' },
          { key: 'imagem', tipo: 'midia', label: 'Imagem' },
          CTA('cta', 'Link "Conhecer a pousada"'),
        ],
      },
      {
        secao: 'home.quartos',
        titulo: 'Chamada das acomodações',
        descricao: 'Título e link acima dos quartos em destaque (os cards vêm das acomodações publicadas).',
        campos: [
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          CTA('cta', 'Link para a listagem'),
        ],
      },
      {
        secao: 'home.experiencias',
        titulo: 'Blocos de estrutura',
        descricao: 'Blocos alternados de foto + texto (piscina, café da manhã…).',
        campos: [
          EYEBROW,
          { key: 'titulo', tipo: 'texto', label: 'Título da seção' },
          {
            key: 'blocos',
            tipo: 'itens',
            label: 'Blocos',
            subcampos: [
              { key: 'sobretitulo', tipo: 'texto', label: 'Selo' },
              { key: 'titulo', tipo: 'texto', label: 'Título' },
              { key: 'texto', tipo: 'longo', label: 'Texto' },
              { key: 'imagem', tipo: 'midia', label: 'Imagem' },
              CTA('cta', 'Link'),
            ],
          },
        ],
      },
      {
        secao: 'home.frase',
        titulo: 'Frase de impacto',
        descricao: 'Faixa panorâmica com frase e botão de reserva.',
        campos: [
          { key: 'texto', tipo: 'longo', label: 'Frase' },
          { key: 'imagem', tipo: 'midia', label: 'Imagem de fundo' },
          CTA('cta', 'Botão'),
        ],
      },
      {
        secao: 'home.galeria',
        titulo: 'Prévia da galeria',
        descricao: 'Título e link da prévia — as fotos vêm da seção "Imagens" da página Galeria.',
        campos: [EYEBROW, { key: 'titulo', tipo: 'texto', label: 'Título' }, CTA('cta', 'Link "Ver galeria completa"')],
      },
      {
        secao: 'home.localizacao',
        titulo: 'Prévia de localização',
        descricao: 'Resumo de localização na home — a lista de pontos vem da página Localização.',
        campos: [
          EYEBROW,
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto' },
          { key: 'imagem', tipo: 'midia', label: 'Imagem' },
        ],
      },
      {
        secao: 'home.depoimentos',
        titulo: 'Avaliações / Google Maps',
        descricao: 'Bloco com o mapa do Google e botões de avaliações.',
        campos: [
          EYEBROW,
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto' },
          { key: 'maps_embed', tipo: 'texto', label: 'URL do mapa incorporado (iframe)' },
          CTA('cta1', 'Botão "Ver avaliações"'),
          CTA('cta2', 'Botão "Google Hotéis"'),
        ],
      },
      {
        secao: 'faq',
        titulo: 'Perguntas frequentes',
        descricao: 'Exibidas na home com marcação estruturada para buscadores. Vazia = seção oculta.',
        campos: [
          {
            key: 'itens',
            tipo: 'itens',
            label: 'Perguntas',
            subcampos: [
              { key: 'pergunta', tipo: 'texto', label: 'Pergunta' },
              { key: 'resposta', tipo: 'longo', label: 'Resposta' },
            ],
          },
        ],
      },
    ],
  },
  {
    pagina: 'sobre',
    titulo: 'Sobre',
    secoes: [
      { secao: 'sobre.header', titulo: 'Cabeçalho', descricao: 'Faixa de abertura da página.', campos: CABECALHO },
      {
        secao: 'sobre.manifesto',
        titulo: 'Manifesto',
        descricao: 'Texto principal da página.',
        campos: [
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto', hint: 'Separe parágrafos com linha em branco.' },
        ],
      },
      {
        secao: 'sobre.pilares',
        titulo: 'Pilares',
        descricao: 'Os três diferenciais numerados.',
        campos: [
          {
            key: 'itens',
            tipo: 'itens',
            label: 'Pilares',
            subcampos: [
              { key: 'rotulo', tipo: 'texto', label: 'Rótulo (ex.: 01)' },
              { key: 'titulo', tipo: 'texto', label: 'Título' },
              { key: 'texto', tipo: 'longo', label: 'Texto' },
            ],
          },
        ],
      },
      {
        secao: 'sobre.cta',
        titulo: 'Chamada final',
        descricao: 'Bloco de fechamento com botões.',
        campos: [
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto' },
          CTA('cta1', 'Botão principal'),
          CTA('cta2', 'Botão secundário'),
        ],
      },
      SEO('sobre'),
    ],
  },
  {
    pagina: 'experiencias',
    titulo: 'Experiências',
    secoes: [
      { secao: 'experiencias.header', titulo: 'Cabeçalho', descricao: 'Faixa de abertura da página.', campos: CABECALHO },
      {
        secao: 'experiencias.itens',
        titulo: 'Experiências e comodidades',
        descricao: 'Cards alternados de foto + texto (piscina, café, Wi-Fi…).',
        campos: [
          {
            key: 'itens',
            tipo: 'itens',
            label: 'Itens',
            subcampos: [
              { key: 'categoria', tipo: 'texto', label: 'Categoria (selo)' },
              { key: 'titulo', tipo: 'texto', label: 'Título' },
              { key: 'tagline', tipo: 'texto', label: 'Frase de efeito (itálico)' },
              { key: 'texto', tipo: 'longo', label: 'Descrição' },
              { key: 'detalhe', tipo: 'longo', label: 'Texto complementar', hint: 'Opcional.' },
              { key: 'horario', tipo: 'texto', label: 'Observação/horário', hint: 'Opcional.' },
              { key: 'imagem', tipo: 'midia', label: 'Imagem' },
              CTA('cta', 'Link do card'),
            ],
          },
        ],
      },
      SEO('experiencias'),
    ],
  },
  {
    pagina: 'galeria',
    titulo: 'Galeria',
    secoes: [
      { secao: 'galeria.header', titulo: 'Cabeçalho', descricao: 'Faixa de abertura da página.', campos: CABECALHO },
      {
        secao: 'galeria.itens',
        titulo: 'Imagens da galeria',
        descricao: 'Fotos e vídeos exibidos no mosaico e na prévia da home.',
        campos: [
          {
            key: 'itens',
            tipo: 'itens',
            label: 'Itens',
            subcampos: [
              { key: 'imagem', tipo: 'midia', label: 'Mídia' },
              { key: 'titulo', tipo: 'texto', label: 'Título / texto alternativo' },
              {
                key: 'categoria',
                tipo: 'select',
                label: 'Categoria',
                opcoes: [
                  { value: 'suites', label: 'Acomodações' },
                  { value: 'gastronomia', label: 'Café da Manhã' },
                  { value: 'lazer-spa', label: 'Piscina & Lazer' },
                  { value: 'natureza', label: 'Região do Peró' },
                ],
              },
              {
                key: 'formato',
                tipo: 'select',
                label: 'Formato no mosaico',
                opcoes: [
                  { value: 'landscape', label: 'Paisagem' },
                  { value: 'panoramic', label: 'Panorâmico' },
                  { value: 'portrait', label: 'Retrato' },
                  { value: 'square', label: 'Quadrado' },
                ],
              },
              { key: 'legenda', tipo: 'texto', label: 'Legenda (lightbox)', hint: 'Opcional.' },
            ],
          },
        ],
      },
      SEO('galeria'),
    ],
  },
  {
    pagina: 'contato',
    titulo: 'Contato',
    secoes: [
      { secao: 'contato.header', titulo: 'Cabeçalho', descricao: 'Faixa de abertura da página.', campos: CABECALHO },
      {
        secao: 'contato.canais',
        titulo: 'Canais oficiais',
        descricao: 'Coluna de atendimento ao lado do formulário.',
        campos: [
          EYEBROW,
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto' },
          { key: 'form_titulo', tipo: 'texto', label: 'Título do formulário' },
          { key: 'checkin', tipo: 'texto', label: 'Texto de check-in/check-out', hint: 'Ex.: Check-in 13h · Check-out 11h' },
        ],
      },
      {
        secao: 'contato.faq',
        titulo: 'FAQ de contato',
        descricao: 'Perguntas categorizadas no fim da página de contato.',
        campos: [
          EYEBROW,
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Introdução' },
          {
            key: 'itens',
            tipo: 'itens',
            label: 'Perguntas',
            subcampos: [
              { key: 'categoria', tipo: 'texto', label: 'Categoria' },
              { key: 'pergunta', tipo: 'texto', label: 'Pergunta' },
              { key: 'resposta', tipo: 'longo', label: 'Resposta' },
            ],
          },
        ],
      },
      SEO('contato'),
    ],
  },
  {
    pagina: 'localizacao',
    titulo: 'Localização',
    secoes: [
      { secao: 'localizacao.header', titulo: 'Cabeçalho', descricao: 'Faixa de abertura da página.', campos: CABECALHO },
      {
        secao: 'localizacao.conteudo',
        titulo: 'Conteúdo principal',
        descricao: 'Texto e foto da região.',
        campos: [
          { key: 'titulo', tipo: 'texto', label: 'Título' },
          { key: 'texto', tipo: 'longo', label: 'Texto' },
          { key: 'imagem', tipo: 'midia', label: 'Imagem' },
        ],
      },
      {
        secao: 'localizacao.pontos',
        titulo: 'Pontos de referência',
        descricao: 'Lista "o que fica perto" — também aparece na prévia da home.',
        campos: [
          {
            key: 'itens',
            tipo: 'itens',
            label: 'Pontos',
            subcampos: [
              { key: 'rotulo', tipo: 'texto', label: 'Local' },
              { key: 'detalhe', tipo: 'texto', label: 'Detalhe' },
            ],
          },
        ],
      },
      SEO('localizacao'),
    ],
  },
  {
    pagina: 'acomodacoes',
    titulo: 'Acomodações',
    secoes: [
      {
        secao: 'acomodacoes.header',
        titulo: 'Cabeçalho',
        descricao: 'Faixa de abertura da listagem (o conteúdo dos quartos vem da aba Acomodações).',
        campos: CABECALHO,
      },
      SEO('acomodacoes'),
    ],
  },
  {
    pagina: 'geral',
    titulo: 'Global',
    secoes: [
      {
        secao: 'geral.contato',
        titulo: 'Contato institucional',
        descricao: 'Dados exibidos no rodapé e nas páginas de contato/localização de todo o site.',
        campos: [
          { key: 'telefone', tipo: 'texto', label: 'Telefone exibido' },
          { key: 'telefone_link', tipo: 'texto', label: 'Telefone p/ link (tel:)', hint: 'Ex.: +552226443077' },
          { key: 'whatsapp', tipo: 'texto', label: 'WhatsApp', hint: 'Opcional.' },
          { key: 'email', tipo: 'texto', label: 'E-mail', hint: 'Opcional.' },
          { key: 'endereco', tipo: 'texto', label: 'Endereço formatado' },
          { key: 'endereco_obs', tipo: 'longo', label: 'Observação do endereço', hint: 'Orientação de chegada.' },
          { key: 'maps_embed', tipo: 'texto', label: 'URL do mapa incorporado (iframe)' },
          { key: 'maps_url', tipo: 'texto', label: 'Link do Google Maps' },
          { key: 'instagram', tipo: 'texto', label: 'Instagram (URL)', hint: 'Opcional.' },
          { key: 'facebook', tipo: 'texto', label: 'Facebook (URL)', hint: 'Opcional.' },
          { key: 'rodape_texto', tipo: 'longo', label: 'Texto do rodapé' },
        ],
      },
    ],
  },
];
