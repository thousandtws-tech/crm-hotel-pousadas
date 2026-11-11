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
  excluirFuncionario(id: number) {
    return this.del<void>(`/funcionarios/${id}`);
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
  excluirCliente(id: number) {
    return this.del<void>(`/clientes/${id}`);
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
  /** Fechamento do dia — pendências + no-show por PIN + relatório e-mail. */
  pendenciasFechamento() {
    return this.get<M.PendenciasFechamento>('/fechamento/pendencias');
  }
  marcarNoShow(idreserva: number, pin: string) {
    return this.post<void>(`/reservas/${idreserva}/no-show`, { pin });
  }
  enviarRelatorioFechamento() {
    return this.post<void>('/fechamento/relatorio', {});
  }

  /** Exportação SNE/CSV das fichas do período — envio manual ao MTur. */
  exportarFnrh(inicio: string, fim: string) {
    return this.http.get(`${this.base}/fnrh/exportar`, {
      params: params({ inicio, fim }),
      responseType: 'text',
    });
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
  excluirTipo(id: number) {
    return this.del<{ mensagem: string }>(`/tipos-acomodacao/${id}`);
  }
  tarifasOcupacao(idtipo: number) {
    return this.get<M.TarifaOcupacao[]>(`/tipos-acomodacao/${idtipo}/tarifas-ocupacao`);
  }
  salvarTarifasOcupacao(idtipo: number, faixas: M.TarifaOcupacaoInput[]) {
    return this.put<M.TarifaOcupacao[]>(`/tipos-acomodacao/${idtipo}/tarifas-ocupacao`, faixas);
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
  excluirAcomodacao(id: number) {
    return this.del<{ mensagem: string }>(`/acomodacoes/${id}`);
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
  excluirQuarto(id: number) {
    return this.del<{ mensagem: string }>(`/quartos/${id}`);
  }

  // -- CMS (conteúdo do site público) -------------------------------------------

  listarCms() {
    return this.get<M.AcomodacaoCmsView[]>('/cms/acomodacoes');
  }
  salvarCms(idacomodacao: number, input: M.CmsInput) {
    return this.put<M.AcomodacaoCms>(`/cms/acomodacoes/${idacomodacao}`, input);
  }
  statusCms(idacomodacao: number, publicar: boolean) {
    return this.patch<M.AcomodacaoCms>(`/cms/acomodacoes/${idacomodacao}/status`, { publicar });
  }
  uploadMidia(idacomodacao: number, file: File) {
    return this.http.post<M.Midia>(
      `${this.base}/cms/acomodacoes/${idacomodacao}/midia`, file,
      { headers: { 'Content-Type': file.type } },
    );
  }
  removerMidia(id: number) {
    return this.del<{ ok: boolean }>(`/cms/midia/${id}`);
  }
  definirCapa(id: number) {
    return this.patch<{ ok: boolean }>(`/cms/midia/${id}/capa`, {});
  }
  ordenarMidias(idacomodacao: number, ordem: number[]) {
    return this.patch<{ ok: boolean }>(`/cms/acomodacoes/${idacomodacao}/midia/ordem`, { ordem });
  }
  midiaAdminUrl(id: number) {
    return `${this.base}/cms/midia/${id}/arquivo`;
  }
  /** Binário autenticado da mídia — use URL.createObjectURL para preview. */
  midiaBlob(id: number) {
    return this.http.get(`${this.base}/cms/midia/${id}/arquivo`, { responseType: 'blob' });
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
  /** Exclui reserva pendente/cancelada junto com a conta de consumo (admin). */
  excluirReserva(id: number) {
    return this.del<void>(`/reservas/${id}`);
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
  excluirCategoria(id: number) {
    return this.del<{ mensagem: string }>(`/estoque/categorias/${id}`);
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
  excluirItem(id: number) {
    return this.del<{ mensagem: string }>(`/estoque/itens/${id}`);
  }
  listarMovimentos(page = 1, porPagina = 50) {
    return this.get<M.Page<M.MovimentoView>>('/estoque/movimentacoes', {
      page, por_pagina: porPagina,
    });
  }
  movimentar(movimentos: M.MovimentacaoInput[]) {
    return this.post<{ mensagem: string }>('/estoque/movimentacoes', { movimentos });
  }

  listarFicha(idproduto: number) {
    return this.get<M.FichaItemView[]>(`/estoque/itens/${idproduto}/ficha`);
  }
  salvarFichaItem(idproduto: number, input: M.FichaItemInput) {
    return this.post<M.FichaItemView>(`/estoque/itens/${idproduto}/ficha`, input);
  }
  removerFichaItem(idficha: number) {
    return this.del<{ mensagem: string }>(`/estoque/ficha/${idficha}`);
  }
  listarConversoes(iditem: number) {
    return this.get<M.ConversaoUnidade[]>(`/estoque/itens/${iditem}/conversoes`);
  }
  salvarConversao(iditem: number, input: M.ConversaoInput) {
    return this.post<M.ConversaoUnidade>(`/estoque/itens/${iditem}/conversoes`, input);
  }
  removerConversao(id: number) {
    return this.del<{ mensagem: string }>(`/estoque/conversoes/${id}`);
  }
  alertasEstoque() {
    return this.get<M.EstoqueBaixoView[]>('/estoque/alertas');
  }
  // Compras
  listarFornecedores(apenasAtivos = true) {
    return this.get<M.Fornecedor[]>('/compras/fornecedores', { apenas_ativos: apenasAtivos });
  }
  salvarFornecedor(b: M.FornecedorInput) {
    return this.post<M.Fornecedor>('/compras/fornecedores', b);
  }
  statusFornecedor(id: number, ativo: boolean) {
    return this.patch<M.Fornecedor>(`/compras/fornecedores/${id}/status`, { ativo });
  }
  listarPedidos(f: { status?: string; pagina?: number } = {}) {
    return this.get<M.Page<M.PedidoCompraView>>('/compras/pedidos', { ...f, por_pagina: 15 });
  }
  buscarPedido(id: number) {
    return this.get<M.PedidoDetalhe>(`/compras/pedidos/${id}`);
  }
  criarPedido(b: M.PedidoCompraInput) {
    return this.post<M.PedidoCriado>('/compras/pedidos', b);
  }
  receberPedido(id: number, b: { itens: M.RecebimentoItem[]; observacao?: string }) {
    return this.post<{ status: string }>(`/compras/pedidos/${id}/receber`, b);
  }
  cancelarPedido(id: number) {
    return this.post<{ mensagem: string }>(`/compras/pedidos/${id}/cancelar`, {});
  }

  previewNfe(xml: string) {
    return this.post<M.NfePreview>('/estoque/nfe/preview', { xml });
  }
  importarNfe(req: M.NfeImportRequest) {
    return this.post<M.NfeImport>('/estoque/nfe/importar', req);
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
  excluirFrigobar(id: number) {
    return this.del<{ mensagem: string }>(`/frigobares/${id}`);
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
  excluirPagamento(id: number) {
    return this.del<{ mensagem: string }>(`/formas-pagamento/${id}`);
  }
  comprovantes() {
    return this.get<M.ComprovanteResumo[]>('/pagamentos/comprovantes');
  }

  // ---- Pagamentos online (Stripe) -------------------------------------

  pagamentosOnline(f: { status?: string; idreserva?: number; inicio?: string; fim?: string; per_page?: number; page?: number }) {
    return this.get<{ items: M.PagOnlineResumo[]; total: number }>('/pagamentos', f);
  }

  resumoFinanceiroOnline(inicio?: string, fim?: string) {
    return this.get<M.ResumoFinanceiroOnline>('/financeiro/pagamentos/resumo', { inicio, fim });
  }

  receitaPorAcomodacao(inicio?: string, fim?: string) {
    return this.get<M.ReceitaAcomodacao[]>('/financeiro/pagamentos/receita-acomodacoes', { inicio, fim });
  }

  pagamentosDaReserva(idreserva: number) {
    return this.get<M.PagOnlineResumo[]>(`/reservas/${idreserva}/pagamentos`);
  }

  reembolsarPagamento(id: number, valorCentavos: number | null, motivo: string) {
    return this.post<{ idreembolso: number }>(`/pagamentos/${id}/reembolsos`, {
      valor_centavos: valorCentavos,
      motivo: motivo || null,
    });
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
  /** Reimprime a etiqueta do item na impressora dedicada. */
  etiquetaItem(id: number) {
    return this.post(`/estoque/itens/${id}/etiqueta`, {});
  }

  testarImpressora(id: number) {
    return this.post(`/impressoras/${id}/testar`, {});
  }
  listarDescobertasImpressoras() {
    return this.get<M.ImpressoraDescoberta[]>('/impressoras/descobertas');
  }
  registrarDescoberta(id: number, body: { nome: string; setor: string; padrao?: boolean; etiqueta?: boolean }) {
    return this.post<M.Impressora>(`/impressoras/descobertas/${id}/registrar`, body);
  }
  ignorarDescoberta(id: number) {
    return this.del(`/impressoras/descobertas/${id}`);
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

  // -- tesouraria: plano de contas ------------------------------------------------
  listarPlanoContas(todas = false, tipo?: M.TipoLancamento | null) {
    return this.get<M.PlanoConta[]>('/financeiro/plano-contas', { todas, tipo });
  }
  criarPlanoConta(input: {
    codigo: string; nome: string; tipo: M.TipoLancamento; grupo_dre: M.GrupoDre;
  }) {
    return this.post<M.PlanoConta>('/financeiro/plano-contas', input);
  }
  atualizarPlanoConta(id: number, input: {
    codigo: string; nome: string; tipo: M.TipoLancamento;
    grupo_dre: M.GrupoDre; version?: number;
  }) {
    return this.put<M.PlanoConta>(`/financeiro/plano-contas/${id}`, input);
  }
  statusPlanoConta(id: number, ativo: boolean) {
    return this.patch<M.PlanoConta>(`/financeiro/plano-contas/${id}/status`, { ativo });
  }
  excluirPlanoConta(id: number) {
    return this.del<{ mensagem: string }>(`/financeiro/plano-contas/${id}`);
  }

  // -- tesouraria: contas financeiras ----------------------------------------------
  listarContasFinanceiras(todas = false) {
    return this.get<M.ContaFinanceira[]>('/financeiro/contas', { todas });
  }
  criarContaFinanceira(input: M.ContaFinanceiraInput) {
    return this.post<M.ContaFinanceira>('/financeiro/contas', input);
  }
  atualizarContaFinanceira(id: number, input: M.ContaFinanceiraInput) {
    return this.put<M.ContaFinanceira>(`/financeiro/contas/${id}`, input);
  }
  statusContaFinanceira(id: number, ativo: boolean) {
    return this.patch<M.ContaFinanceira>(`/financeiro/contas/${id}/status`, { ativo });
  }
  saldoConta(id: number) {
    return this.get<{ saldo: string }>(`/financeiro/contas/${id}/saldo`);
  }

  // -- tesouraria: lançamentos (contas a pagar/receber) ------------------------------
  listarLancamentos(f: {
    tipo?: M.TipoLancamento | null; status?: M.StatusLancamento | null;
    vencidos?: boolean; inicio?: string | null; fim?: string | null;
    idplano_conta?: number | null; busca?: string | null;
    page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.LancamentoView>>('/financeiro/lancamentos', {
      tipo: f.tipo, status: f.status, vencidos: f.vencidos,
      inicio: f.inicio, fim: f.fim, idplano_conta: f.idplano_conta,
      busca: f.busca, page: f.page ?? 1, por_pagina: f.porPagina ?? 20,
    });
  }
  criarLancamento(input: M.LancamentoInput) {
    return this.post<M.Lancamento[]>('/financeiro/lancamentos', input);
  }
  buscarLancamento(id: number) {
    return this.get<M.Lancamento>(`/financeiro/lancamentos/${id}`);
  }
  atualizarLancamento(id: number, input: M.LancamentoInput) {
    return this.put<M.Lancamento>(`/financeiro/lancamentos/${id}`, input);
  }
  cancelarLancamento(id: number) {
    return this.post<M.Lancamento>(`/financeiro/lancamentos/${id}/cancelar`, {});
  }
  excluirLancamento(id: number) {
    return this.del<{ mensagem: string }>(`/financeiro/lancamentos/${id}`);
  }
  baixarLancamento(id: number, input: M.BaixaInput) {
    return this.post<M.BaixaResponse>(`/financeiro/lancamentos/${id}/baixar`, input);
  }
  listarBaixas(idlancamento: number) {
    return this.get<M.BaixaView[]>(`/financeiro/lancamentos/${idlancamento}/baixas`);
  }

  // -- tesouraria: fluxo de caixa / DRE -----------------------------------------------
  fluxoCaixa(inicio?: string | null, fim?: string | null) {
    return this.get<M.FluxoCaixa>('/financeiro/fluxo-caixa', { inicio, fim });
  }
  dre(inicio?: string | null, fim?: string | null) {
    return this.get<M.Dre>('/financeiro/dre', { inicio, fim });
  }

  // -- tesouraria: extrato / conciliação -----------------------------------------------
  listarExtrato(f: {
    idconta_financeira?: number | null; status?: M.StatusExtrato | null;
    inicio?: string | null; fim?: string | null;
    page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ExtratoView>>('/financeiro/extrato', {
      idconta_financeira: f.idconta_financeira, status: f.status,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 30,
    });
  }
  resumoExtrato(idconta_financeira?: number | null) {
    return this.get<M.ConciliacaoResumo>('/financeiro/extrato/resumo', {
      idconta_financeira,
    });
  }
  importarExtrato(idconta_financeira: number, conteudo: string) {
    return this.post<{ importados: number; duplicados: number }>(
      '/financeiro/extrato', { idconta_financeira, conteudo },
    );
  }
  ignorarExtrato(id: number) {
    return this.post<{ mensagem: string }>(`/financeiro/extrato/${id}/ignorar`, {});
  }
  sugestoesExtrato(id: number) {
    return this.get<M.SugestaoConciliacao[]>(`/financeiro/extrato/${id}/sugestoes`);
  }
  conciliarExtrato(id: number, idbaixa: number) {
    return this.post<M.Conciliacao>(`/financeiro/extrato/${id}/conciliar`, { idbaixa });
  }
  classificarExtrato(id: number, idplano_conta: number, descricao?: string | null) {
    return this.post<M.Lancamento>(`/financeiro/extrato/${id}/classificar`, {
      idplano_conta, descricao,
    });
  }
  desconciliar(idconciliacao: number) {
    return this.del<{ mensagem: string }>(`/financeiro/conciliacoes/${idconciliacao}`);
  }
  autoConciliar(idconta: number) {
    return this.post<{ conciliados: number }>(
      `/financeiro/conciliar-auto/${idconta}`, {},
    );
  }

  // -- tesouraria: tributos / split IBS-CBS ---------------------------------------------
  tributoConfig() {
    return this.get<M.TributoConfig | null>('/financeiro/tributos');
  }
  listarTributoConfigs() {
    return this.get<M.TributoConfig[]>('/financeiro/tributos/historico');
  }
  criarTributoConfig(input: {
    aliq_ibs: number; aliq_cbs: number; regime?: string; vigente_desde?: string | null;
  }) {
    return this.post<M.TributoConfig>('/financeiro/tributos', input);
  }
  splitResumo(inicio?: string | null, fim?: string | null) {
    return this.get<M.SplitResumo>('/financeiro/split/resumo', { inicio, fim });
  }
  splitEventos(inicio?: string | null, fim?: string | null, page = 1, porPagina = 20) {
    return this.get<M.Page<M.SplitEventoView>>('/financeiro/split/eventos', {
      inicio, fim, page, por_pagina: porPagina,
    });
  }
  listarApuracoes() {
    return this.get<M.TributoApuracao[]>('/financeiro/apuracoes');
  }
  recolherApuracao(competencia: string) {
    return this.post<M.TributoApuracao>('/financeiro/apuracoes/recolher', { competencia });
  }

  // -- controle de caixa (turnos de gaveta) ------------------------------------

  turnoAberto(idconta_financeira: number) {
    return this.get<M.CaixaTurno | null>('/financeiro/caixa/aberto', {
      idconta_financeira,
    });
  }
  listarTurnos(f: {
    idconta_financeira?: number;
    status?: M.StatusTurno;
    idoperador?: number;
    inicio?: string;
    fim?: string;
    page?: number;
    porPagina?: number;
  }) {
    return this.get<M.Page<M.TurnoView>>('/financeiro/caixa/turnos', {
      idconta_financeira: f.idconta_financeira,
      status: f.status,
      idoperador: f.idoperador,
      inicio: f.inicio,
      fim: f.fim,
      page: f.page ?? 1,
      por_pagina: f.porPagina ?? 20,
    });
  }
  abrirTurno(input: M.AbrirCaixaInput) {
    return this.post<M.CaixaTurno>('/financeiro/caixa/turnos', input);
  }
  buscarTurno(id: number) {
    return this.get<M.TurnoView>(`/financeiro/caixa/turnos/${id}`);
  }
  conferirTurno(id: number) {
    return this.get<M.ConferenciaCaixa>(`/financeiro/caixa/turnos/${id}/conferencia`);
  }
  listarMovimentosTurno(id: number) {
    return this.get<M.MovimentoCaixaView[]>(`/financeiro/caixa/turnos/${id}/movimentos`);
  }
  movimentarTurno(id: number, input: M.MovCaixaInput) {
    return this.post<M.CaixaMovimento>(`/financeiro/caixa/turnos/${id}/movimentos`, input);
  }
  fecharTurno(id: number, input: M.FecharCaixaInput) {
    return this.post<M.CaixaTurno>(`/financeiro/caixa/turnos/${id}/fechar`, input);
  }

  // -- PDV & comandas ----------------------------------------------------------

  listarMesas() {
    return this.get<M.MesaView[]>('/pdv/mesas');
  }
  criarMesa(numero: string, lugares: number) {
    return this.post<M.PdvMesa>('/pdv/mesas', { numero, lugares });
  }
  statusMesa(id: number, ativo: boolean) {
    return this.put<M.PdvMesa>(`/pdv/mesas/${id}/status`, { ativo });
  }
  listarGarcons() {
    return this.get<M.GarcomView[]>('/pdv/garcons');
  }
  salvarGarcom(idfuncionario: number, percentual: number, ativo = true) {
    return this.post<M.PdvGarcom>('/pdv/garcons', { idfuncionario, percentual, ativo });
  }
  listarComandas(f: {
    tipo?: string | null; status?: string | null; idgarcom?: number | null;
    inicio?: string | null; fim?: string | null; page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ComandaView>>('/pdv/comandas', {
      tipo: f.tipo, status: f.status, idgarcom: f.idgarcom,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 50,
    });
  }
  abrirComanda(input: M.AbrirComandaInput) {
    return this.post<M.PdvComanda>('/pdv/comandas', input);
  }
  buscarComanda(id: number) {
    return this.get<M.ComandaView>(`/pdv/comandas/${id}`);
  }
  itensComanda(id: number) {
    return this.get<M.ComandaItemView[]>(`/pdv/comandas/${id}/itens`);
  }
  adicionarItem(id: number, iditem: number, quantidade: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens`, { iditem, quantidade });
  }
  entregarItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/entregar`, {});
  }
  cancelarItem(id: number, iditemComanda: number, motivo?: string) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/cancelar`, { motivo });
  }
  cancelarComanda(id: number, motivo?: string) {
    return this.post<M.PdvComanda>(`/pdv/comandas/${id}/cancelar`, { motivo });
  }
  fecharComanda(id: number, input: M.FecharComandaInput) {
    return this.post<M.PdvComanda>(`/pdv/comandas/${id}/fechar`, input);
  }
  itensVenda(busca?: string) {
    return this.get<M.ItemVendaView[]>('/pdv/itens-venda', { busca });
  }
  // ------------------------------------------------------------------ KDS
  filaCozinha() {
    return this.get<M.FilaItemView[]>('/pdv/cozinha/fila');
  }
  prepararItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/preparar`, {});
  }
  prontoItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/pronto`, {});
  }
  retornarItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/retornar`, {});
  }
  // ------------------------------------------------------------------ Café
  quadroCafe(data?: string) {
    return this.get<M.CafeQuadroItem[]>('/cafe/quadro', { data });
  }
  registrarPresenca(idreserva: number, quantidade: number, data?: string) {
    return this.post<M.CafePresenca>('/cafe/presencas', { idreserva, quantidade, data });
  }
  removerPresenca(id: number) {
    return this.del<void>(`/cafe/presencas/${id}`);
  }
  historicoCafe(f: { inicio?: string; fim?: string; page?: number; porPagina?: number }) {
    return this.get<M.Page<M.PresencaView>>('/cafe/historico', {
      inicio: f.inicio, fim: f.fim, page: f.page, por_pagina: f.porPagina,
    });
  }
  listarComissoes(f: {
    idgarcom?: number | null; apenasPendentes?: boolean;
    inicio?: string | null; fim?: string | null; page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ComissaoView>>('/pdv/comissoes', {
      idgarcom: f.idgarcom, apenas_pendentes: f.apenasPendentes,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 50,
    });
  }
  // -- comunicação / reputação --------------------------------------------------
  filaEnvio() {
    return this.get<M.ItemFila[]>('/comunicacao/fila');
  }
  matrizNotificacao() {
    return this.get<M.RegraMatriz[]>('/comunicacao/matriz');
  }
  gravarRegraMatriz(regra: M.RegraMatriz) {
    return this.post<void>('/comunicacao/matriz', regra);
  }
  dispararCobranca(idreserva: number) {
    return this.post<void>(`/comunicacao/cobranca/${idreserva}`, {});
  }
  avaliacoes(status?: string) {
    return this.get<M.Avaliacao[]>('/avaliacoes', { status });
  }
  avaliacoesDashboard() {
    return this.get<M.AvaliacoesDash>('/avaliacoes/dashboard');
  }
  responderAvaliacao(id: number, resposta: string) {
    return this.post<void>(`/avaliacoes/${id}/responder`, { resposta });
  }
  fidelidadeNiveis() {
    return this.get<M.NivelFidelidade[]>('/fidelidade/niveis');
  }
  // -- LGPD ---------------------------------------------------------------------
  lgpdSolicitacoes(status?: string) {
    return this.get<M.LgpdSolicitacao[]>('/lgpd/solicitacoes', { status });
  }
  lgpdResponder(id: number, resposta: string) {
    return this.post<void>(`/lgpd/solicitacoes/${id}/responder`, { resposta });
  }
  lgpdExportarCliente(idcliente: number) {
    return this.get<unknown>(`/clientes/${idcliente}/lgpd-export`);
  }
  anonimizarCliente(idcliente: number) {
    return this.post<void>(`/clientes/${idcliente}/anonimizar`, {});
  }
  autorizacaoMenor(idreserva: number, documento: string) {
    return this.post<void>(`/reservas/${idreserva}/autorizacao-menor`, { documento });
  }
  // -- Mapa por andar + bloqueio ----------------------------------------------
  mapaQuartos() {
    return this.get<M.MapaQuarto[]>('/reservas/mapa');
  }
  widgetMotor() {
    return this.get<{ url: string; qr_svg: string; snippet: string }>('/reservas/widget');
  }
  bloqueios() {
    return this.get<M.Bloqueio[]>('/bloqueios');
  }
  // -- Grupos / eventos --------------------------------------------------------
  grupos() {
    return this.get<M.Grupo[]>('/grupos');
  }
  criarGrupo(input: M.GrupoInput) {
    return this.post<M.Grupo>('/grupos', input);
  }
  grupoUnidades(id: number) {
    return this.get<M.GrupoUnidadeView[]>(`/grupos/${id}/unidades`);
  }
  removerGrupo(id: number) {
    return this.del<void>(`/grupos/${id}`);
  }
  bloquear(idacomodacao: number, inicio: string, fim: string, motivo: string) {
    return this.post<M.Bloqueio>(`/acomodacoes/${idacomodacao}/bloqueio`, { inicio, fim, motivo });
  }
  desbloquear(id: number) {
    return this.del<void>(`/bloqueios/${id}`);
  }
  // -- Atendimento (roteamento) ------------------------------------------------
  atendimentos(status?: string, setor?: string) {
    return this.get<M.Atendimento[]>('/atendimentos', { status, setor });
  }
  atendAceitar(id: number) {
    return this.post<M.Atendimento>(`/atendimentos/${id}/aceitar`, {});
  }
  atendResolver(id: number) {
    return this.post<M.Atendimento>(`/atendimentos/${id}/resolver`, {});
  }
  pushVapidKey() {
    return this.get<{ publica: string }>('/push/vapid-key');
  }
  pushSubscribe(sub: { endpoint: string; p256dh: string; auth: string; user_agent?: string }) {
    return this.post<void>('/push/subscribe', sub);
  }
  pushUnsubscribe(endpoint: string) {
    return this.post<void>('/push/unsubscribe', { endpoint });
  }

  // -- operação: manutenção, governança, escalas ---------------------------------
  manutOrdens(status?: string) {
    return this.get<M.ManutOrdem[]>('/manutencao/ordens', { status });
  }
  manutCriar(input: Partial<M.ManutOrdem>) {
    return this.post<M.ManutOrdem>('/manutencao/ordens', input);
  }
  manutStatus(id: number, status: M.StatusManut, custo_centavos?: number) {
    return this.post<void>(`/manutencao/ordens/${id}/status`, { status, custo_centavos });
  }
  pmocListar() {
    return this.get<M.PmocRegistro[]>('/manutencao/pmoc');
  }
  pmocItens() {
    return this.get<string[]>('/manutencao/pmoc/itens');
  }
  pmocRegistrar(input: unknown) {
    return this.post<M.PmocRegistro>('/manutencao/pmoc', input);
  }
  govQuadro(data?: string) {
    return this.get<M.GovTarefa[]>('/governanca/tarefas', { data });
  }
  govCriar(input: unknown) {
    return this.post<M.GovTarefa>('/governanca/tarefas', input);
  }
  govStatus(id: number, status: M.StatusTarefaGov) {
    return this.post<void>(`/governanca/tarefas/${id}/status`, { status });
  }
  govAtribuir(id: number, idfuncionario: number) {
    return this.post<void>(`/governanca/tarefas/${id}/atribuir`, { idfuncionario });
  }
  govPrevisao() {
    return this.get<M.PrevisaoDia[]>('/governanca/previsao');
  }
  govGerarD1() {
    return this.post<{ criadas: number }>('/governanca/gerar-d1', {});
  }
  lavLotes() {
    return this.get<M.LavLote[]>('/governanca/lavanderia');
  }
  lavAbrir(input: unknown) {
    return this.post<M.LavLote>('/governanca/lavanderia', input);
  }
  lavDevolver(id: number, qtd_devolvida: number, custo_centavos?: number) {
    return this.post<void>(`/governanca/lavanderia/${id}/devolver`, { qtd_devolvida, custo_centavos });
  }
  lavFechar(competencia: string) {
    return this.post<{ idlancamento: number }>('/governanca/lavanderia/fechar', { competencia });
  }
  enxovalSaldo() {
    return this.get<[string, number][]>('/governanca/enxoval/saldo');
  }
  enxovalMovs() {
    return this.get<M.EnxovalMov[]>('/governanca/enxoval');
  }
  enxovalRegistrar(input: unknown) {
    return this.post<void>('/governanca/enxoval', input);
  }
  jornadas() {
    return this.get<M.FuncionarioJornada[]>('/escalas/jornadas');
  }
  gravarJornada(input: unknown, dias = 30) {
    return this.post<void>(`/escalas/jornadas?dias=${dias}`, input);
  }
  turnos(inicio: string, fim: string, idfuncionario?: number) {
    return this.get<M.EscalaTurno[]>('/escalas/turnos', { inicio, fim, idfuncionario });
  }
  removerTurno(id: number) {
    return this.del<void>(`/escalas/turnos/${id}`);
  }
  turnoAtualizar(id: number, input: { inicio: string; fim: string; almoco_min: number }) {
    return this.put<void>(`/escalas/turnos/${id}`, input);
  }
  cltValidar(dias = 14) {
    return this.get<M.CltViolacao[]>('/escalas/clt/validar', { dias });
  }
  cltCorrigir(correcao: unknown) {
    return this.post<void>('/escalas/clt/corrigir', correcao);
  }

  // ---- inteligência preditiva (/ia/*) ----
  iaResumo() {
    return this.get<M.IaResumo>('/ia/resumo');
  }
  iaOcupacao() {
    return this.get<M.IaOcupacaoDia[]>('/ia/ocupacao-14d');
  }
  iaHistorico() {
    return this.get<M.IaMesHistorico[]>('/ia/historico-12m');
  }
  iaRiscos() {
    return this.get<M.IaRisco[]>('/ia/risco-cancelamentos');
  }
  iaPerfis() {
    return this.get<M.IaPerfil[]>('/ia/perfis-hospedes');
  }
  iaEscala() {
    return this.get<M.IaEscalaDia[]>('/ia/escala-ideal');
  }
  iaUpsell() {
    return this.get<M.IaUpsell[]>('/ia/upsell');
  }
  iaEstoque() {
    return this.get<M.IaEstoquePrev[]>('/ia/estoque-previsto');
  }
  iaManutencao() {
    return this.get<M.IaRiscoQuarto[]>('/ia/manutencao-preventiva');
  }

  resumoComissoes(inicio?: string | null, fim?: string | null) {
    return this.get<M.ComissaoResumo[]>('/pdv/comissoes/resumo', { inicio, fim });
  }
  pagarComissao(id: number, idcontaFinanceira: number, idformaPagamento?: number | null) {
    return this.post<M.PdvComissao>(`/pdv/comissoes/${id}/pagar`, {
      idconta_financeira: idcontaFinanceira,
      idforma_pagamento: idformaPagamento,
    });
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
