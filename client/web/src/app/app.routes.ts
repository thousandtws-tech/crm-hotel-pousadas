import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'em-breve',
    loadComponent: () => import('./features/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent)
  },
  {
    path: '',
    loadComponent: () => import('./layout/public-layout.component').then((m) => m.PublicLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
        pathMatch: 'full'
      },
      {
        path: 'acomodacoes',
        loadComponent: () => import('./features/accommodations/accommodations-list.component').then((m) => m.AccommodationsListComponent)
      },
      {
        path: 'acomodacoes/:slug',
        loadComponent: () => import('./features/accommodations/accommodation-detail.component').then((m) => m.AccommodationDetailComponent)
      },
      {
        path: 'experiencias',
        loadComponent: () => import('./features/experiences/experiences.component').then((m) => m.ExperiencesComponent)
      },
      {
        path: 'galeria',
        loadComponent: () => import('./features/gallery/gallery.component').then((m) => m.GalleryComponent)
      },
      {
        path: 'guia',
        loadComponent: () => import('./features/guia/guia-list.component').then((m) => m.GuiaListComponent)
      },
      {
        path: 'guia/:slug',
        loadComponent: () => import('./features/guia/guia-article.component').then((m) => m.GuiaArticleComponent)
      },
      {
        path: 'sobre',
        loadComponent: () => import('./features/about/about.component').then((m) => m.AboutComponent)
      },
      {
        path: 'localizacao',
        loadComponent: () => import('./features/location/location.component').then((m) => m.LocationComponent)
      },
      {
        path: 'contato',
        loadComponent: () => import('./features/contact/contact.component').then((m) => m.ContactComponent)
      },
      {
        path: 'reservar',
        loadComponent: () => import('./features/booking/booking.component').then((m) => m.BookingComponent)
      },
      {
        path: 'reserva/pagamento/sucesso',
        loadComponent: () => import('./features/booking/payment-status.component').then((m) => m.PaymentStatusComponent)
      },
      {
        path: 'reserva/pagamento/cancelado',
        loadComponent: () => import('./features/booking/payment-status.component').then((m) => m.PaymentStatusComponent)
      },
      {
        path: 'fnrh/:token',
        loadComponent: () => import('./features/guest/fnrh-form.component').then((m) => m.FnrhFormComponent)
      },
      {
        path: 'avaliacao/:token',
        loadComponent: () => import('./features/guest/avaliacao-form.component').then((m) => m.AvaliacaoFormComponent)
      },
      {
        path: 'checkout-online/:token',
        loadComponent: () => import('./features/guest/checkout-online.component').then((m) => m.CheckoutOnlineComponent)
      },
      {
        path: 'portal/:token',
        loadComponent: () => import('./features/guest/portal.component').then((m) => m.PortalComponent)
      },
      {
        path: 'privacidade',
        loadComponent: () => import('./features/privacy/privacy.component').then((m) => m.PrivacyComponent)
      },
      {
        path: 'termos-de-reserva',
        loadComponent: () => import('./features/terms/terms.component').then((m) => m.TermsComponent)
      },
      {
        path: 'termos',
        redirectTo: 'termos-de-reserva',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
