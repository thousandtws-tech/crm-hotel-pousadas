import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { MariaService } from './maria.service';

const startSessionMock = vi.fn();
const sendUserMessageMock = vi.fn();
const sendContextualUpdateMock = vi.fn();
const sendUserActivityMock = vi.fn();
const endSessionMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@elevenlabs/client', () => ({
  Conversation: {
    startSession: (...args: unknown[]) => startSessionMock(...args),
  },
}));

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse((init?.body as string) ?? '{}');
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const payload = hit
      ? (typeof hit[1] === 'function' ? (hit[1] as (b: unknown) => unknown)(body) : hit[1])
      : { erro: 'não mapeado' };
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
  });
}

const MCP_TOOLS = {
  result: {
    tools: [
      { name: 'get_reservas' },
      { name: 'preparar_reserva' },
      { name: 'confirmar_acao' },
      { name: 'abrir_pagina' },
    ],
  },
};

describe('MariaService — sessão ElevenLabs', () => {
  let service: MariaService;
  const navigateByUrl = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    startSessionMock.mockReset().mockResolvedValue({
      endSession: endSessionMock,
      sendUserMessage: sendUserMessageMock,
      sendContextualUpdate: sendContextualUpdateMock,
      sendUserActivity: sendUserActivityMock,
      getInputVolume: () => 0.3,
      getOutputVolume: () => 0.8,
      setVolume: vi.fn(),
      setMicMuted: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        '/api/maria/session': { signed_url: 'wss://signed/fake' },
        '/mcp': MCP_TOOLS,
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl } },
        {
          provide: AuthStore,
          useValue: {
            accessToken: () => 'tok',
            user: () => ({ login: 'ana', nome: 'Ana' }),
          },
        },
      ],
    });
    service = TestBed.inject(MariaService);
  });

  afterEach(async () => {
    await service.desconectar();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    navigateByUrl.mockReset();
  });

  it('conectar pede signed_url autenticada e abre a sessão com clientTools', async () => {
    service.conectar();
    await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalled());

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const chamadaSessao = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/api/maria/session'),
    );
    expect(chamadaSessao?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer tok',
    });

    const opts = startSessionMock.mock.calls[0][0] as {
      signedUrl: string;
      clientTools: Record<string, unknown>;
      userId?: string;
    };
    expect(opts.signedUrl).toBe('wss://signed/fake');
    expect(opts.userId).toBe('ana');
    // nomes vêm do tools/list do /mcp — sem hardcode
    expect(Object.keys(opts.clientTools)).toEqual([
      'get_reservas', 'preparar_reserva', 'confirmar_acao', 'abrir_pagina',
    ]);
  });

  it('abrir_pagina navega só por rotas internas', async () => {
    service.conectar();
    await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalled());
    const tools = (startSessionMock.mock.calls[0][0] as {
      clientTools: Record<string, (p: unknown) => Promise<string> | string>;
    }).clientTools;

    expect(await tools['abrir_pagina']({ rota: '/reservas' })).toContain('aberta');
    expect(navigateByUrl).toHaveBeenCalledWith('/reservas');
    expect(await tools['abrir_pagina']({ rota: 'https://evil.com' })).toContain('rejeitada');
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('preparar_* com idacao abre o card; confirmar() chama o /mcp', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        '/api/maria/session': { signed_url: 'wss://signed/fake' },
        '/mcp': (body: { method: string }) =>
          body.method === 'tools/list'
            ? MCP_TOOLS
            : {
                result: {
                  content: [{ text: '{"idacao":"abc","total":230}' }],
                },
              },
      }),
    );
    service.conectar();
    await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalled());
    const tools = (startSessionMock.mock.calls[0][0] as {
      clientTools: Record<string, (p: unknown) => Promise<string>>;
    }).clientTools;

    await tools['preparar_reserva']({ quarto: 1 });
    expect(service.pendente()?.idacao).toBe('abc');

    await service.confirmar('abc');
    expect(service.pendente()).toBeNull();
    expect(sendContextualUpdateMock).toHaveBeenCalled();
  });

  it('desconectar encerra a sessão e cancela reconexão', async () => {
    service.conectar();
    await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalled());
    await service.desconectar();
    expect(endSessionMock).toHaveBeenCalled();
    vi.advanceTimersByTime(30000);
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(service.estado()).toBe('offline');
  });
});
