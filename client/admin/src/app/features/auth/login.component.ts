import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthStore } from '@core/services/auth.store';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-split">
      <div class="login-image" aria-hidden="true">
        <div class="login-image-content">
          <img class="brand" src="logo.svg" alt="" />
          <div class="li-copy">
            <h2>A gestão completa<br />da sua pousada, <b>em um só lugar.</b></h2>
            <span class="li-rule"></span>
            <p>Reservas, recepção, financeiro e operação — em tempo real, do check-in ao checkout.</p>
            <ul class="li-feats">
              <li><mat-icon>event_available</mat-icon> Reservas e recepção</li>
              <li><mat-icon>account_balance_wallet</mat-icon> Financeiro integrado</li>
              <li><mat-icon>monitoring</mat-icon> Dados em tempo real</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="login-form-panel">
        <div class="login-card">
          <img class="login-logo" src="logo.svg" alt="Pousada Espírito do Mar" />
          <p class="login-eyebrow">Painel de gestão</p>
          <h1 class="login-title">Acesse sua conta</h1>

          @if (erro()) {
            <div class="alert-err" role="alert">{{ erro() }}</div>
          }

          <form [formGroup]="form" (ngSubmit)="entrar()">
            <label class="form-group">
              <mat-icon class="form-ico" aria-hidden="true">person</mat-icon>
              <input
                type="text"
                class="login-input"
                formControlName="login"
                placeholder="Login"
                autocomplete="username"
              />
            </label>
            <label class="form-group">
              <mat-icon class="form-ico" aria-hidden="true">lock</mat-icon>
              <input
                type="password"
                class="login-input"
                formControlName="senha"
                placeholder="Senha"
                autocomplete="current-password"
              />
            </label>
            <button
              class="btn-entrar"
              type="submit"
              [disabled]="form.invalid || carregando()"
            >
              @if (carregando()) {
                <mat-spinner diameter="18" />
              } @else {
                Acessar
                <mat-icon class="btn-ico" aria-hidden="true">arrow_forward</mat-icon>
              }
            </button>
          </form>
        </div>
        <p class="login-foot">INNJOY · Sistema de gestão hoteleira</p>
      </div>
    </div>
  `,
  styles: `
    .login-split {
      display: flex;
      min-height: 100vh;
      background: #f4f6f8;
    }

    /* -------- painel da marca -------- */
    .login-image {
      display: none;
      flex: 1.25;
      position: relative;
      background:
        linear-gradient(180deg, rgba(3, 43, 56, 0.45) 0%, rgba(3, 43, 56, 0.82) 78%),
        url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2400&q=90')
        center / cover no-repeat #032b38;
    }
    .login-image-content {
      position: relative;
      z-index: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 3.2rem 3.5rem;
      color: #fff;
    }
    .login-image-content .brand {
      width: 190px;
      height: auto;
      filter: brightness(0) invert(1);
    }
    .li-copy h2 {
      font-family: var(--font-display);
      font-size: 2.6rem;
      font-weight: 500;
      line-height: 1.18;
      margin: 0;
      letter-spacing: 0.01em;
    }
    .li-copy h2 b { font-weight: 700; }
    .li-rule {
      display: block;
      width: 44px; height: 2px;
      background: #c9a45c;
      margin: 1.4rem 0 1.1rem;
    }
    .li-copy p {
      color: rgba(255, 255, 255, 0.82);
      margin: 0;
      max-width: 26rem;
      font-size: 0.95rem;
      line-height: 1.6;
    }
    .li-feats {
      display: flex; gap: 1.4rem; flex-wrap: wrap;
      list-style: none; padding: 0; margin: 1.6rem 0 0;
    }
    .li-feats li {
      display: inline-flex; align-items: center; gap: 0.45rem;
      font-size: 0.78rem; font-weight: 600; letter-spacing: 0.03em;
      color: rgba(255, 255, 255, 0.75);
    }
    .li-feats mat-icon { font-size: 17px; width: 17px; height: 17px; color: #c9a45c; }

    /* -------- painel do formulário -------- */
    .login-form-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1.25rem;
      gap: 1.4rem;
    }
    .login-card {
      width: 100%;
      max-width: 400px;
      background: #fff;
      padding: 2.6rem 2.4rem 2.2rem;
      border-radius: 14px;
      border: 1px solid #e8eef1;
      box-shadow: 0 12px 40px -12px rgba(3, 43, 56, 0.18);
    }
    .login-logo { display: block; height: 64px; width: auto; margin: 0 auto 1.1rem; }
    .login-eyebrow {
      text-align: center;
      margin: 0 0 0.3rem;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #8fa3ab;
    }
    .login-title {
      font-family: var(--font-display);
      text-align: center;
      font-size: 1.9rem;
      font-weight: 600;
      color: #054054;
      margin: 0 0 1.6rem;
      letter-spacing: 0.01em;
    }

    .form-group {
      position: relative;
      display: block;
      margin-bottom: 0.9rem;
    }
    .form-ico {
      position: absolute;
      top: 50%; left: 13px;
      transform: translateY(-50%);
      font-size: 18px; width: 18px; height: 18px;
      color: #8fa3ab;
      pointer-events: none;
      transition: color 0.15s;
    }
    .login-input {
      width: 100%;
      height: 46px;
      padding: 6px 14px 6px 40px;
      border: 1px solid #dce6ea;
      border-radius: 9px;
      font-family: inherit;
      font-size: 0.92rem;
      color: #33424c;
      background: #fbfdfe;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .login-input::placeholder { color: #9fb3bc; }
    .login-input:focus {
      outline: none;
      border-color: #054054;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.1);
    }
    .form-group:focus-within .form-ico { color: #054054; }

    .alert-err {
      display: flex; align-items: center; gap: 6px;
      background: #fdf0ef;
      border: 1px solid #f3d3cf;
      color: #a94442;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.84rem;
      margin-bottom: 1rem;
    }

    .btn-entrar {
      width: 100%;
      height: 46px;
      margin-top: 0.35rem;
      border: none;
      border-radius: 9px;
      background: #054054;
      color: #fff;
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
    }
    .btn-entrar .btn-ico { font-size: 18px; width: 18px; height: 18px; transition: transform 0.15s; }
    .btn-entrar:hover:not(:disabled) {
      background: #042f3d;
      box-shadow: 0 8px 20px -8px rgba(5, 64, 84, 0.55);
      transform: translateY(-1px);
    }
    .btn-entrar:hover:not(:disabled) .btn-ico { transform: translateX(3px); }
    .btn-entrar:disabled { opacity: 0.55; cursor: default; }

    .login-foot {
      margin: 0;
      font-size: 0.74rem;
      letter-spacing: 0.05em;
      color: #8fa3ab;
    }

    @media (min-width: 861px) {
      .login-image { display: block; }
    }
    @media (max-width: 860px) {
      .login-form-panel {
        background:
          linear-gradient(180deg, rgba(3, 43, 56, 0.55) 0%, rgba(3, 43, 56, 0.9) 70%),
          url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85')
          center / cover no-repeat #032b38;
      }
      .login-foot { color: rgba(255, 255, 255, 0.6); }
    }
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
