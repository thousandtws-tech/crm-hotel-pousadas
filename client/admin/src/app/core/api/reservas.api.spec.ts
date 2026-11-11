import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ReservasApi } from './reservas.api';

const API = environment.apiUrl;

describe('ReservasApi — contratos HTTP', () => {
  let api: ReservasApi;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ReservasApi);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('listarReservas envia os filtros como query params (por_pagina)', () => {
    api.listarReservas({ status: 'i', idacomodacao: 3, page: 2, porPagina: 10 }).subscribe();
    const req = mock.expectOne((r) => r.url === `${API}/reservas`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('status')).toBe('i');
    expect(req.request.params.get('idacomodacao')).toBe('3');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('por_pagina')).toBe('10');
    req.flush({ items: [] });
  });

  it('criarReserva posta o payload sem alteração de contrato', () => {
    const input = { idacomodacao: 2, checkin: '2026-12-01', checkout: '2026-12-05' };
    api.criarReserva(input as never).subscribe();
    const req = mock.expectOne(`${API}/reservas`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 10 });
  });

  it('check-in/check-out/cancelar usam os endpoints da reserva', () => {
    api.checkin(5, '2026-12-01', '14:00').subscribe();
    const checkin = mock.expectOne(`${API}/reservas/5/check-in`);
    expect(checkin.request.method).toBe('POST');
    expect(checkin.request.body).toEqual({ data: '2026-12-01', hora: '14:00' });
    checkin.flush({});

    api.checkout(5, {} as never).subscribe();
    const checkout = mock.expectOne(`${API}/reservas/5/check-out`);
    expect(checkout.request.method).toBe('POST');
    checkout.flush({});

    api.cancelarReserva(5, { motivo: 'hóspede desistiu' } as never).subscribe();
    const cancelar = mock.expectOne(`${API}/reservas/5/cancelar`);
    expect(cancelar.request.method).toBe('POST');
    cancelar.flush({});
  });

  it('disponibilidade filtra por período e acomodação opcional', () => {
    api.disponibilidade('2026-12-01', '2026-12-05', 7).subscribe();
    const req = mock.expectOne((r) => r.url === `${API}/reservas/disponibilidade`);
    expect(req.request.params.get('inicio')).toBe('2026-12-01');
    expect(req.request.params.get('fim')).toBe('2026-12-05');
    expect(req.request.params.get('idacomodacao')).toBe('7');
    req.flush({ disponiveis: [] });
  });

  it('no-show exige PIN no corpo', () => {
    api.marcarNoShow(8, '1234').subscribe();
    const req = mock.expectOne(`${API}/reservas/8/no-show`);
    expect(req.request.body).toEqual({ pin: '1234' });
    req.flush({});
  });

  it('propaga erro 409 de conflito de reserva ao chamador', async () => {
    const erro = firstValueFrom(api.criarReserva({} as never)).then(
      () => null,
      (e) => e as { status: number }
    );
    mock.expectOne(`${API}/reservas`).flush(
      { erro: { mensagem: 'Conflito de datas' } },
      { status: 409, statusText: 'Conflict' }
    );
    expect((await erro)?.status).toBe(409);
  });

  it('propaga falha de rede (status 0) ao chamador', async () => {
    const erro = firstValueFrom(api.listarReservas({})).then(
      () => null,
      (e) => e as { status: number }
    );
    mock.expectOne((r) => r.url === `${API}/reservas`).error(
      new ProgressEvent('error')
    );
    expect((await erro)?.status).toBe(0);
  });
});
