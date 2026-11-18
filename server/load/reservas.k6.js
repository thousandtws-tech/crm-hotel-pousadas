import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WRITE = __ENV.WRITE === '1';

const errosApp = new Rate('erros_app');
const duracaoCatalogo = new Trend('duracao_catalogo_ms', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 150 }, 
        { duration: '2m', target: 800 },
        { duration: '2m', target: 800 }, 
        { duration: '1m', target: 0 },
      ],
    },
    ...(WRITE
      ? {
          reserva: {
            executor: 'constant-arrival-rate',
            exec: 'reserva',
            rate: 6,
            timeUnit: '1m',
            duration: '5m',
            preAllocatedVUs: 2,
          },
        }
      : {}),
    sse: {
      executor: 'constant-vus',
      exec: 'sse',
      vus: 200, 
      duration: '6m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    duracao_catalogo_ms: ['p(95)<500'],
    erros_app: ['rate<0.01'],
    http_req_failed: ['rate<0.05'],
  },
};

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export function browse() {
  const res = http.get(`${BASE_URL}/api/v1/publico/acomodacoes`, {
    tags: { endpoint: 'listar' },
  });
  duracaoCatalogo.add(res.timings.duration);
  const ok = check(res, { 'acomodacoes 200': (r) => r.status === 200 });
  errosApp.add(!ok);

  if (ok) {
    let itens;
    try {
      itens = res.json();
    } catch {
      itens = [];
    }
    const slug = Array.isArray(itens) && itens.length && itens[0].slug;
    if (slug) {
      const det = http.get(`${BASE_URL}/api/v1/publico/acomodacoes/${slug}`, {
        tags: { endpoint: 'detalhe' },
      });
      errosApp.add(!check(det, { 'detalhe 200': (r) => r.status === 200 }));
    }
  }
  sleep(0.3 + Math.random() * 0.7);
}

let slugReserva = null;

export function reserva() {

  // slug da 1ª acomodação pública — cache por VU (endpoint exige acomodação)
  if (!slugReserva) {
    const r = http.get(`${BASE_URL}/api/v1/publico/acomodacoes`, JSON_HEADERS);
    const itens = r.json();
    slugReserva = Array.isArray(itens) && itens.length ? itens[0].slug : null;
    if (!slugReserva) {
      errosApp.add(1);
      return;
    }
  }

  const dia = 1 + Math.floor(Math.random() * 350);
  const checkIn = new Date(Date.now() + dia * 864e5).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + (dia + 2) * 864e5).toISOString().slice(0, 10);

  const res = http.post(
    `${BASE_URL}/api/v1/publico/reservas`,
    JSON.stringify({
      slug: slugReserva,
      nome: `Load Test ${__VU}`,
      email: `loadtest+${__VU}-${__ITER}@example.invalid`,
      telefone: `1190000${String(__VU).padStart(4, '0')}`,
      check_in: checkIn,
      check_out: checkOut,
      hospedes: 2,
      aceito_termos: true, // obrigatório — CDC (sem ele valida 422)
      observacoes: 'gerado por k6 — pode excluir',
    }),
    { ...JSON_HEADERS, tags: { endpoint: 'reserva' } },
  );

  check(res, {
    'reserva 201 criada': (r) => r.status === 201 && r.json('status') === 'reserva_criada',
    'ou 201 consulta': (r) => r.status === 201 && r.json('status') === 'consulta_registrada',
    'ou 429 limite': (r) => r.status === 429,
  });
  errosApp.add(res.status >= 500 || (res.status !== 201 && res.status !== 429));
}

export function sse() {
  const res = http.get(`${BASE_URL}/api/v1/publico/stream`, {
    timeout: '35s',
    tags: { endpoint: 'sse' },
  });
  check(res, {
    'sse 200 ou encerrado': (r) => r.status === 200 || r.status === 0,
  });
  sleep(1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const fail = data.metrics.http_req_failed.values.rate;
  console.log(
    `\n=== RESUMO ===\np95: ${p95.toFixed(0)} ms | falhas: ${(fail * 100).toFixed(2)}%\n` +
      `Compare clarituz_db_pool_idle nas réplicas durante o platô —\n` +
      `idle sustentado em 0 indica saturação do pool (hora de +1 réplica\n` +
      `ou de ajustar DB_MAX_CONNECTIONS).\n`,
  );
  return {};
}
