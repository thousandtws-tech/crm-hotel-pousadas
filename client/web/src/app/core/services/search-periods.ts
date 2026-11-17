// Motor de busca — lógica pura de datas civis e geração de períodos
// candidatos. Espelha `reserva_busca.rs` (backend): o servidor REGERA e
// revalida tudo, mas a prévia da UI usa exatamente as mesmas regras para
// mostrar contagens/erros antes de enviar.
//
// Datas civis são {y,m,d} com aritmética por dias-desde-epoch — nenhum
// `new Date` no caminho (evita armadilha de fuso horário em "YYYY-MM-DD").

import { DateQuery, GuestQuery, StayPreset, ToleranceDays } from '../models/search.models';

export interface CivilDate {
  y: number;
  m: number; // 1–12
  d: number; // 1–31
}

export interface Candidate {
  inicio: CivilDate;
  fim: CivilDate;
  /** Só modo `dates` — deslocamento em dias em relação ao intervalo-base. */
  deslocamento?: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; erro: string };

export const HORIZONTE_MESES = 12;
export const MAX_MESES_SELECIONADOS = 12;
export const MAX_CANDIDATOS = 120;
export const MAX_PESSOAS = 20;
export const TOLERANCIAS: readonly ToleranceDays[] = [0, 1, 2, 3, 7, 14];

// ---------------------------------------------------------------------------
// Datas civis
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function parseDate(s: string): CivilDate | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const c = { y: +m[1], m: +m[2], d: +m[3] };
  if (c.m < 1 || c.m > 12 || c.d < 1 || c.d > daysInMonth(c.y, c.m)) return null;
  return c;
}

export function formatDate(c: CivilDate): string {
  const mm = String(c.m).padStart(2, '0');
  const dd = String(c.d).padStart(2, '0');
  return `${c.y}-${mm}-${dd}`;
}

/** Algoritmo civil_from_days (Howard Hinnant) — aritmética sem relógio. */
function toDays(c: CivilDate): number {
  const y = c.m <= 2 ? c.y - 1 : c.y;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (c.m > 2 ? c.m - 3 : c.m + 9) + 2) / 5) + c.d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDays(z: number): CivilDate {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  // Ano civil = ano da era março-base + 1 quando o mês é jan/fev (mp ≥ 10).
  return { y: mp < 10 ? y : y + 1, m: mp < 10 ? mp + 3 : mp - 9, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}

export function addDays(c: CivilDate, n: number): CivilDate {
  return fromDays(toDays(c) + n);
}

export function diffDays(a: CivilDate, b: CivilDate): number {
  return toDays(a) - toDays(b);
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return toDays(a) - toDays(b);
}

/** 0 = domingo … 6 = sábado (igual a `Date#getDay`). */
export function weekday(c: CivilDate): number {
  return (((toDays(c) + 4) % 7) + 7) % 7; // 1970-01-01 era quinta (4)
}

export function endOfMonth(c: CivilDate): CivilDate {
  return { y: c.y, m: c.m, d: daysInMonth(c.y, c.m) };
}

/** `n` meses calendário a partir de `c` — ajusta ao último dia válido. */
export function addCalendarMonths(c: CivilDate, n: number): CivilDate {
  const total = (c.y * 12 + (c.m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm, d: Math.min(c.d, daysInMonth(ny, nm)) };
}

/** Um mês calendário a partir de `c` — 31/01 → 28/02 (29 em bissexto). */
export function addCalendarMonth(c: CivilDate): CivilDate {
  return addCalendarMonths(c, 1);
}

export function todayCivil(now: Date): CivilDate {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/**
 * "Hoje" civil no fuso do hotel (`America/Sao_Paulo`) — a política de
 * passado/horizonte da pousada segue o relógio dela, não o do visitante.
 */
const HOTEL_TZ_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function hojeHotel(now: Date): CivilDate {
  const partes = HOTEL_TZ_FORMATTER.formatToParts(now);
  const get = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// ---------------------------------------------------------------------------
// Validação de hóspedes (mesma política do backend)
// ---------------------------------------------------------------------------

export function validarHospedes(g: GuestQuery): Result<number> {
  if (g.adults < 1) return { ok: false, erro: 'Informe ao menos um adulto para pesquisar.' };
  for (const [n, rotulo] of [
    [g.adults, 'adultos'],
    [g.children, 'crianças'],
    [g.infants, 'bebês'],
    [g.pets, 'animais'],
  ] as const) {
    if (n < 0) return { ok: false, erro: `Quantidade de ${rotulo} não pode ser negativa.` };
  }
  const pessoas = g.adults + g.children + g.infants; // bebês contam na capacidade
  if (pessoas > MAX_PESSOAS) {
    return { ok: false, erro: `Máximo de ${MAX_PESSOAS} hóspedes por busca — para grupos maiores fale com a recepção.` };
  }
  return { ok: true, value: pessoas };
}

// ---------------------------------------------------------------------------
// Geração de candidatos (mesma política do backend)
// ---------------------------------------------------------------------------

export function gerarCandidatos(date: DateQuery, hoje: CivilDate, horizonte: CivilDate): Result<Candidate[]> {
  const r =
    date.mode === 'dates'
      ? gerarComTolerancia(parseDate(date.checkIn), parseDate(date.checkOut), date.toleranceDays, hoje, horizonte)
      : gerarFlexiveis(date.stayPreset, date.months, hoje, horizonte);
  if (!r.ok) return r;
  if (r.value.length === 0) {
    return { ok: false, erro: 'Nenhuma data elegível dentro do horizonte — ajuste datas ou meses.' };
  }
  if (r.value.length > MAX_CANDIDATOS) {
    return {
      ok: false,
      erro: `A busca gerou ${r.value.length} períodos (máximo ${MAX_CANDIDATOS}) — reduza os meses selecionados ou a margem de dias.`,
    };
  }
  return r;
}

/** Desloca a viagem inteira -tol..=+tol preservando noites. Ordem: exata, depois |deslocamento|, entrada mais próxima. */
function gerarComTolerancia(
  entrada: CivilDate | null,
  saida: CivilDate | null,
  tolerancia: ToleranceDays,
  hoje: CivilDate,
  horizonte: CivilDate,
): Result<Candidate[]> {
  if (!entrada || !saida) return { ok: false, erro: 'Datas inválidas — confira entrada e saída.' };
  if (compareDates(saida, entrada) <= 0) {
    return { ok: false, erro: 'A data de saída precisa ser posterior à data de entrada.' };
  }
  if (!TOLERANCIAS.includes(tolerancia)) {
    return { ok: false, erro: 'Margem de dias inválida — use datas exatas, ±1, ±2, ±3, ±7 ou ±14.' };
  }

  const vistos = new Set<string>();
  const candidatos: Candidate[] = [];
  for (let d = -tolerancia; d <= tolerancia; d++) {
    const inicio = addDays(entrada, d);
    const fim = addDays(saida, d);
    if (compareDates(inicio, hoje) < 0 || compareDates(inicio, horizonte) > 0) continue;
    const chave = `${formatDate(inicio)}|${formatDate(fim)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    candidatos.push({ inicio, fim, deslocamento: d === 0 ? 0 : d }); // -0 → 0
  }
  candidatos.sort((a, b) => Math.abs(a.deslocamento ?? 0) - Math.abs(b.deslocamento ?? 0) || diffDays(a.inicio, b.inicio));
  return { ok: true, value: candidatos };
}

/** Mês selecionado gera entradas dia-a-dia (ou só sextas no `weekend`). */
function gerarFlexiveis(
  preset: StayPreset,
  months: string[],
  hoje: CivilDate,
  horizonte: CivilDate,
): Result<Candidate[]> {
  if (months.length === 0) {
    return { ok: false, erro: 'Selecione ao menos um mês para a busca flexível.' };
  }

  const meses = new Map<string, CivilDate>();
  for (const chave of months) {
    const m = MONTH_RE.exec(chave);
    const primeiro = m ? { y: +m[1], m: +m[2], d: 1 } : null;
    if (!primeiro || primeiro.m < 1 || primeiro.m > 12) {
      return { ok: false, erro: `Mês inválido: ${chave}.` };
    }
    if (compareDates(endOfMonth(primeiro), hoje) < 0) {
      return { ok: false, erro: 'Não é possível pesquisar meses já passados.' };
    }
    if (compareDates(primeiro, horizonte) > 0) {
      return { ok: false, erro: `Mês ${chave} está além do horizonte de ${HORIZONTE_MESES} meses.` };
    }
    meses.set(chave, primeiro);
  }
  if (meses.size > MAX_MESES_SELECIONADOS) {
    return { ok: false, erro: `Selecione no máximo ${MAX_MESES_SELECIONADOS} meses por busca.` };
  }

  const limiteFim = addDays(horizonte, 31);
  const vistos = new Set<string>();
  const candidatos: Candidate[] = [];
  const ordenados = [...meses.values()].sort(compareDates);
  for (const mes of ordenados) {
    let dia = mes;
    while (dia.m === mes.m) {
      const entrada = dia;
      dia = addDays(dia, 1);
      if (compareDates(entrada, hoje) < 0) continue;
      if (preset === 'weekend' && weekday(entrada) !== 5) continue;

      const fim =
        preset === 'weekend' ? addDays(entrada, 2) : preset === 'week' ? addDays(entrada, 7) : addCalendarMonth(entrada);
      if (compareDates(fim, limiteFim) > 0) continue;
      const chave = `${formatDate(entrada)}|${formatDate(fim)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      candidatos.push({ inicio: entrada, fim });
    }
  }
  return { ok: true, value: candidatos };
}
