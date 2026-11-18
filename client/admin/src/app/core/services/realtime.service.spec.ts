import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RealtimeService } from './realtime.service';
import { NotifyService } from './notify.service';

// ---- fakes do módulo `phoenix` (import dinâmico no serviço) ----
type Callback = (payload?: unknown) => void;

class FakePush {
  receive(_status: string, _cb: Callback): FakePush {
    return this;
  }
}

class FakeChannel {
  readonly handlers = new Map<string, Callback>();
  joined = false;
  left = false;
  rejoined = false;

  constructor(readonly topic: string) {}

  on(event: string, cb: Callback): number {
    this.handlers.set(event, cb);
    return 1;
  }
  off(): void {}
  join(): FakePush {
    this.joined = true;
    return new FakePush();
  }
  leave(): FakePush {
    this.left = true;
    return new FakePush();
  }
  rejoin(): void {
    this.rejoined = true;
  }
  push(): FakePush {
    return new FakePush();
  }
  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.(payload);
  }
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly channels = new Map<string, FakeChannel>();
  connected = false;
  disconnected = false;
  private openCb: Callback | null = null;
  private closeCb: Callback | null = null;

  constructor(
    readonly endPoint: string,
    readonly opts: unknown,
  ) {
    FakeSocket.instances.push(this);
  }
  connect(): void {
    this.connected = true;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  channel(topic: string): FakeChannel {
    const ch = new FakeChannel(topic);
    this.channels.set(topic, ch);
    return ch;
  }
  onOpen(cb: Callback): number {
    this.openCb = cb;
    return 1;
  }
  onClose(cb: Callback): number {
    this.closeCb = cb;
    return 1;
  }
  onError(): number {
    return 1;
  }
  simulateOpen(): void {
    this.openCb?.();
  }
  simulateClose(): void {
    this.closeCb?.();
  }
}

vi.mock('phoenix', () => ({ Socket: FakeSocket, Channel: FakeChannel }));

describe('RealtimeService — lifecycle e deltas', () => {
  let rt: RealtimeService;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem('clarituz.access', 'token-1');
    FakeSocket.instances = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: NotifyService,
          useValue: { ok: vi.fn(), aviso: vi.fn(), erro: vi.fn() },
        },
      ],
    });
    rt = TestBed.inject(RealtimeService);
  });

  afterEach(() => {
    rt.parar();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('iniciar conecta uma vez e entra nos canais deltas e avisos', async () => {
    rt.iniciar();
    rt.iniciar(); // segunda chamada é no-op
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0];
    expect(socket.connected).toBe(true);
    expect(socket.channels.get('deltas')?.joined).toBe(true);
    expect(socket.channels.get('avisos')?.joined).toBe(true);

    socket.simulateOpen();
    expect(rt.online()).toBe(true);
  });

  it('delta de tabela incrementa o contador após o debounce (sem listener duplo)', async () => {
    rt.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    const deltas = FakeSocket.instances[0].channels.get('deltas')!;

    const antes = rt.delta('reserva');
    deltas.emit('delta', { tabela: 'reserva', acao: 'insert', id: 1 });
    deltas.emit('delta', { tabela: 'reserva', acao: 'update', id: 2 });
    await vi.advanceTimersByTimeAsync(300);

    // rajada de 2 deltas → um único bump
    expect(rt.delta('reserva')).toBe(antes + 1);
  });

  it('parar sai dos canais, desconecta e descarta bumps pendentes', async () => {
    rt.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0];
    socket.channels.get('deltas')!.emit('delta', { tabela: 'reserva', acao: 'insert', id: 1 });

    const antes = rt.delta('reserva');
    rt.parar();

    expect(socket.channels.get('deltas')?.left).toBe(true);
    expect(socket.channels.get('avisos')?.left).toBe(true);
    expect(socket.disconnected).toBe(true);
    expect(rt.online()).toBe(false);

    // timer de debounce pendente foi descartado — nenhum bump pós-teardown
    await vi.advanceTimersByTimeAsync(1000);
    expect(rt.delta('reserva')).toBe(antes);
  });

  it('aviso recebido atualiza signals (ultimoAviso/avisoSeq)', async () => {
    rt.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    const avisos = FakeSocket.instances[0].channels.get('avisos')!;

    avisos.emit('aviso', { tipo: 'sucesso', titulo: 'Reserva', mensagem: 'check-in feito' });
    expect(rt.ultimoAviso()?.titulo).toBe('Reserva');
    expect(rt.avisoSeq()).toBe(1);
  });
});
