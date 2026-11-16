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
    <div class="min-h-screen flex flex-col bg-[#F7F5F0] text-[#054054]">
      <app-header></app-header>
      <main id="main-content" class="flex-grow" tabindex="-1">
        <router-outlet></router-outlet>
      </main>
      <app-footer></app-footer>
    </div>

    <!-- CTA fixo discreto — só mobile, oculto na própria página de consulta -->
    @if (showStickyCta()) {
      <div class="fixed bottom-0 inset-x-0 z-40 lg:hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
        <a
          routerLink="/reservar"
          class="pointer-events-auto flex items-center justify-center gap-2 w-full bg-[#054054] text-white text-[11px] uppercase tracking-[0.18em] font-semibold py-3.5 rounded-lg shadow-[0_10px_28px_rgba(3,43,56,0.45)] active:bg-[#DDA554] active:text-[#054054] transition-colors"
        >
          <app-icon name="calendar" [size]="15"></app-icon>
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
    return !url.startsWith('/reservar') && !url.startsWith('/reserva/');
  });
}
