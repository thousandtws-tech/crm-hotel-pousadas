import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { IntegracoesApi } from './integracoes.api';

const API = environment.apiUrl;

describe('IntegracoesApi — contratos HTTP', () => {
  let api: IntegracoesApi;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(IntegracoesApi);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('listar pede o catálogo completo', () => {
    api.listar().subscribe();
    const req = mock.expectOne(`${API}/integracoes`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('salvar envia versão e segredos no PUT do par', () => {
    api
      .salvar('stripe', 'producao', {
        versao: 3,
        segredos: { secret_key: 'sk_live_x', webhook_secret: '' },
        nome_conta: 'Pousada',
      })
      .subscribe();
    const req = mock.expectOne(`${API}/integracoes/stripe/producao`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      versao: 3,
      segredos: { secret_key: 'sk_live_x', webhook_secret: '' },
      nome_conta: 'Pousada',
    });
    req.flush({});
  });

  it('habilitacao faz PATCH com o booleano', () => {
    api.habilitacao('pagbank', 'teste', false).subscribe();
    const req = mock.expectOne(`${API}/integracoes/pagbank/teste/habilitacao`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ habilitado: false });
    req.flush({});
  });

  it('testar faz POST sem corpo', () => {
    api.testar('mercadopago', 'producao').subscribe();
    const req = mock.expectOne(`${API}/integracoes/mercadopago/producao/testar`);
    expect(req.request.method).toBe('POST');
    req.flush({ verificacao_status: 'ok', nome_conta: 'Conta', mensagem: '' });
  });

  it('definirPadrao faz PUT no endpoint padrao', () => {
    api.definirPadrao('stripe', 'teste').subscribe();
    const req = mock.expectOne(`${API}/integracoes/stripe/teste/padrao`);
    expect(req.request.method).toBe('PUT');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('eventos pede o histórico de webhooks do par', () => {
    api.eventos('stripe', 'producao').subscribe();
    const req = mock.expectOne(`${API}/integracoes/stripe/producao/eventos`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('infobipTeste posta telefone e texto opcional', () => {
    api
      .infobipTeste('producao', { telefone: '5544999990000', texto: 'Teste' })
      .subscribe();
    const req = mock.expectOne(`${API}/integracoes/infobip/producao/teste-msg`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefone: '5544999990000', texto: 'Teste' });
    req.flush({ enviado: true, id_provedor: 'msg-1' });
  });
});
