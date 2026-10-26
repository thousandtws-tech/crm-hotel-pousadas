import { Routes } from '@angular/router';
import { authGuard, adminGuard, guestGuard } from '@core/guards/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'cadastro',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/cadastro.component').then((m) => m.CadastroComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'reservas',
        loadComponent: () =>
          import('./features/reservas/reservas.component').then((m) => m.ReservasComponent),
      },
      {
        path: 'reservas/:id',
        loadComponent: () =>
          import('./features/reservas/reserva-detail.component').then(
            (m) => m.ReservaDetailComponent,
          ),
      },
      {
        path: 'clientes',
        loadComponent: () =>
          import('./features/clientes/clientes.component').then((m) => m.ClientesComponent),
      },
      {
        path: 'acomodacoes',
        loadComponent: () =>
          import('./features/acomodacoes/acomodacoes.component').then(
            (m) => m.AcomodacoesComponent,
          ),
      },
      {
        path: 'estoque',
        loadComponent: () =>
          import('./features/estoque/estoque.component').then((m) => m.EstoqueComponent),
      },
      {
        path: 'frigobares',
        loadComponent: () =>
          import('./features/frigobares/frigobares.component').then((m) => m.FrigobaresComponent),
      },
      {
        path: 'estacionamento',
        loadComponent: () =>
          import('./features/estacionamento/estacionamento.component').then(
            (m) => m.EstacionamentoComponent,
          ),
      },
      {
        path: 'pagamentos',
        loadComponent: () =>
          import('./features/pagamentos/pagamentos.component').then((m) => m.PagamentosComponent),
      },
      {
        path: 'cms',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/cms/cms.component').then((m) => m.CmsComponent),
      },
      {
        path: 'estabelecimento',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/estabelecimento/estabelecimento.component').then(
            (m) => m.EstabelecimentoComponent,
          ),
      },
      {
        path: 'funcionarios',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/funcionarios/funcionarios.component').then(
            (m) => m.FuncionariosComponent,
          ),
      },
      {
        path: 'financeiro',
        loadComponent: () =>
          import('./features/financeiro/financeiro.component').then((m) => m.FinanceiroComponent),
      },
      {
        path: 'auditoria',
        loadComponent: () =>
          import('./features/auditoria/auditoria.component').then((m) => m.AuditoriaComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
