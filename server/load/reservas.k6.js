// Load test da API Clarituz — prova o scale-out e encontra o ponto de
// saturação (pool do Postgres é o gargalo esperado).
//
// Cenários concorrentes:
//   browse  — rampa de VUs lendo o catálogo público (read-heavy)
//   reserva — writes reais a taxa constante (só com WRITE=1, ver aviso)
//   sse     — VUs segurando /publico/stream (cada um = 1 conexão aberta)
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 server/load/reservas.k6.js
//   k6 run -e BASE_URL=https://<staging> -e WRITE=1 server/load/reservas.k6.js
//
// ATENÇÃO: WRITE=1 cria reservas 'p' e clientes de verdade — use só em
// staging ou aceite limpar depois. Sem WRITE, o teste é 100% read-only.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WRITE = __ENV.WRITE === '1';

// erros_app conta falhas de aplicação (5xx, corpo inválido); 429 do
// IpRateLimit é comportamento esperado e entra só em http_req_failed.
const errosApp = new Rate('erros_app');
const duracaoCatalogo = new Trend('duracao_catalogo_ms', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 150 }, // warm-up
        { duration: '2m', target: 800 }, // rampa até o platô
        { duration: '2m', target: 800 }, // platô — observa p95 e pool idle
        { duration: '1m', target: 0 },
      ],
    },
    ...(WRITE
      ? {
          reserva: {
            executor: 'constant-arrival-rate',
            exec: 'reserva',
            // 6/min fica abaixo do IpRateLimit (8/min/IP) de origem única;
            // em k6 Cloud (multi-IP) pode subir — aí 429 vira dado válido.
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
      vus: 200, // cada VU = 1 conexão SSE aberta na réplica
      duration: '6m',
    },
  },
  thresholds: {
    // Critério de aprovação do scale-out:
    //   p95 do catálogo abaixo de 500 ms e < 1% de erros de aplicação.
    http_req_duration: ['p(95)<800'],
    duracao_catalogo_ms: ['p(95)<500'],
    erros_app: ['rate<0.01'],
    http_req_failed: ['rate<0.05'], // margem para 429s legítimos do limiter
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
  sleep(0.3 + Math.random() * 0.7); // think time realista
}

export function reserva() {
  // Datas aleatórias em até ~1 ano: mistura reservas criadas e conflitos
  // ("consulta_registrada") — os dois caminhos devem responder 201.
  const dia = 1 + Math.floor(Math.random() * 350);
  const checkIn = new Date(Date.now() + dia * 864e5).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + (dia + 2) * 864e5).toISOString().slice(0, 10);

  const res = http.post(
    `${BASE_URL}/api/v1/publico/reservas`,
    JSON.stringify({
      nome: `Load Test ${__VU}`,
      email: `loadtest+${__VU}-${__ITER}@example.invalid`,
      telefone: `1190000${String(__VU).padStart(4, '0')}`,
      check_in: checkIn,
      check_out: checkOut,
      hospedes: 2,
      observacoes: 'gerado por k6 — pode excluir',
    }),
    { ...JSON_HEADERS, tags: { endpoint: 'reserva' } },
  );

  check(res, {
    'reserva 201 criada': (r) => r.status === 201 && r.json('status') === 'reserva_criada',
    'ou 201 consulta': (r) => r.status === 201 && r.json('status') === 'consulta_registrada',
    'ou 429 limite': (r) => r.status === 429,
  });
  // 5xx ou corpo inválido é falha real; 429 é o limiter trabalhando.
  errosApp.add(res.status >= 500 || (res.status !== 201 && res.status !== 429));
}

export function sse() {
  // Segura a conexão ~30 s; o servidor vê disconnect no timeout do cliente.
  // Cada VU = 1 assinante no bus da réplica (gauge clarituz_sse_subscribers).
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
