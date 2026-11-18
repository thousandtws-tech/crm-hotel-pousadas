import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { IntegracaoView } from '@core/models/integracoes.models';
import { ConfirmService } from '@core/services/confirm.service';
import { IntegracaoZapiComponent } from './integracao-zapi.component';

const API = environment.apiUrl;
const DETALHE = `${API}/integracoes/zapi/producao`;

function view(parcial: Partial<IntegracaoView> = {}): IntegracaoView {
  return {
    provedor: 'zapi',
    ambiente: 'producao',
    categoria: 'comunicacao',
    estado: 'ativa',
    habilitado: true,
    nome_conta: 'WhatsApp da pousada',
    capabilities: {
      canal: 'whatsapp',
      callbacks: ['received', 'delivery', 'message-status', 'connected', 'disconnected'],
    },
    config: {
      instance_id: 'ABC123',
      sessao: {
        conectado: true,
        smartphone_conectado: true,
        telefone: '5544999990000',
        verificado_em: '2026-01-10T12:00:00Z',
      },
      webhooks_configurados: 5,
    },
    webhook_url: null,
    segredos: {
      campos: { instance_token: true, client_token: true, webhook_segredo: true },
    },
    ultima_verificacao_em: '2026-01-10T12:00:00Z',
    verificacao_status: 'ok',
    verificacao_erro: null,
    versao: 3,
    padrao_site: false,
    ...parcial,
  };
}

function botao(el: HTMLElement, texto: string): HTMLButtonElement | null {
  const bs = [...el.querySelectorAll('button')];
  return (bs.find((b) => b.textContent?.includes(texto)) as HTMLButtonElement) ?? null;
}

describe('IntegracaoZapiComponent', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [IntegracaoZapiComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  async function carrega(fixture: ReturnType<typeof TestBed.createComponent>, v = view()) {
    mock.expectOne(DETALHE).flush(v);
    mock.expectOne(`${DETALHE}/eventos`).flush([]);
    await fixture.whenStable();
  }

  it('renderiza credenciais, sessão e webhook_segredo somente-leitura', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture);

    const texto = el.textContent ?? '';
    expect(texto).toContain('Nome da conexão');
    expect(texto).toContain('Instance ID');
    expect(texto).toContain('Instance token');
    expect(texto).toContain('Client token');
    expect(texto).toContain('Segredo do webhook');
    // Dois estados separados: integração ativa + sessão conectada.
    expect(texto).toContain('WhatsApp conectado');
    expect(texto).toContain('5544999990000');
    expect(texto).toContain('5 de 5 callbacks configurados');
    // webhook_segredo é readonly e gerado pelo servidor — não pode ser digitado.
    const ro = el.querySelector('input[aria-label*="Segredo do webhook"]') as HTMLInputElement;
    expect(ro?.readOnly).toBe(true);
    expect(ro?.value).toBe('Gerado automaticamente pelo servidor');
  });

  it('mostra <img> quando o QR Code vem como imagem', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture, view({ config: { sessao: { conectado: false } } }));

    botao(el, 'Conectar WhatsApp')?.click();
    mock
      .expectOne(`${DETALHE}/qr-code`)
      .flush({ tipo: 'imagem', valor: 'data:image/png;base64,AAA' });
    await fixture.whenStable();

    const img = el.querySelector('img.qr-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('data:image/png;base64,AAA');
    expect(el.textContent).toContain('Conectar aparelho');
  });

  it('mostra a mensagem quando o pareamento é assistido', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture, view({ config: { sessao: { conectado: false } } }));

    botao(el, 'Conectar WhatsApp')?.click();
    mock
      .expectOne(`${DETALHE}/qr-code`)
      .flush({ tipo: 'assistido', mensagem: 'Confirme o código 123-456 no celular.' });
    await fixture.whenStable();

    expect(el.querySelector('img.qr-img')).toBeNull();
    expect(el.textContent).toContain('Confirme o código 123-456 no celular.');
    expect(el.textContent).toContain('painel oficial da Z-API');
  });

  it('rejeita telefone inválido sem chamar a API', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture);

    const tel = el.querySelector('input[inputmode="tel"]') as HTMLInputElement;
    tel.value = '123';
    tel.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    botao(el, 'Enviar teste')?.click();
    await fixture.whenStable();

    mock.expectNone(`${DETALHE}/teste-msg`);
    expect(el.textContent).toContain('DDI e DDD');
  });

  it('envia telefone normalizado quando válido', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture);

    const tel = el.querySelector('input[inputmode="tel"]') as HTMLInputElement;
    tel.value = '+55 44 99999-0000';
    tel.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    botao(el, 'Enviar teste')?.click();
    const req = mock.expectOne(`${DETALHE}/teste-msg`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefone: '5544999990000' });
    req.flush({ enviado: true, id_provedor: 'ZA1B2C' });
    await fixture.whenStable();

    expect(el.textContent).toContain('Mensagem enviada');
  });

  it('rejeita ambiente != producao sem chamar a API', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    // Z-API só existe em produção — rota com outro ambiente é inválida.
    fixture.componentRef.setInput('ambiente', 'teste');
    fixture.detectChanges();
    await fixture.whenStable();

    mock.expectNone(DETALHE);
    expect(fixture.nativeElement.textContent).toContain(
      'Não foi possível carregar esta integração.',
    );
  });

  it('pede confirmação antes de desconectar a sessão', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture);

    const confirm = TestBed.inject(ConfirmService);
    const pergunta = vi.spyOn(confirm, 'perguntar').mockResolvedValue(false);

    botao(el, 'Desconectar sessão')?.click();
    await fixture.whenStable();

    expect(pergunta).toHaveBeenCalled();
    mock.expectNone(`${DETALHE}/desconectar`);
  });

  it('desconecta quando a ação é confirmada', async () => {
    const fixture = TestBed.createComponent(IntegracaoZapiComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await carrega(fixture);

    const confirm = TestBed.inject(ConfirmService);
    vi.spyOn(confirm, 'perguntar').mockResolvedValue(true);

    botao(el, 'Desconectar sessão')?.click();
    await fixture.whenStable();

    const req = mock.expectOne(`${DETALHE}/desconectar`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    // Recarrega a visão — sessão passa a refletir a desconexão.
    mock.expectOne(DETALHE).flush(view({ config: { sessao: { conectado: false } } }));
    await fixture.whenStable();
  });
});
