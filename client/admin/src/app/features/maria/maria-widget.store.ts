// Lógica e estado de maria-widget — separada da camada de UI (maria-widget.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, OnDestroy, OnInit, Directive } from '@angular/core';
import { MariaService } from '@core/services/maria.service';

interface CallEventDetail {
  config: {
    clientTools?: Record<string, (p: unknown) => Promise<string | object>>;
    signedUrl?: string;
    dynamicVariables?: Record<string, string>;
  };
}

@Directive()
export abstract class MariaWidgetStore implements OnInit, OnDestroy {
  readonly m = inject(MariaService);

  private readonly onCall = (ev: Event) => this.aoIniciarChamada(ev);

  get varsJson(): string {
    return JSON.stringify({ funcionario: this.m.funcionario });
  }

  ngOnInit(): void {
    // `elevenlabs-convai:call` borbulha do shadow pro document — escutar
    // aqui dispensa viewChild e não depende de quando o bundle define o
    // elemento (':' no nome inviabiliza o event binding do template).
    document.addEventListener('elevenlabs-convai:call', this.onCall);
    // Bundle do widget (~self-contained) só carrega junto do shell logado.
    void import('@elevenlabs/convai-widget-embed').catch((e: unknown) => {
      this.m.erro.set(`widget maria indisponível: ${e instanceof Error ? e.message : 'erro'}`);
    });
    void this.m.preparar();
  }

  ngOnDestroy(): void {
    document.removeEventListener('elevenlabs-convai:call', this.onCall);
    this.m.recusar();
  }

  /** O evento `call` dispara quando o usuário inicia a conversa — o config
   *  da sessão é mutável aqui: injetamos signed_url fresca + clientTools
   *  (JWT real do funcionário) e já repomos o cache pra próxima chamada. */
  aoIniciarChamada(ev: Event): void {
    const cfg = (ev as CustomEvent<CallEventDetail>).detail?.config;
    if (cfg) {
      cfg.clientTools = this.m.clientTools();
      const url = this.m.signedUrl();
      if (url) cfg.signedUrl = url;
      cfg.dynamicVariables = { funcionario: this.m.funcionario };
    }
    void this.m.preparar(); // signed_url é descartável — repõe p/ próxima
  }

  chaves(resumo: Record<string, unknown>): string[] {
    return Object.keys(resumo)
      .filter((k) => k !== 'idacao')
      .slice(0, 8);
  }

  rotuloAcao(acao: string): string {
    return acao.replace(/^preparar_/, '').replace(/_/g, ' ');
  }

  rotuloCampo(k: string): string {
    return k.replace(/_/g, ' ');
  }
}
