// Lógica e estado de fin-nav — separada da camada de UI (fin-nav.component.ts).
// O componente herda os membros; templates e comportamento não mudam.

/** Sub-navegação do módulo financeiro — presente no topo de todas as telas. */
export abstract class FinNavStore {
  readonly itens = [
    { rota: '/financeiro', rotulo: 'Visão geral', icone: 'assessment', exato: true },
    { rota: '/financeiro/contas', rotulo: 'Contas', icone: 'receipt_long', exato: false },
    { rota: '/financeiro/fluxo-caixa', rotulo: 'Fluxo de caixa', icone: 'swap_vert', exato: false },
    { rota: '/financeiro/dre', rotulo: 'DRE', icone: 'assessment', exato: false },
    {
      rota: '/financeiro/conciliacao',
      rotulo: 'Conciliação',
      icone: 'compare_arrows',
      exato: false,
    },
    { rota: '/financeiro/split', rotulo: 'Split IBS/CBS', icone: 'account_balance', exato: false },
    { rota: '/financeiro/caixa', rotulo: 'Caixa', icone: 'point_of_sale', exato: false },
  ];
}
