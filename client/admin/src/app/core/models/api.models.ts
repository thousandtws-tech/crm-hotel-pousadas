// Contratos espelhando o backend clarituz-api (server/crates/*/dto + entities).
// Decimal chega como string — helpers em `brl()`/`num()` tratam conversão.

export interface ApiErro {
  erro: { codigo: string; mensagem: string };
}

export interface Page<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
}

export type StatusReserva = 'p' | 'i' | 'c' | 'f';
export type StatusConsumo = 'pendente' | 'concluido' | 'cancelado' | 'reembolsado';
export type TipoMovimento = 'entrada' | 'saida';

// -- auth --------------------------------------------------------------------

export interface FuncionarioView {
  id: number;
  nome: string;
  login: string;
  nivel: number;
  nivel_nome: string;
  ativo: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expira_em: number;
  funcionario: FuncionarioView;
}

export interface Funcionario {
  id: number;
  nome: string;
  login: string;
  cpf: string | null;
  data_nascimento: string | null;
  nivel: number;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface FuncionarioInput {
  nome: string;
  login: string;
  senha: string;
  cpf?: string | null;
  data_nascimento?: string | null;
  nivel: number;
}

/** Auto-cadastro pela tela de login — cria conta de administrador. */
export interface RegistroInput {
  nome: string;
  login: string;
  senha: string;
}

export interface FuncionarioUpdate {
  nome?: string;
  login?: string;
  senha?: string;
  cpf?: string | null;
  data_nascimento?: string | null;
  nivel?: number;
  /** Concorrência otimista — enviar a version lida no GET. */
  version?: number;
}

// -- clientes ------------------------------------------------------------------

export interface Cliente {
  id: number;
  nome: string;
  cpf: string;
  data_nascimento: string;
  email: string | null;
  telefone: string | null;
  estado: string | null;
  cidade: string | null;
  // -- dados complementares da FNRH --------------------------------------
  nacionalidade: string | null;
  naturalidade: string | null;
  profissao: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  pais: string | null;
  ativo: boolean;
  /** True quando há foto cadastrada — bytes em GET /clientes/{id}/foto. */
  tem_foto: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ClienteInput {
  nome: string;
  cpf: string;
  data_nascimento: string;
  email?: string | null;
  telefone?: string | null;
  estado?: string | null;
  cidade?: string | null;
  nacionalidade?: string | null;
  naturalidade?: string | null;
  profissao?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cep?: string | null;
  pais?: string | null;
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

// -- documentos de identidade do hóspede -------------------------------------

export type TipoDocumento = 'rg' | 'cpf' | 'cnh' | 'passaporte' | 'rne' | 'outro';

export const TIPOS_DOCUMENTO: Record<TipoDocumento, string> = {
  rg: 'RG',
  cpf: 'CPF',
  cnh: 'CNH',
  passaporte: 'Passaporte',
  rne: 'RNE',
  outro: 'Outro',
};

export interface ClienteDocumento {
  id: number;
  idcliente: number;
  tipo: TipoDocumento;
  numero: string;
  orgao_emissor: string | null;
  uf_emissor: string | null;
  pais_emissor: string | null;
  validade: string | null;
  /** True quando há scan digitalizado — bytes em GET /documentos/{id}/scan. */
  tem_scan: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface DocumentoInput {
  tipo: TipoDocumento;
  numero: string;
  orgao_emissor?: string | null;
  uf_emissor?: string | null;
  pais_emissor?: string | null;
  validade?: string | null;
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

// -- acompanhantes da reserva --------------------------------------------------

export interface Acompanhante {
  id: number;
  idreserva: number;
  nome: string;
  data_nascimento: string | null;
  parentesco: string | null;
  doc_tipo: string | null;
  doc_numero: string | null;
  criado_em: string;
}

export interface AcompanhanteInput {
  nome: string;
  data_nascimento?: string | null;
  parentesco?: string | null;
  doc_tipo?: string | null;
  doc_numero?: string | null;
}

// -- FNRH (ficha nacional de registro de hóspedes) -----------------------------

/** Snapshot imutável gravado na emissão — a ficha impressa renderiza isso. */
export interface FnrhDados {
  hospede: {
    nome: string;
    cpf: string;
    data_nascimento: string;
    nacionalidade: string | null;
    naturalidade: string | null;
    profissao: string | null;
    email: string | null;
    telefone: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    cep: string | null;
    pais: string | null;
    tem_foto: boolean;
  };
  reserva: {
    id: number;
    acomodacao: string;
    acomodacao_numero: number;
    quarto: string | null;
    entradaprevista: string;
    saidaprevista: string;
    checkin_em: string | null;
    quantidade_hospedes: number;
  };
  acompanhantes: Acompanhante[];
  emitida_por: string;
}

export interface Fnrh {
  id: number;
  idreserva: number;
  idcliente: number;
  motivo_viagem: string | null;
  placa_veiculo: string | null;
  dados: FnrhDados;
  emitida_por: number | null;
  emitida_em: string;
}

// -- catálogo ------------------------------------------------------------------

export interface TipoAcomodacao {
  id: number;
  nome: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface Acomodacao {
  id: number;
  idtipo_acomodacao: number | null;
  nome: string;
  numero: number;
  valor: string;
  capacidade: number;
  descricao: string | null;
  cor: string;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface AcomodacaoInput {
  idtipo_acomodacao?: number | null;
  nome: string;
  numero: number;
  valor?: string | number | null;
  capacidade: number;
  descricao?: string | null;
  cor?: string | null;
  version?: number;
}

export interface Quarto {
  id: number;
  idacomodacao: number;
  numero: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// CMS — conteúdo editorial + mídia do site público
// ---------------------------------------------------------------------------

export interface AcomodacaoCms {
  id: number;
  idacomodacao: number;
  slug: string;
  subtitulo: string | null;
  descricao_curta: string | null;
  descricao_longa: string | null;
  destaque_editorial: string | null;
  camas: string | null;
  banheiros: number | null;
  metragem: string | null;
  vista: string | null;
  andar: string | null;
  comodidades: Comodidade[];
  status: 'rascunho' | 'publicado';
  destaque: boolean;
  ordem: number;
  publicado_em: string | null;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface Comodidade {
  name: string;
  icon: string;
  highlight?: boolean;
}

export interface Midia {
  id: number;
  tipo: 'foto' | 'video';
  url: string;
  capa: boolean;
  ordem: number;
}

export interface AcomodacaoCmsView extends Acomodacao {
  cms: AcomodacaoCms | null;
  midias: Midia[];
}

export interface CmsInput {
  slug?: string | null;
  subtitulo?: string | null;
  descricao_curta?: string | null;
  descricao_longa?: string | null;
  destaque_editorial?: string | null;
  camas?: string | null;
  banheiros?: number | null;
  metragem?: string | number | null;
  vista?: string | null;
  andar?: string | null;
  comodidades?: Comodidade[];
  destaque?: boolean;
  ordem?: number;
  version?: number;
}

export interface TarifaHistorico {
  id: number;
  idacomodacao: number;
  valor: string;
  vigente_desde: string;
  vigente_ate: string | null;
  criado_em: string;
}

export interface Frigobar {
  id: number;
  idacomodacao: number;
  modelo: string | null;
  patrimonio: string | null;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface ItemFrigobar {
  id: number;
  idfrigobar: number;
  iditem: number;
  quantidade: number;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface ItemFrigobarView extends ItemFrigobar {
  item_nome: string;
  valor_unitario: string;
}

export interface VagaEstacionamento {
  id: number;
  idacomodacao: number | null;
  numero: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface FormaPagamento {
  id: number;
  nome: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface ComprovanteResumo {
  comprovante: string;
  idreserva: number;
  cliente: string;
  acomodacao: string;
}

export interface Estabelecimento {
  id: number;
  cnpj: string | null;
  razao_social: string | null;
  site: string | null;
  impressora_ip?: string | null;
  impressora_porta?: number;
  impressora_ativa?: boolean;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  version?: number;
}

export interface EnderecoEstabelecimento {
  id: number;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  version?: number;
}

// -- reservas ------------------------------------------------------------------

export interface Reserva {
  id: number;
  idacomodacao: number;
  idcliente: number;
  idquarto: number | null;
  quantidade_hospedes: number;
  entradaprevista: string;
  saidaprevista: string;
  checkin_em: string | null;
  checkout_em: string | null;
  obs: string | null;
  status: StatusReserva;
  valordiaria: string;
  criado_em: string;
  atualizado_em: string;
}

export interface ReservaResumo {
  id: number;
  idacomodacao: number;
  acomodacao_nome: string;
  acomodacao_numero: number;
  acomodacao_cor: string;
  idcliente: number;
  cliente_nome: string;
  quantidade_hospedes: number;
  entradaprevista: string;
  saidaprevista: string;
  status: StatusReserva;
  valordiaria: string;
  idquarto: number | null;
  quarto_numero: string | null;
  valor_estadia: string | null;
}

export interface ConsumoResumo {
  id: number;
  status: StatusConsumo;
  valor_estadia: string;
  valor_itens: string;
  valor_adicional: string;
  total_desconto: string;
  valor_final: string | null;
  idforma_pagamento: number | null;
  forma_pagamento: string | null;
  comprovante: string | null;
  fechado_em: string | null;
}

export interface ReservaDetalhe extends Omit<Reserva, 'atualizado_em'> {
  quarto_numero: string | null;
  acomodacao_nome: string;
  acomodacao_numero: number;
  acomodacao_valor: string;
  cliente_nome: string;
  cliente_cpf: string;
  consumo: ConsumoResumo | null;
}

export interface ReservaInput {
  idacomodacao: number;
  idcliente: number;
  quantidade_hospedes: number;
  entradaprevista: string;
  saidaprevista: string;
  obs?: string | null;
  valordiaria?: string | number | null;
}

export interface ItemConsumido {
  id: number;
  idconsumo: number;
  iditem: number;
  nome: string;
  quantidade: number;
  valor_total: string;
  criado_em: string;
}

export interface AdicionalConsumo {
  id: number;
  idconsumo: number;
  motivo: string;
  valor: string;
  criado_em: string;
}

export interface CheckoutRequest {
  idforma_pagamento: number;
  total_desconto?: number | string | null;
  adicionais: { motivo: string; valor: number | string }[];
}

export interface CheckoutResponse {
  reserva: Reserva;
  consumo: ConsumoResumo;
}

export interface CancelarReservaRequest {
  motivo?: string | null;
  login_admin?: string | null;
  senha_admin?: string | null;
}

export interface AcomodacaoDisponivel {
  id: number;
  nome: string;
  numero: number;
  valor: string;
  capacidade: number;
}

export interface DisponibilidadeResponse {
  disponivel: boolean;
  quantidade: number;
  diarias: number;
  inicio: string;
  fim: string;
  acomodacoes: AcomodacaoDisponivel[];
}

// -- estoque -------------------------------------------------------------------

export interface CategoriaEstoque {
  id: number;
  nome: string;
  /** Impressora do setor para tickets de produção (KOT). */
  impressora_id?: number | null;
  ativo: boolean;
  version: number;
  criado_em: string;
}

/** Impressora térmica de rede por setor. */
export interface Impressora {
  id: number;
  nome: string;
  setor: string;
  ip: string;
  porta: number;
  ativa: boolean;
  /** Impressora padrão de comprovantes. */
  padrao: boolean;
  /** Impressora dedicada a etiquetas de produto. */
  etiqueta: boolean;
  version: number;
  criado_em: string;
}

export interface ItemEstoque {
  id: number;
  nome: string;
  idcategoria: number | null;
  quantidade: number;
  valor_unitario: string;
  unidade: string;
  estoque_minimo: number;
  eh_insumo: boolean;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ItemEstoqueInput {
  nome: string;
  idcategoria?: number | null;
  quantidade_inicial?: number | null;
  valor_unitario?: number | string | null;
  unidade?: string | null;
  estoque_minimo?: number | null;
  eh_insumo?: boolean;
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

export interface ItemEstoqueUpdate {
  nome?: string;
  idcategoria?: number | null;
  unidade?: string | null;
  estoque_minimo?: number | null;
  eh_insumo?: boolean;
  valor_unitario?: number | string | null;
  version?: number;
}

export interface MovimentoView {
  id: number;
  iditem: number;
  item_nome: string;
  tipo: TipoMovimento;
  quantidade: number;
  funcionario: string | null;
  motivo: string;
  criado_em: string;
}

export interface MovimentacaoInput {
  iditem: number;
  tipo: TipoMovimento;
  quantidade: number;
  motivo?: string;
}

// -- relatórios ----------------------------------------------------------------

export interface DashboardCards {
  total_acomodacoes: number;
  acomodacoes_disponiveis: number;
  acomodacoes_ocupadas: number;
  hospedes_atuais: number;
  checkins_hoje: number;
  checkouts_hoje: number;
  checkins_pendentes_hoje: number;
  checkouts_pendentes_hoje: number;
}

export interface PendenciaDia {
  idreserva: number;
  acomodacao_nome: string;
  cliente_nome: string;
  entradaprevista: string;
  saidaprevista: string;
}

export interface AcomodacaoBasica {
  id: number;
  nome: string;
  numero: number;
}

export interface DashboardResponse {
  cards: DashboardCards;
  ultimas_reservas: ReservaResumo[];
  checkins_pendentes: PendenciaDia[];
  checkouts_pendentes: PendenciaDia[];
  acomodacoes_disponiveis: AcomodacaoBasica[];
  acomodacoes_ocupadas: AcomodacaoBasica[];
}

export interface ResumoFinanceiro {
  recebido: string;
  recebido_estadias: string;
  recebido_itens: string;
  recebido_adicionais: string;
  previsto: string;
  descontos: string;
  qtd_contas_fechadas: number;
}

export interface PontoSerie {
  rotulo: string;
  valor: string;
  quantidade: number;
}

export interface ItemMaisVendido {
  nome: string;
  quantidade: number;
  valor: string;
}

export interface VendaItem {
  idreserva: number;
  item: string;
  quantidade: number;
  valor_total: string;
  criado_em: string;
}

export interface RegistroLog {
  id: number;
  idfuncionario: number | null;
  funcionario_nome: string | null;
  acao: string;
  obs: string | null;
  tabela: string | null;
  idtabela: number | null;
  dados: unknown;
  criado_em: string;
}

// -- notificações (inbox realtime) ------------------------------------------------

export interface Notificacao {
  id: number;
  tipo: 'info' | 'sucesso' | 'alerta';
  titulo: string;
  mensagem: string;
  autor_nome: string | null;
  dados: { idreserva?: number } | null;
  lida: boolean;
  criado_em: string;
}

// -- busca global (GET /busca) --------------------------------------------------

export interface ItemBusca {
  tipo: 'cliente' | 'reserva' | 'acomodacao' | 'funcionario' | 'estoque';
  id: number;
  titulo: string;
  sub: string | null;
  rota: string;
}

// -- tesouraria: contas a pagar/receber, conciliação, split IBS/CBS ------------

export type TipoLancamento = 'pagar' | 'receber';
export type StatusLancamento = 'aberto' | 'parcial' | 'liquidado' | 'cancelado';
export type TipoContaFinanceira = 'caixa' | 'banco' | 'aplicacao';
export type StatusExtrato = 'pendente' | 'conciliado' | 'ignorado';
export type StatusSplit = 'provisionado' | 'segregado' | 'recolhido';
export type GrupoDre =
  | 'receita_bruta'
  | 'deducoes'
  | 'custos'
  | 'despesas_operacionais'
  | 'resultado_financeiro'
  | 'outras';

export interface PlanoConta {
  id: number;
  codigo: string;
  nome: string;
  tipo: TipoLancamento;
  grupo_dre: GrupoDre;
  ativo: boolean;
  sistema: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ContaFinanceira {
  id: number;
  nome: string;
  tipo: TipoContaFinanceira;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  saldo_inicial: string;
  saldo_inicial_em: string;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface Lancamento {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  idplano_conta: number | null;
  idconta_financeira: number | null;
  favorecido: string | null;
  documento: string | null;
  idcliente: number | null;
  idreserva: number | null;
  valor: string;
  valor_liquidado: string;
  emissao: string;
  vencimento: string;
  competencia: string | null;
  status: StatusLancamento;
  observacao: string | null;
  idfuncionario: number | null;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface LancamentoView {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  idplano_conta: number | null;
  plano_conta: string | null;
  grupo_dre: GrupoDre | null;
  idconta_financeira: number | null;
  conta_financeira: string | null;
  favorecido: string | null;
  documento: string | null;
  idcliente: number | null;
  cliente_nome: string | null;
  idreserva: number | null;
  valor: string;
  valor_liquidado: string;
  saldo: string;
  emissao: string;
  vencimento: string;
  competencia: string | null;
  status: StatusLancamento;
  vencido: boolean;
  observacao: string | null;
  version: number;
  criado_em: string;
}

export interface BaixaLancamento {
  id: number;
  idlancamento: number;
  idconta_financeira: number;
  valor: string;
  data: string;
  idforma_pagamento: number | null;
  observacao: string | null;
  idfuncionario: number | null;
  criado_em: string;
}

export interface BaixaView {
  id: number;
  idlancamento: number;
  idconta_financeira: number;
  conta_financeira: string | null;
  valor: string;
  data: string;
  idforma_pagamento: number | null;
  forma_pagamento: string | null;
  observacao: string | null;
  funcionario: string | null;
  criado_em: string;
}

export interface FluxoCaixaDia {
  data: string;
  entradas: string;
  saidas: string;
  saldo: string;
  acumulado: string;
  prev_entradas: string;
  prev_saidas: string;
}

export interface FluxoCaixa {
  inicio: string;
  fim: string;
  saldo_abertura: string;
  total_entradas: string;
  total_saidas: string;
  saldo_final_previsto: string;
  dias: FluxoCaixaDia[];
}

export interface DreLinha {
  origem: string;
  codigo: string | null;
  rotulo: string;
  grupo: GrupoDre;
  valor: string;
}

export interface Dre {
  inicio: string;
  fim: string;
  receita_bruta: string;
  deducoes: string;
  receita_liquida: string;
  custos: string;
  despesas_operacionais: string;
  lucro_operacional: string;
  resultado_financeiro: string;
  outras: string;
  resultado_liquido: string;
  ibs: string;
  cbs: string;
  linhas: DreLinha[];
}

export interface ExtratoView {
  id: number;
  idconta_financeira: number;
  conta_financeira: string | null;
  data: string;
  descricao: string;
  documento: string | null;
  valor: string;
  fit_id: string | null;
  origem: string;
  status: StatusExtrato;
  idbaixa: number | null;
  melhor_score: string | null;
  importado_em: string;
}

export interface ConciliacaoResumo {
  pendentes: number;
  conciliados: number;
  ignorados: number;
  coberto_ate: string | null;
}

export interface Conciliacao {
  id: number;
  idextrato_item: number;
  idbaixa: number;
  score: string;
  tipo: string;
  idfuncionario: number | null;
  criado_em: string;
}

export interface SugestaoConciliacao {
  baixa: BaixaView;
  score: string;
  dias_diferenca: number;
  lancamento_descricao: string;
  lancamento_tipo: TipoLancamento;
}

export interface SplitResumo {
  inicio: string;
  fim: string;
  base: string;
  valor_ibs: string;
  valor_cbs: string;
  valor_liquido: string;
  qtd_eventos: number;
  provisionado_ibs: string;
  provisionado_cbs: string;
}

export interface SplitEventoView {
  id: number;
  origem: string;
  idorigem: number;
  descricao: string | null;
  base: string;
  aliq_ibs: string;
  aliq_cbs: string;
  valor_ibs: string;
  valor_cbs: string;
  valor_liquido: string;
  competencia: string;
  status: StatusSplit;
  criado_em: string;
}

export interface TributoConfig {
  id: number;
  aliq_ibs: string;
  aliq_cbs: string;
  regime: string;
  vigente_desde: string;
  idfuncionario: number | null;
  criado_em: string;
}

export interface TributoApuracao {
  id: number;
  competencia: string;
  valor_ibs: string;
  valor_cbs: string;
  status: string;
  recolhido_em: string | null;
  idfuncionario: number | null;
  criado_em: string;
}

// inputs

export interface LancamentoInput {
  tipo: TipoLancamento;
  descricao: string;
  idplano_conta?: number | null;
  idconta_financeira?: number | null;
  favorecido?: string | null;
  documento?: string | null;
  idcliente?: number | null;
  idreserva?: number | null;
  valor: number;
  parcelas?: number | null;
  emissao?: string | null;
  vencimento: string;
  competencia?: string | null;
  observacao?: string | null;
  version?: number;
}

export interface BaixaInput {
  idconta_financeira: number;
  valor: number;
  data?: string | null;
  idforma_pagamento?: number | null;
  observacao?: string | null;
}

export interface ContaFinanceiraInput {
  nome: string;
  tipo: TipoContaFinanceira;
  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  saldo_inicial?: number | null;
  saldo_inicial_em?: string | null;
  version?: number;
}

export interface BaixaResponse {
  baixa: BaixaLancamento;
  lancamento: Lancamento;
}

// ---------------------------------------------------------------------------
// controle de caixa (turnos de gaveta)
// ---------------------------------------------------------------------------

export type StatusTurno = 'aberto' | 'fechado';
export type TipoMovimentoCaixa = 'sangria' | 'suprimento';

export interface CaixaTurno {
  id: number;
  idconta_financeira: number;
  idoperador: number;
  saldo_inicial: string;
  aberto_em: string;
  fechado_em: string | null;
  valor_contado: string | null;
  valor_esperado: string | null;
  /** contado − esperado (negativo = quebra/falta, positivo = sobra). */
  quebra: string | null;
  status: StatusTurno;
  observacao: string | null;
  fechado_por: number | null;
  version: number;
  criado_em: string;
}

export interface TurnoView {
  id: number;
  idconta_financeira: number;
  conta_financeira: string;
  idoperador: number;
  operador: string;
  saldo_inicial: string;
  aberto_em: string;
  fechado_em: string | null;
  valor_contado: string | null;
  valor_esperado: string | null;
  quebra: string | null;
  status: StatusTurno;
  observacao: string | null;
  total_suprimentos: string;
  total_sangrias: string;
  version: number;
  criado_em: string;
}

export interface CaixaMovimento {
  id: number;
  idturno: number;
  tipo: TipoMovimentoCaixa;
  valor: string;
  motivo: string;
  idfuncionario: number;
  criado_em: string;
}

export interface MovimentoCaixaView {
  id: number;
  idturno: number;
  tipo: TipoMovimentoCaixa;
  valor: string;
  motivo: string;
  funcionario: string;
  criado_em: string;
}

export interface ConferenciaLinha {
  origem: string;
  descricao: string;
  valor: string;
  sinal: number;
  criado_em: string;
}

/** Conferência automática: esperado derivado do ledger. */
export interface ConferenciaCaixa {
  turno: TurnoView;
  fundo: string;
  suprimentos: string;
  sangrias: string;
  recebimentos: string;
  pagamentos: string;
  especie: string;
  esperado: string;
  movimentos: MovimentoCaixaView[];
  linhas: ConferenciaLinha[];
}

export interface AbrirCaixaInput {
  idconta_financeira: number;
  saldo_inicial: number;
  observacao?: string | null;
}

export interface MovCaixaInput {
  tipo: TipoMovimentoCaixa;
  valor: number;
  motivo: string;
}

export interface FecharCaixaInput {
  valor_contado: number;
  observacao?: string | null;
}



// ---------------------------------------------------------------------------
// PDV & comandas
// ---------------------------------------------------------------------------

export type PdvComandaTipo = 'mesa' | 'quarto' | 'balcao';
export type PdvComandaStatus = 'aberta' | 'fechada' | 'cancelada';
export type PdvItemStatus = 'pendente' | 'em_preparo' | 'pronto' | 'entregue' | 'cancelado';
export type PdvComissaoStatus = 'pendente' | 'paga';

export interface MesaView {
  id: number;
  numero: string;
  lugares: number;
  ativo: boolean;
  idcomanda: number | null;
  total_aberto: string | null;
  garcom_nome: string | null;
}

export interface GarcomView {
  id: number;
  idfuncionario: number;
  funcionario_nome: string;
  percentual: string;
  ativo: boolean;
}

export interface ComandaView {
  id: number;
  tipo: PdvComandaTipo;
  idmesa: number | null;
  mesa_numero: string | null;
  idquarto: number | null;
  quarto_numero: string | null;
  idreserva: number | null;
  idcliente: number | null;
  cliente_nome: string | null;
  idgarcom: number | null;
  garcom_nome: string | null;
  rotulo: string | null;
  status: PdvComandaStatus;
  total_itens: string;
  itens_pendentes: number;
  desconto: string;
  total: string;
  idlancamento: number | null;
  aberto_em: string;
  fechado_em: string | null;
  version: number;
}

export interface ComandaItemView {
  id: number;
  idcomanda: number;
  iditem: number;
  item_nome: string;
  categoria_nome: string | null;
  quantidade: number;
  valor_unit: string;
  valor_total: string;
  status: PdvItemStatus;
  lancado_por: number | null;
  lancado_por_nome: string | null;
  cancelado_por_nome: string | null;
  motivo_cancelamento: string | null;
  criado_em: string;
}

export interface ItemVendaView {
  id: number;
  nome: string;
  categoria_nome: string | null;
  quantidade: number;
  valor_unitario: string;
}

export interface ComissaoView {
  id: number;
  idgarcom: number;
  garcom_nome: string;
  idcomanda: number;
  comanda_descricao: string;
  percentual: string;
  base: string;
  valor: string;
  status: PdvComissaoStatus;
  pago_em: string | null;
  criado_em: string;
}

export interface ComissaoResumo {
  idgarcom: number;
  garcom_nome: string;
  comissoes_pendentes: number;
  valor_pendente: string;
  valor_pago: string;
}

export interface AbrirComandaInput {
  tipo: PdvComandaTipo;
  idmesa?: number | null;
  idquarto?: number | null;
  idcliente?: number | null;
  idgarcom?: number | null;
  rotulo?: string | null;
}

export interface FecharComandaInput {
  modo: 'pagar' | 'faturar';
  desconto?: number | null;
  idconta_financeira?: number | null;
  idforma_pagamento?: number | null;
  observacao?: string | null;
}

export interface PdvMesa {
  id: number;
  numero: string;
  lugares: number;
  ativo: boolean;
  version: number;
}

export interface PdvGarcom {
  id: number;
  idfuncionario: number;
  percentual: string;
  ativo: boolean;
}

export interface PdvComanda {
  id: number;
  tipo: PdvComandaTipo;
  idmesa: number | null;
  idquarto: number | null;
  idreserva: number | null;
  idcliente: number | null;
  idgarcom: number | null;
  rotulo: string | null;
  status: PdvComandaStatus;
  subtotal: string;
  desconto: string;
  total: string;
  idforma_pagamento: number | null;
  idlancamento: number | null;
  aberto_em: string;
  fechado_em: string | null;
  observacao: string | null;
  version: number;
}

export interface PdvComandaItem {
  id: number;
  idcomanda: number;
  iditem: number;
  quantidade: number;
  valor_unit: string;
  valor_total: string;
  status: PdvItemStatus;
}

export interface PdvComissao {
  id: number;
  idgarcom: number;
  idcomanda: number;
  percentual: string;
  base: string;
  valor: string;
  status: PdvComissaoStatus;
  pago_em: string | null;
}

/** Item na fila da cozinha (KDS) — comanda aberta + contexto de destino. */
export interface FilaItemView {
  id: number;
  idcomanda: number;
  comanda_tipo: PdvComandaTipo;
  mesa_numero: string | null;
  quarto_numero: string | null;
  rotulo: string | null;
  cliente_nome: string | null;
  garcom_nome: string | null;
  iditem: number;
  item_nome: string;
  categoria_nome: string | null;
  quantidade: number;
  status: PdvItemStatus;
  criado_em: string;
  comanda_aberto_em: string;
}

// ---------------------------------------------------------------------------
// Café da manhã — presença por reserva/dia
// ---------------------------------------------------------------------------

export interface CafeQuadroItem {
  idreserva: number;
  cliente_nome: string;
  quantidade_hospedes: number;
  quarto_numero: string | null;
  acomodacao_nome: string;
  entradaprevista: string;
  saidaprevista: string;
  presenca_id: number | null;
  presenca_quantidade: number | null;
  presenca_em: string | null;
  registrado_por_nome: string | null;
}

export interface CafePresenca {
  id: number;
  idreserva: number;
  data: string;
  quantidade: number;
  registrado_por: number | null;
  criado_em: string;
}

export interface PresencaView {
  id: number;
  idreserva: number;
  data: string;
  quantidade: number;
  cliente_nome: string;
  quarto_numero: string | null;
  registrado_por_nome: string | null;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// estoque & insumos — ficha tecnica, conversoes, alertas, NF-e
// ---------------------------------------------------------------------------

export interface FichaItemView {
  id: number;
  idinsumo: number;
  insumo: string;
  unidade: string;
  quantidade: number;
  custo_unit: string;
}

export interface FichaItemInput {
  idinsumo: number;
  quantidade: number;
}

export interface ConversaoUnidade {
  id: number;
  iditem: number;
  unidade_compra: string;
  fator: number;
  criado_em: string;
}

export interface ConversaoInput {
  unidade_compra: string;
  fator: number;
}

export interface EstoqueBaixoView {
  id: number;
  nome: string;
  unidade: string;
  quantidade: number;
  estoque_minimo: number;
}

export interface NfeItemPreview {
  nome: string;
  unidade_compra: string;
  quantidade: string;
  valor_unit: string;
  valor_total: string;
  iditem_sugerido: number | null;
  fator_sugerido: number | null;
}

export interface NfePreview {
  chave: string;
  numero: string | null;
  emitente: string | null;
  cnpj: string | null;
  emissao: string | null;
  total: string;
  ja_importada: boolean;
  itens: NfeItemPreview[];
}

export interface NfeItemInput {
  iditem: number | null;
  nome: string;
  unidade_compra: string;
  fator?: number | null;
  quantidade: number | string;
  valor_total: number | string;
}

export interface NfeImportRequest {
  chave: string;
  numero?: string | null;
  emitente?: string | null;
  cnpj?: string | null;
  emissao?: string | null;
  total: number | string;
  vencimento?: string | null;
  gerar_pagamento?: boolean;
  itens: NfeItemInput[];
}

export interface NfeImport {
  id: number;
  chave: string;
  numero: string | null;
  emitente: string | null;
  total: string;
  idlancamento: number | null;
  criado_em: string;
}

export interface Fornecedor {
  id: number; nome: string; cnpj: string | null; contato: string | null;
  telefone: string | null; lead_time_dias: number; ativo: boolean;
  criado_em: string; atualizado_em: string;
}
/** Upsert por nome no backend — não existe update por id. */
export interface FornecedorInput {
  nome: string; cnpj?: string; contato?: string; telefone?: string; lead_time_dias?: number;
}
export interface PedidoCompraView {
  id: number; idfornecedor: number; fornecedor: string; fornecedor_cnpj: string | null;
  data_prevista: string; valor_total: string;
  status: "pendente" | "parcial" | "recebido" | "cancelado";
  origem: string; idlancamento: number | null; criado_por: string | null;
  observacao: string | null; total_itens: number; recebido_itens: number; criado_em: string;
}
export interface PedidoItemView {
  id: number; iditem: number; item: string; unidade: string;
  quantidade: number; quantidade_recebida: number; valor_unit: string | null;
}
export interface PedidoDetalhe { pedido: PedidoCompraView; itens: PedidoItemView[]; }
export interface PedidoCriado {
  pedido: {
    id: number;
    idfornecedor: number;
    data_prevista: string | null;
    valor_total: string;
    status: string;
    idlancamento: number | null;
  };
  itens: unknown[];
}
export interface PedidoCompraInput {
  idfornecedor: number; itens: { iditem: number; quantidade: number; valor_unit?: number }[];
  vencimento?: string; observacao?: string; gerar_pagamento?: boolean; origem?: string;
}
export interface RecebimentoItem { iditem: number; quantidade: number; }

/** Dispositivo de impressão detectado pelo agente local, aguardando registro. */
export interface ImpressoraDescoberta {
  id: number;
  tipo: 'rede' | 'usb';
  endereco: string;
  porta: number | null;
  modelo: string | null;
  origem: string;
  status: 'pendente' | 'registrada' | 'ignorada';
  impressora_id: number | null;
  visto_em: string;
}
