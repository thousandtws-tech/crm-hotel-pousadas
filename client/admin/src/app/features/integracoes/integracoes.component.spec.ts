import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { IntegracaoView } from '@core/models/integracoes.models';
import { IntegracoesComponent } from './integracoes.component';

const API = environment.apiUrl;

function integracao(parcial: Partial<IntegracaoView>): IntegracaoView {
  return {
    provedor: 'stripe',
    ambiente: 'producao',
    estado: 'nao_configurada',
    habilitado: false,
    nome_conta: null,
    capabilities: {},
    webhook_url: null,
    segredos: { campos: {} },
    ultima_verificacao_em: null,
    verificacao_status: null,
    verificacao_erro: null,
    versao: 1,
    padrao_site: false,
    ...parcial,
  };
}

describe('IntegracoesComponent', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [IntegracoesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('mostra skeletons enquanto carrega e cards depois', async () => {
    const fixture = TestBed.createComponent(IntegracoesComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.skel').length).toBeGreaterThan(0);

    mock.expectOne(`${API}/integracoes`).flush([
      integracao({
        provedor: 'stripe',
        ambiente: 'producao',
        estado: 'ativa',
        habilitado: true,
        padrao_site: true,
        nome_conta: 'Pousada',
      }),
      integracao({ provedor: 'stripe', ambiente: 'teste', estado: 'nao_configurada' }),
      integracao({
        provedor: 'pagbank',
        ambiente: 'producao',
        estado: 'falha',
        verificacao_status: 'falha',
        verificacao_erro: 'token inválido',
      }),
      integracao({ provedor: 'pagbank', ambiente: 'teste' }),
      integracao({ provedor: 'mercadopago', ambiente: 'producao' }),
      integracao({ provedor: 'mercadopago', ambiente: 'teste' }),
    ]);
    await fixture.whenStable();

    expect(el.querySelectorAll('.card-prov').length).toBe(3);
    expect(el.querySelectorAll('.env-linha').length).toBe(6);
    const texto = el.textContent ?? '';
    expect(texto).toContain('Stripe');
    expect(texto).toContain('PagBank');
    expect(texto).toContain('Mercado Pago');
    expect(texto).toContain('Padrão');
    // Faixa do padrão: stripe/producao é o padrão do site neste cenário.
    expect(el.querySelector('.faixa-padrao')?.textContent).toContain(
      'Stripe · Produção é o provedor padrão',
    );
    expect(texto).toContain('Ativa');
    expect(texto).toContain('Não configurada');
    expect(texto).toContain('token inválido');
  });

  it('oferece retry quando o carregamento falha', async () => {
    const fixture = TestBed.createComponent(IntegracoesComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    mock.expectOne(`${API}/integracoes`).flush('erro', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    expect(el.textContent).toContain('Não foi possível carregar');
    expect(el.querySelector('.vazio-card')).toBeTruthy();
  });
});
