import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthStore } from '@core/services/auth.store';
import { authInterceptor } from './auth.interceptor';

const API = environment.apiUrl;
const TOKEN_RESPONSE = {
  access_token: 'novo-access',
  refresh_token: 'novo-refresh',
  funcionario: { id: 1, nome: 'Admin', login: 'admin', nivel: 1, ativo: true },
};

describe('authInterceptor', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  const navigateByUrl = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    localStorage.clear();
    navigateByUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    mock.verify();
    localStorage.clear();
  });

  it('injeta Bearer em rotas protegidas e nunca em /auth/*', () => {
    localStorage.setItem('clarituz.access', 'token-x');

    http.get(`${API}/reservas`).subscribe();
    const protegida = mock.expectOne(`${API}/reservas`);
    expect(protegida.request.headers.get('Authorization')).toBe('Bearer token-x');
    protegida.flush([]);

    http.post(`${API}/auth/login`, {}).subscribe();
    const publica = mock.expectOne(`${API}/auth/login`);
    expect(publica.request.headers.has('Authorization')).toBe(false);
    publica.flush({});
  });

  it('401 em rota protegida: uma rotação de refresh e repete com o novo token', async () => {
    localStorage.setItem('clarituz.access', 'velho');
    localStorage.setItem('clarituz.refresh', 'refresh-1');

    const resposta = firstValueFrom(http.get(`${API}/reservas`));

    mock.expectOne(`${API}/reservas`).flush({}, { status: 401, statusText: 'Unauthorized' });
    mock.expectOne(`${API}/auth/refresh`).flush(TOKEN_RESPONSE);

    const retry = mock.expectOne(`${API}/reservas`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer novo-access');
    expect(retry.request.headers.get('X-Retry')).toBe('1');
    retry.flush([{ id: 7 }]);

    expect(await resposta).toEqual([{ id: 7 }]);
    expect(TestBed.inject(AuthStore).accessToken()).toBe('novo-access');
  });

  it('dois 401 simultânicos disparam uma única rotação de refresh', async () => {
    localStorage.setItem('clarituz.access', 'velho');
    localStorage.setItem('clarituz.refresh', 'refresh-1');

    const r1 = firstValueFrom(http.get(`${API}/reservas`));
    const r2 = firstValueFrom(http.get(`${API}/clientes`));

    mock.match(() => true).forEach((r) => {
      if (!r.request.url.includes('/auth/')) {
        r.flush({}, { status: 401, statusText: 'Unauthorized' });
      }
    });

    const refreshs = mock.match(`${API}/auth/refresh`);
    expect(refreshs).toHaveLength(1);
    refreshs[0].flush(TOKEN_RESPONSE);

    mock.match((req) => req.url === `${API}/reservas`).forEach((r) => r.flush([]));
    mock.match((req) => req.url === `${API}/clientes`).forEach((r) => r.flush([]));

    expect(await r1).toEqual([]);
    expect(await r2).toEqual([]);
  });

  it('refresh falho: encerra a sessão silenciosamente e propaga o 401', async () => {
    localStorage.setItem('clarituz.access', 'velho');
    localStorage.setItem('clarituz.refresh', 'refresh-morto');

    const erro = firstValueFrom(http.get(`${API}/reservas`)).then(
      () => null,
      (e) => e as { status: number }
    );

    mock.expectOne(`${API}/reservas`).flush({}, { status: 401, statusText: 'Unauthorized' });
    mock.expectOne(`${API}/auth/refresh`).flush(
      {},
      { status: 401, statusText: 'Unauthorized' }
    );

    const e = await erro;
    expect(e?.status).toBe(401);
    expect(localStorage.getItem('clarituz.access')).toBeNull();
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
    mock.expectNone(`${API}/reservas`);
  });
});
