import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../shared/components/header/header.component';
import { FooterComponent } from '../shared/components/footer/footer.component';

@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  template: `
    <a href="#main-content" class="skip-link">Ir para o conteúdo</a>
    <div class="min-h-screen flex flex-col bg-[#F7F5F0] text-[#054054]">
      <app-header></app-header>
      <main id="main-content" class="flex-grow" tabindex="-1">
        <router-outlet></router-outlet>
      </main>
      <app-footer></app-footer>
    </div>
  `
})
export class PublicLayoutComponent {}
