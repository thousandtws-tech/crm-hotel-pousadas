import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthStore } from '@core/services/auth.store';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-split">
      <div class="login-image">

      </div>

      <div class="login-form-panel">
        <div class="login-card">
          <div class="login-logo">
            <img src="logo.svg" alt="Pousada Espírito do Mar" />
          </div>

          <p class="login-box-msg">Acesse sua conta</p>

          @if (erro()) {
            <div class="alert-err" role="alert">{{ erro() }}</div>
          }

          <form [formGroup]="form" (ngSubmit)="entrar()">
            <div class="form-group">
              <input
                type="text"
                class="login-input"
                formControlName="login"
                placeholder="Login"
                autocomplete="username"
              />
              <mat-icon class="form-feedback" aria-hidden="true">person</mat-icon>
            </div>
            <div class="form-group">
              <input
                type="password"
                class="login-input"
                formControlName="senha"
                placeholder="Senha"
                autocomplete="current-password"
              />
              <mat-icon class="form-feedback" aria-hidden="true">lock</mat-icon>
            </div>
            <button
              class="btn-entrar"
              type="submit"
              [disabled]="form.invalid || carregando()"
            >
              @if (carregando()) {
                <mat-spinner diameter="18" />
              } @else {
                Acessar
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
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
