import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { SearchResponse } from '../models/search.models';
import { SearchStateService } from './search-state.service';

const API = environment.apiUrl;

const RESP_VAZIA: SearchResponse = { alternativas: [], periodos: 1, com_disponibilidade: 0 };

/** Rascunho válido determinístico (datas sempre no futuro). */
function preencherRascunhoValido(s: SearchStateService): void {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 30);
  const depois = new Date(amanha);
  depois.setDate(depois.getDate() + 3);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.mode.set('dates');
  s.checkIn.set(iso(amanha));
  s.checkOut.set(iso(depois));
  s.tolerance.set(0);
  s.guests.set({ adults: 2, children: 0, infants: 0, pets: 0 });
}

describe('SearchStateService', () => {
  let service: SearchStateService;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SearchStateService);
    mock = TestBed.inject(HttpTestingController);
    preencherRascunhoValido(service);
  });

  afterEach(() => mock.verify());

  it('submit envia o contrato snake/camel correto e aplica o resultado', async () => {
    const promise = service.submit();
    const req = mock.expectOne(`${API}/publico/disponibilidade/busca`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      date: {
        mode: 'dates',
        checkIn: service.checkIn(),
        checkOut: service.checkOut(),
        toleranceDays: 0,
      },
      guests: { adults: 2, children: 0, infants: 0, pets: 0 },
    });
    req.flush({ ...RESP_VAZIA, periodos: 1, com_disponibilidade: 1 });
    expect(await promise).toBe(true);
    expect(service.result()?.com_disponibilidade).toBe(1);
    expect(service.appliedQuery()?.date.mode).toBe('dates');
  });

  it('resposta antiga (fora de ordem) não sobrescreve a consulta nova', async () => {
    const primeira = service.submit();
    const segunda = service.submit();
    const reqs = mock.match(`${API}/publico/disponibilidade/busca`);
    expect(reqs.length).toBe(2);
    // A primeira responde depois — é descartada (corrida monotônica).
    reqs[0].flush({ ...RESP_VAZIA, com_disponibilidade: 99 });
    reqs[1].flush({ ...RESP_VAZIA, com_disponibilidade: 7 });
    await Promise.all([primeira, segunda]);
    expect(service.result()?.com_disponibilidade).toBe(7);
  });

  it('erro de rede devolve mensagem e limpa o resultado', async () => {
    const promise = service.submit();
    mock.expectOne(`${API}/publico/disponibilidade/busca`).error(new ProgressEvent('error'));
    expect(await promise).toBe(true); // navega mesmo com erro — a página mostra a mensagem
    expect(service.result()).toBeNull();
    expect(service.erro()).toContain('Falha de conexão');
  });

  it('erro de validação do backend aparece na mensagem', async () => {
    const promise = service.submit();
    mock
      .expectOne(`${API}/publico/disponibilidade/busca`)
      .flush({ erro: { mensagem: 'Máximo de 20 hóspedes por busca' } }, { status: 422, statusText: 'Unprocessable' });
    await promise;
    expect(service.erro()).toBe('Máximo de 20 hóspedes por busca');
  });

  it('sem adulto a busca não sai — validação local barra', async () => {
    service.guests.set({ adults: 0, children: 2, infants: 0, pets: 0 });
    expect(service.prontoParaBuscar()).toBe(false);
    expect(await service.submit()).toBe(false);
    mock.expectNone(`${API}/publico/disponibilidade/busca`);
  });

  it('modo flexível serializa stayPreset + months', async () => {
    const proximoMes = new Date();
    proximoMes.setMonth(proximoMes.getMonth() + 2);
    const chave = `${proximoMes.getFullYear()}-${String(proximoMes.getMonth() + 1).padStart(2, '0')}`;
    service.mode.set('flexible');
    service.stayPreset.set('week');
    service.months.set([chave]);

    const promise = service.submit();
    const req = mock.expectOne(`${API}/publico/disponibilidade/busca`);
    expect(req.request.body.date).toEqual({ mode: 'flexible', stayPreset: 'week', months: [chave] });
    req.flush(RESP_VAZIA);
    await promise;
  });

  it('parametrosUrl serializa o rascunho sem dados pessoais', () => {
    service.tolerance.set(2);
    service.guests.set({ adults: 2, children: 1, infants: 1, pets: 1 });
    const p = service.parametrosUrl();
    expect(p['modo']).toBe('dates');
    expect(p['in']).toBe(service.checkIn());
    expect(p['tol']).toBe(2);
    expect(p['a']).toBe(2);
    expect(p['c']).toBe(1);
    expect(p['i']).toBe(1);
    expect(p['p']).toBe(1);
  });
});
