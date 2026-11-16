import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

/** Sub-navegação do módulo financeiro — presente no topo de todas as telas. */
@Component({
  selector: 'app-fin-nav',
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <nav class="fin-nav" aria-label="Seções do financeiro">
      @for (item of itens; track item.rota) {
        <a
          [routerLink]="item.rota"
          routerLinkActive="ativo"
          [routerLinkActiveOptions]="{ exact: item.exato }"
          class="fin-nav-link"
        >
          <mat-icon>{{ item.icone }}</mat-icon>
          <span>{{ item.rotulo }}</span>
        </a>
      }
    </nav>
  `,
  styles: `
    .fin-nav {
      display: flex; gap: 4px; flex-wrap: wrap;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 6px; margin-bottom: 16px;
    }
    .fin-nav-link {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 16px; border-radius: 7px;
      font-size: 0.84rem; font-weight: 600; color: #5d6d7e;
      text-decoration: none; white-space: nowrap;
      transition: background .14s ease, color .14s ease;
    }
    .fin-nav-link mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .fin-nav-link:hover { background: #eef4f6; color: #054054; }
    .fin-nav-link.ativo { background: #054054; color: #fff; }
    .fin-nav-link:focus-visible { outline: 2px solid #1a6f8a; outline-offset: 2px; }
  `,
})
export class FinNavComponent {
  readonly itens = [
    { rota: '/financeiro', rotulo: 'Visão geral', icone: 'assessment', exato: true },
    { rota: '/financeiro/contas', rotulo: 'Contas', icone: 'receipt_long', exato: false },
    { rota: '/financeiro/fluxo-caixa', rotulo: 'Fluxo de caixa', icone: 'swap_vert', exato: false },
    { rota: '/financeiro/dre', rotulo: 'DRE', icone: 'assessment', exato: false },
    { rota: '/financeiro/conciliacao', rotulo: 'Conciliação', icone: 'compare_arrows', exato: false },
    { rota: '/financeiro/split', rotulo: 'Split IBS/CBS', icone: 'account_balance', exato: false },
    { rota: '/financeiro/caixa', rotulo: 'Caixa', icone: 'point_of_sale', exato: false },
  ];
}
