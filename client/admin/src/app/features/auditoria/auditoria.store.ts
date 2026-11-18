// Lógica e estado de auditoria — separada da camada de UI (auditoria.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, OnInit, effect, Directive } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { RegistroLog } from '@core/models/relatorios.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';

@Directive()
export abstract class AuditoriaStore implements OnInit {
  private readonly rt = inject(RealtimeService);
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);

  protected readonly items = signal<RegistroLog[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly carregando = signal(true);
  protected readonly aberto = signal<number | null>(null);
  protected readonly skel = [0, 1, 2, 3, 4, 5];

  protected readonly fTabela = this.fb.control<string | null>(null);
  protected readonly fAcao = this.fb.control<string | null>(null);
  protected readonly fDesde = this.fb.control<string | null>(null);
  protected readonly fAte = this.fb.control<string | null>(null);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('log');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
  }

  ngOnInit(): void {
    this.carregar();
  }

  alternar(id: number): void {
    this.aberto.update((a) => (a === id ? null : id));
  }

  carregar(): void {
    this.carregando.set(true);
    this.relatoriosApi
      .logs({
        tabela: this.fTabela.value || null,
        acao: this.fAcao.value || null,
        desde: this.fDesde.value,
        ate: this.fAte.value,
        page: this.pagina(),
        porPagina: 50,
      })
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
          this.carregando.set(false);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  recarregar(): void {
    this.pagina.set(1);
    this.carregar();
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregar();
  }
}
