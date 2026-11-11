import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenResponse } from '@core/models/funcionarios.models';
import { AuthStore } from './auth.store';

const TOKEN: TokenResponse = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  token_type: 'Bearer',
  expira_em: 3600,
  funcionario: {
    id: 1,
    nome: 'Recepcionista',
    login: 'recepcao',
    nivel: 2,
    financeiro: false,
    ativo: true,
  } as TokenResponse['funcionario'],
};

describe('AuthStore', () => {
  let store: AuthStore;
  let http: HttpTestingController;
  const navigateByUrl = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    localStorage.clear();
    navigateByUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('login persiste tokens e publica o funcionário como signal', async () => {
    const promise = firstValueFrom(store.login('recepcao', 'senha'));
    const req = http.expectOne(`${environment.apiUrl}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ login: 'recepcao', senha: 'senha' });
    req.flush(TOKEN);

    const funcionario = await promise;
    expect(funcionario.login).toBe('recepcao');
    expect(store.autenticado()).toBe(true);
    expect(store.accessToken()).toBe('access-1');
    expect(store.refreshToken()).toBe('refresh-1');
    expect(localStorage.getItem('clarituz.user')).toContain('Recepcionista');
  });

  it('logout chama /auth/logout, limpa a sessão e navega ao login', () => {
    localStorage.setItem('clarituz.access', 'a');
    localStorage.setItem('clarituz.refresh', 'r');
    store.logout();

    const req = http.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(req.request.body).toEqual({ refresh_token: 'r' });
    req.flush({ mensagem: 'ok' });

    expect(store.autenticado()).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('refresh concorrente compartilha uma única rotação (single-flight)', async () => {
    localStorage.setItem('clarituz.refresh', 'refresh-velho');

    // Dois refreshs disparados no mesmo instante — padrão de várias
    // respostas 401 simultâneas no interceptor.
    const r1 = firstValueFrom(store.tentarRefresh());
    const r2 = firstValueFrom(store.tentarRefresh());

    const reqs = http.match(`${environment.apiUrl}/auth/refresh`);
    expect(reqs).toHaveLength(1);
    reqs[0].flush(TOKEN);

    expect(await r1).toBe(true);
    expect(await r2).toBe(true);
    expect(store.accessToken()).toBe('access-1');
  });

  it('refresh falho limpa a sessão e retorna false', async () => {
    localStorage.setItem('clarituz.access', 'a');
    localStorage.setItem('clarituz.refresh', 'r-expirado');

    const result = firstValueFrom(store.tentarRefresh());
    http.expectOne(`${environment.apiUrl}/auth/refresh`).flush(
      { erro: { mensagem: 'inválido' } },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(await result).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(store.user()).toBeNull();
  });

  it('sem refresh token, tentarRefresh resolve false sem chamar a API', async () => {
    expect(await firstValueFrom(store.tentarRefresh())).toBe(false);
    http.expectNone(`${environment.apiUrl}/auth/refresh`);
  });
});
