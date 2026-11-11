import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit, computed } from '@angular/core';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { MotionService } from '../../core/services/motion.service';
import { SiteContentService, cmsLista, cmsStr } from '../../core/services/site-content.service';

const PADRAO_HEADER_IMG = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=85';
const PADRAO_FOTO = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=85';

@Component({
  selector: 'app-location',
  imports: [IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="loc-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          [src]="headerImg()"
          alt="Região costeira de Cabo Frio e Praia do Peró"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          {{ headerTxt('titulo', 'Explore Cabo Frio a partir do Peró') }}
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          {{ headerTxt('subtitulo', 'A Pousada Espírito do Mar fica no bairro Peró, em Cabo Frio, próxima à praia e a opções de comércio e gastronomia da região.') }}
        </p>
      </div>
    </header>

    <!-- Location & Directions -->
    <section class="loc-content-section py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]">
      <div class="container-editorial">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          <!-- Directions and Access (Col 1-6) -->
          <div class="loc-info-col lg:col-span-6 flex flex-col items-start">
            <h2 class="type-title text-[#054054] mb-4">{{ conteudoTxt('titulo', 'Próxima à Praia do Peró') }}</h2>
            
            <p class="type-body mb-6">
              {{ conteudoTxt('texto', 'Situada na Rua Anequim, no bairro Peró, em Cabo Frio (Rio de Janeiro), a Pousada Espírito do Mar oferece fácil acesso à Praia do Peró e às conveniências do bairro, facilitando o deslocamento para aproveitar o litoral da Região dos Lagos.') }}
            </p>

            <!-- Nearby Points Box -->
            <div class="w-full border-t border-b border-[#DCE6EA] divide-y divide-[#DCE6EA] mb-6 text-sm">
              @for (d of pontos(); track d.label) {
                <div class="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-1">
                  <span class="font-medium text-[#054054]">{{ d.label }}</span>
                  <span class="text-[#536B73] font-light text-xs sm:text-sm">{{ d.detail }}</span>
                </div>
              }
            </div>

            <!-- Orientation Notes -->
            <div class="space-y-3.5 mb-6 w-full">
              <div class="p-4 bg-[#EEF3F5] border-l-2 border-[#054054]">
                <h3 class="text-xs uppercase tracking-wider font-semibold text-[#054054] mb-1">Referência de Endereço</h3>
                <p class="text-xs text-[#536B73] leading-relaxed">
                  {{ hotelConfig.address.fullFormatted }}. {{ hotelConfig.address.divergenceNote }}
                </p>
              </div>

              <div class="p-4 bg-[#EEF3F5] border-l-2 border-[#DDA554]">
                <h3 class="text-xs uppercase tracking-wider font-semibold text-[#054054] mb-1">Atendimento para Chegada</h3>
                <p class="text-xs text-[#536B73] leading-relaxed">
                  Em caso de dúvida sobre o trajeto ou estacionamento, entre em contato pelo telefone {{ hotelConfig.phone }}.
                </p>
              </div>
            </div>

            <a
              [href]="hotelConfig.mapsQueryUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="btn-primary"
            >
              <span>Abrir no Google Maps</span>
              <app-icon name="arrow-right" [size]="13"></app-icon>
            </a>
          </div>

          <!-- Coastline Photo Frame (Col 7-12) -->
          <div class="loc-photo-col lg:col-span-6">
            <div class="loc-photo-frame editorial-image-container aspect-square shadow-sm">
              <img
                [src]="fotoImg()"
                alt="Paisagem costeira representando o litoral de Cabo Frio"
                loading="lazy"
                class="w-full h-full object-cover"
              />
            </div>
            <div class="pt-4 text-xs text-[#536B73]">
              <span class="text-[#054054] font-medium">{{ hotelConfig.address.fullFormatted }}</span>
              <span class="block text-[11px] mt-0.5">Bairro Peró · Cabo Frio — Rio de Janeiro</span>
            </div>
          </div>

        </div>
      </div>
    </section>
  `
})
export class LocationComponent implements OnInit {
  public readonly hotelConfig = HOTEL_CONFIG;
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);
  private readonly site = inject(SiteContentService);

  private readonly header = computed(() => this.site.secao('localizacao.header'));
  private readonly conteudo = computed(() => this.site.secao('localizacao.conteudo'));
  protected readonly headerImg = computed(
    () => this.site.midiaUrl(this.header()?.['imagem']) || PADRAO_HEADER_IMG
  );
  protected readonly fotoImg = computed(
    () => this.site.midiaUrl(this.conteudo()?.['imagem']) || PADRAO_FOTO
  );
  /** Pontos "o que fica perto" do CMS; vazio cai na lista padrão do config. */
  protected readonly pontos = computed(() => {
    const itens = cmsLista(this.site.secao('localizacao.pontos'), 'itens')
      .map((i) => ({ label: cmsStr(i, 'rotulo'), detail: cmsStr(i, 'detalhe') }))
      .filter((p) => p.label);
    return itens.length ? itens : this.hotelConfig.nearbyPoints;
  });

  protected headerTxt(key: string, fallback: string): string {
    return cmsStr(this.header(), key) || fallback;
  }
  protected conteudoTxt(key: string, fallback: string): string {
    return cmsStr(this.conteudo(), key) || fallback;
  }

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public ngOnInit(): void {
    const seo = this.site.seoPagina('localizacao');
    this.seoService.updateSeo({
      title: seo?.titulo || 'Localização no Peró, Cabo Frio | Pousada Espírito do Mar',
      description: seo?.descricao || 'Saiba onde fica a Pousada Espírito do Mar, no bairro Peró, em Cabo Frio (RJ), próxima à Praia do Peró e a opções de comércio e gastronomia.',
      keywords: seo?.keywords,
      url: 'https://pousadaespiritodomar.com.br/localizacao'
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.loc-page-header');
      const infoCol = root.querySelector<HTMLElement>('.loc-info-col');
      const photoCol = root.querySelector<HTMLElement>('.loc-photo-frame');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (infoCol) {
        this.motion.animateScrollReveal(infoCol, { y: 32, duration: 0.9, trigger: infoCol });
      }

      if (photoCol) {
        const photoImg = photoCol.querySelector<HTMLElement>('img');
        if (photoImg) {
          this.motion.animateImageReveal(photoImg, photoCol, { duration: 1.0 });
        }
      }
    }, this.destroyRef);
  }
}
