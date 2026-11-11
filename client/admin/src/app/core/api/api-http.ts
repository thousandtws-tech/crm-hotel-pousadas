// Base compartilhada dos clientes HTTP por domínio. Todas as chamadas passam pelo
// interceptor de auth (Bearer + rotação de refresh em 401).

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type Query = Record<string, string | number | boolean | null | undefined>;

export function params(q: Query): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  }
  return p;
}

export abstract class ApiHttp {
  protected readonly http = inject(HttpClient);
  protected readonly base = environment.apiUrl;

  protected get<T>(path: string, q: Query = {}): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, { params: params(q) });
  }
  protected post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body);
  }
  protected put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${this.base}${path}`, body);
  }
  protected patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.base}${path}`, body);
  }
  protected del<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.base}${path}`);
  }
}
