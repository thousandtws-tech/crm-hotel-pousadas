import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SearchQuery, SearchResponse } from '../models/search.models';

const API = environment.apiUrl;

/**
 * Adapter do endpoint público `POST /publico/disponibilidade/busca`.
 * O corpo é a consulta serializada — o servidor regera e revalida todos
 * os períodos candidatos, então a prévia local nunca é autoridade.
 */
@Injectable({ providedIn: 'root' })
export class AvailabilityService {
  private readonly http = inject(HttpClient);

  public buscar(query: SearchQuery): Promise<SearchResponse> {
    return firstValueFrom(
      this.http.post<SearchResponse>(`${API}/publico/disponibilidade/busca`, query),
    );
  }
}
