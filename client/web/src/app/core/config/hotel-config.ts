export interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

export const HOTEL_CONFIG = {
  businessName: 'Pousada Espírito do Mar',
  name: 'Pousada Espírito do Mar',
  tagline: 'Sua estadia pertinho da Praia do Peró, em Cabo Frio',
  description:
    'Na Pousada Espírito do Mar, você encontra uma opção de hospedagem em Cabo Frio para aproveitar o litoral com tranquilidade. Localizada no bairro Peró, a pousada oferece fácil acesso à praia e uma estrutura pensada para seus dias de descanso.',
  legalName: 'Pousada Espírito do Mar',
  siteUrl: 'https://pousadaespiritodomar.com.br',
  phone: '(22) 2644-3077',
  phoneFormatted: '+55-22-2644-3077',
  phoneHref: '+552226443077',
  whatsapp: '5522981874553' as string | null,
  whatsappDefaultMessage:
    'Olá! Gostaria de consultar a disponibilidade de hospedagem na Pousada Espírito do Mar.',
  email: null as string | null,
  checkIn: 'A partir das 13h (confirme o horário no ato da reserva)',
  checkOut: 'Até as 11h (confirme o horário no ato da reserva)',
  location: {
    neighborhood: 'Peró',
    city: 'Cabo Frio',
    state: 'Rio de Janeiro',
    stateCode: 'RJ',
    country: 'Brasil',
    reference: 'Próxima à Praia do Peró'
  },
  address: {
    street: 'Rua Anequim (Bairro Peró)',
    neighborhood: 'Peró',
    city: 'Cabo Frio',
    state: 'RJ',
    zipCode: '28923-420',
    country: 'Brasil',
    fullFormatted: 'Rua Anequim, Bairro Peró — Cabo Frio, RJ · CEP 28923-420',
    divergenceNote:
      'Confirme a numeração exata do acesso com a recepção ao agendar sua chegada (registros públicos na Rua Anequim, Peró).'
  },
  geo: {
    latitude: -22.8619,
    longitude: -41.9876
  },
  mapsQueryUrl:
    'https://www.google.com/maps/search/?api=1&query=Pousada+Esp%C3%ADrito+do+Mar+Per%C3%B3+Cabo+Frio+RJ',
  googleSearchReviewsUrl:
    'https://www.google.com/search?q=pousada+espirito+do+mar+cabo+frio',
  googleHotelsUrl:
    'https://www.google.com.br/travel/hotels/entity/ChcIqvCw8M2FhOkNGgsvZy8xdG4wNl93bBAB',
  googleMapsEmbedUrl:
    'https://maps.google.com/maps?q=Pousada+Esp%C3%ADrito+do+Mar+Rua+Anequim+Per%C3%B3+Cabo+Frio+RJ&t=&z=16&ie=UTF8&iwloc=&output=embed',
  nearbyPoints: [
    { label: 'Praia do Peró', detail: 'Fácil acesso a pé a partir da pousada' },
    { label: 'Comércio e gastronomia no Peró', detail: 'Restaurantes, quiosques e serviços no bairro' },
    { label: 'Praia das Conchas', detail: 'Localizada na região do Peró, em Cabo Frio' },
    { label: 'Centro de Cabo Frio e Praia do Forte', detail: 'Acesso pelas vias locais da cidade' }
  ],
  amenities: [
    {
      name: 'Piscina externa',
      description: 'Área de piscina ao ar livre na estrutura da pousada para momentos de descanso após a praia.'
    },
    {
      name: 'Café da manhã',
      description: 'Serviço de café da manhã na pousada (consulte horários e condições incluídas na sua tarifa).'
    },
    {
      name: 'Wi-Fi',
      description: 'Conexão Wi-Fi disponível para os hóspedes (consulte a cobertura nas áreas comuns e quartos).'
    },
    {
      name: 'Estacionamento',
      description: 'Estacionamento na propriedade (consulte disponibilidade de vagas e condições no momento da reserva).'
    },
    {
      name: 'Quartos climatizados',
      description: 'Acomodações equipadas com ar-condicionado, TV e banheiro privativo.'
    },
    {
      name: 'Varanda em unidades específicas',
      description: 'Algumas categorias contam com varanda; informe sua preferência ao consultar disponibilidade.'
    }
  ],
  socialLinks: {
    instagram: null as string | null,
    facebook: null as string | null
  },
  bookingChannels: {
    directPhone: '(22) 2644-3077',
    websiteForm: '/reservar',
    contactPage: '/contato'
  },
  faqs: [
    {
      category: 'Localização',
      question: 'Onde fica localizada a Pousada Espírito do Mar?',
      answer:
        'A pousada está localizada na Rua Anequim, no bairro Peró, em Cabo Frio (RJ), próxima à Praia do Peró e a opções de comércio e gastronomia da região. Como há divergência de numeração entre diretórios públicos (109 e 122), recomendamos confirmar a orientação exata de chegada diretamente com a recepção.'
    },
    {
      category: 'Horários',
      question: 'Quais são os horários de check-in e check-out?',
      answer:
        'As referências divulgadas indicam check-in a partir das 13h (ou 14h conforme a modalidade) e check-out até as 11h (ou 12h). Recomendamos confirmar o horário exato aplicável à sua reserva diretamente pelo telefone de atendimento.'
    },
    {
      category: 'Café da manhã',
      question: 'A pousada oferece café da manhã?',
      answer:
        'Sim, o café da manhã faz parte da estrutura divulgada da pousada. No momento da cotação ou reserva, confirme os horários de funcionamento e se o serviço está incluído na tarifa escolhida.'
    },
    {
      category: 'Estacionamento',
      question: 'Há estacionamento disponível no local?',
      answer:
        'Sim, a estrutura divulgada conta com estacionamento. Como a quantidade de vagas é sujeita à capacidade local, consulte a disponibilidade e eventuais condições diretamente antes da sua chegada.'
    },
    {
      category: 'Acomodações',
      question: 'O que os quartos oferecem e quais unidades possuem varanda?',
      answer:
        'As acomodações contam com ar-condicionado, TV e banheiro privativo, além de opções com frigobar. Algumas unidades específicas possuem varanda — caso deseje esse diferencial, solicite a verificação de disponibilidade dessa categoria ao entrar em contato.'
    },
    {
      category: 'Animais de estimação',
      question: 'A pousada aceita animais de estimação?',
      answer:
        'Algumas plataformas mencionam a possibilidade de hospedagem com animais de estimação mediante solicitação prévia. Para garantir o melhor acolhimento, consulte diretamente a recepção antes de reservar para confirmar as regras, porte permitido e condições vigentes.'
    },
    {
      category: 'Reservas e Contato',
      question: 'Como posso consultar disponibilidade e fazer uma reserva?',
      answer:
        'Você pode enviar uma solicitação pelo formulário deste site na página "Consultar Disponibilidade" ou entrar em contato por ligação telefônica no número (22) 2644-3077 para atendimento direto e confirmação de tarifas.'
    }
  ] as FaqItem[]
};

