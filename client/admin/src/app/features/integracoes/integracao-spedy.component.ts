import { DatePipe, JsonPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { Notify } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  ROTULO_EVENTO,
  CampoCredencial,
  estadoDe,
} from './integracoes.const';

interface SpedyCfg {
  empresa_id?: string;
  empresa_cnpj?: string;
  empresa_razao?: string;
  empresa_cnpj_divergente?: boolean;
  municipio_codigo?: string;
  municipio_nome?: string;
  fiscal_service_code?: string;
  fiscal_city_service_code?: string;
  fiscal_cnae?: string;
  fiscal_nbs?: string;
  fiscal_national_taxation_code?: string;
  fiscal_taxation_type?: string;
  fiscal_iss_rate?: string;
  fiscal_descricao?: string;
  /** Ambiente do MODELO fiscal — independente do host da API (sandbox ≠ teste). */
  fiscal_ambiente?: string;
  fiscal_issue_type?: string;
  webhook_registrado?: boolean;
}

function cfg(i: M.IntegracaoView | null): SpedyCfg {
  return (i?.config ?? {}) as SpedyCfg;
}

/**
 * Detalhe Spedy (categoria Fiscal) — NFS-e de hospedagem e serviços.
 * Dois ambientes de API (producao/sandbox), e o ambiente do modelo fiscal
 * é configurável à parte: sandbox pode emitir nota REAL se o modelo estiver
 * em produção — a tela alerta explicitamente antes de salvar.
 */
@Component({
  selector: 'app-integracao-spedy',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe, JsonPipe],
  template: `
    <div class="pag">
      <a class="volta" routerLink="/integracoes"> <mat-icon>arrow_back</mat-icon> Integrações </a>

      @if (carregando()) {
        <div class="inner-card" aria-hidden="true">
          <span class="skel sk-t"></span>
          <span class="skel sk-p"></span>
          <span class="skel sk-m"></span>
          <span class="skel sk-m"></span>
        </div>
      } @else if (falhou() || !i()) {
        <div class="inner-card vazio-card">
          <mat-icon>cloud_off</mat-icon>
          <p>Não foi possível carregar esta integração.</p>
          <button type="button" class="btn-sec" (click)="carregar()">Tentar novamente</button>
        </div>
      } @else {
        @if (i(); as int) {
          <div class="cab">
            <div>
              <p class="eyebrow">Configurações · Integrações · Fiscal</p>
              <h2 class="titulo">
                Spedy — NFS-e
                <span class="env" [class.env-teste]="ambiente() === 'teste'">
                  {{ ambiente() === 'producao' ? 'Produção' : 'Sandbox' }}
                </span>
              </h2>
              <p class="sub">
                Emissão de NFS-e de hospedagem vinculada às reservas — credenciais cifradas no
                servidor.
              </p>
            </div>
            <div class="cab-pills">
              <span [class]="'pill ' + estadoDe(int.estado).pill">
                {{ estadoDe(int.estado).rotulo }}
              </span>
            </div>
          </div>

          @if (ambiente() === 'teste' && cfgDe(int).fiscal_ambiente === 'producao') {
            <div class="aviso aviso-perigo" role="alert">
              <mat-icon>warning</mat-icon>
              <span>
                <strong>Atenção:</strong> a API está em sandbox, mas o modelo fiscal está
                configurado como <strong>produção</strong> — uma emissão aqui gera documento fiscal
                REAL. Mude o ambiente do modelo para teste se a intenção for homologar.
              </span>
            </div>
          }

          @if (conflito()) {
            <div class="aviso" role="alert">
              <mat-icon>warning</mat-icon>
              <span>
                Outro administrador alterou esta integração. Recarregue para ver a versão atual
                antes de salvar.
              </span>
              <button type="button" class="mini-btn" (click)="carregar()">Recarregar</button>
            </div>
          }

          <!-- ================= Credenciais ================= -->
          <div class="inner-card">
            <h3 class="card-h">Credenciais</h3>
            <p class="card-sub">
              Campos em branco mantêm o valor atual; “Limpar” remove o credencial ao salvar.
            </p>

            @for (c of campos; track c.nome) {
              <div class="dl">
                <span class="dl-rotulo">
                  {{ c.rotulo }}{{ c.obrigatorio ? ' *' : '' }}
                  @if (configurado(c)) {
                    <span class="conf">•••••• configurado</span>
                  }
                </span>
                <span class="segredo-linha">
                  <input
                    class="input-inn"
                    [type]="c.segredo ? 'password' : 'text'"
                    [formControl]="controle(c.nome)"
                    [placeholder]="
                      limpar()[c.nome]
                        ? 'Será removido ao salvar'
                        : configurado(c)
                          ? 'Deixe em branco para manter'
                          : (c.placeholder ?? '')
                    "
                    [disabled]="!!limpar()[c.nome]"
                    [attr.autocomplete]="c.segredo ? 'new-password' : null"
                    [attr.aria-label]="c.rotulo"
                  />
                  @if (configurado(c)) {
                    <button
                      type="button"
                      class="mini-btn"
                      [class.perigo]="limpar()[c.nome]"
                      (click)="alternarLimpar(c.nome)"
                    >
                      {{ limpar()[c.nome] ? 'Desfazer' : 'Limpar' }}
                    </button>
                  }
                </span>
                @if (c.dica) {
                  <span class="mini">{{ c.dica }}</span>
                }
              </div>
            }

            <label class="dl">
              <span class="dl-rotulo">Nome da conta</span>
              <input
                class="input-inn"
                [formControl]="fNomeConta"
                placeholder="Ex.: Spedy da pousada"
              />
            </label>

            <div class="acoes">
              <button type="button" class="btn-pri" (click)="salvar()" [disabled]="salvando()">
                {{ salvando() ? 'Salvando…' : 'Salvar credenciais' }}
              </button>
            </div>
          </div>

          <!-- ================= Empresa ================= -->
          <div class="inner-card">
            <h3 class="card-h">Empresa</h3>
            <p class="card-sub">
              A X-Api-Key é vinculada a uma empresa no painel Spedy. Consulte para confirmar o
              vínculo antes de emitir.
            </p>

            @if (cfgDe(int).empresa_id; as empId) {
              <div class="dl">
                <span class="dl-rotulo">Empresa vinculada</span>
                <span class="dl-valor">
                  <strong>{{ cfgDe(int).empresa_razao || empId }}</strong>
                  @if (cfgDe(int).empresa_cnpj) {
                    <span class="mini">CNPJ {{ cfgDe(int).empresa_cnpj }}</span>
                  }
                  @if (cfgDe(int).empresa_cnpj_divergente) {
                    <span class="mini erro">
                      CNPJ divergente do estabelecimento — eventos fiscais de outras empresas são
                      ignorados.
                    </span>
                  }
                </span>
              </div>
            } @else {
              <p class="mini mut">Nenhuma empresa vinculada ainda.</p>
            }

            <div class="acoes">
              <button
                type="button"
                class="btn-sec"
                (click)="vincularEmpresa()"
                [disabled]="vinculando() || int.estado === 'nao_configurada'"
              >
                <mat-icon>business</mat-icon>
                {{ vinculando() ? 'Consultando…' : 'Consultar empresa na Spedy' }}
              </button>
            </div>
          </div>

          <!-- ================= Município ================= -->
          <div class="inner-card">
            <h3 class="card-h">Município de emissão</h3>
            <p class="card-sub">
              A NFS-e é municipal — cada prefeitura exige provedor e parametrização próprios.
              Consulte pelo código IBGE.
            </p>

            @if (cfgDe(int).municipio_codigo; as mun) {
              <div class="dl">
                <span class="dl-rotulo">Município configurado</span>
                <span class="dl-valor">
                  <strong>{{ cfgDe(int).municipio_nome || mun }}</strong>
                  <span class="mini">IBGE {{ mun }}</span>
                </span>
              </div>
            }

            <div class="consulta-linha">
              <label class="dl-rotulo" for="ibge">Código IBGE</label>
              <input
                id="ibge"
                class="input-inn w140"
                [formControl]="fIbge"
                placeholder="Ex.: 3550308"
                maxlength="7"
                inputmode="numeric"
              />
              <button
                type="button"
                class="btn-sec"
                (click)="consultarMunicipio()"
                [disabled]="consultandoMun() || !fIbge.value.trim()"
              >
                {{ consultandoMun() ? 'Consultando…' : 'Consultar' }}
              </button>
            </div>

            @if (municipio(); as m) {
              <div class="res res-ok" role="status">
                <mat-icon>location_city</mat-icon>
                <span class="mono wrap">{{ m | json }}</span>
              </div>
              <button
                type="button"
                class="btn-sec"
                (click)="usarMunicipio()"
                [disabled]="salvandoCfg()"
              >
                <mat-icon>check</mat-icon> Usar este município na emissão
              </button>
            }
          </div>

          <!-- ================= Parametrização fiscal ================= -->
          <div class="inner-card">
            <h3 class="card-h">Parametrização fiscal</h3>
            <p class="card-sub">
              Códigos de serviço e tributação aprovados pelo contador — são enviados em toda NFS-e.
            </p>

            <div class="grid2">
              <label class="dl">
                <span class="dl-rotulo">Código de serviço federal (LC 116)</span>
                <input class="input-inn" [formControl]="fServiceCode" placeholder="Ex.: 9.01" />
              </label>
              <label class="dl">
                <span class="dl-rotulo">Código de serviço municipal</span>
                <input class="input-inn" [formControl]="fCityServiceCode" />
              </label>
              <label class="dl">
                <span class="dl-rotulo">CNAE</span>
                <input class="input-inn" [formControl]="fCnae" placeholder="Ex.: 5510-8/01" />
              </label>
              <label class="dl">
                <span class="dl-rotulo">NBS</span>
                <input class="input-inn" [formControl]="fNbs" />
              </label>
              <label class="dl">
                <span class="dl-rotulo">Tributação nacional</span>
                <input class="input-inn" [formControl]="fNatTax" />
              </label>
              <label class="dl">
                <span class="dl-rotulo">Tipo de tributação</span>
                <input class="input-inn" [formControl]="fTaxType" />
              </label>
              <label class="dl">
                <span class="dl-rotulo">Alíquota ISS (%)</span>
                <input
                  class="input-inn"
                  [formControl]="fIssRate"
                  placeholder="Ex.: 5"
                  inputmode="decimal"
                />
              </label>
              <label class="dl">
                <span class="dl-rotulo">Ambiente do modelo fiscal</span>
                <select class="input-inn" [formControl]="fFiscalAmbiente">
                  <option value="">— usar padrão do provedor —</option>
                  <option value="teste">Teste (homologação)</option>
                  <option value="producao">Produção (documento real)</option>
                </select>
              </label>
            </div>

            <label class="dl">
              <span class="dl-rotulo">Descrição do serviço na nota</span>
              <input
                class="input-inn"
                [formControl]="fDescricao"
                placeholder="Ex.: Serviço de hospedagem"
              />
            </label>

            @if (fFiscalAmbiente.value === 'producao') {
              <div class="aviso aviso-perigo" role="alert">
                <mat-icon>warning</mat-icon>
                <span>
                  Modelo fiscal em <strong>produção</strong>: as emissões geram documentos fiscais
                  reais{{ ambiente() === 'teste' ? ' mesmo pela API sandbox' : '' }}.
                </span>
              </div>
            }

            <div class="acoes">
              <button
                type="button"
                class="btn-pri"
                (click)="salvarConfig()"
                [disabled]="salvandoCfg()"
              >
                {{ salvandoCfg() ? 'Salvando…' : 'Salvar parametrização' }}
              </button>
            </div>
          </div>

          <!-- ================= Webhook ================= -->
          <div class="inner-card">
            <h3 class="card-h">Webhook</h3>
            <p class="card-sub">
              O status da NFS-e chega por evento assinado — registre a URL na empresa remota.
            </p>

            @if (int.webhook_url) {
              <span class="segredo-linha">
                <input
                  class="input-inn mono"
                  readonly
                  [value]="int.webhook_url"
                  aria-label="URL do webhook"
                />
                <button type="button" class="mini-btn" (click)="copiar(int.webhook_url!)">
                  <mat-icon>content_copy</mat-icon> Copiar
                </button>
              </span>
            }

            <div class="acoes">
              <button
                type="button"
                class="btn-sec"
                (click)="registrarWebhook()"
                [disabled]="registrandoHook() || !int.webhook_url"
              >
                <mat-icon>webhook</mat-icon>
                {{ registrandoHook() ? 'Registrando…' : 'Registrar webhook na Spedy' }}
              </button>
              @if (cfgDe(int).webhook_registrado) {
                <span class="pill pill-ok"><mat-icon>check</mat-icon> Registrado</span>
              }
            </div>

            <div class="verif">
              @if (int.ultima_verificacao_em) {
                <span class="mini">
                  Última verificação:
                  {{ int.ultima_verificacao_em | date: 'dd/MM/yyyy HH:mm' }}
                  — {{ int.verificacao_status === 'ok' ? 'ok' : 'falhou' }}
                </span>
                @if (int.verificacao_status === 'falha' && int.verificacao_erro) {
                  <span class="mini erro">{{ int.verificacao_erro }}</span>
                }
              } @else {
                <span class="mini">Nunca verificada.</span>
              }

              <button type="button" class="btn-sec" (click)="testar()" [disabled]="testando()">
                <mat-icon>network_check</mat-icon>
                {{ testando() ? 'Testando…' : 'Testar conexão' }}
              </button>
            </div>

            @if (teste(); as t) {
              <div
                class="res"
                [class.res-ok]="t.verificacao_status === 'ok'"
                [class.res-erro]="t.verificacao_status !== 'ok'"
                role="status"
              >
                <mat-icon>{{ t.verificacao_status === 'ok' ? 'check_circle' : 'error' }}</mat-icon>
                <span>
                  @if (t.verificacao_status === 'ok') {
                    Conexão verificada{{ t.nome_conta ? ' — ' + t.nome_conta : '' }}.
                  } @else {
                    Falha na verificação{{ t.mensagem ? ' — ' + t.mensagem : '' }}.
                  }
                </span>
              </div>
            }
          </div>

          <!-- ================= Operação ================= -->
          <div class="inner-card">
            <h3 class="card-h">Operação</h3>
            <div class="op-linha">
              <div>
                <strong>Integração habilitada</strong>
                <p class="mini">
                  Quando desabilitada, novas emissões são bloqueadas — documentos já transmitidos
                  continuam reconciliáveis.
                </p>
              </div>
              <button
                type="button"
                class="sw"
                [class.on]="int.habilitado"
                role="switch"
                [attr.aria-checked]="int.habilitado"
                aria-label="Integração habilitada"
                (click)="alternarHabilitado(int)"
                [disabled]="alternando()"
              >
                <span class="sw-dot"></span>
              </button>
            </div>
          </div>

          <!-- ================= Eventos ================= -->
          <div class="inner-card">
            <h3 class="card-h">Eventos de webhook</h3>
            <p class="card-sub">Últimos eventos fiscais recebidos (assinatura verificada).</p>

            @if (carregandoEventos()) {
              <p class="vazio">Carregando…</p>
            } @else if (eventos().length === 0) {
              <p class="vazio">
                Nenhum evento recebido ainda — quando a Spedy chamar a URL acima, os eventos
                aparecem aqui.
              </p>
            } @else {
              <table class="tab">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Status</th>
                    <th>Recebido em</th>
                    <th>Último erro</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of eventos(); track e.event_id) {
                    <tr>
                      <td>
                        <strong class="ev-tipo">{{ e.event_type }}</strong>
                        <span class="mini ev-id">{{ e.event_id }}</span>
                      </td>
                      <td>
                        <span [class]="'pill ' + pillEvento(e.status)">
                          {{ rotuloEvento(e.status) }}
                        </span>
                      </td>
                      <td class="ev-data">{{ e.recebido_em | date: 'dd/MM/yyyy HH:mm' }}</td>
                      <td class="ev-erro">{{ e.ultimo_erro ?? '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .pag { padding: 20px; display: flex; flex-direction: column; gap: 16px; max-width: 860px; }
    .volta {
      display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem;
      color: #4b95ab; text-decoration: none; font-weight: 600;
    }
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .cab-pills { display: flex; gap: 8px; }
    .eyebrow { margin: 0; font-size: 0.72rem; font-weight: 700; color: #4b95ab; text-transform: uppercase; letter-spacing: 0.1em; }
    .titulo { margin: 2px 0 4px; font-size: 1.5rem; font-weight: 800; color: #0c3c54; display: flex; align-items: center; gap: 10px; }
    .sub { margin: 0; font-size: 0.88rem; color: #666; }
    .env {
      font-size: 0.68rem; font-weight: 800; padding: 3px 10px; border-radius: 999px;
      background: #0c3c54; color: #fff; letter-spacing: 0.05em; vertical-align: middle;
    }
    .env-teste { background: #b45309; }
    .inner-card {
      background: #fff; border: 1px solid #e4eaee; border-radius: 12px;
      padding: 18px 20px; display: flex; flex-direction: column; gap: 12px;
    }
    .vazio-card { align-items: center; text-align: center; color: #777; padding: 36px; }
    .vazio-card mat-icon { font-size: 40px; width: 40px; height: 40px; color: #b5c4cc; }
    .card-h { margin: 0; font-size: 1rem; font-weight: 800; color: #0c3c54; }
    .card-sub { margin: -6px 0 0; font-size: 0.82rem; color: #777; }
    .dl { display: flex; flex-direction: column; gap: 4px; }
    .dl-rotulo { font-size: 0.78rem; font-weight: 700; color: #395; color: #33505e; }
    .dl-valor { font-size: 0.9rem; display: flex; flex-direction: column; gap: 2px; }
    .conf { margin-left: 8px; font-size: 0.72rem; color: #2e7d32; font-weight: 700; }
    .segredo-linha { display: flex; gap: 8px; align-items: center; }
    .input-inn {
      flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid #cfdce2; border-radius: 8px;
      font-size: 0.88rem; background: #fff; color: #12303e;
    }
    .input-inn:focus { outline: 2px solid #4b95ab44; border-color: #4b95ab; }
    .w140 { max-width: 140px; }
    .mono { font-family: ui-monospace, monospace; font-size: 0.8rem; }
    .wrap { word-break: break-all; white-space: pre-wrap; }
    .mini { font-size: 0.75rem; color: #7a8a92; }
    .mini.erro, .erro { color: #b3261e; }
    .mut { color: #9aa8ae; }
    .acoes { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
    .btn-pri, .btn-sec, .mini-btn {
      display: inline-flex; align-items: center; gap: 6px; border: 0; cursor: pointer;
      border-radius: 8px; font-weight: 700; font-size: 0.85rem; padding: 10px 16px;
    }
    .btn-pri { background: #0c3c54; color: #fff; }
    .btn-pri:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-sec { background: #eef4f6; color: #0c3c54; border: 1px solid #cfdce2; }
    .btn-sec:disabled { opacity: 0.6; cursor: not-allowed; }
    .mini-btn {
      padding: 6px 10px; font-size: 0.75rem; background: #eef4f6; color: #0c3c54;
      border: 1px solid #cfdce2;
    }
    .mini-btn.perigo { color: #b3261e; border-color: #e6b8b4; }
    .aviso {
      display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px;
      border-radius: 10px; background: #fef7e0; border: 1px solid #e8d48b;
      font-size: 0.85rem; color: #5d4a08;
    }
    .aviso-perigo { background: #fdeceb; border-color: #f0b7b3; color: #7a1c15; }
    .aviso mat-icon { color: inherit; }
    .consulta-linha { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .res {
      display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px;
      border-radius: 8px; font-size: 0.85rem;
    }
    .res-ok { background: #e8f5e9; color: #1b5e20; }
    .res-erro { background: #fdeceb; color: #7a1c15; }
    .verif { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .op-linha { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .op-linha p { margin: 2px 0 0; }
    .sw {
      width: 46px; height: 26px; border-radius: 999px; border: 0; cursor: pointer;
      background: #c3cfd5; position: relative; transition: background 0.15s;
    }
    .sw.on { background: #0c3c54; }
    .sw-dot {
      position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
      border-radius: 50%; background: #fff; transition: left 0.15s;
    }
    .sw.on .sw-dot { left: 23px; }
    .sw:disabled { opacity: 0.6; cursor: not-allowed; }
    .tab { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .tab th {
      text-align: left; padding: 8px; font-size: 0.72rem; text-transform: uppercase;
      color: #7a8a92; border-bottom: 1px solid #e4eaee;
    }
    .tab td { padding: 8px; border-bottom: 1px solid #f0f4f6; vertical-align: top; }
    .ev-tipo { display: block; }
    .ev-id { display: block; word-break: break-all; }
    .ev-data { white-space: nowrap; }
    .vazio { color: #8a989e; font-size: 0.85rem; text-align: center; padding: 12px; }
    .pill {
      display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem;
      font-weight: 700; padding: 3px 10px; border-radius: 999px;
    }
    .pill mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .skel {
      display: block; background: linear-gradient(90deg, #eef2f4, #f8fafb, #eef2f4);
      border-radius: 6px; animation: pulse 1.4s infinite;
    }
    .sk-t { width: 220px; height: 26px; }
    .sk-p { width: 70%; height: 14px; }
    .sk-m { width: 100%; height: 40px; }
    @keyframes pulse { 50% { opacity: 0.55; } }
    @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
  `,
})
export class IntegracaoSpedyComponent implements OnInit {
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(Notify);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
  protected readonly carregando = signal(true);
  protected readonly falhou = signal(false);
  protected readonly eventos = signal<M.EventoIntegracaoView[]>([]);
  protected readonly carregandoEventos = signal(false);
  protected readonly salvando = signal(false);
  protected readonly salvandoCfg = signal(false);
  protected readonly alternando = signal(false);
  protected readonly testando = signal(false);
  protected readonly teste = signal<M.TesteIntegracao | null>(null);
  protected readonly vinculando = signal(false);
  protected readonly consultandoMun = signal(false);
  protected readonly registrandoHook = signal(false);
  protected readonly conflito = signal(false);
  protected readonly limpar = signal<Record<string, boolean>>({});
  protected readonly municipio = signal<M.SpedyMunicipioSettings | null>(null);

  protected readonly campos: CampoCredencial[] = CAMPOS_POR_PROVEDOR['spedy'];
  protected readonly estadoDe = estadoDe;
  protected readonly cfgDe = cfg;

  protected readonly fNomeConta = this.fb.nonNullable.control('');
  protected readonly fIbge = this.fb.nonNullable.control('');
  protected readonly fServiceCode = this.fb.nonNullable.control('');
  protected readonly fCityServiceCode = this.fb.nonNullable.control('');
  protected readonly fCnae = this.fb.nonNullable.control('');
  protected readonly fNbs = this.fb.nonNullable.control('');
  protected readonly fNatTax = this.fb.nonNullable.control('');
  protected readonly fTaxType = this.fb.nonNullable.control('');
  protected readonly fIssRate = this.fb.nonNullable.control('');
  protected readonly fFiscalAmbiente = this.fb.nonNullable.control('');
  protected readonly fDescricao = this.fb.nonNullable.control('');
  private readonly controles: Record<string, FormControl<string>> = {};

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const a = p.get('ambiente') === 'teste' ? 'teste' : 'producao';
      this.ambiente.set(a);
      for (const c of this.campos) this.controle(c.nome);
      this.carregar();
    });
  }

  protected controle(nome: string): FormControl<string> {
    return this.controles[nome] ?? (this.controles[nome] = this.fb.nonNullable.control(''));
  }

  protected configurado(c: CampoCredencial): boolean {
    return this.i()?.segredos.campos[c.nome] === true;
  }

  protected alternarLimpar(nome: string): void {
    this.limpar.update((m) => ({ ...m, [nome]: !m[nome] }));
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.falhou.set(false);
    this.conflito.set(false);
    this.api.buscar('spedy', this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.preencherForm(i);
        this.carregando.set(false);
        this.carregarEventos();
      },
      error: () => {
        this.carregando.set(false);
        this.falhou.set(true);
        this.notify.erroMsg('Falha ao carregar a integração.');
      },
    });
  }

  private preencherForm(i: M.IntegracaoView): void {
    const c = cfg(i);
    this.fNomeConta.setValue(i.nome_conta ?? '');
    this.fIbge.setValue(c.municipio_codigo ?? '');
    this.fServiceCode.setValue(c.fiscal_service_code ?? '');
    this.fCityServiceCode.setValue(c.fiscal_city_service_code ?? '');
    this.fCnae.setValue(c.fiscal_cnae ?? '');
    this.fNbs.setValue(c.fiscal_nbs ?? '');
    this.fNatTax.setValue(c.fiscal_national_taxation_code ?? '');
    this.fTaxType.setValue(c.fiscal_taxation_type ?? '');
    this.fIssRate.setValue(c.fiscal_iss_rate ?? '');
    this.fFiscalAmbiente.setValue(c.fiscal_ambiente ?? '');
    this.fDescricao.setValue(c.fiscal_descricao ?? '');
    for (const k of Object.keys(this.controles)) this.controle(k).setValue('');
    this.limpar.set({});
    this.municipio.set(null);
  }

  private carregarEventos(): void {
    this.carregandoEventos.set(true);
    this.api.eventos('spedy', this.ambiente()).subscribe({
      next: (l) => {
        this.eventos.set(l);
        this.carregandoEventos.set(false);
      },
      error: () => this.carregandoEventos.set(false),
    });
  }

  private salvarInput(input: M.IntegracaoInput, okMsg: string): void {
    const i = this.i();
    if (!i) return;
    this.salvandoCfg.set(true);
    this.api.salvar('spedy', this.ambiente(), input).subscribe({
      next: (nova) => {
        this.salvandoCfg.set(false);
        this.salvando.set(false);
        this.i.set(nova);
        this.notify.ok(okMsg);
      },
      error: (e) => {
        this.salvandoCfg.set(false);
        this.salvando.set(false);
        this.tratarErroSalvar(e);
      },
    });
  }

  private tratarErroSalvar(e: unknown): void {
    if (e instanceof HttpErrorResponse && e.status === 409) {
      this.conflito.set(true);
      this.notify.aviso('Integração alterada por outro administrador — recarregue antes de salvar.');
    } else {
      this.notify.erro(e);
    }
  }

  /** Credenciais + nome — segredos write-only, `""` remove, ausente mantém. */
  protected salvar(): void {
    const i = this.i();
    if (!i) return;
    const lim = this.limpar();
    const segredos: Record<string, string> = {};
    for (const c of this.campos) {
      const v = this.controle(c.nome).value.trim();
      if (lim[c.nome]) segredos[c.nome] = '';
      else if (v) segredos[c.nome] = v;
    }
    const input: M.IntegracaoInput = {
      versao: i.versao,
      nome_conta: this.fNomeConta.value.trim(),
    };
    if (Object.keys(segredos).length) input.segredos = segredos;
    this.salvando.set(true);
    this.salvarInput(input, 'Credenciais salvas.');
  }

  /** Parametrização fiscal + município — merge por chave em `config`. */
  protected salvarConfig(): void {
    const i = this.i();
    if (!i) return;
    const trim = (v: string) => {
      const t = v.trim();
      return t === '' ? null : t;
    };
    this.salvarInput(
      {
        versao: i.versao,
        config: {
          fiscal_service_code: trim(this.fServiceCode.value),
          fiscal_city_service_code: trim(this.fCityServiceCode.value),
          fiscal_cnae: trim(this.fCnae.value),
          fiscal_nbs: trim(this.fNbs.value),
          fiscal_national_taxation_code: trim(this.fNatTax.value),
          fiscal_taxation_type: trim(this.fTaxType.value),
          fiscal_iss_rate: trim(this.fIssRate.value),
          fiscal_ambiente: trim(this.fFiscalAmbiente.value),
          fiscal_descricao: trim(this.fDescricao.value),
        },
      },
      'Parametrização fiscal salva.',
    );
  }

  protected usarMunicipio(): void {
    const i = this.i();
    const m = this.municipio();
    if (!i || !m) return;
    const nome = (m['cityName'] ?? m['name'] ?? '') as string;
    this.salvarInput(
      {
        versao: i.versao,
        config: {
          municipio_codigo: this.fIbge.value.trim(),
          municipio_nome: nome || null,
          municipio_provedores: m['providers'] ?? null,
        },
      },
      'Município de emissão definido.',
    );
  }

  protected vincularEmpresa(): void {
    this.vinculando.set(true);
    this.api.spedyEmpresa(this.ambiente()).subscribe({
      next: (emp) => {
        this.vinculando.set(false);
        const i = this.i();
        if (i) {
          this.salvarInput(
            {
              versao: i.versao,
              config: {
                empresa_id: emp.id,
                empresa_cnpj: emp.cnpj,
                empresa_razao: emp.razao_social,
              },
            },
            `Empresa vinculada: ${emp.razao_social ?? emp.id}`,
          );
        }
      },
      error: (e) => {
        this.vinculando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected consultarMunicipio(): void {
    const ibge = this.fIbge.value.trim();
    if (!ibge) return;
    this.consultandoMun.set(true);
    this.municipio.set(null);
    this.api.spedyMunicipio(this.ambiente(), ibge).subscribe({
      next: (m) => {
        this.consultandoMun.set(false);
        this.municipio.set(m);
      },
      error: (e) => {
        this.consultandoMun.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected registrarWebhook(): void {
    this.registrandoHook.set(true);
    this.api.spedyConfigurarWebhook(this.ambiente()).subscribe({
      next: (r) => {
        this.registrandoHook.set(false);
        this.i.update((v) =>
          v ? { ...v, config: { ...v.config, webhook_registrado: true } } : v,
        );
        this.notify.ok(`Webhook registrado: ${r.webhook_url}`);
      },
      error: (e) => {
        this.registrandoHook.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected alternarHabilitado(i: M.IntegracaoView): void {
    this.alternando.set(true);
    this.api.habilitacao('spedy', i.ambiente, !i.habilitado).subscribe({
      next: (nova) => {
        this.alternando.set(false);
        this.i.set(nova);
        this.notify.ok(nova.habilitado ? 'Integração habilitada.' : 'Integração desabilitada.');
      },
      error: (e) => {
        this.alternando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected testar(): void {
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar('spedy', this.ambiente()).subscribe({
      next: (t) => {
        this.testando.set(false);
        this.teste.set(t);
        this.api.buscar('spedy', this.ambiente()).subscribe({
          next: (nova) => this.i.set(nova),
        });
      },
      error: (e) => {
        this.testando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected copiar(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('URL do webhook copiada.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }

  protected rotuloEvento(status: string): string {
    return ROTULO_EVENTO[status]?.rotulo ?? status;
  }

  protected pillEvento(status: string): string {
    return ROTULO_EVENTO[status]?.pill ?? 'pill-off';
  }
}
