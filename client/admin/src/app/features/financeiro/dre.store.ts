// Lógica e estado de dre — separada da camada de UI (dre.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { num } from '@core/utils/num.utils';
import { Dre, GrupoDre } from '@core/models/financeiro.models';
import { NotifyService } from '@core/services/notify.service';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const ROTULO_GRUPO: Record<GrupoDre, string> = {
  receita_bruta: 'Receita bruta',
  deducoes: 'Deduções',
  custos: 'Custos',
  despesas_operacionais: 'Despesas operacionais',
  resultado_financeiro: 'Resultado financeiro',
  outras: 'Outras receitas/despesas',
};

interface LinhaDre {
  rotulo: string;
  valor: number;
  estilo: 'item' | 'subtotal' | 'destaque';
  sinal?: number; // -1 para dedução visual
}

@Directive()
export abstract class FinDreStore implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly notify = inject(NotifyService);

  readonly fmt = fmt;
  readonly num = num;
  readonly ROTULO = ROTULO_GRUPO;
  readonly dre = signal<Dre | null>(null);

  readonly range = new FormGroup({
    inicio: new FormControl<Date | null>(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    fim: new FormControl<Date | null>(
      new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
    ),
  });

  private ini = '';
  private fim = '';

  readonly margem = computed(() => {
    const d = this.dre();
    if (!d) return '0,0';
    const rl = num(d.receita_liquida);
    if (rl <= 0) return '0,0';
    const m = (num(d.resultado_liquido) / rl) * 100;
    return m.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  });

  readonly estrutura = computed<LinhaDre[]>(() => {
    const d = this.dre();
    if (!d) return [];
    const n = num;
    return [
      { rotulo: '(=) Receita bruta', valor: n(d.receita_bruta), estilo: 'subtotal' },
      {
        rotulo: '(−) Deduções (descontos, IBS, CBS…)',
        valor: -n(d.deducoes),
        estilo: 'item',
        sinal: -1,
      },
      { rotulo: '(=) Receita líquida', valor: n(d.receita_liquida), estilo: 'subtotal' },
      { rotulo: '(−) Custos', valor: -n(d.custos), estilo: 'item', sinal: -1 },
      {
        rotulo: '(−) Despesas operacionais',
        valor: -n(d.despesas_operacionais),
        estilo: 'item',
        sinal: -1,
      },
      { rotulo: '(=) Lucro operacional', valor: n(d.lucro_operacional), estilo: 'subtotal' },
      { rotulo: '(±) Resultado financeiro', valor: n(d.resultado_financeiro), estilo: 'item' },
      { rotulo: '(±) Outras receitas/despesas', valor: n(d.outras), estilo: 'item' },
      {
        rotulo: '(=) Resultado líquido do período',
        valor: n(d.resultado_liquido),
        estilo: 'destaque',
      },
    ];
  });

  ngOnInit(): void {
    const { inicio, fim } = this.range.value;
    if (inicio && fim) {
      this.ini = isoLocal(inicio);
      this.fim = isoLocal(fim);
    }
    this.carregar();
  }

  aplicarRange(): void {
    const { inicio, fim } = this.range.value;
    if (inicio && fim) {
      this.ini = isoLocal(inicio);
      this.fim = isoLocal(fim);
      this.carregar();
    }
  }

  carregar(): void {
    this.dre.set(null);
    this.financeiroApi.dre(this.ini || undefined, this.fim || undefined).subscribe({
      next: (d) => this.dre.set(d),
      error: (e) => this.notify.erro(e),
    });
  }
}
