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
        path: 'insumos',
        loadComponent: () =>
          import('./features/estoque/insumos.component').then((m) => m.InsumosComponent),
      },
      {
        path: 'compras',
        loadComponent: () =>
          import('./features/compras/compras.component').then((m) => m.ComprasComponent),
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
        path: 'pdv',
        loadComponent: () =>
          import('./features/pdv/pdv.component').then((m) => m.PdvComponent),
      },
      {
        path: 'cozinha',
        loadComponent: () =>
          import('./features/pdv/kds.component').then((m) => m.KdsComponent),
      },
      {
        path: 'cafe',
        loadComponent: () =>
          import('./features/cafe/cafe.component').then((m) => m.CafeComponent),
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
        path: 'financeiro/contas',
        loadComponent: () =>
          import('./features/financeiro/contas.component').then((m) => m.FinContasComponent),
      },
      {
        path: 'financeiro/fluxo-caixa',
        loadComponent: () =>
          import('./features/financeiro/fluxo-caixa.component').then(
            (m) => m.FinFluxoCaixaComponent,
          ),
      },
      {
        path: 'financeiro/dre',
        loadComponent: () =>
          import('./features/financeiro/dre.component').then((m) => m.FinDreComponent),
      },
      {
        path: 'financeiro/conciliacao',
        loadComponent: () =>
          import('./features/financeiro/conciliacao.component').then(
            (m) => m.FinConciliacaoComponent,
          ),
      },
      {
        path: 'financeiro/split',
        loadComponent: () =>
          import('./features/financeiro/split.component').then((m) => m.FinSplitComponent),
      },
      {
        path: 'financeiro/caixa',
        loadComponent: () =>
          import('./features/financeiro/caixa.component').then((m) => m.FinCaixaComponent),
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
