import { Component, inject, computed } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { HeaderComponent } from '../shared/components/header/header.component';
import { FooterComponent } from '../shared/components/footer/footer.component';
import { IconComponent } from '../shared/components/icons/icon.component';

@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, HeaderComponent, FooterComponent, IconComponent],
  template: `
    <a href="#main-content" class="skip-link">Ir para o conteúdo</a>
    <div class="min-h-screen flex flex-col bg-[#F7F5F0] text-[#054054]" [class.pb-20]="showStickyCta()">
      <app-header></app-header>
      <main id="main-content" class="flex-grow" tabindex="-1">
        <router-outlet></router-outlet>
      </main>
      <app-footer></app-footer>
    </div>

    <!-- CTA fixo — só mobile; abre o motor de busca, oculto nele e no checkout -->
    @if (showStickyCta()) {
      <div class="fixed bottom-0 inset-x-0 z-40 lg:hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
        <a
          routerLink="/buscar"
          class="pointer-events-auto flex items-center justify-center gap-2.5 w-full bg-[#054054] text-white text-[11px] uppercase tracking-[0.18em] font-semibold py-4 rounded-full shadow-[0_10px_28px_rgba(3,43,56,0.45)] active:bg-[#032B38] transition-colors"
        >
          <span class="text-[#DDA554]"><app-icon name="search" [size]="16"></app-icon></span>
          <span>Consultar disponibilidade</span>
        </a>
      </div>
    }
  `
})
export class PublicLayoutComponent {
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  protected readonly showStickyCta = computed(() => {
    const url = this.currentUrl() ?? '';
    return !url.startsWith('/reservar') && !url.startsWith('/reserva/') && !url.startsWith('/buscar');
  });
}
