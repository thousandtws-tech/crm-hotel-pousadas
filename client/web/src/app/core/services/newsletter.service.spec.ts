import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { NewsletterService } from './newsletter.service';

const API = environment.apiUrl;

describe('NewsletterService', () => {
  let service: NewsletterService;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NewsletterService);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('inscreve com email e origem no corpo', async () => {
    const promise = service.inscrever('a@b.com', 'rodape');
    const req = mock.expectOne(`${API}/publico/newsletter`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.com', origem: 'rodape' });
    req.flush({});
    expect(await promise).toBe(true);
  });

  it('devolve false quando a inscrição falha', async () => {
    const promise = service.inscrever('a@b.com');
    mock.expectOne(`${API}/publico/newsletter`).error(new ProgressEvent('error'));
    expect(await promise).toBe(false);
  });
});
