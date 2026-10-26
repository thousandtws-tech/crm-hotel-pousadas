import { Injectable, signal, computed } from '@angular/core';
import { GalleryItem, GalleryCategory } from '../models/gallery-item.model';

@Injectable({
  providedIn: 'root'
})
export class GalleryService {
  private readonly itemsState = signal<GalleryItem[]>([
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
  ]);

  private readonly selectedCategoryState = signal<GalleryCategory>('todas');

  public readonly items = this.itemsState.asReadonly();
  public readonly selectedCategory = this.selectedCategoryState.asReadonly();

  public readonly filteredItems = computed(() => {
    const category = this.selectedCategoryState();
    if (category === 'todas') {
      return this.itemsState();
    }
    return this.itemsState().filter((item) => item.category === category);
  });

  public setCategory(category: GalleryCategory): void {
    this.selectedCategoryState.set(category);
  }
}

