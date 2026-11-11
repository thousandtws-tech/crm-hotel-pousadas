import { Injectable, signal, computed } from '@angular/core';
import { Experience } from '../models/experience.model';

@Injectable({
  providedIn: 'root'
})
export class ExperienceService {
  private readonly experiencesState = signal<Experience[]>([
    {
      id: 'exp-1',
      slug: 'piscina-externa-e-descanso',
      title: 'Piscina Externa e Área de Convivência',
      category: 'Lazer na Pousada',
      tagline: 'Um espaço tranquilo ao ar livre para relaxar após a Praia do Peró.',
      description:
        'A estrutura da Pousada Espírito do Mar conta com piscina externa, oferecendo uma opção agradável de lazer e descanso nos dias de sol em Cabo Frio.',
      longDescription:
        'Seja antes de caminhar até a praia ou no retorno do passeio pelo litoral, a área da piscina proporciona um ambiente acolhedor para famílias, casais e viajantes descansarem com tranquilidade.',
      image:
        'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1600&q=85',
      gallery: [
        'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1600&q=85'
      ],
      schedule: 'Consulte as normas e horários de utilização na recepção',
      highlights: [
        'Piscina ao ar livre na estrutura da pousada',
        'Ambiente familiar e acolhedor no bairro Peró',
        'Espaço de descanso para o pós-praia'
      ],
      includedInStay: true,
      featured: true,
      order: 1
    },
    {
      id: 'exp-2',
      slug: 'cafe-da-manha',
      title: 'Café da Manhã na Pousada',
      category: 'Hospitalidade',
      tagline: 'Comece o dia com praticidade antes de aproveitar as praias de Cabo Frio.',
      description:
        'A Pousada Espírito do Mar divulga serviço de café da manhã em sua estrutura, preparado para receber os hóspedes antes dos passeios pela região do Peró.',
      longDescription:
        'No momento da sua consulta de disponibilidade ou check-in, confirme com a recepção os horários de funcionamento do café da manhã e as condições aplicáveis à sua tarifa.',
      image:
        'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=1600&q=85',
      gallery: [
        'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=1600&q=85'
      ],
      schedule: 'Horários e condições informados no ato da reserva',
      highlights: [
        'Serviço divulgado na estrutura da pousada',
        'Praticidade para iniciar o dia no Peró',
        'Confirme itens e horários diretamente com a recepção'
      ],
      includedInStay: true,
      featured: true,
      order: 2
    },
    {
      id: 'exp-3',
      slug: 'comodidades-e-servicos',
      title: 'Wi-Fi, Estacionamento e Estrutura de Apoio',
      category: 'Comodidades',
      tagline: 'Recursos essenciais para uma estadia prática e segura no litoral.',
      description:
        'A estrutura divulgada da pousada inclui acesso Wi-Fi e estacionamento no local, além de quartos equipados com ar-condicionado, televisão e banheiro privativo.',
      longDescription:
        'Como a disponibilidade de vagas de estacionamento, a cobertura de Wi-Fi e as políticas para animais de estimação podem possuir condições específicas, recomendamos validar todas as suas necessidades diretamente ao solicitar a reserva.',
      image:
        'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1600&q=85',
      schedule: 'Consulte condições de uso e disponibilidade de vagas na reserva',
      highlights: [
        'Wi-Fi disponível (confirme cobertura nas áreas comuns e quartos)',
        'Estacionamento (sujeito à disponibilidade e confirmação prévia)',
        'Quartos com ar-condicionado, TV e banheiro privativo',
        'Hospedagem com animais de estimação mediante consulta prévia'
      ],
      includedInStay: true,
      featured: true,
      order: 3
    },
    {
      id: 'exp-4',
      slug: 'proximidade-praia-do-pero',
      title: 'Proximidade com a Praia do Peró',
      category: 'Localização em Cabo Frio',
      tagline: 'Fácil acesso à praia e às opções de gastronomia e comércio do bairro.',
      description:
        'Situada na Rua Anequim, no bairro Peró, a pousada permite fácil acesso à Praia do Peró e está próxima a restaurantes, quiosques e serviços locais.',
      longDescription:
        'A partir do Peró, você também pode explorar outros pontos conhecidos de Cabo Frio, como a Praia das Conchas, a Ilha do Japonês e a Praia do Forte.',
      image:
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85',
      schedule: 'Acesso livre pelo bairro Peró',
      highlights: [
        'Localização no bairro Peró, em Cabo Frio (RJ)',
        'Proximidade com a Praia do Peró',
        'Fácil acesso a comércio e gastronomia da região'
      ],
      includedInStay: true,
      featured: true,
      order: 4
    }
  ]);

  public readonly experiences = this.experiencesState.asReadonly();
  public readonly featuredExperiences = computed(() =>
    this.experiencesState().filter((item) => item.featured).sort((a, b) => a.order - b.order)
  );

  public getBySlug(slug: string): Experience | undefined {
    return this.experiencesState().find((item) => item.slug === slug);
  }
}

