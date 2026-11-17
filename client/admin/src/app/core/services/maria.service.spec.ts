import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MariaService } from './maria.service';

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

describe('MariaService — widget ElevenLabs', () => {
  let service: MariaService;
  const navigateByUrl = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        '/api/maria/session': { signed_url: 'wss://signed/fake' },
        '/mcp': MCP_TOOLS,
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        MariaService,
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    service = TestBed.inject(MariaService);
    localStorage.setItem('clarituz.access', 'jwt-teste');
    navigateByUrl.mockReset();
  });

  it('preparar() emite signed_url e monta clientTools do tools/list', async () => {
    await service.preparar();
    expect(service.signedUrl()).toBe('wss://signed/fake');
    const tools = service.clientTools();
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(['get_reservas', 'preparar_reserva', 'confirmar_acao', 'abrir_pagina']),
    );
  });

  it('clientTool abrir_pagina navega pelo enum pagina', async () => {
    await service.preparar();
    const tools = service.clientTools();
    await tools['abrir_pagina']({ pagina: 'reservas' });
    expect(navigateByUrl).toHaveBeenCalledWith('/reservas');
    await tools['abrir_pagina']({ pagina: 'reservas', idreserva: 42 });
    expect(navigateByUrl).toHaveBeenCalledWith('/reservas/42');
    const r = await tools['abrir_pagina']({ pagina: 'https://evil.com' });
    expect(r).toContain('desconhecida');
    expect(navigateByUrl).toHaveBeenCalledTimes(2);
  });

  it('preparar_* via clientTool alimenta o card de confirmação', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        '/api/maria/session': { signed_url: 'wss://signed/fake' },
        '/mcp': (b: { method: string }) =>
          b.method === 'tools/list'
            ? MCP_TOOLS
            : {
                result: {
                  content: [{ text: '{"idacao":"a-1","hospede":"Ana","total":500}' }],
                },
              },
      }),
    );
    await service.preparar();
    const tools = service.clientTools();
    await tools['preparar_reserva']({ hospede: 'Ana' });
    expect(service.pendente()?.idacao).toBe('a-1');
    expect(service.pendente()?.resumo['hospede']).toBe('Ana');
  });

  it('confirmar() chama confirmar_acao no /mcp e limpa o card', async () => {
    const chamadas: { name?: string; arguments?: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        '/api/maria/session': { signed_url: 'wss://signed/fake' },
        '/mcp': (b: { method: string; params?: { name?: string; arguments?: Record<string, unknown> } }) => {
          if (b.method === 'tools/list') return MCP_TOOLS;
          chamadas.push(b.params ?? {});
          return { result: { content: [{ text: 'ok' }] } };
        },
      }),
    );
    await service.preparar();
    service.pendente.set({ idacao: 'a-9', acao: 'preparar_checkin', resumo: {} });
    await service.confirmar('a-9');
    expect(service.pendente()).toBeNull();
    expect(chamadas.at(-1)?.name).toBe('confirmar_acao');
    expect(chamadas.at(-1)?.arguments).toEqual({ idacao: 'a-9' });
  });

  it('erro na sessão é sinalizado e não quebra o serviço', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 500 })));
    await service.preparar();
    expect(service.erro()).toContain('HTTP 500');
    expect(service.signedUrl()).toBeNull();
  });
});
