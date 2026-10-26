import { Routes } from '@angular/router';

export const routes: Routes = [
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
