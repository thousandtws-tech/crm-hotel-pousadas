import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Inscrição da newsletter — POST /publico/newsletter. */
@Injectable({ providedIn: 'root' })
export class NewsletterService {
  private readonly http = inject(HttpClient);

  public async inscrever(email: string, origem = 'rodape'): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/publico/newsletter`, { email, origem })
      );
      return true;
    } catch {
      return false;
    }
  }
}
