// Cliente HTTP tipado para clarituz-api. Todas as chamadas passam pelo
// interceptor de auth (Bearer + rotação de refresh em 401).

import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import * as M from '@core/models/api.models';

export type Query = Record<string, string | number | boolean | null | undefined>;

function params(q: Query): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  }
  return p;
}

@Service()
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, q: Query = {}): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, { params: params(q) });
  }
  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body);
  }
  private put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${this.base}${path}`, body);
  }
  private patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.base}${path}`, body);
  }
  private del<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.base}${path}`);
  }

  // -- auth -------------------------------------------------------------------
  login(login: string, senha: string) {
    return this.post<M.TokenResponse>('/auth/login', { login, senha });
  }
  refresh(refresh_token: string) {
    return this.post<M.TokenResponse>('/auth/refresh', { refresh_token });
  }
  logout(refresh_token: string) {
    return this.post<{ mensagem: string }>('/auth/logout', { refresh_token });
  }
  me() {
    return this.get<M.FuncionarioView>('/auth/me');
  }
  registrar(input: M.RegistroInput) {
    return this.post<{ mensagem: string }>('/auth/register', input);
  }

  // -- funcionários ------------------------------------------------------------
  listarFuncionarios(page = 1, porPagina = 20, apenasAtivos = false) {
    return this.get<M.Page<M.Funcionario>>('/funcionarios', {
      page, por_pagina: porPagina, apenas_ativos: apenasAtivos,
    });
  }
  criarFuncionario(input: M.FuncionarioInput) {
    return this.post<M.Funcionario>('/funcionarios', input);
  }
  atualizarFuncionario(id: number, input: M.FuncionarioUpdate) {
    return this.put<M.Funcionario>(`/funcionarios/${id}`, input);
  }
  statusFuncionario(id: number, ativo: boolean) {
    return this.patch<M.Funcionario>(`/funcionarios/${id}/status`, { ativo });
  }

  // -- clientes ----------------------------------------------------------------
  listarClientes(busca: string | null, page = 1, porPagina = 20, apenasAtivos = false) {
    return this.get<M.Page<M.Cliente>>('/clientes', {
      busca, page, por_pagina: porPagina, apenas_ativos: apenasAtivos,
    });
  }
  buscarCliente(id: number) {
    return this.get<M.Cliente>(`/clientes/${id}`);
  }
  criarCliente(input: M.ClienteInput) {
    return this.post<M.Cliente>('/clientes', input);
  }
  atualizarCliente(id: number, input: M.ClienteInput) {
    return this.put<M.Cliente>(`/clientes/${id}`, input);
  }
  statusCliente(id: number, ativo: boolean) {
    return this.patch<M.Cliente>(`/clientes/${id}/status`, { ativo });
  }
  /** Foto cadastrada do cliente (blob autenticado — use URL.createObjectURL). */
  fotoCliente(id: number) {
    return this.http.get(`${this.base}/clientes/${id}/foto`, {
      responseType: 'blob',
    });
  }
  uploadFotoCliente(id: number, f: Blob) {
    return this.http.put(`${this.base}/clientes/${id}/foto`, f, {
      headers: { 'Content-Type': f.type || 'image/jpeg' },
    });
  }
  removerFotoCliente(id: number) {
    return this.del<void>(`/clientes/${id}/foto`);
  }

  // -- documentos de identidade do cliente --------------------------------------
  listarDocumentos(idcliente: number) {
    return this.get<M.ClienteDocumento[]>(`/clientes/${idcliente}/documentos`);
  }
  criarDocumento(idcliente: number, input: M.DocumentoInput) {
    return this.post<M.ClienteDocumento>(`/clientes/${idcliente}/documentos`, input);
  }
  atualizarDocumento(id: number, input: M.DocumentoInput) {
    return this.put<M.ClienteDocumento>(`/documentos/${id}`, input);
  }
  removerDocumento(id: number) {
    return this.del<void>(`/documentos/${id}`);
  }
  /** Scan digitalizado (blob autenticado — use URL.createObjectURL). */
  scanDocumento(id: number) {
    return this.http.get(`${this.base}/documentos/${id}/scan`, {
      responseType: 'blob',
    });
  }
  uploadScanDocumento(id: number, f: Blob) {
    return this.http.put(`${this.base}/documentos/${id}/scan`, f, {
      headers: { 'Content-Type': f.type || 'image/jpeg' },
    });
  }
  removerScanDocumento(id: number) {
    return this.del<void>(`/documentos/${id}/scan`);
  }
  /** Arquivo digital do hóspede — todas as FNRHs já emitidas. */
  fnrhCliente(id: number) {
    return this.get<M.Fnrh[]>(`/clientes/${id}/fnrh`);
  }

  // -- acompanhantes + FNRH da reserva ------------------------------------------
  listarAcompanhantes(idreserva: number) {
    return this.get<M.Acompanhante[]>(`/reservas/${idreserva}/acompanhantes`);
  }
  adicionarAcompanhante(idreserva: number, input: M.AcompanhanteInput) {
    return this.post<M.Acompanhante>(`/reservas/${idreserva}/acompanhantes`, input);
  }
  removerAcompanhante(id: number) {
    return this.del<void>(`/acompanhantes/${id}`);
  }
  fnrhReserva(idreserva: number) {
    return this.get<M.Fnrh[]>(`/reservas/${idreserva}/fnrh`);
  }
  emitirFnrh(idreserva: number, req: { motivo_viagem?: string | null; placa_veiculo?: string | null }) {
    return this.post<M.Fnrh>(`/reservas/${idreserva}/fnrh`, req);
  }

  // -- tipos de acomodação ------------------------------------------------------
  listarTipos(apenasAtivos = false) {
    return this.get<M.TipoAcomodacao[]>('/tipos-acomodacao', { apenas_ativos: apenasAtivos });
  }
  criarTipo(nome: string) {
    return this.post<M.TipoAcomodacao>('/tipos-acomodacao', { nome });
  }
  atualizarTipo(id: number, nome: string, version?: number) {
    return this.put<M.TipoAcomodacao>(`/tipos-acomodacao/${id}`, { nome, version });
  }
  statusTipo(id: number, ativo: boolean) {
    return this.patch<M.TipoAcomodacao>(`/tipos-acomodacao/${id}/status`, { ativo });
  }

  // -- acomodações --------------------------------------------------------------
  listarAcomodacoes(page = 1, porPagina = 50, apenasAtivas = false) {
    return this.get<M.Page<M.Acomodacao>>('/acomodacoes', {
      page, por_pagina: porPagina, apenas_ativas: apenasAtivas,
    });
  }
  buscarAcomodacao(id: number) {
    return this.get<M.Acomodacao>(`/acomodacoes/${id}`);
  }
  criarAcomodacao(input: M.AcomodacaoInput) {
    return this.post<M.Acomodacao>('/acomodacoes', input);
  }
  atualizarAcomodacao(id: number, input: M.AcomodacaoInput) {
    return this.put<M.Acomodacao>(`/acomodacoes/${id}`, input);
  }
  statusAcomodacao(id: number, ativo: boolean) {
    return this.patch<M.Acomodacao>(`/acomodacoes/${id}/status`, { ativo });
  }
  tarifasAcomodacao(id: number) {
    return this.get<M.TarifaHistorico[]>(`/acomodacoes/${id}/tarifas`);
  }
  listarQuartos(idacomodacao: number) {
    return this.get<M.Quarto[]>(`/acomodacoes/${idacomodacao}/quartos`);
  }
  criarQuarto(idacomodacao: number, numero: string) {
    return this.post<M.Quarto>(`/acomodacoes/${idacomodacao}/quartos`, { numero });
  }
  statusQuarto(id: number, ativo: boolean) {
    return this.patch<M.Quarto>(`/quartos/${id}/status`, { ativo });
  }

  // -- reservas -----------------------------------------------------------------
  listarReservas(f: {
    inicio?: string | null; fim?: string | null; status?: string | null;
    idacomodacao?: number | null; idcliente?: number | null;
    busca?: string | null;
    page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ReservaResumo>>('/reservas', {
      inicio: f.inicio, fim: f.fim, status: f.status,
      idacomodacao: f.idacomodacao, idcliente: f.idcliente, busca: f.busca,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 20,
    });
  }
  eventosReserva(inicio?: string | null, fim?: string | null) {
    return this.get<M.ReservaResumo[]>('/reservas/eventos', { inicio, fim });
  }
  disponibilidade(inicio: string, fim: string, idacomodacao?: number | null) {
    return this.get<M.DisponibilidadeResponse>('/reservas/disponibilidade', {
      inicio, fim, idacomodacao,
    });
  }
  buscarReserva(id: number) {
    return this.get<M.ReservaDetalhe>(`/reservas/${id}`);
  }
  criarReserva(input: M.ReservaInput) {
    return this.post<M.Reserva>('/reservas', input);
  }
  checkin(id: number, data?: string | null, hora?: string | null) {
    return this.post<M.Reserva>(`/reservas/${id}/check-in`, { data, hora });
  }
  checkout(id: number, req: M.CheckoutRequest) {
    return this.post<M.CheckoutResponse>(`/reservas/${id}/check-out`, req);
  }
  cancelarReserva(id: number, req: M.CancelarReservaRequest) {
    return this.post<{ reserva: M.Reserva; reembolso: unknown }>(
      `/reservas/${id}/cancelar`, req,
    );
  }
  itensConsumidos(id: number) {
    return this.get<M.ItemConsumido[]>(`/reservas/${id}/itens-consumidos`);
  }
  registrarItemConsumido(id: number, iditem_frigobar: number, quantidade: number) {
    return this.post<M.ItemConsumido>(`/reservas/${id}/itens-consumidos`, {
      iditem_frigobar, quantidade,
    });
  }
  adicionais(id: number) {
    return this.get<M.AdicionalConsumo[]>(`/reservas/${id}/adicionais`);
  }
  /** Lançamento avulso na conta durante a estadia. */
  lancarAdicional(idreserva: number, motivo: string, valor: number) {
    return this.post<M.AdicionalConsumo>(`/reservas/${idreserva}/adicionais`, {
      motivo,
      valor,
    });
  }

  // -- estoque ------------------------------------------------------------------
  listarCategorias(apenasAtivas = false) {
    return this.get<M.CategoriaEstoque[]>('/estoque/categorias', {
      apenas_ativos: apenasAtivas,
    });
  }
  criarCategoria(nome: string) {
    return this.post<M.CategoriaEstoque>('/estoque/categorias', { nome });
  }
  statusCategoria(id: number, ativo: boolean) {
    return this.patch<M.CategoriaEstoque>(`/estoque/categorias/${id}/status`, { ativo });
  }
  /** Roteamento KOT — impressora do setor para a categoria (null = sem ticket). */
  rotaCategoria(id: number, impressora_id: number | null) {
    return this.patch<M.CategoriaEstoque>(`/estoque/categorias/${id}/impressora`, {
      impressora_id,
    });
  }
  listarItens(page = 1, porPagina = 50, apenasAtivos = false) {
    return this.get<M.Page<M.ItemEstoque>>('/estoque/itens', {
      page, por_pagina: porPagina, apenas_ativos: apenasAtivos,
    });
  }
  criarItem(input: M.ItemEstoqueInput) {
    return this.post<M.ItemEstoque>('/estoque/itens', input);
  }
  atualizarItem(id: number, input: M.ItemEstoqueUpdate) {
    return this.put<M.ItemEstoque>(`/estoque/itens/${id}`, input);
  }
  statusItem(id: number, ativo: boolean) {
    return this.patch<M.ItemEstoque>(`/estoque/itens/${id}/status`, { ativo });
  }
  listarMovimentos(page = 1, porPagina = 50) {
    return this.get<M.Page<M.MovimentoView>>('/estoque/movimentacoes', {
      page, por_pagina: porPagina,
    });
  }
  movimentar(movimentos: M.MovimentacaoInput[]) {
    return this.post<{ mensagem: string }>('/estoque/movimentacoes', { movimentos });
  }

  // -- frigobares ----------------------------------------------------------------
  listarFrigobares() {
    return this.get<M.Frigobar[]>('/frigobares');
  }
  criarFrigobar(input: { idacomodacao: number; modelo?: string | null; patrimonio?: string | null }) {
    return this.post<M.Frigobar>('/frigobares', input);
  }
  atualizarFrigobar(id: number, input: { idacomodacao: number; modelo?: string | null; patrimonio?: string | null; version?: number }) {
    return this.put<M.Frigobar>(`/frigobares/${id}`, input);
  }
  statusFrigobar(id: number, ativo: boolean) {
    return this.patch<M.Frigobar>(`/frigobares/${id}/status`, { ativo });
  }
  itensFrigobar(idfrigobar: number) {
    return this.get<M.ItemFrigobarView[]>(`/frigobares/${idfrigobar}/itens`);
  }
  reporItemFrigobar(idfrigobar: number, iditem: number, quantidade: number) {
    return this.post<M.ItemFrigobar>(`/frigobares/${idfrigobar}/itens`, { iditem, quantidade });
  }
  atualizarItemFrigobar(id: number, quantidade: number, version?: number) {
    return this.put<M.ItemFrigobar>(`/frigobares/itens/${id}`, { quantidade, version });
  }
  removerItemFrigobar(id: number) {
    return this.del<{ mensagem: string }>(`/frigobares/itens/${id}`);
  }
  statusItemFrigobar(id: number, ativo: boolean) {
    return this.patch<M.ItemFrigobar>(`/frigobares/itens/${id}/status`, { ativo });
  }

  // -- estacionamento -------------------------------------------------------------
  listarVagas() {
    return this.get<M.VagaEstacionamento[]>('/estacionamento');
  }
  criarVaga(numero: string) {
    return this.post<M.VagaEstacionamento>('/estacionamento', { numero });
  }
  vincularVaga(id: number, idacomodacao: number | null) {
    return this.patch<M.VagaEstacionamento>(`/estacionamento/${id}/vinculo`, { idacomodacao });
  }
  statusVaga(id: number, ativo: boolean) {
    return this.patch<M.VagaEstacionamento>(`/estacionamento/${id}/status`, { ativo });
  }
  removerVaga(id: number) {
    return this.del<{ mensagem: string }>(`/estacionamento/${id}`);
  }

  // -- formas de pagamento ---------------------------------------------------------
  listarPagamentos(apenasAtivos = true) {
    return this.get<M.FormaPagamento[]>('/formas-pagamento', {
      apenas_ativos: apenasAtivos,
    });
  }
  criarPagamento(nome: string) {
    return this.post<M.FormaPagamento>('/formas-pagamento', { nome });
  }
  atualizarPagamento(id: number, nome: string, version?: number) {
    return this.put<M.FormaPagamento>(`/formas-pagamento/${id}`, { nome, version });
  }
  statusPagamento(id: number, ativo: boolean) {
    return this.patch<M.FormaPagamento>(`/formas-pagamento/${id}/status`, { ativo });
  }
  comprovantes() {
    return this.get<M.ComprovanteResumo[]>('/pagamentos/comprovantes');
  }
  comprovanteTexto(idreserva: number) {
    return this.http.get(`${this.base}/pagamentos/comprovantes/${idreserva}`, {
      responseType: 'text',
    });
  }
  // -- impressoras por setor ---------------------------------------------------
  listarImpressoras() {
    return this.get<M.Impressora[]>('/impressoras');
  }
  criarImpressora(input: Omit<M.Impressora, 'id' | 'criado_em' | 'version'>) {
    return this.post<M.Impressora>('/impressoras', input);
  }
  atualizarImpressora(id: number, input: Omit<M.Impressora, 'id' | 'criado_em' | 'version'> & { version?: number }) {
    return this.put<M.Impressora>(`/impressoras/${id}`, input);
  }
  statusImpressora(id: number, ativo: boolean) {
    return this.patch(`/impressoras/${id}/status`, { ativo });
  }
  removerImpressora(id: number) {
    return this.del(`/impressoras/${id}`);
  }
  testarImpressora(id: number) {
    return this.post(`/impressoras/${id}/testar`, {});
  }
  /** Reimprime tickets de produção (KOT) do consumo da reserva. */
  imprimirProducao(idreserva: number) {
    return this.post<{ mensagem: string; tickets: number }>(
      `/reservas/${idreserva}/consumo/imprimir`,
      {},
    );
  }

  imprimirComprovante(idreserva: number, impressora?: number) {
    const qs = impressora ? `?impressora=${impressora}` : '';
    return this.post<{ mensagem: string }>(
      `/pagamentos/comprovantes/${idreserva}/imprimir${qs}`,
      {},
    );
  }

  // -- estabelecimento ----------------------------------------------------------------
  obterEstabelecimento() {
    return this.get<M.Estabelecimento>('/estabelecimento');
  }
  salvarEstabelecimento(input: Omit<M.Estabelecimento, 'id'>) {
    return this.put<M.Estabelecimento>('/estabelecimento', input);
  }
  obterEndereco() {
    return this.get<M.EnderecoEstabelecimento>('/estabelecimento/endereco');
  }
  salvarEndereco(input: Omit<M.EnderecoEstabelecimento, 'id'>) {
    return this.put<M.EnderecoEstabelecimento>('/estabelecimento/endereco', input);
  }
  logoAtual() {
    return this.http.get(`${this.base}/estabelecimento/logo`, { responseType: 'blob' });
  }
  uploadLogo(f: File) {
    return this.http.post(`${this.base}/estabelecimento/logo`, f, {
      headers: { 'Content-Type': f.type || 'application/octet-stream' },
    });
  }

  // -- relatórios ----------------------------------------------------------------------
  dashboard() {
    return this.get<M.DashboardResponse>('/dashboard');
  }
  resumoFinanceiro(inicio?: string | null, fim?: string | null) {
    return this.get<M.ResumoFinanceiro>('/financeiro/resumo', { inicio, fim });
  }
  serieRecebido(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/recebido', { inicio, fim });
  }
  serieReservas(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/reservas', { inicio, fim });
  }
  serieVendas(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/vendas', { inicio, fim });
  }
  seriePorPagamento(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/por-pagamento', { inicio, fim });
  }
  seriePorAcomodacao(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/por-acomodacao', { inicio, fim });
  }
  itensMaisVendidos(inicio?: string | null, fim?: string | null) {
    return this.get<M.ItemMaisVendido[]>('/financeiro/itens-mais-vendidos', { inicio, fim });
  }
  vendasFinanceiro(inicio?: string | null, fim?: string | null) {
    return this.get<M.VendaItem[]>('/financeiro/vendas', { inicio, fim });
  }
  logs(f: {
    tabela?: string | null; acao?: string | null; idfuncionario?: number | null;
    idtabela?: number | null;
    desde?: string | null; ate?: string | null; page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.RegistroLog>>('/auditoria/logs', {
      tabela: f.tabela, acao: f.acao, idfuncionario: f.idfuncionario,
      idtabela: f.idtabela,
      desde: f.desde, ate: f.ate, page: f.page ?? 1, por_pagina: f.porPagina ?? 50,
    });
  }

  // -- notificações (inbox + sino) ------------------------------------------------
  notificacoes(page = 1, porPagina = 30) {
    return this.get<M.Page<M.Notificacao>>('/notificacoes', { page, por_pagina: porPagina });
  }
  naoLidas() {
    return this.get<{ total: number }>('/notificacoes/nao-lidas');
  }
  lerNotificacao(id: number) {
    return this.post<{ ok: boolean }>(`/notificacoes/${id}/ler`, {});
  }
  lerTodasNotificacoes() {
    return this.post<{ ok: boolean; marcadas: number }>('/notificacoes/ler-todas', {});
  }
  excluirNotificacao(id: number) {
    return this.del<{ ok: boolean }>(`/notificacoes/${id}`);
  }

  // -- busca global (header) ----------------------------------------------------
  buscaGlobal(q: string) {
    return this.get<M.ItemBusca[]>('/busca', { q });
  }
}

// -- helpers de apresentação -----------------------------------------------------

/** Decimal vem como string — parse seguro. */
export function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export const STATUS_RESERVA: Record<
  M.StatusReserva,
  { rotulo: string; cor: string; texto: string }
> = {
  p: { rotulo: 'Pendente', cor: '#ffc107', texto: '#000' },
  i: { rotulo: 'Iniciado', cor: '#3498db', texto: '#fff' },
  c: { rotulo: 'Cancelado', cor: '#dc3545', texto: '#fff' },
  f: { rotulo: 'Finalizado', cor: '#198754', texto: '#fff' },
};
