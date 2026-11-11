import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { PagamentosApi } from './pagamentos.api';

const API = environment.apiUrl;

describe('PagamentosApi — contratos HTTP', () => {
  let api: PagamentosApi;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PagamentosApi);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('pagamentosOnline envia status e período como query params', () => {
    api.pagamentosOnline({ status: 'pago', inicio: '2026-01-01', fim: '2026-01-31' }).subscribe();
    const req = mock.expectOne((r) => r.url === `${API}/pagamentos`);
    expect(req.request.params.get('status')).toBe('pago');
    expect(req.request.params.get('inicio')).toBe('2026-01-01');
    req.flush({ items: [] });
  });

  it('reembolsarPagamento posta valor e motivo', () => {
    api.reembolsarPagamento(9, 15000, 'cancelamento').subscribe();
    const req = mock.expectOne(`${API}/pagamentos/9/reembolsos`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ valor_centavos: 15000, motivo: 'cancelamento' });
    req.flush({});
  });

  it('reembolso integral envia valor_centavos nulo', () => {
    api.reembolsarPagamento(9, null, 'cancelamento total').subscribe();
    const req = mock.expectOne(`${API}/pagamentos/9/reembolsos`);
    expect(req.request.body.valor_centavos).toBeNull();
    req.flush({});
  });

  it('resumoFinanceiroOnline aceita período opcional', () => {
    api.resumoFinanceiroOnline('2026-01-01', '2026-01-31').subscribe();
    const req = mock.expectOne((r) => r.url === `${API}/financeiro/pagamentos/resumo`);
    expect(req.request.params.get('inicio')).toBe('2026-01-01');
    req.flush({});
  });
});
