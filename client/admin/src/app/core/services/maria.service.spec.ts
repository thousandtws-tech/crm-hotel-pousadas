import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { MariaService } from './maria.service';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  readyState = 0;
  binaryType = '';
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  send(): void {}
  simulateClose(): void {
    this.onclose?.();
  }
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

describe('MariaService — conexão e teardown', () => {
  let service: MariaService;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: AuthStore, useValue: { accessToken: () => 'tok' } },
      ],
    });
    service = TestBed.inject(MariaService);
  });

  afterEach(() => {
    service.desconectar();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('conectar abre o WebSocket com o token e sinaliza conectado ao abrir', () => {
    service.conectar();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain('token=tok');

    FakeWebSocket.instances[0].simulateOpen();
    expect(service.conectado()).toBe(true);
    expect(service.estado()).toBe('idle');
  });

  it('desconectar durante o backoff cancela a reconexão pendente', () => {
    service.conectar();
    const ws = FakeWebSocket.instances[0];
    ws.simulateClose(); // agenda retry com backoff

    service.desconectar(); // antes do retry disparar
    vi.advanceTimersByTime(30000);

    // nenhuma reconexão ressuscitou após o teardown
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(service.conectado()).toBe(false);
    expect(service.estado()).toBe('offline');
  });

  it('queda inesperada reconecta com backoff enquanto querConectar', () => {
    service.conectar();
    FakeWebSocket.instances[0].simulateClose();

    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
