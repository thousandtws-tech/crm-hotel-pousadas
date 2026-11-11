import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { PaymentService } from './payment.service';

const API = `${environment.apiUrl}/publico/pagamentos`;

describe('PaymentService', () => {
  let service: PaymentService;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PaymentService);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('criarCheckout posta token e tipo — sem valor no corpo', async () => {
    const promise = service.criarCheckout('tok-1', 'sinal');
    const req = mock.expectOne(`${API}/checkout`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'tok-1', tipo: 'sinal' });
    expect(req.request.body.valor_centavos).toBeUndefined();
    const out = { checkout_url: 'https://pay/1', valor_centavos: 5000, expira_em: 'x', idpagamento: 1 };
    req.flush(out);
    expect(await promise).toEqual(out);
  });

  it('criarCheckout devolve null quando a API falha', async () => {
    const promise = service.criarCheckout('tok-1', 'integral');
    mock.expectOne(`${API}/checkout`).error(new ProgressEvent('error'));
    expect(await promise).toBeNull();
  });

  it('status consulta por token e devolve os estados do backend', async () => {
    const promise = service.status('tok-9');
    const req = mock.expectOne((r) => r.url === `${API}/status`);
    expect(req.request.params.get('token')).toBe('tok-9');
    req.flush({
      status_reserva: 'p',
      confirmada: false,
      pagamentos: [{ tipo: 'sinal', status: 'pendente', valor_centavos: 3000, metodo: null }],
    });
    const result = await promise;
    expect(result?.status_reserva).toBe('p');
    expect(result?.pagamentos[0].status).toBe('pendente');
  });

  it('status devolve null quando a consulta falha', async () => {
    const promise = service.status('tok-9');
    mock.expectOne((r) => r.url === `${API}/status`).error(new ProgressEvent('error'));
    expect(await promise).toBeNull();
  });
});
