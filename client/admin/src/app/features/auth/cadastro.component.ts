import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@core/services/api.service';
import { AuthStore } from '@core/services/auth.store';

function senhasIguais(c: AbstractControl): ValidationErrors | null {
  const senha = c.get('senha')?.value;
  const confirmar = c.get('confirmar')?.value;
  return senha && confirmar && senha !== confirmar ? { senhasDiferentes: true } : null;
}

@Component({
  selector: 'app-cadastro',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-split">
      <div class="login-image">
        <div class="login-image-content">
          <img class="brand" src="logo.svg" alt="" />
          <h2>Gestão completa para sua <b>pousada</b></h2>
          <p>
            Reservas, check-in, frigobar, financeiro e muito mais — tudo em um
            só lugar, em tempo real.
          </p>
        </div>
      </div>

      <div class="login-form-panel">
        <div class="login-card">
          <div class="login-logo">
            <img src="logo.svg" alt="Pousada Espírito do Mar" />
          </div>

          @if (criado()) {
            <div class="caixa-sucesso">
              <h3>Administrador criado!</h3>
              <p>Entre normalmente com seu login e senha.</p>
              <a class="btn-entrar" routerLink="/login">Ir para o login</a>
            </div>
          } @else {
            <p class="login-box-msg">
              Crie sua conta de administrador.<br />
              Recepção e gerente são cadastrados no painel.
            </p>

            @if (erro()) {
              <div class="alert-err" role="alert">{{ erro() }}</div>
            }
            @if (form.hasError('senhasDiferentes') && (form.get('confirmar')?.touched ?? false)) {
              <div class="alert-err" role="alert">As senhas não coincidem.</div>
            }

            <form [formGroup]="form" (ngSubmit)="cadastrar()">
              <div class="form-group">
                <input
                  type="text"
                  class="login-input"
                  formControlName="nome"
                  placeholder="Nome completo"
                  autocomplete="name"
                />
                <mat-icon class="form-feedback" aria-hidden="true">badge</mat-icon>
              </div>
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
                  placeholder="Senha (mínimo 8 caracteres)"
                  autocomplete="new-password"
                />
                <mat-icon class="form-feedback" aria-hidden="true">lock</mat-icon>
              </div>
              <div class="form-group">
                <input
                  type="password"
                  class="login-input"
                  formControlName="confirmar"
                  placeholder="Confirmar senha"
                  autocomplete="new-password"
                />
                <mat-icon class="form-feedback" aria-hidden="true">lock_outline</mat-icon>
              </div>
              <button
                class="btn-entrar"
                type="submit"
                [disabled]="form.invalid || carregando()"
              >
                @if (carregando()) {
                  <mat-spinner diameter="18" />
                } @else {
                  Cadastrar
                }
              </button>
            </form>

            <p class="login-links">
              Já tem conta? <a routerLink="/login">Entrar</a>
            </p>
          }
          <p class="login-contato">contato&#64;clarituz.com.br | (19) 99555-1577</p>
        </div>
      </div>
    </div>
  `,
})
export class CadastroComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly criado = signal(false);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly form = this.fb.nonNullable.group(
    {
      nome: ['', Validators.required],
      login: ['', Validators.required],
      senha: ['', [Validators.required, Validators.minLength(8)]],
      confirmar: ['', Validators.required],
    },
    { validators: senhasIguais },
  );

  cadastrar(): void {
    if (this.form.invalid) return;
    this.carregando.set(true);
    this.erro.set(null);
    const { nome, login, senha } = this.form.getRawValue();
    this.api.registrar({ nome, login, senha }).subscribe({
      next: () => {
        // conta de admin já nasce ativa — entra direto no painel
        this.auth.login(login, senha).subscribe({
          next: () => void this.router.navigateByUrl('/dashboard'),
          error: () => {
            this.carregando.set(false);
            this.criado.set(true);
          },
        });
      },
      error: (e: { error?: { erro?: { mensagem?: string } } }) => {
        this.carregando.set(false);
        this.erro.set(e.error?.erro?.mensagem ?? 'Não foi possível concluir o cadastro.');
      },
    });
  }
}
