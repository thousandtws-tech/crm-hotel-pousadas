import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  GuestsDraft,
  SearchMode,
  SearchQuery,
  SearchResponse,
  StayPreset,
  ToleranceDays,
} from '../models/search.models';
import { AvailabilityService } from './availability.service';
import {
  addCalendarMonths,
  CivilDate,
  HORIZONTE_MESES,
  gerarCandidatos,
  hojeHotel,
  validarHospedes,
} from './search-periods';

/**
 * Estado do motor de busca.
 *
 * `draft*` = o que está sendo editado na barra de pesquisa.
 * `appliedQuery` + `result` = a última consulta efetivamente enviada —
 * a página /buscar renderiza só o applied, nunca o rascunho.
 * Corrida: cada `submit()` incrementa `reqSeq`; respostas fora de ordem
 * são descartadas (a UI nunca mostra resultado de consulta antiga).
 */
@Injectable({ providedIn: 'root' })
export class SearchStateService {
  private readonly availability = inject(AvailabilityService);
  private reqSeq = 0;

  // --- rascunho editável ---
  public readonly mode = signal<SearchMode>('dates');
  public readonly checkIn = signal<string>('');
  public readonly checkOut = signal<string>('');
  public readonly tolerance = signal<ToleranceDays>(0);
  public readonly stayPreset = signal<StayPreset>('weekend');
  public readonly months = signal<string[]>([]);
  public readonly guests = signal<GuestsDraft>({ adults: 2, children: 0, infants: 0, pets: 0 });
  public readonly acomodacaoSlug = signal<string>('');

  // --- estado aplicado ---
  public readonly appliedQuery = signal<SearchQuery | null>(null);
  public readonly result = signal<SearchResponse | null>(null);
  public readonly loading = signal(false);
  public readonly erro = signal<string | null>(null);
  /** Parâmetros da última busca aplicada — p/ saber se o rascunho mudou. */
  private readonly appliedParamsJson = signal<string | null>(null);

  public readonly hoje = computed<CivilDate>(() => hojeHotel(new Date()));
  public readonly horizonte = computed<CivilDate>(() => addCalendarMonths(this.hoje(), HORIZONTE_MESES));

  /** Erro de validação local da consulta em rascunho (mesma política do servidor). */
  public readonly validacaoRascunho = computed<string | null>(() => {
    const g = validarHospedes(this.guests());
    if (!g.ok) return g.erro;
    const r = gerarCandidatos(this.dateQueryRascunho(), this.hoje(), this.horizonte());
    return r.ok ? null : r.erro;
  });

  /** Quantos períodos a consulta atual vai gerar (prévia honesta). */
  public readonly previaPeriodos = computed<number | null>(() => {
    const r = gerarCandidatos(this.dateQueryRascunho(), this.hoje(), this.horizonte());
    return r.ok ? r.value.length : null;
  });

  /**
   * Prévia visível sob a barra: some quando o rascunho é idêntico à
   * busca já aplicada — não faz sentido "vai consultar N períodos"
   * embaixo dos resultados desses mesmos períodos.
   */
  public readonly previaVisivel = computed<number | null>(() => {
    const n = this.previaPeriodos();
    if (n === null) return null;
    const aplicada = this.appliedParamsJson();
    if (aplicada !== null && this.result() !== null && JSON.stringify(this.parametrosUrl()) === aplicada) {
      return null;
    }
    return n;
  });

  public readonly prontoParaBuscar = computed(() => this.validacaoRascunho() === null);

  /**
   * Erro visível sob a barra: só aparece depois que o usuário tocou no
   * rascunho — uma barra intocada não pode estar "errada".
   */
  public readonly validacaoVisivel = computed<string | null>(() => {
    const err = this.validacaoRascunho();
    if (!err) return null;
    // Erros de hóspedes só ocorrem após edição (padrão já é válido).
    if (!validarHospedes(this.guests()).ok) return err;
    const tocou = this.mode() === 'dates'
      ? Boolean(this.checkIn() || this.checkOut())
      : this.months().length > 0;
    return tocou ? err : null;
  });

  private dateQueryRascunho(): SearchQuery['date'] {
    return this.mode() === 'dates'
      ? { mode: 'dates', checkIn: this.checkIn(), checkOut: this.checkOut(), toleranceDays: this.tolerance() }
      : { mode: 'flexible', stayPreset: this.stayPreset(), months: this.months() };
  }

  public toggleMonth(chave: string): void {
    this.months.update((atual) =>
      atual.includes(chave) ? atual.filter((m) => m !== chave) : [...atual, chave].sort(),
    );
  }

  /**
   * Serializa o rascunho para query params (share/refresh na /buscar).
   * Nunca inclui dados pessoais — só critérios da busca.
   */
  public parametrosUrl(): Record<string, string | number | undefined> {
    const g = this.guests();
    const query: Record<string, string | number | undefined> =
      this.mode() === 'dates'
        ? {
            modo: 'dates',
            in: this.checkIn() || undefined,
            out: this.checkOut() || undefined,
            tol: this.tolerance() || undefined,
          }
        : { modo: 'flexible', preset: this.stayPreset(), meses: this.months().join(',') || undefined };
    query['a'] = g.adults;
    query['c'] = g.children || undefined;
    query['i'] = g.infants || undefined;
    query['p'] = g.pets || undefined;
    query['suite'] = this.acomodacaoSlug() || undefined;
    return query;
  }

  /** Envia a consulta em rascunho. Devolve false se a validação local falhar. */
  public async submit(): Promise<boolean> {
    const hospedes = validarHospedes(this.guests());
    if (!hospedes.ok) {
      this.erro.set(hospedes.erro);
      return false;
    }
    const date = this.dateQueryRascunho();
    const query: SearchQuery = {
      date,
      guests: { ...this.guests() },
      ...(this.acomodacaoSlug() ? { acomodacaoSlug: this.acomodacaoSlug() } : {}),
    };

    const seq = ++this.reqSeq;
    this.loading.set(true);
    this.erro.set(null);
    try {
      const resp = await this.availability.buscar(query);
      if (seq !== this.reqSeq) return true; // consulta mais nova em andamento
      this.appliedQuery.set(query);
      this.appliedParamsJson.set(JSON.stringify(this.parametrosUrl()));
      this.result.set(resp);
      return true;
    } catch (e) {
      if (seq !== this.reqSeq) return true;
      this.erro.set(extrairErro(e));
      this.result.set(null);
      return true; // navega mesmo assim — a página mostra o erro
    } finally {
      if (seq === this.reqSeq) this.loading.set(false);
    }
  }
}

function extrairErro(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const msg = (e.error as { erro?: { mensagem?: string }; mensagem?: string })?.erro?.mensagem
      ?? (e.error as { mensagem?: string })?.mensagem;
    if (msg) return msg;
    if (e.status === 0) return 'Falha de conexão — verifique sua internet e tente novamente.';
    if (e.status === 429) return 'Muitas buscas seguidas — aguarde um instante e tente novamente.';
    return 'Não foi possível concluir a busca agora — tente novamente.';
  }
  return 'Erro inesperado ao pesquisar — tente novamente.';
}
