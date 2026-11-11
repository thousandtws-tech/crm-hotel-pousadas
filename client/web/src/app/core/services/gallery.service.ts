import { Injectable, inject, signal, computed } from '@angular/core';
import { GalleryItem, GalleryCategory } from '../models/gallery-item.model';
import { CmsDados, SiteContentService, cmsLista, cmsStr } from './site-content.service';

const CATEGORIAS: GalleryCategory[] = ['suites', 'gastronomia', 'lazer-spa', 'natureza'];
const CATEGORIA_LABEL: Record<string, string> = {
  suites: 'Acomodações',
  gastronomia: 'Café da Manhã',
  'lazer-spa': 'Piscina & Lazer',
  natureza: 'Região do Peró'
};

@Injectable({
  providedIn: 'root'
})
export class GalleryService {
  private readonly site = inject(SiteContentService);

  private readonly padrao: GalleryItem[] = [
    {
      id: 'gal-1',
      title: 'Área de Piscina Externa (Imagem Ilustrativa)',
      category: 'lazer-spa',
      categoryLabel: 'Estrutura & Lazer',
      imageUrl: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1600&q=85',
      caption: 'A pousada conta com piscina externa para momentos de lazer e descanso no Peró. (Imagem ilustrativa)',
      aspectRatio: 'panoramic'
    },
    {
      id: 'gal-2',
      title: 'Acomodação Climatizada (Imagem Ilustrativa)',
      category: 'suites',
      categoryLabel: 'Acomodações',
      imageUrl: 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1400&q=85',
      caption: 'Quartos equipados com ar-condicionado, TV e banheiro privativo. (Imagem ilustrativa)',
      aspectRatio: 'portrait'
    },
    {
      id: 'gal-3',
      title: 'Café da Manhã na Pousada (Imagem Ilustrativa)',
      category: 'gastronomia',
      categoryLabel: 'Café da Manhã',
      imageUrl: 'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=1400&q=85',
      caption: 'Serviço de café da manhã disponível na estrutura da pousada. (Imagem ilustrativa)',
      aspectRatio: 'square'
    },
    {
      id: 'gal-4',
      title: 'Quarto com Varanda em Unidades Específicas (Imagem Ilustrativa)',
      category: 'suites',
      categoryLabel: 'Acomodações',
      imageUrl: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85',
      caption: 'Algumas categorias de acomodação dispõem de varanda privativa. (Imagem ilustrativa)',
      aspectRatio: 'landscape'
    },
    {
      id: 'gal-5',
      title: 'Praia e Litoral em Cabo Frio (Imagem Ilustrativa)',
      category: 'natureza',
      categoryLabel: 'Região do Peró',
      imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85',
      caption: 'Proximidade com a Praia do Peró, em Cabo Frio, Rio de Janeiro. (Imagem ilustrativa)',
      aspectRatio: 'landscape'
    },
    {
      id: 'gal-6',
      title: 'Acomodação para Famílias (Imagem Ilustrativa)',
      category: 'suites',
      categoryLabel: 'Acomodações',
      imageUrl: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1400&q=85',
      caption: 'Opções de quartos duplos, triplos e quádruplos para sua estadia em Cabo Frio. (Imagem ilustrativa)',
      aspectRatio: 'portrait'
    }
  ];

  private readonly selectedCategoryState = signal<GalleryCategory>('todas');

  /** Itens do CMS (`galeria.itens`); sem conteúdo publicado cai no acervo padrão. */
  public readonly items = computed<GalleryItem[]>(() => {
    const lista = cmsLista(this.site.secao('galeria.itens'), 'itens')
      .map((i, idx) => this.paraItem(i, idx))
      .filter((i): i is GalleryItem => i !== null);
    return lista.length ? lista : this.padrao;
  });
  public readonly selectedCategory = this.selectedCategoryState.asReadonly();

  public readonly filteredItems = computed(() => {
    const category = this.selectedCategoryState();
    if (category === 'todas') {
      return this.items();
    }
    return this.items().filter((item) => item.category === category);
  });

  private paraItem(i: CmsDados, idx: number): GalleryItem | null {
    const url = this.site.midiaUrl(i['imagem']);
    if (!url) return null;
    const cat = cmsStr(i, 'categoria');
    const categoria = (CATEGORIAS as string[]).includes(cat) ? (cat as GalleryCategory) : 'natureza';
    const fmt = cmsStr(i, 'formato');
    const aspectRatio = (['landscape', 'portrait', 'square', 'panoramic'] as const).includes(fmt as never)
      ? (fmt as GalleryItem['aspectRatio'])
      : 'landscape';
    return {
      id: `cms-${idx}`,
      title: cmsStr(i, 'titulo'),
      category: categoria,
      categoryLabel: CATEGORIA_LABEL[categoria] ?? 'Galeria',
      imageUrl: url,
      video: this.site.midia(i['imagem'])?.tipo === 'video',
      caption: cmsStr(i, 'legenda') || undefined,
      aspectRatio,
    };
  }

  public setCategory(category: GalleryCategory): void {
    this.selectedCategoryState.set(category);
  }
}

