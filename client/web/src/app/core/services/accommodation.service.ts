import { Injectable, signal, computed } from '@angular/core';
import { Accommodation } from '../models/accommodation.model';

@Injectable({
  providedIn: 'root'
})
export class AccommodationService {
  private readonly accommodationsState = signal<Accommodation[]>([
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
  ]);

  public readonly accommodations = this.accommodationsState.asReadonly();
  public readonly featuredAccommodations = computed(() =>
    this.accommodationsState().filter((item) => item.featured).sort((a, b) => a.order - b.order)
  );

  public getBySlug(slug: string): Accommodation | undefined {
    return this.accommodationsState().find((item) => item.slug === slug);
  }

  public getById(id: string): Accommodation | undefined {
    return this.accommodationsState().find((item) => item.id === id);
  }
}

