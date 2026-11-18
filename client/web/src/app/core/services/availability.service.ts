import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config/api-url';
import { SearchQuery, SearchResponse } from '../models/search.models';

/**
 * Adapter do endpoint público `POST /publico/disponibilidade/busca`.
 * O corpo é a consulta serializada — o servidor regera e revalida todos
 * os períodos candidatos, então a prévia local nunca é autoridade.
 */
@Injectable({ providedIn: 'root' })
export class AvailabilityService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_URL);

  public buscar(query: SearchQuery): Promise<SearchResponse> {
    return firstValueFrom(
      this.http.post<SearchResponse>(`${this.api}/publico/disponibilidade/busca`, query),
    );
  }
}
