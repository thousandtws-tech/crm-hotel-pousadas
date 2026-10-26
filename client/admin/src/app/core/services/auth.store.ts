// Estado de autenticação — access+refresh tokens persistidos em
// localStorage, usuário como signal. Rotação de refresh é serializada
// (single-flight) para chamadas concorrentes não dispararem 2 rotações.

import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { FuncionarioView, TokenResponse } from '@core/models/api.models';

const K_ACCESS = 'clarituz.access';
const K_REFRESH = 'clarituz.refresh';
const K_USER = 'clarituz.user';

@Service()
export class AuthStore {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly _user = signal<FuncionarioView | null>(this.readUser());
  readonly user = this._user.asReadonly();
  readonly autenticado = computed(() => this._user() !== null && this.accessToken() !== null);
  readonly isAdmin = computed(() => this._user()?.nivel === 1);

  private refreshing: Observable<boolean> | null = null;

  accessToken(): string | null {
    return localStorage.getItem(K_ACCESS);
  }

  refreshToken(): string | null {
    return localStorage.getItem(K_REFRESH);
  }

  login(login: string, senha: string): Observable<FuncionarioView> {
    return this.api.login(login, senha).pipe(
      tap((r) => this.persist(r)),
      map((r) => r.funcionario),
    );
  }

  logout(): void {
    const rt = this.refreshToken();
    if (rt) this.api.logout(rt).subscribe({ error: () => undefined });
    this.limpar();
    void this.router.navigateByUrl('/login');
  }

  /** Rotação single-flight: retorna true quando a sessão foi renovada. */
  tentarRefresh(): Observable<boolean> {
    const rt = this.refreshToken();
    if (!rt) return of(false);
    this.refreshing ??= this.api.refresh(rt).pipe(
      tap((r) => this.persist(r)),
      map(() => true),
      catchError(() => {
        this.limpar();
        return of(false);
      }),
      shareReplay(1),
    );
    return this.refreshing.pipe(
      tap(() => {
        this.refreshing = null;
      }),
    );
  }

  sairSilencioso(): void {
    this.limpar();
    void this.router.navigateByUrl('/login');
  }

  private persist(r: TokenResponse): void {
    localStorage.setItem(K_ACCESS, r.access_token);
    localStorage.setItem(K_REFRESH, r.refresh_token);
    localStorage.setItem(K_USER, JSON.stringify(r.funcionario));
    this._user.set(r.funcionario);
  }

  private limpar(): void {
    localStorage.removeItem(K_ACCESS);
    localStorage.removeItem(K_REFRESH);
    localStorage.removeItem(K_USER);
    this._user.set(null);
  }

  private readUser(): FuncionarioView | null {
    try {
      const raw = localStorage.getItem(K_USER);
      return raw ? (JSON.parse(raw) as FuncionarioView) : null;
    } catch {
      return null;
    }
  }
}
