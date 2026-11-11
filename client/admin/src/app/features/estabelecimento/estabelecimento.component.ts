import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '@core/services/api.service';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import * as M from '@core/models/api.models';

const SETORES = ['caixa', 'cozinha', 'bar', 'balcao', 'churrasqueira', 'recepcao'];

// Configurações do estabelecimento: dados fiscais, endereço, logo e
// impressoras térmicas por setor (roteamento de comprovantes e pedidos).
@Component({
  selector: 'app-estabelecimento',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [ReactiveFormsModule, MatIconModule, MatFormFieldModule, MatSelectModule],
  template: `
    <div class="page">
      <!-- ================= Cabeçalho ================= -->
      <div class="est-head">
        <div>
          <h2 class="est-titulo">Estabelecimento</h2>
          <p class="est-sub">Dados da pousada usados em comprovantes, documentos e na impressão térmica</p>
        </div>
        <div class="est-acoes">
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-logo" class="btn-dark-blue" type="button" (click)="abrirLogo()">
            <mat-icon>image</mat-icon> Alterar logo
          </button>
        </div>
      </div>

      <!-- ================= Checklist de configuração ================= -->
      <div class="est-check" id="tour-check">
        <span class="est-check-tit"><mat-icon>task_alt</mat-icon> Configuração da pousada</span>
        <div class="est-check-item" [class.ok]="dadosOk()">
          <mat-icon>{{ dadosOk() ? 'check_circle' : 'error' }}</mat-icon>
          <span>
            <b>Dados fiscais</b>
            <small>{{ dadosOk() ? 'razão social e CNPJ preenchidos' : 'informe razão social e CNPJ' }}</small>
          </span>
        </div>
        <div class="est-check-item" [class.ok]="endOk()">
          <mat-icon>{{ endOk() ? 'check_circle' : 'error' }}</mat-icon>
          <span>
            <b>Endereço</b>
            <small>{{ endOk() ? 'logradouro, cidade e CEP' : 'complete o endereço' }}</small>
          </span>
        </div>
        <div class="est-check-item" [class.ok]="logoOk()">
          <mat-icon>{{ logoOk() ? 'check_circle' : 'error' }}</mat-icon>
          <span>
            <b>Logo</b>
            <small>{{ logoOk() ? 'enviada — aparece nos comprovantes' : 'não enviada ainda' }}</small>
          </span>
        </div>
        <div class="est-check-item" [class.ok]="impOk()">
          <mat-icon>{{ impOk() ? 'check_circle' : 'error' }}</mat-icon>
          <span>
            <b>Impressora padrão</b>
            <small>{{ impOk() ? 'comprovantes configurados' : 'nenhuma marcada como padrão' }}</small>
          </span>
        </div>
      </div>

      <!-- ================= Formulários ================= -->
      <div class="row-cards">
        <div class="inner-card est-card">
          <div class="est-card-head">
            <span class="est-card-ic tint-teal"><mat-icon>badge</mat-icon></span>
            <div>
              <h4>Dados da hospedagem</h4>
              <small>Saem no cabeçalho de comprovantes e documentos</small>
            </div>
          </div>
          <form [formGroup]="dados" class="form">
            <div class="duo">
              <label class="lbl">
                CNPJ
                <input class="input-inn" type="text" formControlName="cnpj" placeholder="00.000.000/0000-00" />
              </label>
              <label class="lbl">
                Telefone
                <input class="input-inn" type="text" formControlName="telefone" placeholder="(22) 0000-0000" />
              </label>
            </div>
            <label class="lbl">
              Razão social
              <input class="input-inn" type="text" formControlName="razao_social" placeholder="Nome jurídico da pousada" />
            </label>
            <label class="lbl">
              E-mail
              <input class="input-inn" type="email" formControlName="email" placeholder="contato@pousada.com.br" />
            </label>
            <div class="duo">
              <label class="lbl">
                Site
                <input class="input-inn" type="text" formControlName="site" placeholder="www.pousada.com.br" />
              </label>
              <label class="lbl">
                Celular / WhatsApp
                <input class="input-inn" type="text" formControlName="celular" placeholder="(22) 90000-0000" />
              </label>
            </div>
            <div class="duo">
              <label class="lbl">
                Taxa early check-in (R$)
                <input class="input-inn" type="number" min="0" step="0.01" formControlName="taxa_early" placeholder="0,00" />
              </label>
              <label class="lbl">
                Taxa late checkout (R$)
                <input class="input-inn" type="number" min="0" step="0.01" formControlName="taxa_late" placeholder="0,00" />
              </label>
            </div>
            <fieldset class="concierge-fields">
              <legend>Concierge Inná — o que a IA pode responder ao hóspede</legend>
              <div class="duo">
                <label class="lbl">
                  Rede Wi-Fi
                  <input class="input-inn" type="text" formControlName="wifi_nome" placeholder="Pousada-Guest" />
                </label>
                <label class="lbl">
                  Senha Wi-Fi
                  <input class="input-inn" type="text" formControlName="wifi_senha" placeholder="bemvindo2026" />
                </label>
              </div>
              <div class="duo">
                <label class="lbl">
                  Horário de check-in
                  <input class="input-inn" type="text" formControlName="horario_checkin" placeholder="a partir das 14h" />
                </label>
                <label class="lbl">
                  Horário de check-out
                  <input class="input-inn" type="text" formControlName="horario_checkout" placeholder="até as 12h" />
                </label>
              </div>
              <label class="lbl">
                Horário do café da manhã
                <input class="input-inn" type="text" formControlName="horario_cafe" placeholder="7h às 10h no salão principal" />
              </label>
              <label class="lbl">
                Serviços e informações (piscina, estacionamento, passeios…)
                <textarea class="input-inn" rows="3" formControlName="info_servicos" placeholder="Piscina das 8h às 20h; estacionamento gratuito;…"></textarea>
              </label>
            </fieldset>
            <fieldset class="fld">
              <legend>Conformidade legal — CDC, LGPD e MTur</legend>
              <label class="lbl">
                Cadastur (MTur)
                <input class="input-inn" type="text" formControlName="cadastur" placeholder="Nº do cadastro no Ministério do Turismo" />
              </label>
              <label class="lbl">
                E-mail do encarregado de dados (DPO — LGPD)
                <input class="input-inn" type="email" formControlName="dpo_email" placeholder="privacidade@pousada.com.br" />
              </label>
              <label class="lbl">
                Retenção de dados do hóspede (anos)
                <input class="input-inn" type="number" min="1" max="30" formControlName="retencao_dados_anos" />
              </label>
              <label class="lbl lbl-check">
                <input type="checkbox" formControlName="fnrh_assinatura" />
                Exigir assinatura desenhada do hóspede na pré-ficha (FNRH)
              </label>
              <div class="grid-3">
                <label class="lbl">
                  Reembolso integral até (dias antes)
                  <input class="input-inn" type="number" min="0" formControlName="pol1_dias" />
                </label>
                <label class="lbl">
                  Reembolso parcial até (dias antes)
                  <input class="input-inn" type="number" min="0" formControlName="pol2_dias" />
                </label>
                <label class="lbl">
                  Reembolso final (%)
                  <input class="input-inn" type="number" min="0" max="100" formControlName="pol3_pct" />
                </label>
              </div>
              <div class="grid-3">
                <label class="lbl">
                  % reembolso integral
                  <input class="input-inn" type="number" min="0" max="100" formControlName="pol1_pct" />
                </label>
                <label class="lbl">
                  % reembolso parcial
                  <input class="input-inn" type="number" min="0" max="100" formControlName="pol2_pct" />
                </label>
                <span class="hint">Faixas por proximidade do check-in (CDC art. 49).</span>
              </div>
            </fieldset>
            <div class="end">
              <button class="btn-dark-blue" type="button" (click)="salvarDados()" [disabled]="salvando()">
                <mat-icon>save</mat-icon> {{ salvando() ? 'Salvando…' : 'Gravar dados' }}
              </button>
            </div>
          </form>
        </div>

        <div class="inner-card est-card">
          <div class="est-card-head">
            <span class="est-card-ic tint-navy"><mat-icon>location_on</mat-icon></span>
            <div>
              <h4>Endereço da hospedagem</h4>
              <small>Usado em documentos fiscais e na ficha do hóspede</small>
            </div>
          </div>
          <form [formGroup]="endereco" class="form">
            <div class="duo">
              <label class="lbl">
                CEP
                <input class="input-inn" type="text" formControlName="cep" placeholder="00000-000" />
              </label>
              <label class="lbl">
                Cidade
                <input class="input-inn" type="text" formControlName="cidade" placeholder="Cabo Frio" />
              </label>
            </div>
            <label class="lbl">
              Logradouro
              <input class="input-inn" type="text" formControlName="logradouro" placeholder="Rua, avenida…" />
            </label>
            <div class="num-comp">
              <label class="lbl num">
                Número
                <input class="input-inn" type="text" formControlName="numero" placeholder="123" />
              </label>
              <label class="lbl comp">
                Complemento
                <input class="input-inn" type="text" formControlName="complemento" placeholder="Opcional" />
              </label>
            </div>
            <label class="lbl">
              Bairro
              <input class="input-inn" type="text" formControlName="bairro" placeholder="Centro" />
            </label>
            <div class="end">
              <button class="btn-dark-blue" type="button" (click)="salvarEndereco()" [disabled]="salvando()">
                <mat-icon>save</mat-icon> {{ salvando() ? 'Salvando…' : 'Gravar endereço' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ================= Impressoras por setor ================= -->
      <div class="inner-card est-card" id="tour-imp">
        <div class="est-card-head com-acao">
          <div class="est-card-head-grupo">
            <span class="est-card-ic tint-gold"><mat-icon>print</mat-icon></span>
            <div>
              <h4>Impressoras por setor</h4>
              <small>Comprovantes saem na <b>padrão</b>; pedidos de consumo saem na impressora do setor da categoria</small>
            </div>
          </div>
          <button class="btn-dark-blue" type="button" (click)="abrirImpressora()">
            <mat-icon>add</mat-icon> Nova impressora
          </button>
        </div>
        @if (descobertas().length) {
          <div class="desc-box">
            <div class="desc-head">
              <mat-icon>travel_explore</mat-icon>
              <b>{{ descobertas().length }} dispositivo(s) detectado(s) na rede</b>
              <span>— confirme para registrar ou ignore</span>
            </div>
            @for (d of descobertas(); track d.id) {
              <div class="desc-linha">
                <mat-icon [class]="d.tipo === 'usb' ? 'desc-ic usb' : 'desc-ic'">
                  {{ d.tipo === 'usb' ? 'usb' : 'print' }}
                </mat-icon>
                <div class="desc-info">
                  <b>{{ d.modelo || d.endereco }}</b>
                  <span>
                    {{ d.tipo === 'usb' ? 'USB · ' + d.endereco : d.endereco + ':' + (d.porta ?? 9100) }}
                    · detectada por {{ d.origem }}
                  </span>
                </div>
                <button class="btn-green mini" type="button" (click)="abrirRegistro(d)">Registrar</button>
                <button class="btn-gray mini" type="button" (click)="ignorar(d)">Ignorar</button>
              </div>
            }
          </div>
        }
        <div class="est-tabela-wrap">
          <table class="est-tabela">
            <thead>
              <tr>
                <th>Impressora</th>
                <th>Setor</th>
                <th>Endereço</th>
                <th class="tc">Padrão</th>
                <th class="tc">Status</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @for (p of impressoras(); track p.id) {
                <tr>
                  <td class="td-nome"><mat-icon>print</mat-icon> {{ p.nome }}</td>
                  <td><span class="est-chip-setor">{{ p.setor }}</span></td>
                  <td class="td-ip">{{ p.ip }}:{{ p.porta }}</td>
                  <td class="tc">
                    @if (p.etiqueta) {
                      <span class="est-chip-padrao" title="Recebe as etiquetas ao cadastrar produtos">
                        <mat-icon>sell</mat-icon> etiquetas
                      </span>
                    }
                    @if (p.padrao) {
                      <span class="est-chip-padrao" title="Recebe os comprovantes de check-out">
                        <mat-icon>star</mat-icon> Comprovantes
                      </span>
                    }
                  </td>
                  <td class="tc">
                    <button
                      class="status-chip clickable"
                      [class.on]="p.ativa"
                      [class.off]="!p.ativa"
                      type="button"
                      title="Clique para alternar"
                      (click)="statusImpressora(p)"
                    >{{ p.ativa ? 'Ativa' : 'Inativa' }}</button>
                  </td>
                  <td class="tc">
                    <div class="est-acoes-linha">
                      <button class="acao navy" type="button" title="Imprimir página de teste"
                              (click)="testar(p)"><mat-icon>print</mat-icon></button>
                      <button class="acao gold" type="button" title="Editar"
                              (click)="abrirImpressora(p)"><mat-icon>edit</mat-icon></button>
                      <button class="acao navy" type="button" title="Excluir"
                              (click)="removerImpressora(p)"><mat-icon>delete</mat-icon></button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="est-vazio">
                    <mat-icon>print_disabled</mat-icon>
                    Nenhuma impressora cadastrada — adicione a primeira para imprimir comprovantes e pedidos.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ================= Modal: Nova/Editar impressora ================= -->
    @if (modalImp()) {
      <div class="overlay" (click.self)="modalImp.set(false)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Impressora">
          <div class="modal-head">
            <h5><mat-icon>print</mat-icon> {{ impEditando() ? 'Editar impressora' : 'Nova impressora' }}</h5>
            <button class="close" type="button" (click)="modalImp.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <form [formGroup]="impForm" class="form">
              <label class="lbl">
                Nome <small class="req">*</small>
                <input class="input-inn" type="text" formControlName="nome" placeholder="Ex.: Impressora da cozinha" />
              </label>
              <div class="f-field">
                <span class="f-lbl">Setor <small class="req">*</small></span>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat f-mat">
                  <mat-select formControlName="setor" placeholder="Escolha o setor…">
                    @for (s of setoresOpcoes(); track s) {
                      <mat-option [value]="s">{{ s }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <small class="est-dica">Pedidos de itens desse setor saem nesta impressora.</small>
              </div>
              <div class="duo">
                <label class="lbl">
                  IP <small class="req">*</small>
                  <input class="input-inn" type="text" formControlName="ip" placeholder="192.168.0.50" />
                </label>
                <label class="lbl">
                  Porta
                  <input class="input-inn porta-inn" type="number" formControlName="porta" />
                </label>
              </div>
              <label class="lbl check">
                <input type="checkbox" formControlName="padrao" />
                <span><b>Impressora padrão</b> — recebe os comprovantes de check-out</span>
              </label>
              <label class="lbl check">
                <input type="checkbox" formControlName="etiqueta" />
                <span><b>Impressora de etiquetas</b> — recebe a etiqueta ao cadastrar produtos</span>
              </label>
              <label class="lbl check">
                <input type="checkbox" formControlName="ativa" />
                <span>Impressora <b>ativa</b> (disponível para uso)</span>
              </label>
            </form>
          </div>
          <div class="modal-foot">
            <button class="btn-gray" type="button" (click)="modalImp.set(false)">Cancelar</button>
            <button class="btn-green" type="button" [disabled]="salvando() || impForm.invalid" (click)="salvarImpressora()">
              <mat-icon>save</mat-icon> {{ impEditando() ? 'Salvar alterações' : 'Cadastrar' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ================= Modal: Registrar descoberta ================= -->
    @if (modalReg(); as d) {
      <div class="overlay" (click.self)="modalReg.set(null)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Registrar impressora">
          <div class="modal-head">
            <h5><mat-icon>travel_explore</mat-icon> Registrar impressora detectada</h5>
            <button class="close" type="button" (click)="modalReg.set(null)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <p class="est-dica" style="margin-top:0">
              {{ d.tipo === 'usb' ? 'USB · ' + d.endereco : d.endereco + ':' + (d.porta ?? 9100) }}
              @if (d.modelo) { — {{ d.modelo }} }
            </p>
            <form [formGroup]="regForm" class="form">
              <label class="lbl">
                Nome <small class="req">*</small>
                <input class="input-inn" type="text" formControlName="nome" placeholder="Ex.: Impressora da recepção" />
              </label>
              <div class="f-field">
                <span class="f-lbl">Setor <small class="req">*</small></span>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat f-mat">
                  <mat-select formControlName="setor" placeholder="Escolha o setor…">
                    @for (s of setoresOpcoes(); track s) {
                      <mat-option [value]="s">{{ s }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
              <label class="lbl check">
                <input type="checkbox" formControlName="padrao" />
                <span><b>Impressora padrão</b> — recebe os comprovantes de check-out</span>
              </label>
              <label class="lbl check">
                <input type="checkbox" formControlName="etiqueta" />
                <span><b>Impressora de etiquetas</b> — recebe a etiqueta ao cadastrar produtos</span>
              </label>
            </form>
          </div>
          <div class="modal-foot">
            <button class="btn-gray" type="button" (click)="modalReg.set(null)">Cancelar</button>
            <button class="btn-green" type="button" [disabled]="salvando() || regForm.invalid" (click)="registrar()">
              <mat-icon>save</mat-icon> Registrar
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ================= Modal: Alterar logo ================= -->
    @if (modalLogo()) {
      <div class="overlay" (click.self)="modalLogo.set(false)">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Alterar logo">
          <div class="modal-head">
            <h5><mat-icon>image</mat-icon> Logo do estabelecimento</h5>
            <button class="close" type="button" (click)="modalLogo.set(false)" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <div class="logo-box" [class.vazia]="!logoPreview()">
              @if (logoPreview()) {
                <img class="logo-img" [src]="logoPreview()" alt="Logo do estabelecimento" />
              } @else {
                <div class="logo-vazia">
                  <mat-icon>add_photo_alternate</mat-icon>
                  <span>Nenhuma logo enviada</span>
                </div>
              }
            </div>
            <label class="est-upload">
              <mat-icon>cloud_upload</mat-icon>
              {{ logoArquivo() ? logoArquivo()!.name : 'Escolher arquivo de imagem' }}
              <input
                type="file" hidden
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                (change)="selecionarLogo($event)"
                aria-label="Arquivo da logo"
              />
            </label>
            <small class="est-dica">PNG, JPG, WEBP ou SVG — máximo 2 MB. Fundo transparente fica melhor no comprovante.</small>
          </div>
          <div class="modal-foot">
            <button class="btn-gray" type="button" (click)="modalLogo.set(false)">Cancelar</button>
            <button
              class="btn-green" type="button"
              [disabled]="!logoArquivo() || enviando()"
              (click)="enviarLogo()"
            >
              <mat-icon>{{ enviando() ? 'hourglass_top' : 'save' }}</mat-icon>
              {{ enviando() ? 'Enviando…' : 'Salvar logo' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .est-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .est-titulo { margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054; letter-spacing: -0.02em; }
    .est-sub { margin: 2px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .est-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .est-acoes button { display: inline-flex; align-items: center; gap: 6px; }
    .concierge-fields {
      border: 1px dashed #cfd9df; border-radius: 8px;
      padding: 12px 14px 14px; margin: 4px 0 0;
      display: flex; flex-direction: column; gap: 10px;
    }
    .concierge-fields legend {
      font-size: 0.78rem; font-weight: 600; color: #5d6d7e; padding: 0 6px;
    }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #d7e0e6; background: #fff;
      color: #5d6d7e; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600; font-family: inherit;
      transition: border-color .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { border-color: #1a6f8a; color: #1a6f8a; }

    /* ---------- checklist ---------- */
    .est-check {
      display: flex; align-items: center; gap: 8px 26px; flex-wrap: wrap;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 14px 20px; margin-bottom: 16px;
    }
    .est-check-tit {
      display: inline-flex; align-items: center; gap: 7px;
      font-size: 0.74rem; font-weight: 700; color: #054054;
      text-transform: uppercase; letter-spacing: 0.06em;
      padding-right: 18px; border-right: 1px solid #eef2f5;
    }
    .est-check-tit mat-icon { font-size: 17px; width: 17px; height: 17px; color: #1a6f8a; }
    .est-check-item {
      display: inline-flex; align-items: center; gap: 9px;
    }
    .est-check-item > mat-icon { font-size: 20px; width: 20px; height: 20px; color: #b5811f; }
    .est-check-item.ok > mat-icon { color: #1a6f8a; }
    .est-check-item span { display: flex; flex-direction: column; }
    .est-check-item b { font-size: 0.82rem; color: #054054; }
    .est-check-item small { font-size: 0.7rem; color: #8a99a4; }

    /* ---------- cards de formulário ---------- */
    .row-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .est-card { padding: 0; }
    .est-card-head {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px; border-bottom: 1px solid #eef2f5;
    }
    .est-card-head.com-acao { justify-content: space-between; flex-wrap: wrap; }
    .est-card-head-grupo { display: flex; align-items: center; gap: 12px; }
    .est-card-ic {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .est-card-ic mat-icon { font-size: 21px; width: 21px; height: 21px; }
    .tint-teal { background: rgba(26, 111, 138, 0.1); color: #1a6f8a; }
    .tint-gold { background: rgba(221, 165, 84, 0.14); color: #b5811f; }
    .tint-navy { background: rgba(5, 64, 84, 0.08); color: #054054; }
    .est-card-head h4 { margin: 0; font-size: 0.95rem; font-weight: 700; color: #054054; }
    .est-card-head small { font-size: 0.74rem; color: #8a99a4; }
    .est-card form { padding: 16px 18px 18px; }
    .form { display: flex; flex-direction: column; gap: 12px; }
    .lbl {
      display: flex; flex-direction: column; gap: 4px;
      font-size: 0.82rem; font-weight: 600; color: #40525d;
    }
    .lbl .req, .f-lbl .req { color: #dc3545; }
    .lbl-check { flex-direction: row; align-items: center; gap: 8px; font-weight: 500; }
    .f-field { display: flex; flex-direction: column; gap: 4px; }
    .f-lbl { font-size: 0.82rem; font-weight: 600; color: #40525d; }
    .f-mat { width: 100%; }
    .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .hint { font-size: 0.73rem; color: #8a99a4; font-weight: 400; align-self: end; padding-bottom: 10px; }
    .porta-inn { margin-top: 20px; }
    .num-comp { display: grid; grid-template-columns: 120px 1fr; gap: 10px; }
    .end { display: flex; justify-content: flex-end; }
    .end button { display: inline-flex; align-items: center; gap: 6px; }
    .check { flex-direction: row !important; align-items: center; gap: 9px; font-weight: 400 !important; cursor: pointer; }
    .est-dica { font-size: 0.73rem; color: #8a99a4; font-weight: 400; }

    /* ---------- auto-descoberta ---------- */
    .desc-box {
      margin: 0 0 14px; border: 1.5px dashed #b5851f; border-radius: 10px;
      background: #fdf8ec; padding: 10px 12px;
    }
    .desc-head {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.84rem; color: #7a5b13; margin-bottom: 8px;
    }
    .desc-head span { color: #a08a55; font-weight: 400; }
    .desc-head mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .desc-linha {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 4px; border-top: 1px solid #f0e6cc;
    }
    .desc-ic { color: #1a6f8a; font-size: 20px; width: 20px; height: 20px; }
    .desc-ic.usb { color: #b5811f; }
    .desc-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .desc-info b { font-size: 0.86rem; color: #23404e; }
    .desc-info span { font-size: 0.75rem; color: #8a99a4; }
    .btn-green.mini, .btn-gray.mini { padding: 6px 12px; font-size: 0.78rem; border-radius: 7px; }

    /* ---------- tabela impressoras ---------- */
    .est-tabela-wrap { overflow-x: auto; padding: 0 18px 18px; }
    .est-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .est-tabela thead th {
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 12px 14px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .est-tabela tbody td {
      padding: 12px 14px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .est-tabela tbody tr:hover { background: #f7fafb; }
    .est-tabela .tc { text-align: center; }
    .td-nome { font-weight: 700; color: #054054; white-space: nowrap; }
    .td-nome mat-icon { font-size: 16px; width: 16px; height: 16px; vertical-align: -3px; color: #1a6f8a; margin-right: 7px; }
    .td-ip { font-family: monospace; font-size: 0.82rem; color: #5d6d7e; white-space: nowrap; }
    .est-chip-setor {
      display: inline-flex; background: #eef4f6; color: #1a6f8a;
      border-radius: 999px; padding: 3px 12px;
      font-size: 0.78rem; font-weight: 700; text-transform: capitalize;
    }
    .est-chip-padrao {
      display: inline-flex; align-items: center; gap: 4px;
      background: rgba(221, 165, 84, 0.15); color: #b5811f;
      border-radius: 999px; padding: 3px 12px;
      font-size: 0.75rem; font-weight: 700; white-space: nowrap;
    }
    .est-chip-padrao mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .est-acoes-linha { display: inline-flex; gap: 5px; }
    .acao {
      display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 6px; width: 30px; height: 30px;
      cursor: pointer; transition: filter .14s;
    }
    .acao mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .acao:hover { filter: brightness(1.12); }
    .acao.navy { background: #054054; color: #fff; }
    .acao.gold { background: #b5811f; color: #054054; }
    .status-chip.clickable { cursor: pointer; border: none; font-family: inherit; }
    .status-chip.on { background: #1a6f8a; color: #fff; }
    .status-chip.off { background: #7d97a1; color: #fff; }
    .est-vazio {
      text-align: center; color: #8a99a4; padding: 34px !important; font-size: 0.86rem;
    }
    .est-vazio mat-icon { display: block; margin: 0 auto 8px; font-size: 30px; width: 30px; height: 30px; color: #c3d2d9; }

    /* ---------- modais ---------- */
    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(5, 64, 84, 0.45);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 2rem 1rem; backdrop-filter: blur(2px);
    }
    .modal-inn {
      background: #fff; border-radius: 12px; width: 100%; max-width: 480px;
      box-shadow: 0 18px 50px rgba(5, 64, 84, 0.25);
      animation: in 0.16s ease-out;
      max-height: 90vh; display: flex; flex-direction: column;
    }
    @keyframes in { from { transform: translateY(-12px); opacity: 0; } }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.85rem 1.15rem; border-bottom: 1px solid #e3eaef;
    }
    .modal-head h5 {
      margin: 0; font-size: 1rem; font-weight: 700; color: #054054;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .modal-head h5 mat-icon { font-size: 19px; width: 19px; height: 19px; color: #1a6f8a; }
    .modal-head .close {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 28px; height: 28px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .modal-head .close:hover { background: #d7e0e6; }
    .modal-head .close mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .modal-body { padding: 1.1rem 1.15rem; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .modal-body .form input:not([type='checkbox']) { height: 36px; padding: 0 9px; box-sizing: border-box; }
    .modal-foot {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 0.8rem 1.15rem; border-top: 1px solid #e3eaef;
      background: #f7fafb; border-radius: 0 0 12px 12px;
    }
    .modal-foot button { display: inline-flex; align-items: center; gap: 6px; }
    .modal-foot mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .logo-box {
      border: 1px dashed #c5d6de; border-radius: 10px;
      min-height: 140px; display: flex; align-items: center; justify-content: center;
      background: #f7fafb; padding: 14px;
    }
    .logo-img { max-height: 150px; max-width: 100%; }
    .logo-vazia { display: flex; flex-direction: column; align-items: center; gap: 6px; color: #a5b6bf; font-size: 0.82rem; }
    .logo-vazia mat-icon { font-size: 38px; width: 38px; height: 38px; }
    .est-upload {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      border: 1.5px dashed #1a6f8a; border-radius: 10px;
      padding: 13px 16px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600; color: #1a6f8a;
      transition: background .14s;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .est-upload:hover { background: rgba(26, 111, 138, 0.06); }
    .est-upload mat-icon { font-size: 19px; width: 19px; height: 19px; flex-shrink: 0; }
  `,
})
export class EstabelecimentoComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly rt = inject(Realtime);
  private readonly fb = inject(FormBuilder);
  private readonly tour = inject(TourGuiado);

  protected readonly salvando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly modalLogo = signal(false);
  protected readonly logoPreview = signal<string | null>(null);
  protected readonly logoArquivo = signal<File | null>(null);
  protected readonly logoOk = signal(false);
  protected readonly impressoras = signal<M.Impressora[]>([]);
  protected readonly modalImp = signal(false);
  protected readonly impEditando = signal<M.Impressora | null>(null);
  protected readonly descobertas = signal<M.ImpressoraDescoberta[]>([]);
  protected readonly modalReg = signal<M.ImpressoraDescoberta | null>(null);
  protected readonly regForm = this.fb.nonNullable.group({
    nome: [''],
    setor: [''],
    padrao: [false],
    etiqueta: [false],
  });

  protected readonly impForm = this.fb.nonNullable.group({
    nome: [''],
    setor: [''],
    ip: [''],
    porta: [9100],
    padrao: [false],
    etiqueta: [false],
    ativa: [true],
  });

  protected readonly dados = this.fb.nonNullable.group({
    cnpj: [''],
    razao_social: [''],
    site: [''],
    email: [''],
    telefone: [''],
    celular: [''],
    impressora_ip: [''],
    impressora_porta: [9100],
    impressora_ativa: [false],
    taxa_early: [0],
    taxa_late: [0],
    wifi_nome: [''],
    wifi_senha: [''],
    horario_checkin: [''],
    horario_checkout: [''],
    horario_cafe: [''],
    info_servicos: [''],
    cadastur: [''],
    dpo_email: [''],
    retencao_dados_anos: [5],
    fnrh_assinatura: [false],
    // CDC — faixas escalonadas: reembolso integral, parcial e nenhum.
    pol1_dias: [15],
    pol1_pct: [100],
    pol2_dias: [7],
    pol2_pct: [50],
    pol3_pct: [0],
  });
  private readonly dadosVersion = signal<number | undefined>(undefined);
  private readonly endVersion = signal<number | undefined>(undefined);
  protected readonly endereco = this.fb.nonNullable.group({
    logradouro: [''],
    numero: [''],
    complemento: [''],
    bairro: [''],
    cidade: [''],
    cep: [''],
  });

  protected readonly dadosOk = computed(() => {
    const v = this.dados.value;
    return !!(v.razao_social?.trim() && v.cnpj?.trim());
  });
  protected readonly endOk = computed(() => {
    const v = this.endereco.value;
    return !!(v.logradouro?.trim() && v.cidade?.trim() && v.cep?.trim());
  });
  protected readonly impOk = computed(() =>
    this.impressoras().some((p) => p.padrao && p.ativa),
  );
  protected readonly setoresOpcoes = computed(() => {
    const atual = this.impForm.value.setor?.trim();
    return atual && !SETORES.includes(atual) ? [...SETORES, atual] : SETORES;
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('impressora', 'categoria_estoque', 'impressora_descoberta');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregarImpressoras();
        this.carregarDescobertas();
      }
    });
  }

  ngOnInit(): void {
    this.api.obterEstabelecimento().subscribe({
      next: (e) => {
        this.dadosVersion.set(e.version);
        const faixas = (e.politica_cancelamento as { faixas?: { ate_dias: number; pct: number }[] } | null)?.faixas;
        const fx = (i: number) => faixas?.[i];
        this.dados.patchValue({
          cnpj: e.cnpj ?? '',
          razao_social: e.razao_social ?? '',
          site: e.site ?? '',
          email: e.email ?? '',
          telefone: e.telefone ?? '',
          celular: e.celular ?? '',
          impressora_ip: e.impressora_ip ?? '',
          impressora_porta: e.impressora_porta ?? 9100,
          impressora_ativa: e.impressora_ativa ?? false,
          taxa_early: Number(e.taxa_early ?? 0),
          taxa_late: Number(e.taxa_late ?? 0),
          wifi_nome: e.wifi_nome ?? '',
          wifi_senha: e.wifi_senha ?? '',
          horario_checkin: e.horario_checkin ?? '',
          horario_checkout: e.horario_checkout ?? '',
          horario_cafe: e.horario_cafe ?? '',
          info_servicos: e.info_servicos ?? '',
          cadastur: e.cadastur ?? '',
          dpo_email: e.dpo_email ?? '',
          retencao_dados_anos: e.retencao_dados_anos ?? 5,
          fnrh_assinatura: e.fnrh_assinatura ?? false,
          pol1_dias: fx(0)?.ate_dias ?? 15,
          pol1_pct: fx(0)?.pct ?? 100,
          pol2_dias: fx(1)?.ate_dias ?? 7,
          pol2_pct: fx(1)?.pct ?? 50,
          pol3_pct: fx(2)?.pct ?? 0,
        });
      },
      error: () => undefined,
    });
    this.carregarImpressoras();
    this.carregarDescobertas();
    this.api.logoAtual().subscribe({
      next: () => this.logoOk.set(true),
      error: () => this.logoOk.set(false),
    });
    this.api.obterEndereco().subscribe({
      next: (e) => {
        this.endVersion.set(e.version);
        this.endereco.patchValue({
          logradouro: e.logradouro ?? '',
          numero: e.numero ?? '',
          complemento: e.complemento ?? '',
          bairro: e.bairro ?? '',
          cidade: e.cidade ?? '',
          cep: e.cep ?? '',
        });
      },
      error: () => undefined,
    });
  }

  onEsc(): void {
    if (this.modalImp()) this.modalImp.set(false);
    else if (this.modalLogo()) this.modalLogo.set(false);
  }

  salvarDados(): void {
    this.salvando.set(true);
    const v = this.dados.getRawValue();
    const empty = (s: string) => s || null;
    this.api
      .salvarEstabelecimento({
        cnpj: empty(v.cnpj),
        razao_social: empty(v.razao_social),
        site: empty(v.site),
        email: empty(v.email),
        telefone: empty(v.telefone),
        celular: empty(v.celular),
        impressora_ip: empty(v.impressora_ip),
        impressora_porta: v.impressora_porta || 9100,
        impressora_ativa: v.impressora_ativa,
        taxa_early: Number(v.taxa_early) || 0,
        taxa_late: Number(v.taxa_late) || 0,
        wifi_nome: empty(v.wifi_nome),
        wifi_senha: empty(v.wifi_senha),
        horario_checkin: empty(v.horario_checkin),
        horario_checkout: empty(v.horario_checkout),
        horario_cafe: empty(v.horario_cafe),
        info_servicos: empty(v.info_servicos),
        cadastur: empty(v.cadastur),
        dpo_email: empty(v.dpo_email),
        retencao_dados_anos: Number(v.retencao_dados_anos) || 5,
        fnrh_assinatura: !!v.fnrh_assinatura,
        politica_cancelamento: {
          faixas: [
            { ate_dias: Number(v.pol1_dias) || 0, pct: Number(v.pol1_pct) || 0 },
            { ate_dias: Number(v.pol2_dias) || 0, pct: Number(v.pol2_pct) || 0 },
            { ate_dias: 0, pct: Number(v.pol3_pct) || 0 },
          ],
        },
        version: this.dadosVersion(),
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.notify.ok('Dados salvos.');
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e);
        },
      });
  }

  salvarEndereco(): void {
    this.salvando.set(true);
    const v = this.endereco.getRawValue();
    const empty = (s: string) => s || null;
    this.api
      .salvarEndereco({
        logradouro: empty(v.logradouro),
        numero: empty(v.numero),
        complemento: empty(v.complemento),
        bairro: empty(v.bairro),
        cidade: empty(v.cidade),
        cep: empty(v.cep),
        version: this.endVersion(),
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.notify.ok('Endereço salvo.');
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e);
        },
      });
  }

  // -- logo -----------------------------------------------------------------

  abrirLogo(): void {
    this.logoArquivo.set(null);
    this.logoPreview.set(null);
    // logo atual via GET /estabelecimento/logo (404 = não configurada)
    this.api.logoAtual().subscribe({
      next: (b) => this.logoPreview.set(URL.createObjectURL(b)),
      error: () => undefined,
    });
    this.modalLogo.set(true);
  }

  selecionarLogo(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.logoArquivo.set(f);
    if (f) {
      URL.revokeObjectURL(this.logoPreview() ?? '');
      this.logoPreview.set(URL.createObjectURL(f));
    }
  }

  enviarLogo(): void {
    const f = this.logoArquivo();
    if (!f) return;
    this.enviando.set(true);
    this.api.uploadLogo(f).subscribe({
      next: () => {
        this.enviando.set(false);
        this.modalLogo.set(false);
        this.logoOk.set(true);
        this.notify.ok('Logo atualizada.');
      },
      error: (err) => {
        this.enviando.set(false);
        this.notify.erro(err);
      },
    });
  }

  // -- impressoras por setor --------------------------------------------------

  private carregarImpressoras(): void {
    this.api.listarImpressoras().subscribe({
      next: (l) => this.impressoras.set(l),
      error: () => undefined,
    });
  }

  abrirImpressora(p?: M.Impressora): void {
    this.impEditando.set(p ?? null);
    this.impForm.reset({
      nome: p?.nome ?? '',
      setor: p?.setor ?? '',
      ip: p?.ip ?? '',
      porta: p?.porta ?? 9100,
      padrao: p?.padrao ?? false,
      etiqueta: p?.etiqueta ?? false,
      ativa: p?.ativa ?? true,
    });
    this.modalImp.set(true);
  }

  salvarImpressora(): void {
    const v = this.impForm.getRawValue();
    this.salvando.set(true);
    const edit = this.impEditando();
    const req = edit
      ? this.api.atualizarImpressora(edit.id, { ...v, version: edit.version })
      : this.api.criarImpressora(v);
    req.subscribe({
      next: () => {
        this.salvando.set(false);
        this.modalImp.set(false);
        this.notify.ok(edit ? 'Impressora atualizada.' : 'Impressora cadastrada.');
        this.carregarImpressoras();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  statusImpressora(p: M.Impressora): void {
    this.api.statusImpressora(p.id, !p.ativa).subscribe({
      next: () => this.carregarImpressoras(),
      error: (e) => this.notify.erro(e),
    });
  }

  testar(p: M.Impressora): void {
    this.api.testarImpressora(p.id).subscribe({
      next: () => this.notify.ok('Teste de impressão enviado.'),
      error: (e) => this.notify.erro(e),
    });
  }

  async removerImpressora(p: M.Impressora): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a impressora "${p.nome}" (${p.setor})?`,
      { titulo: 'Excluir impressora', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.api.removerImpressora(p.id).subscribe({
      next: () => {
        this.notify.ok('Impressora excluída.');
        this.carregarImpressoras();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- auto-descoberta (agente local) ----------------------------------------

  private carregarDescobertas(): void {
    this.api.listarDescobertasImpressoras().subscribe({
      next: (l) => this.descobertas.set(l),
      error: () => undefined,
    });
  }

  abrirRegistro(d: M.ImpressoraDescoberta): void {
    this.modalReg.set(d);
    this.regForm.reset({ nome: d.modelo ?? '', setor: '', padrao: false, etiqueta: false });
  }

  registrar(): void {
    const d = this.modalReg();
    if (!d) return;
    const v = this.regForm.getRawValue();
    this.salvando.set(true);
    this.api.registrarDescoberta(d.id, v).subscribe({
      next: () => {
        this.salvando.set(false);
        this.modalReg.set(null);
        this.notify.ok('Impressora registrada.');
        this.carregarImpressoras();
        this.carregarDescobertas();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  async ignorar(d: M.ImpressoraDescoberta): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Ignorar "${d.modelo ?? d.endereco}"? Novas varreduras podem reabri-la.`,
      { titulo: 'Ignorar dispositivo', confirmar: 'Ignorar' },
    );
    if (!ok) return;
    this.api.ignorarDescoberta(d.id).subscribe({
      next: () => this.carregarDescobertas(),
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo às configurações da pousada!',
          description:
            'Aqui ficam os dados que aparecem em <b>comprovantes, documentos ' +
            'e na impressão térmica</b>. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '#tour-check',
        popover: {
          title: 'Checklist de configuração',
          description:
            'Os 4 itens essenciais: <b>dados fiscais</b>, <b>endereço</b>, ' +
            '<b>logo</b> e <b>impressora padrão</b>. Verde = pronto; ' +
            'dourado = pendente.',
          side: 'bottom',
        },
      },
      {
        element: '.row-cards',
        popover: {
          title: 'Dados da pousada',
          description:
            'Razão social, CNPJ, contatos e endereço — tudo isso sai no ' +
            '<b>cabeçalho dos comprovantes</b> e na ficha do hóspede. ' +
            'Cada card grava separado.',
          side: 'top',
        },
      },
      {
        element: '#tour-imp',
        popover: {
          title: 'Impressoras por setor',
          description:
            'A impressora marcada como <b>padrão</b> recebe os comprovantes ' +
            'de check-out. Pedidos de consumo saem na impressora do ' +
            '<b>setor da categoria</b> (cozinha, bar…). O botão print testa na hora.',
          side: 'top',
        },
      },
      {
        element: '#tour-logo',
        popover: {
          title: 'Logo da pousada',
          description:
            'Envie a logo aqui — ela aparece nos <b>comprovantes ' +
            'impressos</b> e documentos do sistema.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Deixe os 4 itens do checklist verdes e a operação de ' +
            'impressão/documentos estará redonda.',
        },
      },
    ]);
  }
}
