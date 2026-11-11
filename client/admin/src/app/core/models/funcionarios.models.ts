// Contratos do domínio funcionarios (extraído de api.models.ts).

export interface FuncionarioView {
  id: number;
  nome: string;
  login: string;
  nivel: number;
  nivel_nome: string;
  ativo: boolean;
  /** Permissão granular: consulta financeira completa e reembolsos. */
  financeiro?: boolean;
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
