import { Routes } from '@angular/router';
import { authGuard, adminGuard, guestGuard } from '@core/guards/auth.guard';
import { verificacaoGuard } from '@core/guards/verificacao.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    // Portão de identidade — autenticado mas fora do shell (sem menu),
    // senão o verificacaoGuard criaria um loop de redirecionamento.
    path: 'verificacao',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/verificacao/verificacao-pendente.component').then(
        (m) => m.VerificacaoPendenteComponent,
      ),
  },

  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard, verificacaoGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        data: { preload: true },
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'recepcao',
        data: { preload: true },
        loadComponent: () =>
          import('./features/recepcao/recepcao.component').then((m) => m.RecepcaoComponent),
      },
      {
        path: 'reservas',
        data: { preload: true },
        loadComponent: () =>
          import('./features/reservas/reservas.component').then((m) => m.ReservasComponent),
      },
      {
        path: 'operadoras',
        data: { preload: true },
        loadComponent: () =>
          import('./features/operadoras/operadoras.component').then((m) => m.OperadorasComponent),
      },
      {
        path: 'contratos',
        data: { preload: true },
        loadComponent: () =>
          import('./features/contratos/contratos.component').then((m) => m.ContratosComponent),
      },
      {
        path: 'reservas/:id',
        data: { preload: true },
        loadComponent: () =>
          import('./features/reservas/reserva-detail.component').then(
            (m) => m.ReservaDetailComponent,
          ),
      },
      {
        path: 'clientes',
        data: { preload: true },
        loadComponent: () =>
          import('./features/clientes/clientes.component').then((m) => m.ClientesComponent),
      },
      {
        path: 'acomodacoes',
        data: { preload: true },
        loadComponent: () =>
          import('./features/acomodacoes/acomodacoes.component').then(
            (m) => m.AcomodacoesComponent,
          ),
      },
      {
        path: 'estoque',
        data: { preload: true },
        loadComponent: () =>
          import('./features/estoque/estoque.component').then((m) => m.EstoqueComponent),
      },
      {
        path: 'insumos',
        data: { preload: true },
        loadComponent: () =>
          import('./features/estoque/insumos.component').then((m) => m.InsumosComponent),
      },
      {
        path: 'compras',
        data: { preload: true },
        loadComponent: () =>
          import('./features/compras/compras.component').then((m) => m.ComprasComponent),
      },
      {
        path: 'frigobares',
        data: { preload: true },
        loadComponent: () =>
          import('./features/frigobares/frigobares.component').then((m) => m.FrigobaresComponent),
      },
      {
        path: 'estacionamento',
        data: { preload: true },
        loadComponent: () =>
          import('./features/estacionamento/estacionamento.component').then(
            (m) => m.EstacionamentoComponent,
          ),
      },
      {
        path: 'pagamentos',
        data: { preload: true },
        loadComponent: () =>
          import('./features/pagamentos/pagamentos.component').then((m) => m.PagamentosComponent),
      },
      {
        path: 'pdv',
        data: { preload: true },
        loadComponent: () => import('./features/pdv/pdv.component').then((m) => m.PdvComponent),
      },
      {
        path: 'cozinha',
        data: { preload: true },
        loadComponent: () => import('./features/pdv/kds.component').then((m) => m.KdsComponent),
      },
      {
        path: 'cafe',
        data: { preload: true },
        loadComponent: () => import('./features/cafe/cafe.component').then((m) => m.CafeComponent),
      },
      {
        path: 'cms',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () => import('./features/cms/cms.component').then((m) => m.CmsComponent),
      },
      {
        path: 'estabelecimento',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/estabelecimento/estabelecimento.component').then(
            (m) => m.EstabelecimentoComponent,
          ),
      },
      {
        path: 'funcionarios',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/funcionarios/funcionarios.component').then(
            (m) => m.FuncionariosComponent,
          ),
      },
      {
        path: 'comunicacao',
        data: { preload: true },
        loadComponent: () =>
          import('./features/comunicacao/comunicacao.component').then(
            (m) => m.ComunicacaoComponent,
          ),
      },
      {
        path: 'inteligencia',
        data: { preload: true },
        loadComponent: () =>
          import('./features/inteligencia/inteligencia.component').then(
            (m) => m.InteligenciaComponent,
          ),
      },
      {
        path: 'operacao/governanca',
        data: { preload: true },
        loadComponent: () =>
          import('./features/governanca/governanca.component').then((m) => m.GovernancaComponent),
      },
      {
        path: 'operacao/manutencao',
        data: { preload: true },
        loadComponent: () =>
          import('./features/manutencao/manutencao.component').then((m) => m.ManutencaoComponent),
      },
      {
        path: 'operacao/escalas',
        data: { preload: true },
        loadComponent: () =>
          import('./features/escalas/escalas.component').then((m) => m.EscalasComponent),
      },
      {
        path: 'financeiro',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/financeiro.component').then((m) => m.FinanceiroComponent),
      },
      {
        path: 'financeiro/pagamentos-online',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/pagamentos-online.component').then(
            (m) => m.FinPagamentosOnlineComponent,
          ),
      },
      {
        path: 'financeiro/contas',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/contas.component').then((m) => m.FinContasComponent),
      },
      {
        path: 'financeiro/fluxo-caixa',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/fluxo-caixa.component').then(
            (m) => m.FinFluxoCaixaComponent,
          ),
      },
      {
        path: 'financeiro/dre',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/dre.component').then((m) => m.FinDreComponent),
      },
      {
        path: 'financeiro/conciliacao',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/conciliacao.component').then(
            (m) => m.FinConciliacaoComponent,
          ),
      },
      {
        path: 'financeiro/split',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/split.component').then((m) => m.FinSplitComponent),
      },
      {
        path: 'financeiro/caixa',
        data: { preload: true },
        loadComponent: () =>
          import('./features/financeiro/caixa.component').then((m) => m.FinCaixaComponent),
      },
      {
        path: 'auditoria',
        data: { preload: true },
        loadComponent: () =>
          import('./features/auditoria/auditoria.component').then((m) => m.AuditoriaComponent),
      },
      {
        path: 'integracoes',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracoes.component').then(
            (m) => m.IntegracoesComponent,
          ),
      },
      {
        // Z-API, Spedy e Didit têm telas dedicadas — antes da rota genérica.
        path: 'integracoes/didit/:ambiente',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracao-didit.component').then(
            (m) => m.IntegracaoDiditComponent,
          ),
      },
      {
        path: 'integracoes/spedy/:ambiente',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracao-spedy.component').then(
            (m) => m.IntegracaoSpedyComponent,
          ),
      },
      {
        path: 'integracoes/channex/:ambiente',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracao-channex.component').then(
            (m) => m.IntegracaoChannexComponent,
          ),
      },
      {
        path: 'integracoes/zapi/:ambiente',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracao-zapi.component').then(
            (m) => m.IntegracaoZapiComponent,
          ),
      },
      {
        path: 'integracoes/infobip/:ambiente',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracao-infobip.component').then(
            (m) => m.IntegracaoInfobipComponent,
          ),
      },
      {
        path: 'integracoes/:provedor/:ambiente',
        data: { preload: true },
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/integracoes/integracao-detalhe.component').then(
            (m) => m.IntegracaoDetalheComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
