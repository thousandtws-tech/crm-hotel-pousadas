// Lógica e estado de login — separada da camada de UI (login.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, Directive } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthStore } from '@core/services/auth.store';

@Directive()
export abstract class LoginStore {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly carregando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly form = this.fb.nonNullable.group({
    login: ['', Validators.required],
    senha: ['', Validators.required],
  });

  entrar(): void {
    if (this.form.invalid) return;
    this.carregando.set(true);
    this.erro.set(null);
    const { login, senha } = this.form.getRawValue();
    this.auth.login(login, senha).subscribe({
      next: () => void this.router.navigateByUrl('/dashboard'),
      error: (e: { error?: { erro?: { mensagem?: string } } }) => {
        this.carregando.set(false);
        this.erro.set(e.error?.erro?.mensagem ?? 'Usuário ou senha inválidos.');
      },
    });
  }
}
