// Cliente HTTP dos serviços públicos de geografia e dados cadastrais
// (ViaCEP + REST Countries + BrasilAPI). São APIs externas: não passam pelo
// ApiHttp (que é da clarituz-api) e o interceptor de auth não injeta Bearer
// nelas — ver auth.interceptor.ts.

import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import { BrasilApiCnpj, PaisGeo, RestCountry, ViaCepResponse } from '@core/models/geo.models';

const VIACEP = 'https://viacep.com.br/ws';
const RESTCOUNTRIES = 'https://restcountries.com/v3.1';
const BRASILAPI = 'https://brasilapi.com.br/api';

@Service()
export class GeoApi {
  private readonly http = inject(HttpClient);
  private paises$: Observable<PaisGeo[]> | null = null;

  /** CEP com 8 dígitos -> endereço (logradouro/bairro/cidade/UF). */
  buscarCep(cep: string): Observable<ViaCepResponse> {
    return this.http.get<ViaCepResponse>(`${VIACEP}/${cep}/json/`);
  }

  /** CNPJ com 14 dígitos -> dados cadastrais da Receita (via BrasilAPI). */
  buscarCnpj(cnpj: string): Observable<BrasilApiCnpj> {
    return this.http.get<BrasilApiCnpj>(`${BRASILAPI}/cnpj/v1/${cnpj}`);
  }

  /** Todos os países em português — uma única chamada, cacheada na sessão. */
  listarPaises(): Observable<PaisGeo[]> {
    this.paises$ ??= this.http
      .get<RestCountry[]>(`${RESTCOUNTRIES}/all?fields=name,cca2,translations,idd`)
      .pipe(map(paisesDeRest), shareReplay(1));
    return this.paises$;
  }
}

function paisesDeRest(lista: RestCountry[]): PaisGeo[] {
  return (lista ?? [])
    .map((r): PaisGeo => ({
      cca2: (r.cca2 ?? '').toUpperCase(),
      nome: r.translations?.por?.common ?? r.name?.common ?? '',
      ddi: r.idd?.root ? r.idd.root + (r.idd.suffixes?.[0] ?? '') : null,
    }))
    .filter((p) => p.cca2.length === 2 && !!p.nome)
    .sort((a, b) => (a.cca2 === 'BR' ? -1 : b.cca2 === 'BR' ? 1 : a.nome.localeCompare(b.nome, 'pt-BR')));
}
