import { Component, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { SearchStateService } from '../../core/services/search-state.service';
import { SearchBarComponent } from '../../shared/components/search/search-bar.component';
import { SearchAlternativa, SearchAcomodacao, SearchMode, StayPreset, ToleranceDays } from '../../core/models/search.models';
import { TOLERANCIAS, parseDate } from '../../core/services/search-periods';
import { SeoService } from '../../core/services/seo.service';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Página de resultados do motor de busca.
 *
 * A consulta é restaurada de parâmetros serializáveis da URL (refresh e
 * compartilhamento funcionam) e revalidada antes de ser enviada — a URL
 * nunca é autoridade. Cada alternativa leva SUAS datas reais para
 * `/reservar`, nunca as datas-base do rascunho.
 */
@Component({
  selector: 'app-search-page',
  imports: [SearchBarComponent, DatePipe],
  template: `
    <section class="pt-24 sm:pt-28 pb-2">
      <app-search-bar (buscar)="refazer()" />
    </section>

    <section class="max-w-5xl mx-auto px-4 sm:px-6 pb-16">
      @if (state.erro(); as msg) {
        <div class="mt-6 rounded-xl border border-[#E4C7C7] bg-[#FBF3F3] p-5" role="alert">
          <p class="text-sm font-medium text-[#9A3B3B]">{{ msg }}</p>
          <button
            type="button"
            class="mt-3 px-5 py-2 rounded-full bg-[#054054] text-white text-xs font-semibold hover:bg-[#0a5a73]"
            (click)="refazer()"
          >Tentar novamente</button>
        </div>
      } @else if (state.loading()) {
        <div class="mt-8 space-y-3" aria-busy="true" aria-label="Buscando disponibilidade">
          @for (i of [1, 2, 3]; track i) {
            <div class="h-24 rounded-xl bg-[#E8F0F2] animate-pulse"></div>
          }
          <p class="text-xs text-[#536B73] text-center pt-2">Consultando disponibilidade real…</p>
        </div>
      } @else if (state.result(); as r) {
        <div class="mt-6 flex items-baseline justify-between flex-wrap gap-2">
          <h1 class="text-lg font-semibold text-[#054054]">
            {{ r.com_disponibilidade === 0
              ? 'Nenhuma alternativa disponível'
              : r.com_disponibilidade + (r.com_disponibilidade === 1 ? ' período disponível' : ' períodos disponíveis') }}
          </h1>
          <span class="text-xs text-[#536B73]">{{ r.periodos }} {{ r.periodos === 1 ? 'período consultado' : 'períodos consultados' }}</span>
        </div>

        @if (r.aviso) {
          <p class="mt-2 text-xs text-[#536B73] italic">{{ r.aviso }}</p>
        }

        @if (r.com_disponibilidade === 0) {
          <div class="mt-6 rounded-xl border border-[#DCE6EA] bg-white p-8 text-center">
            <p class="text-sm text-[#054054] font-medium">Não encontramos vagas para essa seleção.</p>
            <p class="text-xs text-[#536B73] mt-1">
              Tente aumentar a margem de dias, escolher outros meses ou reduzir os hóspedes.
            </p>
          </div>
        } @else {
          <ul class="mt-4 space-y-3">
            @for (alt of r.alternativas; track alt.inicio + '-' + alt.fim) {
              <li class="rounded-xl border border-[#DCE6EA] bg-white overflow-hidden">
                <div class="px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[#F0F5F6]">
                  <div>
                    <p class="text-sm font-semibold text-[#054054]">
                      {{ alt.inicio | date: "d 'de' MMM" : '' : 'pt-BR' }} →
                      {{ alt.fim | date: "d 'de' MMM 'de' y" : '' : 'pt-BR' }}
                    </p>
                    <p class="text-[11px] text-[#536B73]">
                      {{ alt.noites }} {{ alt.noites === 1 ? 'noite' : 'noites' }}
                    </p>
                  </div>
                  @if (alt.deslocamento !== undefined) {
                    <span
                      class="text-[11px] font-medium px-2.5 py-1 rounded-full"
                      [class]="alt.deslocamento === 0
                        ? 'bg-[#DCE6EA] text-[#054054]'
                        : 'bg-[#F4F8F9] text-[#536B73] border border-[#DCE6EA]'"
                    >
                      {{ rotuloDeslocamento(alt) }}
                    </span>
                  }
                </div>
                <ul class="divide-y divide-[#F0F5F6]">
                  @for (acc of alt.acomodacoes; track acc.id) {
                    <li>
                      <button
                        type="button"
                        class="w-full flex items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-[#F4F8F9] transition-colors"
                        (click)="escolher(alt, acc.slug)"
                      >
                        <span>
                          <span class="block text-sm font-medium text-[#054054]">{{ acc.nome }}</span>
                          <span class="block text-[11px] text-[#536B73]">
                            Unidade {{ acc.numero }} · até {{ acc.capacidade }}
                            {{ acc.capacidade === 1 ? 'pessoa' : 'pessoas' }}
                          </span>
                        </span>
                        <span class="text-right shrink-0">
                          <span class="block text-sm font-semibold text-[#054054]">
                            {{ total(alt, acc) }}
                          </span>
                          <span class="block text-[11px] text-[#536B73]">
                            {{ alt.noites }} {{ alt.noites === 1 ? 'noite' : 'noites' }} ·
                            {{ preco(acc.valor) }}/noite
                          </span>
                          <span class="block text-[11px] font-medium text-[#054054] mt-0.5">reservar →</span>
                        </span>
                      </button>
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
})
export class SearchPageComponent implements OnInit {
  public readonly state = inject(SearchStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  public ngOnInit(): void {
    this.seo.updateSeo({
      title: 'Buscar disponibilidade | Pousada Espírito do Mar',
      description: 'Encontre datas e acomodações disponíveis para sua estadia na Pousada Espírito do Mar, no Peró, Cabo Frio.',
      url: `${HOTEL_CONFIG.siteUrl}/buscar`,
    });
    this.restaurarDaUrl();
  }

  /** Restaura o rascunho da URL e dispara a consulta (revalidada). */
  private restaurarDaUrl(): void {
    const p = this.route.snapshot.queryParamMap;
    const modo: SearchMode = p.get('modo') === 'flexible' ? 'flexible' : 'dates';
    this.state.mode.set(modo);

    if (modo === 'dates') {
      const tol = Number(p.get('tol') ?? 0);
      if (p.get('in')) this.state.checkIn.set(p.get('in')!);
      if (p.get('out')) this.state.checkOut.set(p.get('out')!);
      this.state.tolerance.set(TOLERANCIAS.includes(tol as ToleranceDays) ? (tol as ToleranceDays) : 0);
    } else {
      const preset = p.get('preset');
      this.state.stayPreset.set(
        preset === 'week' || preset === 'month' ? (preset as StayPreset) : 'weekend',
      );
      this.state.months.set((p.get('meses') ?? '').split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)));
    }

    const num = (k: string) => Math.max(0, Number(p.get(k) ?? 0) || 0);
    this.state.guests.set({
      adults: Math.max(1, num('a') || 2),
      children: num('c'),
      infants: num('i'),
      pets: num('p'),
    });
    if (p.get('suite')) this.state.acomodacaoSlug.set(p.get('suite')!);

    if (this.state.prontoParaBuscar()) void this.enviar();
  }

  /** Buscar clicado na barra — serializa o rascunho na URL e envia. */
  protected refazer(): void {
    if (!this.state.prontoParaBuscar()) return;
    void this.enviar();
  }

  private async enviar(): Promise<void> {
    const ok = await this.state.submit();
    if (ok) this.sincronizarUrl();
  }

  /** A URL reflete a consulta aplicada — share/refresh restauram. */
  private sincronizarUrl(): void {
    void this.router.navigate([], { queryParams: this.state.parametrosUrl(), replaceUrl: true });
  }

  /** A alternativa leva SUAS datas reais para o fluxo de reserva existente. */
  protected escolher(alt: SearchAlternativa, slug: string): void {
    const g = this.state.appliedQuery()?.guests ?? this.state.guests();
    void this.router.navigate(['/reservar'], {
      queryParams: {
        checkIn: alt.inicio,
        checkOut: alt.fim,
        guests: g.adults + g.children + g.infants,
        suite: slug,
      },
    });
  }

  protected rotuloDeslocamento(alt: SearchAlternativa): string {
    const d = alt.deslocamento ?? 0;
    if (d === 0) return 'Datas exatas';
    return d > 0 ? `+${d} ${d === 1 ? 'dia' : 'dias'}` : `${d} ${d === -1 ? 'dia' : 'dias'}`;
  }

  protected preco(valor: string): string {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? brl.format(n) : 'Sob consulta';
  }

  /** Total da estadia — diária (já ajustada pela ocupação) × noites. */
  protected total(alt: SearchAlternativa, acc: SearchAcomodacao): string {
    const n = Number(acc.valor);
    return Number.isFinite(n) && n > 0 ? brl.format(n * alt.noites) : 'Sob consulta';
  }
}
