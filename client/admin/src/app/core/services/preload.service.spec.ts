import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { routes } from '../../app.routes';
import { PreloadService } from './preload.service';

describe('PreloadService — preload seletivo', () => {
  let svc: PreloadService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(PreloadService);
  });

  it('baixa o chunk de rota marcada com preload', () => {
    let carregou = false;
    svc
      .preload({ data: { preload: true } }, () => {
        carregou = true;
        return of(null);
      })
      .subscribe();
    expect(carregou).toBe(true);
  });

  it('ignora rota sem a flag — fica sob demanda', () => {
    let carregou = false;
    svc
      .preload({ path: 'auditoria' }, () => {
        carregou = true;
        return of(null);
      })
      .subscribe();
    expect(carregou).toBe(false);
  });
});

describe('Rotas — contrato de preload', () => {
  const filhos = routes.find((r) => r.path === '')?.children ?? [];

  // Todas as telas do shell pré-carregam em background após o login — a
  // navegação do CRM inteira fica instantânea (chunks são pequenos; o
  // custo de banda é uma vez por sessão, não por clique).
  it('toda rota de feature do shell está marcada para preload', () => {
    const sem = filhos
      .filter((r) => r.path !== '' && !r.redirectTo && r.data?.['preload'] !== true)
      .map((r) => r.path);
    expect(sem).toEqual([]);
  });
});
