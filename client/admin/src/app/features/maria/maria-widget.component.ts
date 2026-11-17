// MAR IA — widget oficial ElevenLabs (<elevenlabs-convai>) no shell do CRM.
// A sessão sai de POST /api/maria/session (signed_url) e as tools rodam
// como client tools → POST /mcp com o JWT do funcionário. O card abaixo é
// a única UI nossa: a confirmação de escrita (preparar_* → confirmar_acao).

import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, inject, OnDestroy, OnInit, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MariaService } from '@core/services/maria.service';

interface CallEventDetail {
  config: {
    clientTools?: Record<string, (p: unknown) => Promise<string | object>>;
    signedUrl?: string;
    dynamicVariables?: Record<string, string>;
  };
}

@Component({
  selector: 'app-maria',
  imports: [MatIconModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <elevenlabs-convai
      #convai
      [attr.agent-id]="m.agentId"
      [attr.signed-url]="m.signedUrl()"
      [attr.dynamic-variables]="varsJson"
      variant="compact"
      placement="bottom-right"
      text-input="true"
      transcript="true"
      mic-muting="true"
      dismissible="false"
      show-agent-status="true"
      action-text="Falar com a MARIA"
      start-call-text="Iniciar conversa"
      end-call-text="Encerrar"
      expand-text="Abrir assistente"
      listening-text="Ouvindo…"
      speaking-text="MARIA falando"
    ></elevenlabs-convai>

    @if (m.pendente(); as a) {
      <section class="mar-acao" role="alertdialog" aria-label="Confirmação de ação">
        <div class="mar-acao-tit"><mat-icon>verified_user</mat-icon> Confirmar ação</div>
        <div class="mar-acao-res">
          <b>{{ rotuloAcao(a.acao) }}</b>
          @for (k of chaves(a.resumo); track k) {
            <span>{{ rotuloCampo(k) }}: {{ a.resumo[k] ?? '—' }}</span>
          }
        </div>
        <div class="mar-acao-btns">
          <button class="mar-ok" type="button" (click)="m.confirmar(a.idacao)">
            <mat-icon>check</mat-icon> Confirmar
          </button>
          <button class="mar-nok" type="button" (click)="m.recusar()">
            <mat-icon>close</mat-icon> Cancelar
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    /* Card de confirmação — flutua acima do orb do widget (bottom-right). */
    .mar-acao {
      position: fixed; right: 22px; bottom: 96px; z-index: 400;
      width: 300px; padding: 14px 16px;
      background: #fff; border: 1px solid #d8e4e8; border-radius: 14px;
      box-shadow: 0 8px 30px rgba(5, 40, 56, .22);
      display: flex; flex-direction: column; gap: 10px;
    }
    .mar-acao-tit {
      display: flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 700; color: #054054;
    }
    .mar-acao-tit mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .mar-acao-res {
      display: flex; flex-direction: column; gap: 3px;
      font-size: 12.5px; color: #33474f; max-height: 160px; overflow-y: auto;
    }
    .mar-acao-res b { color: #054054; margin-bottom: 2px; }
    .mar-acao-btns { display: flex; gap: 8px; }
    .mar-ok, .mar-nok {
      flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      padding: 8px 10px; border-radius: 9px; border: none; cursor: pointer;
      font-size: 12.5px; font-weight: 600;
    }
    .mar-ok { background: #054054; color: #fff; }
    .mar-ok:hover { background: #0a5a74; }
    .mar-nok { background: #eef3f5; color: #5a707a; }
    .mar-nok:hover { background: #e0e9ec; }
    .mar-ok mat-icon, .mar-nok mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `,
})
export class MariaWidgetComponent implements OnInit, OnDestroy {
  readonly m = inject(MariaService);
  private readonly convai = viewChild<ElementRef<HTMLElement>>('convai');

  private readonly onCall = (ev: Event) => this.aoIniciarChamada(ev);

  get varsJson(): string {
    return JSON.stringify({ funcionario: this.m.funcionario });
  }

  ngOnInit(): void {
    // Bundle do widget (~self-contained) só carrega junto do shell logado.
    void import('@elevenlabs/convai-widget-embed').then(() => {
      // `elevenlabs-convai:call` tem ':' no nome — o event binding do
      // Angular não aceita; addEventListener direto resolve.
      this.convai()?.nativeElement.addEventListener('elevenlabs-convai:call', this.onCall);
    });
    void this.m.preparar();
  }

  ngOnDestroy(): void {
    this.convai()?.nativeElement.removeEventListener('elevenlabs-convai:call', this.onCall);
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
    return Object.keys(resumo).filter((k) => k !== 'idacao').slice(0, 8);
  }

  rotuloAcao(acao: string): string {
    return acao.replace(/^preparar_/, '').replace(/_/g, ' ');
  }

  rotuloCampo(k: string): string {
    return k.replace(/_/g, ' ');
  }
}
