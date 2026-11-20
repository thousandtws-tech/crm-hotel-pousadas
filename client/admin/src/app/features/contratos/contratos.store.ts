// Lógica e estado de contratos — separada da camada de UI (contratos.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, inject, signal, Directive } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ContratosApi } from '@core/api/contratos.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';

/**
 * Contratos corporativos — empresa com código público e desconto
 * negociado, aplicado quando o hóspede digita o código no motor.
 */
@Directive()
export abstract class ContratosStore implements OnInit {
  private readonly contratosApi = inject(ContratosApi);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);

  protected readonly contratos = signal<M.ContratoCorporativo[]>([]);
  protected readonly carregando = signal(true);

  protected readonly ativos = computed(() => this.contratos().filter((c) => c.ativo).length);
  protected readonly expirados = computed(
    () => this.contratos().filter((c) => this.expirado(c)).length,
  );
  protected readonly descontoMedio = computed(() => {
    const ativos = this.contratos().filter((c) => c.ativo);
    if (!ativos.length) return '—';
    const soma = ativos.reduce((acc, c) => acc + Number(c.desconto_pct || 0), 0);
    return `${(soma / ativos.length).toFixed(1).replace('.', ',')}%`;
  });
  protected readonly salvando = signal(false);
  protected readonly modalForm = signal(false);
  protected readonly editando = signal<M.ContratoCorporativo | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    empresa: ['', [Validators.required, Validators.minLength(3)]],
    codigo: ['', [Validators.required, Validators.minLength(4)]],
    desconto_pct: [10, [Validators.required, Validators.min(0.5), Validators.max(100)]],
    vigente_de: ['', Validators.required],
    vigente_ate: ['', Validators.required],
    contato: [''],
    email: [''],
    notas: [''],
  });

  ngOnInit(): void {
    this.carregar();
  }

  protected dataBr(iso: string): string {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  protected expirado(c: M.ContratoCorporativo): boolean {
    return c.vigente_ate < new Date().toISOString().slice(0, 10);
  }

  private carregar(): void {
    this.contratosApi.listarContratos().subscribe({
      next: (l) => {
        this.contratos.set(l);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erroMsg('Falha ao carregar contratos.');
      },
    });
  }

  protected abrirForm(c: M.ContratoCorporativo | null): void {
    this.editando.set(c);
    this.form.reset({
      empresa: c?.empresa ?? '',
      codigo: c?.codigo ?? '',
      desconto_pct: Number(c?.desconto_pct ?? 10),
      vigente_de: c?.vigente_de ?? new Date().toISOString().slice(0, 10),
      vigente_ate: c?.vigente_ate ?? '',
      contato: c?.contato ?? '',
      email: c?.email ?? '',
      notas: c?.notas ?? '',
    });
    this.modalForm.set(true);
  }

  protected salvar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input: M.ContratoInput = {
      empresa: v.empresa.trim(),
      codigo: v.codigo.trim().toUpperCase(),
      desconto_pct: v.desconto_pct,
      vigente_de: v.vigente_de,
      vigente_ate: v.vigente_ate,
      contato: v.contato.trim() || null,
      email: v.email.trim() || null,
      notas: v.notas.trim() || null,
    };
    this.salvando.set(true);
    const c = this.editando();
    const req = c
      ? this.contratosApi.atualizarContrato(c.id, input)
      : this.contratosApi.criarContrato(input);
    req.subscribe({
      next: (salvo) => {
        this.salvando.set(false);
        this.modalForm.set(false);
        this.upsert(salvo);
        this.notify.ok('Contrato salvo.');
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erroMsg(e?.error?.erro ?? 'Falha ao salvar.');
      },
    });
  }

  // Aplica a entidade retornada direto na lista — evita o refetch de 1 RTT.
  private upsert(salvo: M.ContratoCorporativo): void {
    this.contratos.update((l) => {
      const i = l.findIndex((c) => c.id === salvo.id);
      const nl = i >= 0 ? l.map((c) => (c.id === salvo.id ? salvo : c)) : [...l, salvo];
      return [...nl].sort((a, b) => a.empresa.localeCompare(b.empresa));
    });
  }

  protected alternar(c: M.ContratoCorporativo): void {
    this.contratosApi.definirContratoAtivo(c.id, !c.ativo).subscribe({
      next: (salvo) => this.upsert(salvo),
      error: () => this.notify.erroMsg('Falha ao alterar o status.'),
    });
  }
}
