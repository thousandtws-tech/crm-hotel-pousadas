import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { BookingSubmission } from '../models/booking-request.model';
import { BookingService } from './booking.service';

const API = environment.apiUrl;

const SUBMISSION: BookingSubmission = {
  accommodationSlug: 'suite-peró',
  checkIn: '2026-12-01',
  checkOut: '2026-12-05',
  guests: 2,
  guestName: 'Maria Silva',
  guestEmail: 'maria@example.com',
  guestPhone: '(22) 99999-0000',
  specialRequests: 'Berço',
  earlyCheckin: true,
  lateCheckout: false,
  aceitoTermos: true,
  aceitoMarketing: false,
  aceitoWhatsapp: true,
  guestPhoneDdi: '55',
  codigoCorporativo: 'CORP10',
} as BookingSubmission;

describe('BookingService', () => {
  let service: BookingService;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BookingService);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('nights deriva do filtro (mínimo 1)', () => {
    service.updateFilter({ checkIn: '2026-12-01', checkOut: '2026-12-05' });
    expect(service.nights()).toBe(4);
    service.updateFilter({ checkOut: '2026-12-01' });
    expect(service.nights()).toBe(1);
  });

  it('submit posta o contrato completo e devolve sucesso com token', async () => {
    const promise = service.submitBookingRequest(SUBMISSION);
    const req = mock.expectOne(`${API}/publico/reservas`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      slug: 'suite-peró',
      check_in: '2026-12-01',
      check_out: '2026-12-05',
      hospedes: 2,
      nome: 'Maria Silva',
      email: 'maria@example.com',
      telefone: '(22) 99999-0000',
      telefone_ddi: '55',
      observacoes: 'Berço',
      early_checkin: true,
      late_checkout: false,
      aceito_termos: true,
      aceito_marketing: false,
      aceito_whatsapp: true,
      codigo_corporativo: 'CORP10',
    });
    req.flush({ idreserva: 42, token_publico: 'tok-1', mensagem: 'Recebido!' });

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.idreserva).toBe(42);
    expect(result.token).toBe('tok-1');
    expect(result.message).toBe('Recebido!');
  });

  it('erro da API devolve a mensagem do backend', async () => {
    const promise = service.submitBookingRequest(SUBMISSION);
    mock.expectOne(`${API}/publico/reservas`).flush(
      { erro: { mensagem: 'Datas indisponíveis' } },
      { status: 409, statusText: 'Conflict' }
    );
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Datas indisponíveis');
  });

  it('falha de rede (status 0) devolve mensagem de conexão', async () => {
    const promise = service.submitBookingRequest(SUBMISSION);
    mock.expectOne(`${API}/publico/reservas`).error(new ProgressEvent('error'));
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('Falha de conexão');
  });

  it('validarContrato consulta o endpoint público com o código escapado', async () => {
    const promise = service.validarContrato('CORP/10');
    const req = mock.expectOne(`${API}/publico/contrato/CORP%2F10`);
    expect(req.request.method).toBe('GET');
    req.flush({ valido: true, desconto_pct: 10 });
    expect(await promise).toEqual({ valido: true, desconto_pct: 10 });
  });

  it('validarContrato devolve null quando a API falha', async () => {
    const promise = service.validarContrato('XYZ');
    mock.expectOne(`${API}/publico/contrato/XYZ`).error(new ProgressEvent('error'));
    expect(await promise).toBeNull();
  });
});
