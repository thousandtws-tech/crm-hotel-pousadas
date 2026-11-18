// Lógica e estado de verificacao-pendente — separada da camada de UI (verificacao-pendente.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnDestroy, OnInit, computed, inject, signal, Directive } from '@angular/core';
import { Router } from '@angular/router';
import { VerificacaoApi } from '@core/api/verificacao.api';
import { AuthStore } from '@core/services/auth.store';
import { Notify } from '@core/services/notify.service';
import { invalidarCacheVerificacao, marcarBypassAdmin } from '@core/guards/verificacao.guard';
import type { MinhaVerificacao, StatusVerificacao } from '@core/models';

const POLL_MS = 10_000;

@Directive()
export abstract class VerificacaoPendenteStore implements OnInit, OnDestroy {
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
