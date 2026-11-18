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
  /** Cargo (título) vinculado — `nivel` é o acesso derivado dele. */
  cargo_id: number;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

/** Cargo — título do funcionário vinculado a um nível de acesso. */
export interface Cargo {
  id: number;
  nome: string;
  descricao: string | null;
  nivel: number;
  ativo: boolean;
  /** Cargos-base (Administrador/Gerente/Recepção): não removíveis, nível travado. */
  sistema: boolean;
  total_funcionarios: number;
  criado_em: string;
  atualizado_em: string;
}

export interface CargoInput {
  nome: string;
  descricao?: string | null;
  nivel: number;
}

export interface CargoUpdate {
  nome?: string;
  descricao?: string | null;
  nivel?: number;
  ativo?: boolean;
}

export interface FuncionarioInput {
  nome: string;
  login: string;
  senha: string;
  cpf?: string | null;
  data_nascimento?: string | null;
  cargo_id: number;
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
  /** Troca de cargo — redefine `nivel` a partir dele no backend. */
  cargo_id?: number;
  /** Concorrência otimista — enviar a version lida no GET. */
  version?: number;
}

// -- clientes ------------------------------------------------------------------
