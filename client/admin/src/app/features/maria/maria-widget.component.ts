import { Component, computed, effect, inject, signal, ElementRef, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MariaService } from '@core/services/maria.service';
import { MariaAuraComponent, type AuraState } from './maria-aura.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-maria',
  imports: [MatIconModule, MariaAuraComponent],
  template: `
    @if (habilitado) {
      <!-- ===== botão flutuante ===== -->
      <button
        type="button"
        class="mar-fab"
        [class.mar-fab-live]="m.estado() === 'listening' || m.estado() === 'speaking'"
        [class.mar-fab-think]="m.estado() === 'thinking'"
        (click)="aberta.set(!aberta()); aberta() && m.conectar()"
        aria-label="Abrir MAR IA"
        [attr.aria-expanded]="aberta()"
      >
        <mat-icon>graphic_eq</mat-icon>
      </button>

      @if (aberta()) {
        <!-- ===== painel conversacional ===== -->
        <div
          class="mar-panel"
          [class.mar-dark]="m.micLigado()"
          role="dialog"
          aria-label="MAR IA — assistente de voz"
        >
          <header class="mar-head">
            <span class="mar-dot" [class]="'mar-dot-' + m.estado()"></span>
            <div class="mar-head-txt">
              <strong>MAR IA</strong>
              <span class="mar-st">{{ rotuloEstado() }}</span>
            </div>
            <button
              type="button"
              class="mar-hbtn"
              [class.mar-on]="m.vozLigada()"
              (click)="m.vozLigada.set(!m.vozLigada())"
              [title]="m.vozLigada() ? 'Voz ligada' : 'Voz desligada'"
              [attr.aria-pressed]="m.vozLigada()"
            >
              <mat-icon>{{ m.vozLigada() ? 'volume_up' : 'volume_off' }}</mat-icon>
            </button>
            <button type="button" class="mar-hbtn" (click)="aberta.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </header>

          @if (m.erro(); as err) {
            <div class="mar-erro"><mat-icon>error_outline</mat-icon> {{ err }}</div>
          }

          @if (m.micLigado()) {
            <!-- ===== modo voz: Aura do LiveKit (porte Angular) ===== -->
            <div class="mar-voz">
              <app-maria-aura
                [state]="auraEstado()"
                [volumeSrc]="volumeSrc"
                color="#4B95AB"
                [colorShift]="0.45"
                themeMode="dark"
                size="lg"
              />
              @if (m.transcricaoViva()) {
                <p class="mar-voz-tr">{{ m.transcricaoViva() }}<span class="cur">▌</span></p>
              } @else if (m.assistenteParcial()) {
                <p class="mar-voz-tr mar-voz-ia">{{ m.assistenteParcial() }}<span class="cur">▌</span></p>
              } @else {
                <p class="mar-voz-st">{{ rotuloEstado() }}</p>
              }
            </div>
          } @else {
            <!-- ===== histórico ===== -->
            <div class="mar-msgs" #msgs>
              @for (msg of m.mensagens(); track $index) {
                <div class="mar-msg" [class]="'mar-' + msg.papel">
                  {{ msg.texto }}
                </div>
              }
              @if (m.assistenteParcial()) {
                <div class="mar-msg mar-assistant mar-partial">{{ m.assistenteParcial() }}<span class="cur">▌</span></div>
              }
              @if (m.transcricaoViva()) {
                <div class="mar-msg mar-user mar-partial">{{ m.transcricaoViva() }}<span class="cur">▌</span></div>
              }
              @if (!m.mensagens().length && !m.assistenteParcial()) {
                <p class="mar-hint">
                  {{ m.micDisponivel() ? 'Fale ou digite — ex.: "quais os check-ins de hoje?"' : 'Digite — ex.: "quais os check-ins de hoje?"' }}
                </p>
              }
            </div>
          }

          <!-- ação pendente de confirmação -->
          @if (m.pendente(); as a) {
            <div class="mar-acao">
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
            </div>
          }

          <!-- barra de entrada -->
          <footer class="mar-foot">
            @if (m.micDisponivel()) {
              <button
                type="button"
                class="mar-mic"
                [class.mar-mic-on]="m.micLigado()"
                (click)="alternarMic()"
                [attr.aria-pressed]="m.micLigado()"
                [title]="m.micLigado() ? 'Parar de ouvir' : 'Falar com MAR IA'"
              >
                <mat-icon>{{ m.micLigado() ? 'mic' : 'mic_off' }}</mat-icon>
              </button>
            }
            @if (m.estado() === 'speaking' || m.estado() === 'thinking') {
              <button type="button" class="mar-stop" (click)="m.interromper()" title="Interromper">
                <mat-icon>stop</mat-icon>
              </button>
            }
            <input
              class="mar-txt"
              type="text"
              placeholder="Digite para a MAR IA…"
              #entrada
              (keydown.enter)="enviar(entrada)"
              aria-label="Mensagem para a MAR IA"
            />
            <button type="button" class="mar-send" (click)="enviar(entrada)" aria-label="Enviar">
              <mat-icon>send</mat-icon>
            </button>
          </footer>
        </div>
      }
    }
  `,
  styles: `
    :host { position: relative; z-index: 200; }

    .mar-fab {
      position: fixed; right: 22px; bottom: 22px; z-index: 300;
      width: 56px; height: 56px; border-radius: 50%;
      background: #054054; color: #fff; border: 2px solid #1a6f8a;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 18px rgba(0,0,0,.35);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .mar-fab:hover { transform: scale(1.06); }
    .mar-fab mat-icon { font-size: 26px; width: 26px; height: 26px; }
    .mar-fab-live { border-color: #dda554; box-shadow: 0 0 0 6px rgba(221,165,84,.18), 0 4px 18px rgba(0,0,0,.35); }
    .mar-fab-think { border-color: #4b95ab; animation: fab-think 1.2s ease-in-out infinite; }
    @keyframes fab-think { 50% { box-shadow: 0 0 0 8px rgba(75,149,171,.16), 0 4px 18px rgba(0,0,0,.35); } }

    .mar-panel {
      position: fixed; right: 22px; bottom: 90px; z-index: 300;
      width: min(400px, calc(100vw - 44px)); max-height: min(560px, calc(100vh - 120px));
      background: #fff; border: 1px solid #d7e0e6; border-radius: 14px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 12px 40px rgba(5, 40, 54, .28);
    }

    .mar-head {
      display: flex; align-items: center; gap: 10px;
      background: #054054; color: #fff; padding: 12px 14px;
    }
    .mar-head-txt { display: flex; flex-direction: column; line-height: 1.15; flex: 1; min-width: 0; }
    .mar-head-txt strong { font-size: 0.95rem; letter-spacing: 0.02em; }
    .mar-st { font-size: 0.72rem; color: #9fc3d0; }
    .mar-dot { width: 10px; height: 10px; border-radius: 50%; background: #6c7f88; flex-shrink: 0; }
    .mar-dot-idle { background: #8fa3ab; }
    .mar-dot-listening { background: #dda554; animation: pulse 1s infinite; }
    .mar-dot-thinking { background: #4b95ab; animation: pulse .8s infinite; }
    .mar-dot-speaking { background: #2e9e6b; animation: pulse .6s infinite; }
    .mar-dot-offline { background: #9aa7ad; }
    @keyframes pulse { 50% { opacity: .45; } }
    .mar-hbtn {
      background: transparent; border: none; color: #9fc3d0; cursor: pointer;
      border-radius: 6px; padding: 4px; display: inline-flex;
    }
    .mar-hbtn:hover { color: #fff; background: rgba(255,255,255,.1); }
    .mar-hbtn.mar-on { color: #dda554; }
    .mar-hbtn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .mar-erro {
      display: flex; align-items: center; gap: 6px;
      background: #fdecec; color: #b3261e; font-size: 0.78rem;
      padding: 8px 12px; border-bottom: 1px solid #f3d3d1;
    }
    .mar-erro mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .mar-msgs {
      flex: 1; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 8px; min-height: 160px;
    }
    .mar-msg {
      max-width: 85%; padding: 8px 12px; border-radius: 12px;
      font-size: 0.88rem; line-height: 1.4; white-space: pre-wrap;
    }
    .mar-user {
      align-self: flex-end; background: #e8f1f5; color: #054054;
      border-bottom-right-radius: 4px;
    }
    .mar-assistant {
      align-self: flex-start; background: #054054; color: #fff;
      border-bottom-left-radius: 4px;
    }
    .mar-sys {
      align-self: center; background: transparent; color: #8a99a4;
      font-size: 0.74rem; font-style: italic; padding: 2px 8px;
    }
    .mar-partial { opacity: .75; }
    .cur { animation: pulse .7s infinite; }
    .mar-hint { margin: auto; color: #8a99a4; font-size: 0.82rem; text-align: center; padding: 20px; }

    /* ===== modo voz: minimalista estilo ChatGPT ===== */
    .mar-panel.mar-dark {
      background: #031c27;              /* quase preto com tint navy */
      border-color: #0c3a4c;
    }
    .mar-dark .mar-head {
      background: #031c27;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    .mar-dark .mar-st { color: #5c8395; }
    .mar-dark .mar-hbtn { color: #5c8395; }
    .mar-dark .mar-hbtn:hover { color: #e8f2f7; background: rgba(255,255,255,.08); }
    .mar-dark .mar-erro {
      background: #3a1d1d; color: #f0a8a2; border-bottom-color: #542b2b;
    }
    .mar-dark .mar-foot {
      background: #031c27; border-top-color: rgba(255,255,255,.07);
    }
    .mar-dark .mar-txt {
      background: #0a2f3d; border-color: #14465c; color: #e8f2f7;
    }
    .mar-dark .mar-txt::placeholder { color: #55798a; }
    .mar-dark .mar-txt:focus {
      border-color: #4b95ab; box-shadow: 0 0 0 3px rgba(75,149,171,.2);
    }
    .mar-dark .mar-mic { background: #12394c; color: #9fc3d0; }
    .mar-dark .mar-mic.mar-mic-on { background: #dda554; color: #054054; }
    .mar-dark .mar-stop { background: #3a1d1d; color: #f0a8a2; }
    .mar-dark .mar-send { background: #1a6f8a; color: #fff; }
    .mar-dark .mar-send:hover { background: #4b95ab; }
    .mar-dark .mar-acao { background: #0a2f3d; }
    .mar-dark .mar-acao-res { color: #b9d3dd; }

    .mar-voz {
      flex: 1; min-height: 300px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 26px 16px;
    }
    .mar-voz-st {
      margin: 0; font-size: 0.72rem; font-weight: 500; letter-spacing: .18em;
      text-transform: uppercase; color: #4b95ab;
    }
    .mar-voz-tr {
      margin: 0; max-width: 92%; text-align: center;
      font-size: 0.88rem; color: #a9c9d6; line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .mar-voz-ia { color: #7fa9bc; font-style: italic; }

    .mar-acao {
      margin: 0 12px 8px; border: 1.5px solid #dda554; border-radius: 10px;
      background: #fdf7ec; padding: 10px 12px;
    }
    .mar-acao-tit {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.72rem; font-weight: 700; color: #b5811f;
      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;
    }
    .mar-acao-tit mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .mar-acao-res { display: flex; flex-direction: column; gap: 2px; font-size: 0.82rem; color: #33424c; margin-bottom: 8px; }
    .mar-acao-btns { display: flex; gap: 8px; }
    .mar-ok, .mar-nok {
      display: inline-flex; align-items: center; gap: 5px;
      border: none; border-radius: 6px; padding: 7px 14px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer; font-family: inherit;
    }
    .mar-ok { background: #1a6f8a; color: #fff; }
    .mar-ok:hover { background: #054054; }
    .mar-nok { background: #e8edf0; color: #5d6d7e; }
    .mar-ok mat-icon, .mar-nok mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .mar-onda { display: none; }

    .mar-foot {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-top: 1px solid #e3eaef; background: #f8fbfc;
    }
    .mar-mic, .mar-stop, .mar-send {
      border: none; border-radius: 50%; width: 38px; height: 38px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all .15s ease;
    }
    .mar-mic { background: #e8edf0; color: #5d6d7e; }
    .mar-mic.mar-mic-on { background: #dda554; color: #054054; animation: pulse 1.4s infinite; }
    .mar-stop { background: #fdecec; color: #b3261e; }
    .mar-send { background: #054054; color: #fff; }
    .mar-send:hover { background: #1a6f8a; }
    .mar-mic mat-icon, .mar-stop mat-icon, .mar-send mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .mar-txt {
      flex: 1; min-width: 0; border: 1px solid #d7e0e6; border-radius: 19px;
      padding: 9px 14px; font-size: 0.86rem; font-family: inherit; outline: none;
    }
    .mar-txt:focus { border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26,111,138,.12); }
  `,
})
export class MariaWidgetComponent {
  protected readonly m = inject(MariaService);
  protected readonly aberta = signal(false);
  protected readonly habilitado = !!((environment as { mariaUrl?: string }).mariaUrl);
  private readonly msgs = viewChild<ElementRef<HTMLDivElement>>('msgs');

  protected readonly rotuloEstado = computed(() => {
    if (!this.m.conectado()) return 'offline';
    return this.m.estadoRotulo() ?? 'pronta';
  });

  /** Estado do nosso serviço → estado do Aura do LiveKit. */
  protected readonly auraEstado = computed<AuraState>(() => {
    const e = this.m.estado();
    if (e === 'offline') return 'disconnected';
    return e; // idle | listening | thinking | speaking — mesmos nomes
  });

  /** Getter de volume lido a cada frame pelo Aura (mic ou TTS). */
  protected readonly volumeSrc = (): number => this.m.volumeAura();

  constructor() {
    effect(() => {
      // rola para o fim quando chega mensagem
      this.m.mensagens();
      this.m.assistenteParcial();
      const el = this.msgs()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async alternarMic(): Promise<void> {
    if (this.m.micLigado()) {
      this.m.pararMic();
      this.m.commit();
    } else {
      try {
        await this.m.ligarMic();
      } catch {
        this.m.erro.set('microfone não autorizado — verifique a permissão do navegador');
      }
    }
  }

  enviar(inp: HTMLInputElement): void {
    const t = inp.value.trim();
    if (!t) return;
    inp.value = '';
    this.m.enviarTexto(t);
  }

  chaves(o: Record<string, unknown>): string[] {
    return Object.keys(o).filter((k) => !['idcliente', 'idacao'].includes(k));
  }

  rotuloAcao(acao: string): string {
    return { criar_reserva: 'Criar reserva', cancelar_reserva: 'Cancelar reserva' }[acao] ?? acao;
  }

  rotuloCampo(k: string): string {
    return (
      {
        hospede: 'Hóspede',
        acomodacao: 'Acomodação',
        entradaprevista: 'Entrada',
        saidaprevista: 'Saída',
        quantidade_hospedes: 'Hóspedes',
        valordiaria: 'Diária',
        status: 'Situação',
        idreserva: 'Reserva',
        idacomodacao: 'Acomodação',
      }[k] ?? k
    );
  }
}
