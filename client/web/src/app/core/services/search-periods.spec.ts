// Espelha os testes de `reserva_busca.rs` — a prévia da UI e a geração
// server-side precisam concordar exatamente.

import {
  addCalendarMonth,
  addDays,
  compareDates,
  daysInMonth,
  diffDays,
  formatDate,
  gerarCandidatos,
  isLeapYear,
  parseDate,
  todayCivil,
  validarHospedes,
  weekday,
} from './search-periods';

const d = (s: string) => parseDate(s)!;

describe('search-periods — datas civis', () => {
  it('parseDate valida formato e dias do mês', () => {
    expect(parseDate('2027-02-28')).toEqual({ y: 2027, m: 2, d: 28 });
    expect(parseDate('2027-02-30')).toBeNull();
    expect(parseDate('2027-13-01')).toBeNull();
    expect(parseDate('15/02/2027')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('aritmética cruza meses, anos e bissextos sem relógio', () => {
    expect(formatDate(addDays(d('2027-01-31'), 1))).toBe('2027-02-01');
    expect(formatDate(addDays(d('2027-12-31'), 1))).toBe('2028-01-01');
    expect(formatDate(addDays(d('2028-02-28'), 1))).toBe('2028-02-29'); // bissexto
    expect(formatDate(addDays(d('2027-02-28'), 1))).toBe('2027-03-01'); // comum
    expect(diffDays(d('2027-03-01'), d('2027-02-25'))).toBe(4);
  });

  it('weekday e isLeapYear batem com o calendário real', () => {
    expect(weekday(d('2027-01-01'))).toBe(5); // sexta
    expect(weekday(d('2027-01-03'))).toBe(0); // domingo
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
  });

  it('addCalendarMonth ajusta ao último dia válido do mês seguinte', () => {
    expect(addCalendarMonth(d('2027-01-31'))).toEqual(d('2027-02-28'));
    expect(addCalendarMonth(d('2028-01-31'))).toEqual(d('2028-02-29')); // bissexto
    expect(addCalendarMonth(d('2027-01-15'))).toEqual(d('2027-02-15'));
    expect(addCalendarMonth(d('2027-12-31'))).toEqual(d('2028-01-31'));
  });
});

describe('search-periods — modo dates (tolerância)', () => {
  const hoje = d('2026-11-01');
  const horizonte = d('2027-11-01');

  it('tolerância 0 gera um único período exato', () => {
    const r = gerarCandidatos(
      { mode: 'dates', checkIn: '2026-12-10', checkOut: '2026-12-13', toleranceDays: 0 },
      hoje,
      horizonte,
    );
    expect(r.ok && r.value.length).toBe(1);
    if (r.ok) {
      expect(r.value[0].deslocamento).toBe(0);
      expect(formatDate(r.value[0].inicio)).toBe('2026-12-10');
    }
  });

  it('±2 gera 5 períodos preservando noites, exata primeiro', () => {
    const r = gerarCandidatos(
      { mode: 'dates', checkIn: '2026-12-10', checkOut: '2026-12-13', toleranceDays: 2 },
      hoje,
      horizonte,
    );
    expect(r.ok && r.value.length).toBe(5);
    if (r.ok) {
      for (const c of r.value) expect(diffDays(c.fim, c.inicio)).toBe(3);
      expect(r.value[0].deslocamento).toBe(0);
      const deslocamentos = r.value.map((c) => Math.abs(c.deslocamento!));
      expect(deslocamentos).toEqual([0, 1, 1, 2, 2]);
    }
  });

  it('±14 gera no máximo 29 e descarta entradas no passado', () => {
    const r = gerarCandidatos(
      { mode: 'dates', checkIn: '2026-12-10', checkOut: '2026-12-13', toleranceDays: 14 },
      hoje,
      horizonte,
    );
    expect(r.ok && r.value.length).toBe(29);

    const r2 = gerarCandidatos(
      { mode: 'dates', checkIn: '2026-12-10', checkOut: '2026-12-13', toleranceDays: 14 },
      d('2026-12-10'), // hoje no meio da janela
      horizonte,
    );
    expect(r2.ok && r2.value.length).toBeLessThan(29);
    if (r2.ok) {
      expect(r2.value.every((c) => compareDates(c.inicio, d('2026-12-10')) >= 0)).toBe(true);
    }
  });

  it('rejeita tolerância fora da lista e saída não posterior', () => {
    expect(
      gerarCandidatos(
        { mode: 'dates', checkIn: '2026-12-10', checkOut: '2026-12-13', toleranceDays: 5 as never },
        hoje,
        horizonte,
      ).ok,
    ).toBe(false);
    expect(
      gerarCandidatos(
        { mode: 'dates', checkIn: '2026-12-13', checkOut: '2026-12-10', toleranceDays: 0 },
        hoje,
        horizonte,
      ).ok,
    ).toBe(false);
    expect(
      gerarCandidatos(
        { mode: 'dates', checkIn: '2026-12-10', checkOut: '2026-12-10', toleranceDays: 0 },
        hoje,
        horizonte,
      ).ok,
    ).toBe(false);
  });

  it('rejeita datas malformadas', () => {
    expect(
      gerarCandidatos(
        { mode: 'dates', checkIn: 'abc', checkOut: '2026-12-13', toleranceDays: 0 },
        hoje,
        horizonte,
      ).ok,
    ).toBe(false);
  });
});

describe('search-periods — modo flexível', () => {
  const hoje = d('2026-11-17');
  const horizonte = d('2027-11-17');

  it('weekend gera só sextas com 2 noites', () => {
    const r = gerarCandidatos(
      { mode: 'flexible', stayPreset: 'weekend', months: ['2027-01'] },
      hoje,
      horizonte,
    );
    expect(r.ok && r.value.length).toBeGreaterThan(0);
    if (r.ok) {
      for (const c of r.value) {
        expect(weekday(c.inicio)).toBe(5);
        expect(diffDays(c.fim, c.inicio)).toBe(2);
      }
    }
  });

  it('week gera uma entrada por dia com 7 noites', () => {
    const r = gerarCandidatos(
      { mode: 'flexible', stayPreset: 'week', months: ['2027-01'] },
      hoje,
      horizonte,
    );
    expect(r.ok && r.value.length).toBe(31);
    if (r.ok) {
      for (const c of r.value) expect(diffDays(c.fim, c.inicio)).toBe(7);
    }
  });

  it('month usa mês calendário com ajuste de fim de mês', () => {
    const r = gerarCandidatos(
      { mode: 'flexible', stayPreset: 'month', months: ['2027-01'] },
      hoje,
      horizonte,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const jan31 = r.value.find((c) => formatDate(c.inicio) === '2027-01-31');
      expect(jan31 && formatDate(jan31.fim)).toBe('2027-02-28');
    }
  });

  it('meses duplicados não duplicam e a ordem é cronológica', () => {
    const r1 = gerarCandidatos(
      { mode: 'flexible', stayPreset: 'weekend', months: ['2027-01', '2027-01'] },
      hoje,
      horizonte,
    );
    const r2 = gerarCandidatos(
      { mode: 'flexible', stayPreset: 'weekend', months: ['2027-02', '2027-01'] },
      hoje,
      horizonte,
    );
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r2.value.length).toBeGreaterThan(r1.value.length);
      for (let i = 1; i < r2.value.length; i++) {
        expect(compareDates(r2.value[i - 1].inicio, r2.value[i].inicio)).toBeLessThan(0);
      }
    }
  });

  it('mês passado, mês inválido e lista vazia são rejeitados', () => {
    expect(gerarCandidatos({ mode: 'flexible', stayPreset: 'week', months: ['2026-10'] }, hoje, horizonte).ok).toBe(false);
    expect(gerarCandidatos({ mode: 'flexible', stayPreset: 'week', months: ['2027-13'] }, hoje, horizonte).ok).toBe(false);
    expect(gerarCandidatos({ mode: 'flexible', stayPreset: 'week', months: ['abc'] }, hoje, horizonte).ok).toBe(false);
    expect(gerarCandidatos({ mode: 'flexible', stayPreset: 'week', months: [] }, hoje, horizonte).ok).toBe(false);
  });

  it('mês além do horizonte é rejeitado', () => {
    expect(
      gerarCandidatos({ mode: 'flexible', stayPreset: 'week', months: ['2027-12'] }, hoje, horizonte).ok,
    ).toBe(false);
  });

  it('acima do teto de candidatos a busca é rejeitada com mensagem clara', () => {
    // 12 meses × ~31 entradas/dia no preset week estoura MAX_CANDIDATOS.
    const meses = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`);
    const r = gerarCandidatos({ mode: 'flexible', stayPreset: 'week', months: meses }, d('2027-01-01'), d('2027-12-15'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain('períodos');
  });
});

describe('search-periods — hóspedes', () => {
  it('exige ao menos um adulto e rejeita negativos', () => {
    expect(validarHospedes({ adults: 0, children: 0, infants: 0, pets: 0 }).ok).toBe(false);
    expect(validarHospedes({ adults: 1, children: -1, infants: 0, pets: 0 }).ok).toBe(false);
  });

  it('bebês contam na capacidade, pets não; teto de 20 pessoas', () => {
    expect(validarHospedes({ adults: 2, children: 1, infants: 1, pets: 2 })).toEqual({ ok: true, value: 4 });
    expect(validarHospedes({ adults: 19, children: 0, infants: 2, pets: 0 }).ok).toBe(false);
  });
});

describe('search-periods — todayCivil', () => {
  it('extrai data civil local do relógio', () => {
    const agora = new Date(2027, 1, 15); // 15 fev 2027, hora local
    expect(todayCivil(agora)).toEqual({ y: 2027, m: 2, d: 15 });
  });
});
