import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config/api-url';

/** Inscrição da newsletter — POST /publico/newsletter. */
@Injectable({ providedIn: 'root' })
export class NewsletterService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_URL);

  public async inscrever(email: string, origem = 'rodape'): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${this.api}/publico/newsletter`, { email, origem })
      );
      return true;
    } catch {
      return false;
    }
  }
}
