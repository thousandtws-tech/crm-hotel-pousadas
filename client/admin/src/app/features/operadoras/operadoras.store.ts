// Lógica e estado de operadoras — separada da camada de UI (operadoras.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, inject, signal, Directive } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { OperadorasApi } from '@core/api/operadoras.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';

/**
 * Operadoras & consolidadoras B2B — cadastro com % de comissão (tarifa
 * net), credencial de extranet (revelar/rotacionar) e faturamento
 * segregado por período.
 */
@Directive()
export abstract class OperadorasStore implements OnInit {
  private readonly operadorasApi = inject(OperadorasApi);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);

  protected readonly operadoras = signal<M.Operadora[]>([]);
  protected readonly carregando = signal(true);
  protected readonly salvando = signal(false);
  protected readonly modalForm = signal(false);
  protected readonly editando = signal<M.Operadora | null>(null);
  protected readonly modalToken = signal<{ id: number; nome: string; token: string } | null>(null);
  protected readonly modalFat = signal<M.FaturamentoOperadora | null>(null);
  protected readonly fatDe = signal(this.mesPassado());
  protected readonly fatAte = signal(this.hoje());

  protected readonly ativas = computed(() => this.operadoras().filter((o) => o.ativa).length);
  protected readonly inativas = computed(() => this.operadoras().length - this.ativas());
  protected readonly comissaoMedia = computed(() => {
    const ativas = this.operadoras().filter((o) => o.ativa);
    if (!ativas.length) return '—';
    const soma = ativas.reduce((acc, o) => acc + Number(o.comissao_pct || 0), 0);
    return `${(soma / ativas.length).toFixed(1).replace('.', ',')}%`;
  });

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(3)]],
    comissao_pct: [15],
    contato: [''],
    email: [''],
    telefone: [''],
    notas: [''],
  });

  ngOnInit(): void {
    this.carregar();
  }

  protected valorDe(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  protected brl(v: string): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
  }

  protected dataBr(iso: string): string {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  protected statusRotulo(s: string): string {
    return { p: 'Pendente', i: 'Em curso', f: 'Finalizada', c: 'Cancelada' }[s] ?? s;
  }

  private hoje(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private mesPassado(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  }

  private carregar(): void {
    this.operadorasApi.listarOperadoras().subscribe({
      next: (l) => {
        this.operadoras.set(l);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erroMsg('Falha ao carregar operadoras.');
      },
    });
  }

  protected abrirForm(o: M.Operadora | null): void {
    this.editando.set(o);
    this.form.reset({
      nome: o?.nome ?? '',
      comissao_pct: Number(o?.comissao_pct ?? 15),
      contato: o?.contato ?? '',
      email: o?.email ?? '',
      telefone: o?.telefone ?? '',
      notas: o?.notas ?? '',
    });
    this.modalForm.set(true);
  }

  protected salvar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input: M.OperadoraInput = {
      nome: v.nome.trim(),
      comissao_pct: v.comissao_pct,
      contato: v.contato.trim() || null,
      email: v.email.trim() || null,
      telefone: v.telefone.trim() || null,
      notas: v.notas.trim() || null,
    };
    this.salvando.set(true);
    const op = this.editando();
    if (op) {
      this.operadorasApi.atualizarOperadora(op.id, input).subscribe({
        next: () => this.posSalvamento(null),
        error: (e) => this.falhaSalvamento(e),
      });
    } else {
      this.operadorasApi.criarOperadora(input).subscribe({
        next: (resp) => this.posSalvamento(resp),
        error: (e) => this.falhaSalvamento(e),
      });
    }
  }

  private posSalvamento(resp: { operadora: M.Operadora; token: string } | null): void {
    this.salvando.set(false);
    this.modalForm.set(false);
    this.carregar();
    if (resp) {
      this.modalToken.set({ id: resp.operadora.id, nome: resp.operadora.nome, token: resp.token });
      this.notify.ok('Operadora criada — copie o token da extranet.');
    } else {
      this.notify.ok('Operadora salva.');
    }
  }

  private falhaSalvamento(e: unknown): void {
    this.salvando.set(false);
    const erro = (e as { error?: { erro?: string } })?.error?.erro;
    this.notify.erroMsg(erro ?? 'Falha ao salvar.');
  }

  protected alternar(o: M.Operadora): void {
    this.operadorasApi.definirOperadoraAtiva(o.id, !o.ativa).subscribe({
      next: () => this.carregar(),
      error: () => this.notify.erroMsg('Falha ao alterar o status.'),
    });
  }

  protected verToken(o: M.Operadora): void {
    this.operadorasApi.tokenOperadora(o.id).subscribe({
      next: (t) => this.modalToken.set({ id: o.id, nome: o.nome, token: t.token }),
      error: () => this.notify.erroMsg('Falha ao obter o token.'),
    });
  }

  protected rotacionar(id: number): void {
    if (!confirm('Rotacionar o token? A credencial atual para de funcionar imediatamente.')) return;
    this.operadorasApi.rotacionarTokenOperadora(id).subscribe({
      next: (t) => {
        const cur = this.modalToken();
        if (cur) this.modalToken.set({ ...cur, token: t.token });
        this.notify.ok('Token rotacionado.');
      },
      error: () => this.notify.erroMsg('Falha ao rotacionar.'),
    });
  }

  protected abrirFaturamento(o: M.Operadora): void {
    this.buscarFaturamento(o.id);
  }

  protected buscarFaturamento(id: number): void {
    this.operadorasApi.faturamentoOperadora(id, this.fatDe(), this.fatAte()).subscribe({
      next: (f) => this.modalFat.set(f),
      error: () => this.notify.erroMsg('Falha ao carregar o faturamento.'),
    });
  }

  protected copiar(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('Token copiado.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }
}
