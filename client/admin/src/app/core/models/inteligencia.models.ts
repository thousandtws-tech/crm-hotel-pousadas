// Contratos do domínio inteligencia (extraído de api.models.ts).

export interface IaOcupacaoDia {
  data: string;
  ocupados: number;
  total_quartos: number;
  checkins: number;
  checkouts: number;
  stayovers: number;
}

export interface IaSemanaReceita {
  semana: string;
  diarias: number;
  receita: number;
}

export interface IaFluxo {
  entradas_confirmadas: number;
  media_historica_90d: number;
  entradas_previstas: number;
  saidas_previstas: number;
  saldo_previsto: number;
}

export interface IaMesHistorico {
  mes: string;
  diarias: number;
  receita: number;
  reservas: number;
  ocupacao_pct: number;
  adr: number;
}

export interface IaRisco {
  idreserva: number;
  cliente: string;
  acomodacao: string;
  entrada: string;
  score: number;
  nivel: 'verde' | 'amarelo' | 'vermelho';
  sinais: string[];
  acao: string;
}

export interface IaPerfil {
  idcliente: number;
  nome: string;
  estadias: number;
  ultima_estadia: string | null;
  ltv: number;
  classe: 'vip' | 'ativo' | 'em_risco' | 'churn' | 'novo';
}

export interface IaPace {
  reservas_atual: number;
  receita_atual: number;
  reservas_ano_anterior: number;
  receita_ano_anterior: number;
  variacao_pct: number;
  recomendacao: string;
}

export interface IaEscalaDia {
  data: string;
  setor: string;
  demanda_min: number;
  sugerido: number;
  escalado: number;
  deficit: number;
}

export interface IaUpsell {
  idreserva: number;
  cliente: string;
  acomodacao_atual: string;
  acomodacao_alvo: string;
  entrada: string;
  saida: string;
  diferenca_diaria: number;
  ganho_potencial: number;
}

export interface IaEstoquePrev {
  iditem: number;
  nome: string;
  saldo: number;
  consumo_diario_medio: number;
  demanda_prevista_14d: number;
  dias_restantes: number | null;
  sugestao_compra: number;
}

export interface IaRiscoQuarto {
  idquarto: number;
  quarto: string;
  noites_90d: number;
  os_90d: number;
  score: number;
  nivel: 'verde' | 'amarelo' | 'vermelho';
  recomendacao: string;
}

export interface IaResumo {
  ocupacao_14d: IaOcupacaoDia[];
  ocupacao_media_pct: number;
  receita_4sem: IaSemanaReceita[];
  fluxo: IaFluxo;
  pace: IaPace;
  riscos_altos: number;
  upsells: number;
  perfis: Record<string, number>;
}
