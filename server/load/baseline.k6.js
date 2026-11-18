// Baseline de performance da API — cenário leve (≈17 VUs, ~50 s) para
// localhost. Complementa reservas.k6.js (que mede saturação/scale-out);
// aqui o objetivo é a linha de base dos endpoints quentes: catálogo,
// reserva (site pública e admin), check-in e check-out.
//
// Pré-requisitos (ver docs/load-baseline.md):
//   1. Postgres local + migrations aplicadas
//   2. server/load/seed-baseline.sql aplicado (cliente + 4 suítes publicadas)
//   3. Admin criado: clarituz-api create-admin --login admin --senha <senha>
//   4. API no ar (default http://localhost:3000)
//
// Rodar:
//   k6 run -e BASE_URL=http://localhost:3000 \
//          -e ADMIN_LOGIN=admin -e ADMIN_SENHA=<senha> \
//          -e IDCLIENTE=<id do cliente seed> \
//          server/load/baseline.k6.js
//
// NUNCA apontar BASE_URL para produção — este script escreve de verdade.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const LOGIN = __ENV.ADMIN_LOGIN || 'admin';
const SENHA = __ENV.ADMIN_SENHA || 'admin';
const IDCLIENTE = Number(__ENV.IDCLIENTE || '1');
const IDFORMA = Number(__ENV.IDFORMA_PAGAMENTO || '1');

const errosApp = new Rate('erros_app');
const conflitosReserva = new Rate('conflitos_reserva'); // 409 overlap — esperado sob concorrência
const conflitosSite = new Rate('conflitos_site'); // 409 — cpf sintético colide (~68s) ou overlap
const durCatalogo = new Trend('duracao_catalogo_ms', true);
const durDetalhe = new Trend('duracao_detalhe_ms', true);
const durReservaSite = new Trend('duracao_reserva_site_ms', true);
const durReservaAdmin = new Trend('duracao_reserva_admin_ms', true);
const durCheckin = new Trend('duracao_checkin_ms', true);
const durCheckout = new Trend('duracao_checkout_ms', true);

export const options = {
  scenarios: {
    // Leitura pública — o tráfego dominante do site.
    browse: {
      executor: 'constant-vus',
      exec: 'browse',
      vus: 10,
      duration: '50s',
    },
    // Ciclo completo da recepção: reserva → check-in → check-out.
    // Mede o caminho de escrita real (transações + eventos + log).
    ciclo_admin: {
      executor: 'constant-vus',
      exec: 'cicloAdmin',
      vus: 5,
      duration: '50s',
    },
    // Reserva do site — sem auth, limitada a 8 req/min/IP pelo
    // IpRateLimit; 6/min mede o caminho feliz sem bater no limiter.
    reserva_site: {
      executor: 'constant-arrival-rate',
      exec: 'reservaSite',
      rate: 6,
      timeUnit: '1m',
      duration: '50s',
      preAllocatedVUs: 2,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    duracao_catalogo_ms: ['p(95)<500'],
    duracao_checkout_ms: ['p(95)<800'],
    erros_app: ['rate<0.01'],
  },
};

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  const login = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ login: LOGIN, senha: SENHA }),
    JSON_HEADERS,
  );
  if (login.status !== 200) {
    throw new Error(
      `login falhou (${login.status}) — criou o admin? ` +
        `clarituz-api create-admin --login ${LOGIN} --nome Admin --senha <senha>`,
    );
  }
  const token = login.json('access_token');

  const cat = http.get(`${BASE_URL}/api/v1/publico/acomodacoes`);
  const acoms = (cat.status === 200 ? cat.json() : [])
    .map((a) => ({ id: a.id, slug: a.slug })) // `id` público = acomodacao.id
    .filter((a) => a.id && a.slug);
  if (!acoms.length) {
    throw new Error(
      'catálogo público vazio — rode server/load/seed-baseline.sql ' +
        '(acomodacao + acomodacao_cms publicado).',
    );
  }
  return { token, acoms };
}

function auth(token) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}

function datasAleatorias() {
  const dia = 250 + Math.floor(Math.random() * 350);
  const entrada = new Date(Date.now() + dia * 864e5).toISOString().slice(0, 10);
  const saida = new Date(Date.now() + (dia + 2) * 864e5).toISOString().slice(0, 10);
  return { entrada, saida };
}

export function browse(data) {
  const res = http.get(`${BASE_URL}/api/v1/publico/acomodacoes`, {
    tags: { endpoint: 'catalogo' },
  });
  durCatalogo.add(res.timings.duration);
  errosApp.add(!check(res, { 'catalogo 200': (r) => r.status === 200 }));

  const a = data.acoms[Math.floor(Math.random() * data.acoms.length)];
  const det = http.get(`${BASE_URL}/api/v1/publico/acomodacoes/${a.slug}`, {
    tags: { endpoint: 'detalhe' },
  });
  durDetalhe.add(det.timings.duration);
  errosApp.add(!check(det, { 'detalhe 200': (r) => r.status === 200 }));

  sleep(0.2 + Math.random() * 0.3);
}

export function cicloAdmin(data) {
  const a = data.acoms[Math.floor(Math.random() * data.acoms.length)];
  const { entrada, saida } = datasAleatorias();
  const headers = auth(data.token);

  const cri = http.post(
    `${BASE_URL}/api/v1/reservas`,
    JSON.stringify({
      idacomodacao: a.id,
      idcliente: IDCLIENTE,
      quantidade_hospedes: 2,
      entradaprevista: entrada,
      saidaprevista: saida,
      obs: 'baseline k6 — pode excluir',
    }),
    { ...headers, tags: { endpoint: 'reserva_admin' } },
  );
  durReservaAdmin.add(cri.timings.duration);
  conflitosReserva.add(cri.status === 409);
  const criou = check(cri, { 'reserva 201 ou 409': (r) => r.status === 201 || r.status === 409 });
  errosApp.add(!criou);
  if (cri.status !== 201) {
    return; // overlap de período — nada a fazer check-in/out
  }
  const id = cri.json('id');

  const cin = http.post(`${BASE_URL}/api/v1/reservas/${id}/check-in`, '{}', {
    ...headers,
    tags: { endpoint: 'checkin' },
  });
  durCheckin.add(cin.timings.duration);
  errosApp.add(!check(cin, { 'checkin 200': (r) => r.status === 200 }));
  if (cin.status !== 200) {
    return;
  }

  const cout = http.post(
    `${BASE_URL}/api/v1/reservas/${id}/check-out`,
    JSON.stringify({ idforma_pagamento: IDFORMA }),
    { ...headers, tags: { endpoint: 'checkout' } },
  );
  durCheckout.add(cout.timings.duration);
  errosApp.add(!check(cout, { 'checkout 200': (r) => r.status === 200 }));
}

export function reservaSite(data) {
  const a = data.acoms[Math.floor(Math.random() * data.acoms.length)];
  const { entrada, saida } = datasAleatorias();

  const res = http.post(
    `${BASE_URL}/api/v1/publico/reservas`,
    JSON.stringify({
      slug: a.slug,
      nome: `Load Baseline ${__VU}`,
      email: `loadbaseline+${__VU}-${__ITER}@example.invalid`,
      telefone: `1190000${String(__VU).padStart(4, '0')}`,
      check_in: entrada,
      check_out: saida,
      hospedes: 2,
      aceito_termos: true, // obrigatório — CDC (sem ele o endpoint valida 422)
      observacoes: 'baseline k6 — pode excluir',
    }),
    { ...JSON_HEADERS, tags: { endpoint: 'reserva_site' } },
  );
  durReservaSite.add(res.timings.duration);
  check(res, {
    'reserva site 201': (r) => r.status === 201,
    'ou 429/409 esperado': (r) => r.status === 429 || r.status === 409,
  });
  // 409: período ocupado devolve 201 'consulta_registrada' — o 409 observado
  // vem do cpf sintético SITE-{tel}-{6hex} que só muda a cada ~68 s
  // (mesma origem + e-mail novo dentro da janela → 23505).
  conflitosSite.add(res.status === 409);
  errosApp.add(res.status >= 500 || ![201, 429, 409].includes(res.status));
}

export function handleSummary(data) {
  const m = data.metrics;
  const pct = (name, p) => {
    if (!m[name]) return '-';
    // Trend guarda 'med' (p50) e 'p(90)'/'p(95)'/'p(99)' — não 'p(50)'.
    const key = p === 50 ? 'med' : `p(${p})`;
    const v = m[name].values[key];
    return v == null ? '-' : v.toFixed(1);
  };
  console.log(
    `\n=== BASELINE ===\n` +
      `catálogo    p50=${pct('duracao_catalogo_ms', 50)} p95=${pct('duracao_catalogo_ms', 95)} p99=${pct('duracao_catalogo_ms', 99)} ms\n` +
      `detalhe     p50=${pct('duracao_detalhe_ms', 50)} p95=${pct('duracao_detalhe_ms', 95)} p99=${pct('duracao_detalhe_ms', 99)} ms\n` +
      `reserva ADM p50=${pct('duracao_reserva_admin_ms', 50)} p95=${pct('duracao_reserva_admin_ms', 95)} p99=${pct('duracao_reserva_admin_ms', 99)} ms\n` +
      `check-in    p50=${pct('duracao_checkin_ms', 50)} p95=${pct('duracao_checkin_ms', 95)} p99=${pct('duracao_checkin_ms', 99)} ms\n` +
      `check-out   p50=${pct('duracao_checkout_ms', 50)} p95=${pct('duracao_checkout_ms', 95)} p99=${pct('duracao_checkout_ms', 99)} ms\n` +
      `reserva web p50=${pct('duracao_reserva_site_ms', 50)} p95=${pct('duracao_reserva_site_ms', 95)} p99=${pct('duracao_reserva_site_ms', 99)} ms\n`,
  );
  return {};
}
