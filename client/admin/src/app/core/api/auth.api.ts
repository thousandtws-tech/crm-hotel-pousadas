// Cliente HTTP tipado do domínio auth para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class AuthApi extends ApiHttp {
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
}
