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

  it.each(['dashboard', 'recepcao', 'reservas', 'reservas/:id', 'clientes', 'acomodacoes', 'pdv'])(
    'rota quente %s está marcada',
    (path) => {
      expect(filhos.find((r) => r.path === path)?.data?.['preload']).toBe(true);
    },
  );

  it.each(['auditoria', 'cms', 'integracoes', 'financeiro'])(
    'rota administrativa %s fica sob demanda',
    (path) => {
      expect(filhos.find((r) => r.path === path)?.data?.['preload']).toBeUndefined();
    },
  );
});
