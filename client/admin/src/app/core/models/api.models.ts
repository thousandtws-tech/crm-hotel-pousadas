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
  version: number;
  criado_em: string;
}

export interface ItemEstoque {
  id: number;
  nome: string;
  idcategoria: number | null;
  quantidade: number;
  valor_unitario: string;
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
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

export interface ItemEstoqueUpdate {
  nome?: string;
  idcategoria?: number | null;
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
