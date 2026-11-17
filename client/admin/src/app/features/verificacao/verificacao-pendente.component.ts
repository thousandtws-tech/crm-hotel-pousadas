// Tela do portão de identidade — exibida quando a integração Didit exige
// KYC e o funcionário ainda não aprovou. Cria/reutiliza a sessão hospedada,
// acompanha o status por polling e libera a navegação ao aprovar. Admin
// (nível 1) tem bypass de emergência para nunca trancar todo mundo fora.

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { VerificacaoApi } from '@core/api/verificacao.api';
import { AuthStore } from '@core/services/auth.store';
import { Notify } from '@core/services/notify.service';
import { invalidarCacheVerificacao, marcarBypassAdmin } from '@core/guards/verificacao.guard';
import type { MinhaVerificacao, StatusVerificacao } from '@core/models';

const POLL_MS = 10_000;

@Component({
  selector: 'app-verificacao-pendente',
  imports: [MatIconModule],
  template: `
    <div class="vp">
      <div class="vp-card">
        <span class="vp-ic" [class.ok]="aprovada()"><mat-icon>{{ icone() }}</mat-icon></span>
        <h1 class="vp-t">{{ titulo() }}</h1>
        <p class="vp-sub">{{ subtitulo() }}</p>

        @if (v()?.url && pendente()) {
          <button type="button" class="vp-btn" (click)="abrir()">
            <mat-icon>open_in_new</mat-icon> Continuar verificação
          </button>
        } @else if (pendente() && criarDisponivel()) {
          <button type="button" class="vp-btn" (click)="criarSessao()" [disabled]="criando()">
            <mat-icon>verified_user</mat-icon>
            {{ criando() ? 'Gerando link…' : 'Verificar minha identidade' }}
          </button>
        }

        <p class="vp-status">
          Status: <strong>{{ v()?.rotulo ?? 'Carregando…' }}</strong>
          @if (ultimoCheck()) {
            <span class="vp-mut">· atualizado {{ ultimoCheck() }}</span>
          }
        </p>

        @if (recusada()) {
          <p class="vp-aviso">
            A verificação foi recusada ou expirou. Fale com o administrador para gerar um novo
            link ou verificar os dados enviados.
          </p>
        }

        <div class="vp-acoes">
          @if (v()?.admin && v()?.bloqueado) {
            <button type="button" class="vp-bypass" (click)="bypass()">
              Continuar assim mesmo (administrador)
            </button>
          }
          <button type="button" class="vp-sair" (click)="sair()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .vp { min-height: 100svh; display: grid; place-items: center; padding: 24px;
      background: linear-gradient(160deg, #054054 0%, #0b2437 100%); }
    .vp-card { width: min(460px, 100%); background: #fff; border-radius: 20px;
      padding: 40px 32px; text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,.35); }
    .vp-ic { display: inline-grid; place-items: center; width: 72px; height: 72px;
      border-radius: 50%; background: #EEF4F6; margin-bottom: 16px; }
    .vp-ic mat-icon { font-size: 36px; width: 36px; height: 36px; color: #054054; }
    .vp-ic.ok { background: #e6f4ea; }
    .vp-ic.ok mat-icon { color: #1e7d32; }
    .vp-t { font-size: 22px; font-weight: 700; color: #0b2437; margin: 0 0 8px; }
    .vp-sub { font-size: 14px; color: #5a6b76; line-height: 1.55; margin: 0 0 24px; }
    .vp-btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 24px;
      border: 0; border-radius: 999px; background: #054054; color: #fff;
      font-size: 15px; font-weight: 600; cursor: pointer; }
    .vp-btn:disabled { opacity: .6; cursor: wait; }
    .vp-status { font-size: 13px; color: #0b2437; margin: 20px 0 0; }
    .vp-mut { color: #8aa0ac; }
    .vp-aviso { font-size: 13px; color: #8a5a00; background: #fff7e0;
      border-radius: 10px; padding: 10px 12px; margin: 16px 0 0; }
    .vp-acoes { margin-top: 24px; display: grid; gap: 8px; }
    .vp-bypass { border: 0; background: none; color: #4B95AB; font-size: 13px;
      font-weight: 600; cursor: pointer; text-decoration: underline; }
    .vp-sair { display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; border: 0; background: none; color: #8aa0ac; font-size: 13px;
      cursor: pointer; }
  `,
})
export class VerificacaoPendenteComponent implements OnInit, OnDestroy {
  private readonly api = inject(VerificacaoApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);

  protected readonly v = signal<MinhaVerificacao | null>(null);
  protected readonly criando = signal(false);
  protected readonly criarDisponivel = signal(true);
  protected readonly ultimoCheck = signal<string | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly aprovada = computed(() => this.v()?.aprovada === true);
  protected readonly pendente = computed(() => {
    const s = this.v()?.status;
    return s !== undefined && !this.aprovada() && !this.recusada();
  });
  protected readonly recusada = computed(() => {
    const s = this.v()?.status;
    return s === 'recusada' || s === 'kyc_expirada';
  });
  protected readonly icone = computed(() => {
    if (this.aprovada()) return 'verified_user';
    const s: StatusVerificacao | undefined = this.v()?.status;
    if (s === 'em_andamento' || s === 'em_revisao' || s === 'reenviada') return 'hourglass_top';
    if (this.recusada()) return 'gpp_bad';
    return 'shield';
  });
  protected readonly titulo = computed(() => {
    if (this.aprovada()) return 'Identidade verificada';
    if (this.recusada()) return 'Verificação não concluída';
    return 'Verifique sua identidade';
  });
  protected readonly subtitulo = computed(() => {
    if (this.aprovada()) return 'Tudo certo — você já pode usar o sistema.';
    if (this.recusada()) return 'Não foi possível confirmar sua identidade desta vez.';
    return 'Para proteger o acesso ao painel, todos os funcionários precisam validar a identidade uma única vez. O processo abre em uma página segura e leva menos de um minuto.';
  });

  ngOnInit(): void {
    this.atualizar();
    this.timer = setInterval(() => this.atualizar(), POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private atualizar(): void {
    this.api.minha().subscribe({
      next: (v) => {
        this.v.set(v);
        this.ultimoCheck.set(new Date().toLocaleTimeString('pt-BR'));
        if (v.aprovada || !v.bloqueado) {
          if (this.timer) clearInterval(this.timer);
          invalidarCacheVerificacao();
          setTimeout(() => this.router.navigateByUrl('/'), 900);
        }
      },
      error: () => undefined,
    });
  }

  protected criarSessao(): void {
    this.criando.set(true);
    this.api.minhaSessao().subscribe({
      next: (s) => {
        this.criando.set(false);
        this.v.update((v) => (v ? { ...v, url: s.url, status: s.status } : v));
        window.open(s.url, '_blank', 'noopener');
      },
      error: (e) => {
        this.criando.set(false);
        if (e?.status === 400 || e?.status === 409) this.criarDisponivel.set(false);
        this.notify.erro(e?.error?.message ?? 'Não foi possível gerar o link de verificação.');
      },
    });
  }

  protected abrir(): void {
    const url = this.v()?.url;
    if (url) window.open(url, '_blank', 'noopener');
  }

  protected bypass(): void {
    marcarBypassAdmin();
    this.notify.ok('Acesso de administrador liberado nesta aba.');
    this.router.navigateByUrl('/');
  }

  protected sair(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
