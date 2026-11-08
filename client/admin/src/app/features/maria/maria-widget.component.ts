import { Component, computed, effect, inject, signal, ElementRef, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MariaService } from '@core/services/maria.service';
import { MariaAuraComponent, type AuraState } from './maria-aura.component';
import { environment } from '../../../environments/environment';

const SUGESTOES = [
  { icone: 'today', texto: 'Quais os check-ins de hoje?' },
  { icone: 'inventory_2', texto: 'Quais itens estão em falta no estoque?' },
  { icone: 'shopping_cart', texto: 'Sugira pedidos de compra' },
  { icone: 'calendar_month', texto: 'Reservas da semana' },
];

@Component({
  selector: 'app-maria',
  imports: [MatIconModule, MariaAuraComponent],
  template: `
    @if (habilitado) {
      <button
        type="button"
        class="mar-fab"
        [class.mar-fab-live]="m.estado() === 'listening' || m.estado() === 'speaking'"
        [class.mar-fab-think]="m.estado() === 'thinking'"
        (click)="alternar()"
        aria-label="Abrir MAR IA"
        [attr.aria-expanded]="aberta()"
      >
        <mat-icon>auto_awesome</mat-icon>
      </button>

      @if (aberta()) {
        <div
          class="mar-panel"
          [class.mar-dark]="m.micLigado()"
          role="dialog"
          aria-label="MAR IA — assistente virtual"
        >
          <!-- header -->
          <header class="mar-head">
            <div class="mar-avatar">M</div>
            <div class="mar-head-txt">
              <strong>MAR IA</strong>
              <span class="mar-st">
                <span class="mar-dot" [class]="'mar-dot-' + m.estado()"></span>
                {{ rotuloEstado() }}
              </span>
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
            <!-- ===== mensagens (prompt-kit: ChatContainer) ===== -->
            <div class="mar-scroll" #msgs (scroll)="aoRolar()">
              @if (!m.mensagens().length && !m.assistenteParcial() && !m.transcricaoViva()) {
                <div class="mar-vazio">
                  <div class="mar-avatar mar-avatar-lg">M</div>
                  <p class="mar-vazio-t">Olá! Como posso ajudar?</p>
                  <div class="mar-sug">
                    @for (s of sugestoes; track s.texto) {
                      <button type="button" class="mar-chip" (click)="enviarTexto(s.texto)">
                        <mat-icon>{{ s.icone }}</mat-icon>{{ s.texto }}
                      </button>
                    }
                  </div>
                </div>
              }
              <div class="mar-msgs" role="log" aria-live="polite" aria-label="Conversa">
                @for (msg of m.mensagens(); track $index) {
                  @if (msg.papel === 'user') {
                    <div class="mar-linha mar-linha-user">
                      <div class="mar-balao mar-balao-user">{{ msg.texto }}</div>
                    </div>
                  } @else if (msg.papel === 'sys') {
                    <div class="mar-sys">{{ msg.texto }}</div>
                  } @else {
                    <div class="mar-linha">
                      <div class="mar-avatar mar-avatar-sm">M</div>
                      <div class="mar-balao mar-balao-ia" [innerHTML]="md(msg.texto)"></div>
                    </div>
                  }
                }
                @if (m.assistenteParcial()) {
                  <div class="mar-linha">
                    <div class="mar-avatar mar-avatar-sm">M</div>
                    <div class="mar-balao mar-balao-ia mar-partial" [innerHTML]="md(m.assistenteParcial())"></div>
                  </div>
                }
                @if (m.transcricaoViva()) {
                  <div class="mar-linha mar-linha-user">
                    <div class="mar-balao mar-balao-user mar-partial">{{ m.transcricaoViva() }}<span class="cur">▌</span></div>
                  </div>
                }
                @if (m.estado() === 'thinking' && !m.assistenteParcial()) {
                  <div class="mar-linha">
                    <div class="mar-avatar mar-avatar-sm">M</div>
                    <div class="mar-balao mar-balao-ia mar-typing" aria-label="MAR IA pensando">
                      <span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>
                    </div>
                  </div>
                }
              </div>

              @if (!pertoDoFim()) {
                <button type="button" class="mar-voltar" (click)="rolarFim()" aria-label="Voltar ao fim da conversa">
                  <mat-icon>arrow_downward</mat-icon>
                </button>
              }
            </div>
          }

          <!-- confirmação de ação -->
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

          <!-- ===== composer (prompt-kit: PromptInput) ===== -->
          <footer class="mar-foot">
            <div class="mar-composer">
              <textarea
                class="mar-txt"
                rows="1"
                placeholder="Pergunte à MAR IA…"
                #entrada
                (input)="autoResize(entrada)"
                (keydown)="tecla($event, entrada)"
                aria-label="Mensagem para a MAR IA"
              ></textarea>
              <div class="mar-acoes">
                @if (m.micDisponivel()) {
                  <button
                    type="button"
                    class="mar-ibtn"
                    [class.mar-mic-on]="m.micLigado()"
                    (click)="alternarMic()"
                    [attr.aria-pressed]="m.micLigado()"
                    [title]="m.micLigado() ? 'Parar de ouvir' : 'Falar com MAR IA'"
                  >
                    <mat-icon>{{ m.micLigado() ? 'mic' : 'mic_none' }}</mat-icon>
                  </button>
                }
                @if (m.estado() === 'speaking' || m.estado() === 'thinking') {
                  <button type="button" class="mar-ibtn mar-ibtn-stop" (click)="m.interromper()" title="Interromper" aria-label="Interromper">
                    <mat-icon>stop</mat-icon>
                  </button>
                } @else {
                  <button
                    type="button"
                    class="mar-ibtn mar-ibtn-send"
                    (click)="enviar(entrada)"
                    [disabled]="!entrada.value.trim()"
                    aria-label="Enviar"
                  >
                    <mat-icon>arrow_upward</mat-icon>
                  </button>
                }
              </div>
            </div>
          </footer>
        </div>
      }
    }
  `,
  styles: `
    :host { position: relative; z-index: 200; }

    /* ===== FAB ===== */
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
    .mar-fab-live { border-color: #b5811f; box-shadow: 0 0 0 6px rgba(221,165,84,.18), 0 4px 18px rgba(0,0,0,.35); }
    .mar-fab-think { border-color: #4b95ab; animation: fab-think 1.2s ease-in-out infinite; }
    @keyframes fab-think { 50% { box-shadow: 0 0 0 8px rgba(75,149,171,.16), 0 4px 18px rgba(0,0,0,.35); } }

    /* ===== painel ===== */
    .mar-panel {
      position: fixed; right: 22px; bottom: 90px; z-index: 300;
      width: min(410px, calc(100vw - 44px)); max-height: min(580px, calc(100vh - 120px));
      background: #fff; border: 1px solid #d7e0e6; border-radius: 16px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 12px 40px rgba(5, 40, 54, .28);
    }

    .mar-head {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-bottom: 1px solid #e3eaef;
    }
    .mar-avatar {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #054054 0%, #1a6f8a 100%);
      color: #fff; font-size: 14px; font-weight: 700; letter-spacing: 0.02em;
      display: inline-flex; align-items: center; justify-content: center;
      user-select: none;
    }
    .mar-avatar-sm { width: 26px; height: 26px; align-self: flex-end; margin-bottom: 2px; font-size: 11.5px; }
    .mar-avatar-lg { width: 44px; height: 44px; font-size: 19px; }
    .mar-head-txt { display: flex; flex-direction: column; line-height: 1.15; flex: 1; min-width: 0; }
    .mar-head-txt strong { font-size: 0.95rem; letter-spacing: 0.02em; color: #054054; }
    .mar-st { display: inline-flex; align-items: center; gap: 5px; font-size: 0.72rem; color: #8a99a4; }
    .mar-dot { width: 7px; height: 7px; border-radius: 50%; background: #6c7f88; flex-shrink: 0; }
    .mar-dot-idle { background: #2e9e6b; }
    .mar-dot-listening { background: #b5811f; animation: pulse 1s infinite; }
    .mar-dot-thinking { background: #4b95ab; animation: pulse .8s infinite; }
    .mar-dot-speaking { background: #2e9e6b; animation: pulse .6s infinite; }
    .mar-dot-offline { background: #9aa7ad; }
    @keyframes pulse { 50% { opacity: .45; } }
    .mar-hbtn {
      background: transparent; border: none; color: #8a99a4; cursor: pointer;
      border-radius: 8px; padding: 6px; display: inline-flex;
    }
    .mar-hbtn:hover { color: #054054; background: #eef3f6; }
    .mar-hbtn.mar-on { color: #b5811f; }
    .mar-hbtn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .mar-erro {
      display: flex; align-items: center; gap: 6px;
      background: #fdecec; color: #dc3545; font-size: 0.78rem;
      padding: 8px 12px; border-bottom: 1px solid #f3d3d1;
    }
    .mar-erro mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* ===== área de mensagens ===== */
    .mar-scroll {
      flex: 1; overflow-y: auto; min-height: 180px; position: relative;
      scroll-behavior: smooth;
    }
    .mar-msgs { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
    .mar-linha { display: flex; align-items: flex-end; gap: 8px; }
    .mar-linha-user { justify-content: flex-end; }
    .mar-balao {
      max-width: 82%; padding: 9px 13px; border-radius: 16px;
      font-size: 0.88rem; line-height: 1.45;
      animation: mar-in .18s ease-out;
    }
    @keyframes mar-in { from { opacity: 0; transform: translateY(4px); } }
    .mar-balao-user {
      background: #054054; color: #fff; border-bottom-right-radius: 6px;
      white-space: pre-wrap;
    }
    .mar-balao-ia {
      background: #f1f5f7; color: #1c3038; border-bottom-left-radius: 6px;
    }
    .mar-balao-ia code {
      background: #e2eaee; border-radius: 4px; padding: 1px 5px;
      font-size: 0.8rem; font-family: ui-monospace, monospace;
    }
    .mar-partial { opacity: .8; }
    .cur { animation: pulse .7s infinite; }
    .mar-sys {
      align-self: center; color: #8a99a4;
      font-size: 0.74rem; font-style: italic; padding: 2px 8px;
    }

    /* typing indicator */
    .mar-typing { display: inline-flex; gap: 4px; align-items: center; padding: 12px 14px; }
    .tdot {
      width: 7px; height: 7px; border-radius: 50%; background: #8fa9b5;
      animation: tbounce 1.2s infinite;
    }
    .tdot:nth-child(2) { animation-delay: .15s; }
    .tdot:nth-child(3) { animation-delay: .3s; }
    @keyframes tbounce { 0%, 60%, 100% { transform: none; opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

    /* scroll-to-bottom */
    .mar-voltar {
      position: sticky; bottom: 8px; margin-left: auto; margin-right: 12px;
      display: flex; float: right;
      width: 32px; height: 32px; border-radius: 50%;
      border: 1px solid #d7e0e6; background: #fff; color: #5d6d7e;
      box-shadow: 0 2px 8px rgba(0,0,0,.12); cursor: pointer;
      align-items: center; justify-content: center;
    }
    .mar-voltar:hover { color: #054054; }
    .mar-voltar mat-icon { font-size: 17px; width: 17px; height: 17px; }

    /* estado vazio + suggestions */
    .mar-vazio {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 30px 18px 20px; text-align: center;
    }
    .mar-vazio-t { margin: 0; font-size: 0.95rem; color: #054054; font-weight: 600; }
    .mar-sug { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
    .mar-chip {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid #d7e0e6; border-radius: 999px; background: #fff;
      padding: 7px 12px; font-size: 0.78rem; color: #3d5460;
      cursor: pointer; font-family: inherit; transition: all .14s ease;
    }
    .mar-chip:hover { border-color: #4b95ab; color: #054054; background: #f0f7fa; }
    .mar-chip mat-icon { font-size: 15px; width: 15px; height: 15px; color: #4b95ab; }

    /* ===== voz (dark) ===== */
    .mar-panel.mar-dark { background: #031c27; border-color: #0c3a4c; }
    .mar-dark .mar-head { border-bottom-color: rgba(255,255,255,.06); }
    .mar-dark .mar-head-txt strong { color: #e8f2f7; }
    .mar-dark .mar-st { color: #5c8395; }
    .mar-dark .mar-hbtn { color: #5c8395; }
    .mar-dark .mar-hbtn:hover { color: #e8f2f7; background: rgba(255,255,255,.08); }
    .mar-dark .mar-erro { background: #3a1d1d; color: #f0a8a2; border-bottom-color: #542b2b; }
    .mar-dark .mar-composer { background: #0a2f3d; border-color: #14465c; }
    .mar-dark .mar-txt { color: #e8f2f7; }
    .mar-dark .mar-txt::placeholder { color: #55798a; }
    .mar-dark .mar-ibtn { background: #12394c; color: #9fc3d0; }
    .mar-dark .mar-ibtn-send { background: #1a6f8a; color: #fff; }
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

    /* ===== confirmação ===== */
    .mar-acao {
      margin: 0 12px 8px; border: 1.5px solid #b5811f; border-radius: 12px;
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
      border: none; border-radius: 8px; padding: 8px 14px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer; font-family: inherit;
    }
    .mar-ok { background: #1a6f8a; color: #fff; }
    .mar-ok:hover { background: #054054; }
    .mar-nok { background: #e8edf0; color: #5d6d7e; }
    .mar-ok mat-icon, .mar-nok mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* ===== composer ===== */
    .mar-foot { padding: 10px 12px 12px; border-top: 1px solid #e3eaef; }
    .mar-composer {
      display: flex; flex-direction: column; gap: 6px;
      border: 1px solid #d7e0e6; border-radius: 18px; background: #fff;
      padding: 8px 8px 6px 14px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .mar-composer:focus-within { border-color: #4b95ab; box-shadow: 0 0 0 3px rgba(75,149,171,.14); }
    .mar-txt {
      border: none; outline: none; resize: none; background: transparent;
      font-size: 0.88rem; font-family: inherit; line-height: 1.45;
      max-height: 120px; width: 100%; padding: 4px 0; color: #1c3038;
    }
    .mar-acoes { display: flex; justify-content: space-between; align-items: center; }
    .mar-acoes > :last-child { margin-left: auto; }
    .mar-ibtn {
      border: none; border-radius: 50%; width: 34px; height: 34px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all .15s ease;
      background: #eef3f6; color: #5d6d7e;
    }
    .mar-ibtn:hover { background: #e2eaee; color: #054054; }
    .mar-ibtn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .mar-ibtn-send { background: #054054; color: #fff; }
    .mar-ibtn-send:hover:not(:disabled) { background: #1a6f8a; }
    .mar-ibtn-send:disabled { opacity: .35; cursor: default; }
    .mar-ibtn-stop { background: #fdecec; color: #dc3545; }
    .mar-mic-on { background: #b5811f; color: #054054; animation: pulse 1.4s infinite; }
  `,
})
export class MariaWidgetComponent {
  protected readonly m = inject(MariaService);
  protected readonly aberta = signal(false);
  protected readonly habilitado = !!((environment as { mariaUrl?: string }).mariaUrl);
  protected readonly pertoDoFim = signal(true);
  protected readonly sugestoes = SUGESTOES;
  private readonly msgs = viewChild<ElementRef<HTMLDivElement>>('msgs');

  protected readonly rotuloEstado = computed(() => {
    if (!this.m.conectado()) return 'offline';
    return this.m.estadoRotulo() ?? 'pronta';
  });

  protected readonly auraEstado = computed<AuraState>(() => {
    const e = this.m.estado();
    if (e === 'offline') return 'disconnected';
    return e;
  });

  protected readonly volumeSrc = (): number => this.m.volumeAura();

  constructor() {
    effect(() => {
      this.m.mensagens();
      this.m.assistenteParcial();
      if (this.pertoDoFim()) this.rolarFim();
    });
  }

  alternar(): void {
    this.aberta.update((v) => !v);
    if (this.aberta()) this.m.conectar();
  }

  aoRolar(): void {
    const el = this.msgs()?.nativeElement;
    if (!el) return;
    this.pertoDoFim.set(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }

  rolarFim(): void {
    const el = this.msgs()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
      this.pertoDoFim.set(true);
    }
  }

  autoResize(ta: HTMLTextAreaElement): void {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }

  tecla(e: KeyboardEvent, ta: HTMLTextAreaElement): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.enviar(ta);
    }
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

  enviar(ta: HTMLTextAreaElement): void {
    const t = ta.value.trim();
    if (!t) return;
    ta.value = '';
    ta.style.height = 'auto';
    this.enviarTexto(t);
  }

  enviarTexto(t: string): void {
    this.m.enviarTexto(t);
    this.pertoDoFim.set(true);
    this.rolarFim();
  }

  /** Markdown mínimo (prompt-kit: respostas formatadas). Escape primeiro. */
  md(texto: string): string {
    const esc = texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
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
