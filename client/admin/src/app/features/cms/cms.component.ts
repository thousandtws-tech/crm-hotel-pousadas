import { Component, inject, signal, computed, OnInit, effect, viewChild, ElementRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { firstValueFrom } from 'rxjs';
import { ApiService, num } from '@core/services/api.service';
import { AuthStore } from '@core/services/auth.store';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import * as M from '@core/models/api.models';

interface ComodidadeForm {
  name: string;
  icon: string;
  highlight: boolean;
}

const PRESETS_COMODIDADES: ComodidadeForm[] = [
  { name: 'Ar-condicionado', icon: 'wind', highlight: true },
  { name: 'Banheiro privativo com chuveiro', icon: 'bath', highlight: true },
  { name: 'Televisão de tela plana', icon: 'tv', highlight: true },
  { name: 'Frigobar', icon: 'coffee', highlight: false },
  { name: 'Wi-Fi nas áreas da pousada', icon: 'wifi', highlight: false },
  { name: 'Varanda privativa', icon: 'sun', highlight: true },
  { name: 'Roupa de cama e toalhas', icon: 'sparkles', highlight: false },
  { name: 'Acesso à piscina externa', icon: 'waves', highlight: false },
];

export const ICONES_SITE: { id: string; label: string }[] = [
  { id: 'wind', label: 'Ar-condicionado (wind)' },
  { id: 'bath', label: 'Banheiro / Chuveiro (bath)' },
  { id: 'tv', label: 'Televisão (tv)' },
  { id: 'coffee', label: 'Frigobar / Café (coffee)' },
  { id: 'wifi', label: 'Wi-Fi (wifi)' },
  { id: 'sun', label: 'Varanda / Sol (sun)' },
  { id: 'sparkles', label: 'Conforto / Enxoval (sparkles)' },
  { id: 'waves', label: 'Piscina / Mar (waves)' },
  { id: 'users', label: 'Capacidade / Família (users)' },
  { id: 'bed', label: 'Cama (bed)' },
  { id: 'maximize', label: 'Espaço / Área (maximize)' },
  { id: 'eye', label: 'Vista (eye)' },
  { id: 'star', label: 'Destaque (star)' },
  { id: 'check', label: 'Item incluso (check)' },
];

type FiltroPub = 'todos' | 'pub' | 'rasc';

@Component({
  selector: 'app-cms',
  host: {
    '(document:keydown.escape)': 'onEsc()',
    '(document:keydown.arrowleft)': 'onSeta(-1)',
    '(document:keydown.arrowright)': 'onSeta(1)',
  },
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatSelectModule,
    MatChipsModule,
  ],
  template: `
    <div class="page">
      <!-- ================= Cabeçalho ================= -->
      <div class="cms-head">
        <div>
          <h2 class="cms-titulo">Conteúdo do site</h2>
          <p class="cms-sub">Quartos, textos, fotos e vídeos exibidos no site da pousada</p>
        </div>
        <div class="cms-acoes">
          <span class="rt-pill" [class.on]="rt.online()" [title]="rt.online() ? 'Publicações chegam ao site instantaneamente' : 'Sem conexão em tempo real'">
            <span class="dot"></span>
            {{ rt.online() ? 'Sincronização em tempo real' : 'Reconectando…' }}
          </span>
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-novo" class="btn-dark-blue" type="button" (click)="abrirNovo()">
            <mat-icon>add</mat-icon> Novo quarto
          </button>
        </div>
      </div>

      <!-- ================= Banners ================= -->
      <div class="cms-banners">
        <div class="cms-banner">
          <span class="cms-banner-ic tint-teal"><mat-icon>public</mat-icon></span>
          <div>
            <strong>Publicação em tempo real</strong>
            <p>O que estiver <b>Publicado</b> aparece no site na mesma hora — sem recarregar nem esperar. Rascunhos ficam invisíveis.</p>
          </div>
        </div>
        <div class="cms-banner">
          <span class="cms-banner-ic tint-gold"><mat-icon>photo_library</mat-icon></span>
          <div>
            <strong>Fotos e vídeos</strong>
            <p>No editor de cada quarto você envia a galeria, escolhe a <b>foto de capa</b> e ordena com as setas.</p>
          </div>
        </div>
        <div class="cms-banner">
          <span class="cms-banner-ic tint-navy"><mat-icon>star</mat-icon></span>
          <div>
            <strong>Vitrine da página inicial</strong>
            <p>Quartos marcados como <b>Destaque</b> aparecem na vitrine principal do site. Use com parcimônia — menos é mais.</p>
          </div>
        </div>
      </div>

      <!-- ================= Barra de números ================= -->
      <div class="cms-resumo" id="tour-resumo">
        <div class="cms-est">
          <span class="cms-est-num">{{ items().length }}</span>
          <span class="cms-est-lbl"><mat-icon>hotel</mat-icon> Quartos</span>
        </div>
        <div class="cms-est">
          <span class="cms-est-num">{{ totalPublicados() }}</span>
          <span class="cms-est-lbl"><mat-icon>public</mat-icon> No ar</span>
        </div>
        <div class="cms-est">
          <span class="cms-est-num">{{ totalRascunhos() }}</span>
          <span class="cms-est-lbl"><mat-icon>edit_note</mat-icon> Rascunhos / ocultos</span>
        </div>
        <div class="cms-est">
          <span class="cms-est-num" [class.cms-alerta]="semFotos() > 0">{{ semFotos() }}</span>
          <span class="cms-est-lbl"><mat-icon>image_not_supported</mat-icon> Sem fotos</span>
        </div>
        <span class="cms-resumo-info">
          <mat-icon>info</mat-icon> Quartos sem foto aparecem sem capa no site
        </span>
      </div>

      <!-- ================= Widget "usar no meu site" ================= -->
      @if (widget(); as w) {
        <div class="inner-card cms-card wg-card">
          <h3 class="wg-tit"><mat-icon>link</mat-icon> Motor de reservas — usar no seu site</h3>
          <p class="wg-sub">
            Hóspede reserva e paga direto no motor; os dados caem aqui no CRM.
            Compartilhe o link, o QR ou cole o código no seu site.
          </p>
          <div class="wg-grid">
            <img
              class="wg-qr" alt="QR code apontando para o motor de reservas"
              [src]="qrSrc()"
            />
            <div class="wg-info">
              <label class="dl">
                <span>Link direto</span>
                <input class="input-inn" readonly [value]="w.url" aria-label="Link do motor" />
              </label>
              <label class="dl">
                <span>Código do widget (mini busca + botão)</span>
                <textarea
                  class="input-inn wg-snippet" readonly rows="6"
                  [value]="w.snippet" aria-label="Código HTML do widget"
                ></textarea>
              </label>
              <div class="wg-acoes">
                <button type="button" class="mc-btn" (click)="copiarWidget(w.url)">Copiar link</button>
                <button type="button" class="mc-btn" (click)="copiarWidget(w.snippet)">Copiar código</button>
                <a class="mc-btn" [href]="w.url" target="_blank" rel="noopener">Abrir motor</a>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- ================= Site institucional (hero / SEO / FAQ) ================= -->
      <div class="inner-card cms-card">
        <h3 class="wg-tit"><mat-icon>web</mat-icon> Site institucional</h3>
        <p class="wg-sub">
          Conteúdo da página inicial — editável sem mexer em código. Salve cada seção de forma independente.
        </p>

        <form [formGroup]="siteForm" (ngSubmit)="salvarSite('hero')">
          <div class="site-secao">
            <div class="site-secao-head">
              <span class="site-secao-tit"><mat-icon>crop_landscape</mat-icon> Hero — primeira dobra</span>
              <button type="submit" class="mc-btn" [disabled]="salvandoSite()">Salvar hero</button>
            </div>
            <div class="form-grid">
              <label class="dl full">
                <span>Título</span>
                <input class="input-inn" formControlName="hero_titulo"
                       placeholder="Ex.: Refúgio à beira-mar na Bahia" />
              </label>
              <label class="dl full">
                <span>Subtítulo</span>
                <textarea class="input-inn" formControlName="hero_subtitulo" rows="2"
                          placeholder="Ex.: Acomodações aconchegantes, café da manhã regional e a melhor vista do litoral"></textarea>
              </label>
            </div>
          </div>

          <div class="site-secao">
            <div class="site-secao-head">
              <span class="site-secao-tit"><mat-icon>travel_explore</mat-icon> SEO — Google e buscadores</span>
              <button type="button" class="mc-btn" [disabled]="salvandoSite()" (click)="salvarSite('seo')">
                Salvar SEO
              </button>
            </div>
            <div class="form-grid">
              <label class="dl full">
                <span>Título da página</span>
                <input class="input-inn" formControlName="seo_titulo"
                       placeholder="Ex.: Pousada Mar Azul — Suítes à beira-mar" maxlength="60" />
              </label>
              <label class="dl full">
                <span>Descrição</span>
                <textarea class="input-inn" formControlName="seo_descricao" rows="2" maxlength="160"
                          placeholder="Aparece abaixo do título nos resultados de busca"></textarea>
              </label>
              <label class="dl full">
                <span>Palavras-chave (separadas por vírgula)</span>
                <input class="input-inn" formControlName="seo_keywords"
                       placeholder="pousada, bahia, beira-mar, suíte com vista" />
              </label>
            </div>
          </div>
        </form>

        <div class="site-secao">
          <div class="site-secao-head">
            <span class="site-secao-tit"><mat-icon>quiz</mat-icon> FAQ — dúvidas frequentes</span>
            <div class="site-secao-acoes">
              <button type="button" class="mc-btn" (click)="addFaq()">
                <mat-icon>add</mat-icon> Pergunta
              </button>
              <button type="button" class="mc-btn" [disabled]="salvandoSite()" (click)="salvarSite('faq')">
                Salvar FAQ
              </button>
            </div>
          </div>
          @if (faq().length === 0) {
            <p class="site-vazio">Nenhuma pergunta cadastrada — o site não exibe FAQ.</p>
          }
          @for (f of faq(); track $index) {
            <div class="faq-item">
              <input class="input-inn" [value]="f.pergunta" placeholder="Pergunta"
                     [attr.aria-label]="'Pergunta ' + ($index + 1)"
                     (input)="setFaq($index, 'pergunta', $event)" />
              <textarea class="input-inn" [value]="f.resposta" rows="2" placeholder="Resposta"
                        [attr.aria-label]="'Resposta ' + ($index + 1)"
                        (input)="setFaq($index, 'resposta', $event)"></textarea>
              <button type="button" class="faq-del" [attr.aria-label]="'Remover pergunta ' + ($index + 1)"
                      (click)="delFaq($index)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          }
        </div>
      </div>

      <!-- ================= Lista ================= -->
      <div class="inner-card cms-card" id="tour-tabela">
        <div class="cms-toolbar">
          <div class="cms-busca" [class.foco]="buscaFoco()">
            <mat-icon class="cms-busca-icone">search</mat-icon>
            <input
              class="cms-busca-input"
              type="search"
              [value]="termo()"
              (input)="termo.set(valorDe($event))"
              placeholder="Buscar por nome, número ou slug…"
              aria-label="Buscar quarto"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button type="button" class="cms-limpar" aria-label="Limpar busca" (click)="termo.set('')">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          <mat-chip-listbox
            class="cms-filtro"
            [value]="filtro()"
            (change)="filtro.set($event.value ?? 'todos')"
            aria-label="Filtrar por publicação"
          >
            <mat-chip-option value="todos">Todos</mat-chip-option>
            <mat-chip-option value="pub">No ar</mat-chip-option>
            <mat-chip-option value="rasc">Rascunhos</mat-chip-option>
          </mat-chip-listbox>
        </div>

        <div class="cms-tabela-wrap">
          <table class="cms-tabela">
            <thead>
              <tr>
                <th>Capa</th>
                <th>Quarto</th>
                <th class="tr">Diária</th>
                <th>Mídias</th>
                <th class="tc">Quarto</th>
                <th class="tc">No site</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td><span class="skel sk-capa"></span></td>
                    <td><span class="skel sk-txt-l"></span><span class="skel sk-txt-s"></span></td>
                    <td><span class="skel sk-txt"></span></td>
                    <td><span class="skel sk-txt"></span></td>
                    <td><span class="skel sk-chip"></span></td>
                    <td><span class="skel sk-chip"></span></td>
                    <td><span class="skel sk-acoes"></span></td>
                  </tr>
                }
              } @else {
                @for (a of filtrados(); track a.id) {
                  <tr [class.inativo-row]="!a.ativo">
                    <td>
                      @if (thumbs()[a.id]) {
                        <img [src]="thumbs()[a.id]" alt="Capa de {{ a.nome }}" class="capa-thumb" />
                      } @else {
                        <div class="capa-vazia" title="Sem foto de capa"><mat-icon>image</mat-icon></div>
                      }
                    </td>
                    <td>
                      <div class="q-cell">
                        <strong>
                          {{ a.nome }}
                          @if (a.cms?.destaque) {
                            <span class="tag-destaque" title="Exibido na vitrine da página inicial">★ Destaque</span>
                          }
                        </strong>
                        <small>
                          Nº {{ a.numero }} · {{ a.capacidade }} hóspede{{ a.capacidade === 1 ? '' : 's' }}
                          @if (a.cms?.slug) {
                            · <span class="slug">{{ a.cms!.slug }}</span>
                          }
                        </small>
                      </div>
                    </td>
                    <td class="tr preco-cell">
                      @if (Number(a.valor) > 0) {
                        R$ {{ num(a.valor) | number: '1.2-2' }}
                      } @else {
                        <span class="sob-consulta">Sob consulta</span>
                      }
                    </td>
                    <td class="midias-cell">
                      <span class="midia-n" [class.off]="contar(a, 'foto') === 0" title="Fotos">
                        <mat-icon>photo</mat-icon>{{ contar(a, 'foto') }}
                      </span>
                      <span class="midia-n" [class.off]="contar(a, 'video') === 0" title="Vídeos">
                        <mat-icon>videocam</mat-icon>{{ contar(a, 'video') }}
                      </span>
                    </td>
                    <td class="tc">
                      <button
                        class="status-chip badge-toggle"
                        [class.chip-ativo]="a.ativo"
                        [class.chip-vazio]="!a.ativo"
                        type="button"
                        [title]="a.ativo ? 'Clique para desativar quarto (some do PMS)' : 'Clique para reativar'"
                        (click)="toggleAtivo(a)"
                      >
                        {{ a.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc">
                      @if (!a.cms) {
                        <span class="status-chip chip-vazio">Sem conteúdo</span>
                      } @else if (a.cms!.status === 'publicado' && a.ativo) {
                        <button
                          class="status-chip chip-pub badge-toggle"
                          type="button"
                          title="Clique para tirar do ar (virar Rascunho)"
                          (click)="togglePublicacao(a, false)"
                        >
                          ● No ar
                        </button>
                      } @else {
                        <button
                          class="status-chip chip-rasc badge-toggle"
                          type="button"
                          title="Clique para publicar imediatamente no site"
                          (click)="togglePublicacao(a, true)"
                        >
                          Rascunho
                        </button>
                      }
                    </td>
                    <td class="tc">
                      <div class="cms-acoes-linha">
                        <button class="acao teal acao-txt" type="button" title="Abrir editor do quarto" (click)="abrirEditor(a)">
                          <mat-icon>edit</mat-icon> Editar
                        </button>
                        @if (auth.isAdmin()) {
                          <button
                            class="acao navy" type="button" title="Excluir quarto"
                            aria-label="Excluir quarto"
                            (click)="excluirQuarto(a)"
                          >
                            <mat-icon>delete</mat-icon>
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="cms-vazio">
                      <mat-icon>web</mat-icon>
                      {{ termo() || filtro() !== 'todos'
                        ? 'Nenhum quarto encontrado com esses filtros.'
                        : 'Nenhum quarto cadastrado ainda — clique em Novo quarto.' }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- ================= modal unificado (novo ou editar) ================= -->
      @if (modalAberto()) {
        <div class="overlay" (click.self)="fecharEditor()">
          <div class="modal-inn modal-cms" role="dialog" aria-modal="true" aria-labelledby="tit-cms">
            <div class="modal-head">
              <h5 id="tit-cms">
                <mat-icon>edit_note</mat-icon>
                {{ modoNovo() ? 'Novo quarto — cadastro e conteúdo do site' : 'Editar quarto — ' + form.controls.nome.value }}
              </h5>
              <button class="close" type="button" aria-label="Fechar" (click)="fecharEditor()">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <div class="modal-body">
              <form [formGroup]="form" (ngSubmit)="salvar(false)">
                <!-- SEÇÃO 1: DADOS DO QUARTO & PREÇO -->
                <div class="sec-title"><mat-icon>hotel</mat-icon> Dados do quarto &amp; tarifa</div>
                <div class="form-grid">
                  <label class="f-span2">
                    Nome do quarto <span class="req">*</span>
                    <input formControlName="nome" placeholder="Ex.: Suíte Master com Varanda" />
                  </label>
                  <label>
                    Número / código <span class="req">*</span>
                    <input type="number" formControlName="numero" min="1" placeholder="101" />
                  </label>

                  <div class="f-field">
                    <span class="f-lbl">Categoria</span>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat f-mat">
                      <mat-select formControlName="idtipo_acomodacao" placeholder="— Sem categoria —">
                        <mat-option [value]="null">— Sem categoria —</mat-option>
                        @for (t of tipos(); track t.id) {
                          <mat-option [value]="t.id">{{ t.nome }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </div>
                  <label>
                    Capacidade (hóspedes) <span class="req">*</span>
                    <input type="number" formControlName="capacidade" min="1" max="20" />
                  </label>
                  <label>
                    Diária (R$) — <span class="hint-inline">0 = "Sob consulta"</span>
                    <input type="number" formControlName="valor" min="0" step="0.01" placeholder="0,00 = Sob consulta" />
                  </label>
                </div>

                <!-- SEÇÃO 2: CONTEÚDO EDITORIAL DO SITE -->
                <div class="sec-title"><mat-icon>article</mat-icon> Textos &amp; ficha técnica no site</div>
                <div class="form-grid">
                  <label class="f-span2">
                    Subtítulo de destaque <span class="req">*</span>
                    <input formControlName="subtitulo"
                           placeholder="Ex.: Conforto e praticidade a poucos passos da Praia do Peró" />
                  </label>
                  <label class="f-field">
                    Slug da URL (automático se vazio)
                    <input formControlName="slug" placeholder="suite-master-varanda" />
                  </label>

                  <label class="f-full">
                    Descrição curta (exibida no card da lista de acomodações)
                    <textarea formControlName="descricao_curta" rows="2"
                              placeholder="Resumo objetivo que aparece nos cards da página inicial e de acomodações."></textarea>
                  </label>
                  <label class="f-full">
                    Descrição completa (página exclusiva do quarto)
                    <textarea formControlName="descricao_longa" rows="4"
                              placeholder="Texto detalhado apresentando a experiência, equipamentos e diferenciais do quarto."></textarea>
                  </label>
                  <label class="f-full">
                    Frase editorial (citação em destaque na página do quarto)
                    <input formControlName="destaque_editorial"
                           placeholder="Ex.: Praticidade e descanso a poucos minutos de caminhada da Praia do Peró." />
                  </label>

                  <label>
                    Configuração de camas
                    <input formControlName="camas" placeholder="1 cama de casal ou 2 de solteiro" />
                  </label>
                  <label>
                    Banheiros privativos
                    <input type="number" formControlName="banheiros" min="0" />
                  </label>
                  <label>
                    Área (m² — opcional)
                    <input type="number" formControlName="metragem" min="0" step="0.5" placeholder="Opcional" />
                  </label>
                  <label>
                    Vista / ambiente
                    <input formControlName="vista" placeholder="Varanda com vista para o jardim" />
                  </label>
                  <label>
                    Andar / localização
                    <input formControlName="andar" placeholder="Térreo ou piso superior" />
                  </label>
                  <label>
                    Ordem de exibição no site
                    <input type="number" formControlName="ordem" min="0" />
                  </label>

                  <label class="check f-full">
                    <input type="checkbox" formControlName="destaque" />
                    <strong>Destacar na página inicial (Home)</strong> — exibe este quarto na vitrine principal do site
                  </label>
                </div>
              </form>

              <!-- SEÇÃO 3: COMODIDADES -->
              <div class="bloco">
                <div class="bloco-head">
                  <div>
                    <div class="sec-title bloco-titulo"><mat-icon>room_service</mat-icon> Comodidades do quarto</div>
                    <div class="hint">Clique nos atalhos abaixo ou adicione itens personalizados:</div>
                  </div>
                  <button class="btn-gray" type="button" (click)="addComodidade()">
                    <mat-icon>add</mat-icon> Item personalizado
                  </button>
                </div>

                <div class="presets-bar">
                  @for (p of presets; track p.name) {
                    <button
                      type="button"
                      class="preset-chip"
                      [class.ativo]="temComodidade(p.name)"
                      (click)="togglePreset(p)"
                    >
                      {{ temComodidade(p.name) ? '✓ ' : '+ ' }}{{ p.name }}
                    </button>
                  }
                </div>

                @for (c of comodidades(); track $index; let i = $index) {
                  <div class="como-row">
                    <input
                      class="como-nome"
                      [value]="c.name"
                      (input)="atualizarComodidadeNome(i, $event)"
                      placeholder="Nome da comodidade (ex.: Ar-condicionado)"
                    />
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat f-mat ic-sel">
                      <mat-select
                        [value]="c.icon"
                        (selectionChange)="atualizarComodidadeIcone(i, $event.value)"
                        aria-label="Ícone da comodidade"
                      >
                        @for (ic of iconesSite; track ic.id) {
                          <mat-option [value]="ic.id">{{ ic.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <label class="check">
                      <input
                        type="checkbox"
                        [checked]="c.highlight"
                        (change)="atualizarComodidadeDestaque(i, $event)"
                      />
                      Destaque no card
                    </label>
                    <button class="btn-icon" type="button" title="Remover comodidade" (click)="delComodidade(i)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                }
              </div>

              <!-- SEÇÃO 4: FOTOS E VÍDEOS (MINIO S3) -->
              <div class="bloco">
                <div class="bloco-head">
                  <div>
                    <div class="sec-title bloco-titulo"><mat-icon>photo_library</mat-icon> Fotos e vídeos (S3)</div>
                    <div class="hint">
                      A foto marcada com <strong>Capa</strong> aparece nos cards; as demais compõem a galeria e o vídeo aparece na página do quarto.
                    </div>
                  </div>
                  <label class="upload-btn">
                    <mat-icon>cloud_upload</mat-icon> Enviar fotos / vídeos
                    <input
                      type="file"
                      hidden
                      multiple
                      accept="image/*,video/mp4,video/webm"
                      (change)="upload($event)"
                    />
                  </label>
                </div>

                @if (enviando()) {
                  <div class="loading"><mat-spinner diameter="24" /> Enviando para o armazenamento S3…</div>
                }

                @if (editandoMidias().length === 0 && !enviando()) {
                  <div class="midia-empty">
                    <mat-icon>add_photo_alternate</mat-icon>
                    Nenhuma foto ou vídeo enviado ainda.<br />
                    Clique em <strong>Enviar fotos / vídeos</strong> — aceita JPG, PNG, WebP, MP4 e WebM.
                  </div>
                } @else {
                  <div class="midia-grid">
                    @for (m of editandoMidias(); track m.id; let i = $index) {
                      <div class="midia-card" [class.capa]="m.capa">
                        @if (m.tipo === 'foto') {
                          <img [src]="midiaUrl(m.id)" alt="" title="Clique para ampliar" (click)="abrirPreview(i)" />
                        } @else {
                          <video [src]="midiaUrl(m.id)" muted preload="metadata" title="Clique para ampliar" (click)="abrirPreview(i)"></video>
                          <span class="video-tag">VÍDEO</span>
                        }
                        @if (m.capa) {
                          <span class="capa-tag">★ Capa</span>
                        }
                        <div class="midia-ops">
                          <button type="button" title="Mover para trás" (click)="mover(i, -1)">
                            <mat-icon>arrow_back</mat-icon>
                          </button>
                          <button type="button" title="Mover para frente" (click)="mover(i, 1)">
                            <mat-icon>arrow_forward</mat-icon>
                          </button>
                          @if (m.tipo === 'foto' && !m.capa) {
                            <button type="button" title="Definir como foto de capa" (click)="capa(m.id)">
                              <mat-icon>star</mat-icon>
                            </button>
                          }
                          <button type="button" class="del" title="Excluir do S3" (click)="removerMidia(m)">
                            <mat-icon>delete</mat-icon>
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="modal-foot">
              <button class="btn-gray" type="button" [disabled]="salvando()" (click)="salvar(false)">
                <mat-icon>save</mat-icon> Salvar rascunho
              </button>
              <button class="btn-green" type="button" [disabled]="salvando()" (click)="salvar(true)">
                <mat-icon>public</mat-icon>
                {{ editando()?.cms?.status === 'publicado' ? 'Salvar e atualizar no site' : 'Salvar e publicar no site' }}
              </button>
              <button class="btn-gray" type="button" (click)="fecharEditor()">Fechar</button>
            </div>
          </div>
        </div>
      }

      <!-- ================= Lightbox de mídia ================= -->
      @if (preview(); as p) {
        <div class="lightbox" role="dialog" aria-modal="true" aria-label="Pré-visualização de mídia"
             tabindex="-1" #lightbox (click)="fecharPreview()">
          <button type="button" class="lb-btn lb-close" aria-label="Fechar visualização" (click)="fecharPreview()">
            <mat-icon>close</mat-icon>
          </button>
          @if (editandoMidias().length > 1) {
            <button type="button" class="lb-btn lb-nav prev" aria-label="Mídia anterior"
                    (click)="navPreview(-1); $event.stopPropagation()">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <button type="button" class="lb-btn lb-nav next" aria-label="Próxima mídia"
                    (click)="navPreview(1); $event.stopPropagation()">
              <mat-icon>chevron_right</mat-icon>
            </button>
          }
          <figure class="lb-midia" (click)="$event.stopPropagation()">
            @if (p.tipo === 'foto') {
              <img [src]="midiaUrl(p.id)" [alt]="p.capa ? 'Foto de capa do quarto' : 'Foto da galeria'" />
            } @else {
              <video [src]="midiaUrl(p.id)" controls autoplay></video>
            }
            <figcaption>
              @if (p.capa) { <span class="lb-capa">★ Capa ·</span> }
              {{ (previewIdx() ?? 0) + 1 }} de {{ editandoMidias().length }}
            </figcaption>
          </figure>
        </div>
      }
    </div>
  `,
  styles: [`
    /* ---------- cabeçalho ---------- */
    .cms-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .cms-titulo { margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054; letter-spacing: -0.02em; }
    .cms-sub { margin: 2px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .cms-acoes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cms-acoes button { display: inline-flex; align-items: center; gap: 6px; }
    .rt-pill {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.74rem; padding: 6px 12px; border-radius: 20px;
      background: #eef2f5; color: #5d6d7e; font-weight: 600;
    }
    .rt-pill.on { background: rgba(26, 111, 138, 0.1); color: #1a6f8a; }
    .rt-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #adb5bd; }
    .rt-pill.on .dot { background: #1a6f8a; }
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

    /* ---------- banners ---------- */
    .cms-banners {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 960px) { .cms-banners { grid-template-columns: 1fr; } }
    .cms-banner {
      display: flex; gap: 12px; align-items: flex-start;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 14px 16px;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .cms-banner:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(5, 64, 84, 0.07); }
    .cms-banner-ic {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .cms-banner-ic mat-icon { font-size: 21px; width: 21px; height: 21px; }
    .tint-teal { background: rgba(26, 111, 138, 0.1); color: #1a6f8a; }
    .tint-gold { background: rgba(221, 165, 84, 0.14); color: #b5811f; }
    .tint-navy { background: rgba(5, 64, 84, 0.08); color: #054054; }
    .cms-banner strong { display: block; font-size: 0.88rem; color: #054054; margin-bottom: 3px; }
    .cms-banner p { margin: 0; font-size: 0.78rem; color: #7d97a1; line-height: 1.45; }

    /* ---------- resumo ---------- */
    .cms-resumo {
      display: flex; align-items: center;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      margin-bottom: 16px; overflow-x: auto;
    }
    .cms-est {
      display: flex; flex-direction: column; gap: 3px;
      padding: 12px 26px; min-width: 150px;
      border-left: 1px solid #eef2f5;
    }
    .cms-est:first-child { border-left: none; }
    .cms-est-num {
      font-size: 1.5rem; font-weight: 800; color: #054054;
      line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
    }
    .cms-est-num.cms-alerta { color: #b97708; }
    .cms-est-lbl {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; font-weight: 600; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap;
    }
    .cms-est-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; color: #a5b6bf; }
    .cms-resumo-info {
      margin-left: auto; padding: 0 20px;
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.72rem; color: #a5b6bf; white-space: nowrap;
    }
    .cms-resumo-info mat-icon { font-size: 14px; width: 14px; height: 14px; }
    @media (max-width: 820px) { .cms-resumo-info { display: none; } }

    /* ---------- toolbar ---------- */
    .cms-card { padding-top: 14px; }

    /* ---------- widget "usar no meu site" ---------- */
    .wg-card { margin-bottom: 16px; }
    .wg-tit { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 1rem; color: #054054; }
    .wg-tit mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .wg-sub { margin: 0 0 12px; font-size: 0.82rem; color: #5d6d7e; }
    .wg-grid { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
    .wg-qr { width: 150px; height: 150px; border: 1px solid #e3eaef; border-radius: 8px; background: #fff; }
    .wg-info { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
    .wg-snippet { font-family: monospace; font-size: 0.72rem; resize: vertical; }
    .wg-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .dl { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: #5d6d7e; }
    .mc-btn { font-size: 0.78rem; padding: 6px 14px; border: 1px solid #d7e0e6; border-radius: 6px; background: #fff; color: #1a6f8a; cursor: pointer; text-decoration: none; }
    .mc-btn:hover { border-color: #1a6f8a; }
    .mc-btn:disabled { opacity: 0.55; cursor: default; }

    /* ---------- site institucional ---------- */
    .site-secao { border-top: 1px solid #edf1f4; padding: 14px 0; }
    .site-secao-head {
      display: flex; justify-content: space-between; align-items: center;
      gap: 10px; flex-wrap: wrap; margin-bottom: 10px;
    }
    .site-secao-tit {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.85rem; font-weight: 700; color: #054054;
    }
    .site-secao-tit mat-icon { font-size: 18px; width: 18px; height: 18px; color: #1a6f8a; }
    .site-secao-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .site-secao-acoes .mc-btn { display: inline-flex; align-items: center; gap: 4px; }
    .site-secao-acoes .mc-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .site-vazio { margin: 0; font-size: 0.8rem; color: #7d97a1; }
    .faq-item {
      display: grid; grid-template-columns: 1fr auto; gap: 8px;
      align-items: start; margin-bottom: 8px;
    }
    .faq-item textarea { grid-column: 1 / 2; resize: vertical; }
    .faq-del {
      grid-row: 1 / 3; align-self: center; border: none; background: none;
      color: #b3402a; cursor: pointer; padding: 6px; border-radius: 6px;
    }
    .faq-del:hover { background: rgba(179, 64, 42, 0.08); }

    .cms-toolbar {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      padding: 4px 2px 14px;
    }
    .cms-busca {
      display: flex; align-items: center; gap: 8px;
      flex: 1; min-width: 200px; max-width: 380px;
      background: #fff; border: 1px solid #d7e0e6; border-radius: 8px;
      padding: 0 10px; height: 40px;
      transition: border-color .15s, box-shadow .15s;
    }
    .cms-busca.foco { border-color: #1a6f8a; box-shadow: 0 0 0 3px rgba(26, 111, 138, 0.14); }
    .cms-busca-icone { color: #7d97a1; font-size: 20px; width: 20px; height: 20px; }
    .cms-busca-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 0.9rem; color: #33424c; font-family: inherit; height: 100%;
    }
    .cms-busca-input::placeholder { color: #8fa3ab; }
    .cms-busca-input::-webkit-search-cancel-button { display: none; }
    .cms-limpar {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 22px; height: 22px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .cms-limpar mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .cms-limpar:hover { background: #d7e0e6; }
    .cms-filtro {
      --mdc-chip-elevated-container-color: #fff;
      --mdc-chip-elevated-selected-container-color: #1a6f8a;
      --mdc-chip-selected-label-text-color: #fff;
      --mdc-chip-label-text-color: #40525d;
      --mdc-chip-outline-color: #d7e0e6;
    }

    /* ---------- tabela ---------- */
    .cms-tabela-wrap { overflow-x: auto; min-height: 40vh; }
    .cms-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .cms-tabela thead th {
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 12px 16px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .cms-tabela tbody td {
      padding: 12px 16px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .cms-tabela tbody tr:hover { background: #f7fafb; }
    .cms-tabela .tc { text-align: center; }
    .cms-tabela .tr { text-align: right; }
    .inativo-row { opacity: .55; }
    .capa-thumb, .capa-vazia {
      width: 78px; height: 52px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
    }
    .capa-thumb { object-fit: cover; border: 1px solid #dde5e9; }
    .capa-vazia { background: #eef3f6; color: #9fb4be; }
    .capa-vazia mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .q-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .q-cell strong {
      font-size: 0.93rem; color: #054054; font-weight: 700;
      display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    }
    .q-cell small { font-size: 0.75rem; color: #8a99a4; white-space: nowrap; }
    .slug { font-family: monospace; color: #1a6f8a; font-size: 0.72rem; }
    .tag-destaque {
      background: rgba(221, 165, 84, 0.15); color: #b5811f;
      font-size: 0.65rem; font-weight: 700; padding: 1px 8px; border-radius: 999px;
      white-space: nowrap;
    }
    .preco-cell { font-weight: 700; color: #054054; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sob-consulta { font-size: 0.78rem; color: #8a99a4; font-style: italic; font-weight: 400; }
    .midias-cell { white-space: nowrap; }
    .midia-n {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.8rem; font-weight: 700; color: #054054;
      margin-right: 12px;
    }
    .midia-n mat-icon { font-size: 16px; width: 16px; height: 16px; color: #1a6f8a; }
    .midia-n.off { color: #a5b6bf; }
    .midia-n.off mat-icon { color: #c3d2d9; }
    .chip-ativo { background: #1a6f8a; color: #fff; }
    .chip-pub { background: #198754; color: #fff; }
    .chip-rasc { background: #b5811f; color: #054054; }
    .chip-vazio { background: #eef2f5; color: #7d97a1; }
    .badge-toggle { border: none; cursor: pointer; font-family: inherit; }
    .cms-acoes-linha { display: inline-flex; gap: 5px; align-items: center; }
    .acao {
      display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 6px; height: 30px; padding: 0 10px;
      color: #fff; cursor: pointer; transition: filter .14s;
      font-size: 0.78rem; font-weight: 600; font-family: inherit; gap: 5px;
    }
    .acao mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .acao:hover { filter: brightness(1.12); }
    .acao.teal { background: #1a6f8a; }
    .acao.navy { background: #054054; }
    .acao-txt { padding: 0 12px; }
    .cms-vazio {
      text-align: center; color: #8a99a4; padding: 40px !important; font-size: 0.86rem;
    }
    .cms-vazio mat-icon { display: block; margin: 0 auto 8px; font-size: 32px; width: 32px; height: 32px; color: #c3d2d9; }

    /* ---------- skeleton ---------- */
    .skel-row td { padding: 14px 16px; }
    .skel {
      display: block; border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .sk-capa { width: 78px; height: 52px; }
    .sk-txt-l { width: 170px; height: 15px; margin-bottom: 6px; }
    .sk-txt-s { width: 110px; height: 11px; }
    .sk-txt { width: 80px; height: 14px; }
    .sk-chip { width: 72px; height: 22px; border-radius: 999px; margin: 0 auto; }
    .sk-acoes { width: 92px; height: 28px; margin: 0 auto; }

    /* ---------- modal ---------- */
    .overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(5, 64, 84, 0.45);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 2rem 1rem; backdrop-filter: blur(2px);
    }
    .modal-inn {
      background: #fff; border-radius: 12px;
      box-shadow: 0 18px 50px rgba(5, 64, 84, 0.25);
      animation: in 0.16s ease-out;
      display: flex; flex-direction: column; max-height: 92vh;
    }
    .modal-cms { width: 95vw; max-width: 880px; }
    @keyframes in { from { transform: translateY(-12px); opacity: 0; } }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.85rem 1.25rem; border-bottom: 1px solid #e3eaef;
    }
    .modal-head h5 {
      margin: 0; font-size: 1.02rem; font-weight: 700; color: #054054;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .modal-head h5 mat-icon { font-size: 20px; width: 20px; height: 20px; color: #1a6f8a; }
    .modal-head .close {
      border: none; background: #eef2f5; border-radius: 50%;
      width: 28px; height: 28px; cursor: pointer; color: #5d6d7e;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .modal-head .close:hover { background: #d7e0e6; }
    .modal-head .close mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .modal-body { padding: 1.1rem 1.25rem; overflow-y: auto; }
    .modal-foot {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 0.8rem 1.25rem; border-top: 1px solid #e3eaef;
      background: #f7fafb; border-radius: 0 0 12px 12px;
    }
    .modal-foot button { display: inline-flex; align-items: center; gap: 6px; }

    .sec-title {
      display: flex; align-items: center; gap: 7px;
      font-size: 0.74rem; font-weight: 700; color: #054054;
      text-transform: uppercase; letter-spacing: 0.06em;
      margin: 16px 0 10px; padding-bottom: 6px;
      border-bottom: 2px solid #eef3f6;
    }
    .sec-title:first-child { margin-top: 0; }
    .sec-title mat-icon { font-size: 17px; width: 17px; height: 17px; color: #1a6f8a; }
    .bloco-titulo { margin: 0 0 4px; border-bottom: none; padding-bottom: 0; }
    .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 12px; }
    .f-span2 { grid-column: span 2; }
    .f-full { grid-column: 1 / -1; }
    label { font-size: 12px; color: #334; font-weight: 600; display: flex; flex-direction: column; gap: 3px; }
    label.check { flex-direction: row; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
    .f-field { display: flex; flex-direction: column; gap: 3px; margin-top: 1.3rem; }
    .f-lbl { font-size: 12px; color: #334; font-weight: 600; }
    .f-mat { width: 100%; }
    .req { color: #b00; }
    .hint { color: #7d97a1; font-size: 12px; margin: 3px 0 0; }
    .hint-inline { color: #7d97a1; font-weight: 400; font-size: 11px; }
    input, textarea { border: 1px solid #d2d6de; border-radius: 4px; padding: 7px 9px; font: inherit; font-weight: 400; background: #fff; }
    .form-grid input:not([type='checkbox']) { height: 36px; padding: 0 9px; }
    input:focus, textarea:focus { border-color: #1a6f8a; outline: none; }
    .bloco { margin-top: 18px; border-top: 2px solid #eef3f6; padding-top: 12px; }
    .bloco-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .bloco-head .btn-gray { display: inline-flex; align-items: center; gap: 5px; }
    .presets-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .preset-chip {
      border: 1px solid #c5d6de; background: #f4f8fa; color: #054054;
      border-radius: 16px; padding: 4px 11px; font-size: 11px; cursor: pointer;
      font-family: inherit; transition: all .13s;
    }
    .preset-chip:hover { border-color: #1a6f8a; }
    .preset-chip.ativo { background: #1a6f8a; color: #fff; border-color: #1a6f8a; font-weight: 600; }
    .como-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .como-nome { flex: 1; min-width: 0; height: 36px; padding: 0 10px; box-sizing: border-box; }
    .ic-sel { width: 240px; flex-shrink: 0; }
    .btn-icon {
      background: none; border: none; color: #b00; cursor: pointer;
      display: inline-flex; align-items: center; padding: 4px; border-radius: 6px;
    }
    .btn-icon:hover { background: rgba(187, 0, 0, 0.07); }
    .upload-btn {
      display: inline-flex; flex-direction: row; align-items: center; gap: 6px;
      background: #054054; color: #fff; border-radius: 5px; padding: 9px 14px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap;
      transition: background 0.15s; margin-top: 14px;
    }
    .upload-btn:hover { background: #1a6f8a; }
    .upload-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .loading { display: flex; align-items: center; gap: 10px; padding: 16px; justify-content: center; color: #7d97a1; font-size: 0.85rem; }
    .midia-empty {
      padding: 22px 16px; background: #f7fafb; border: 1px dashed #c5d6de;
      border-radius: 8px; text-align: center; color: #7d97a1; font-size: 12px;
      line-height: 1.6;
    }
    .midia-empty mat-icon { font-size: 26px; width: 26px; height: 26px; color: #a5b6bf; margin-bottom: 4px; }
    .midia-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
    .midia-card { position: relative; border: 2px solid #dde5e9; border-radius: 8px; padding: 4px; background: #fff; }
    .midia-card.capa { border-color: #b5811f; }
    .midia-card img, .midia-card video { width: 100%; height: 92px; object-fit: cover; border-radius: 5px; display: block; background: #f2f6f8; cursor: zoom-in; }
    /* ---------- lightbox ---------- */
    .lightbox {
      position: fixed; inset: 0; z-index: 300;
      background: rgba(3, 20, 28, 0.88);
      display: flex; align-items: center; justify-content: center;
      outline: none; animation: lb-fade 0.15s ease-out;
    }
    @keyframes lb-fade { from { opacity: 0; } }
    .lb-midia { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: min(1100px, 92vw); }
    .lb-midia img, .lb-midia video { max-width: 100%; max-height: 78vh; object-fit: contain; border-radius: 8px; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.55); background: #062d3d; }
    .lb-midia figcaption { color: #9fc4d3; font-size: 0.82rem; font-weight: 600; }
    .lb-capa { color: #b5811f; }
    .lb-btn {
      position: fixed; z-index: 301;
      width: 42px; height: 42px; border-radius: 50%; border: none;
      background: rgba(26, 111, 138, 0.9); color: #fff; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .lb-btn:hover, .lb-btn:focus-visible { background: #b5811f; color: #054054; }
    .lb-close { top: 18px; right: 20px; }
    .lb-nav { top: 50%; transform: translateY(-50%); }
    .lb-nav.prev { left: 16px; }
    .lb-nav.next { right: 16px; }
    .capa-tag { position: absolute; top: 9px; left: 9px; background: #b5811f; color: #054054; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
    .video-tag { position: absolute; top: 9px; right: 9px; background: #054054; color: #fff; font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .midia-ops { display: flex; justify-content: center; gap: 4px; margin-top: 4px; }
    .midia-ops button {
      background: #f0f4f6; border: none; cursor: pointer; color: #054054;
      padding: 3px; border-radius: 5px; display: inline-flex;
    }
    .midia-ops button:hover { background: #dde7ec; }
    .midia-ops button.del { color: #b00; }
    .midia-ops button.del:hover { background: rgba(187, 0, 0, 0.08); }
    .midia-ops mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class CmsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly tour = inject(TourGuiado);
  protected readonly rt = inject(Realtime);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<M.AcomodacaoCmsView[]>([]);
  protected readonly tipos = signal<M.TipoAcomodacao[]>([]);
  protected readonly carregando = signal(true);
  protected readonly modalAberto = signal(false);
  protected readonly modoNovo = signal(false);
  protected readonly editando = signal<M.AcomodacaoCmsView | null>(null);
  protected readonly editandoMidias = signal<M.Midia[]>([]);
  protected readonly thumbs = signal<Record<number, string>>({});
  protected readonly midiaBlobs = signal<Record<number, string>>({});
  protected readonly enviando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly comodidades = signal<ComodidadeForm[]>([]);
  protected readonly termo = signal('');
  protected readonly filtro = signal<FiltroPub>('todos');
  protected readonly buscaFoco = signal(false);
  protected readonly previewIdx = signal<number | null>(null);
  protected readonly preview = computed<M.Midia | null>(() => {
    const i = this.previewIdx();
    return i === null ? null : (this.editandoMidias()[i] ?? null);
  });
  private readonly lightboxEl = viewChild<ElementRef<HTMLElement>>('lightbox');
  protected readonly skel = [0, 1, 2, 3];

  protected readonly num = num;
  protected readonly Number = Number;
  protected readonly presets = PRESETS_COMODIDADES;
  protected readonly iconesSite = ICONES_SITE;

  protected readonly totalPublicados = computed(
    () => this.items().filter((a) => a.ativo && a.cms?.status === 'publicado').length,
  );
  protected readonly totalRascunhos = computed(
    () => this.items().length - this.totalPublicados(),
  );
  protected readonly semFotos = computed(
    () => this.items().filter((a) => !a.midias.some((m) => m.tipo === 'foto')).length,
  );
  protected readonly filtrados = computed(() => {
    const t = this.termo().trim().toLowerCase();
    const f = this.filtro();
    return this.items().filter((a) => {
      if (f === 'pub' && !(a.ativo && a.cms?.status === 'publicado')) return false;
      if (f === 'rasc' && a.ativo && a.cms?.status === 'publicado') return false;
      if (!t) return true;
      return (
        a.nome.toLowerCase().includes(t) ||
        String(a.numero).includes(t) ||
        (a.cms?.slug ?? '').toLowerCase().includes(t) ||
        (a.cms?.subtitulo ?? '').toLowerCase().includes(t)
      );
    });
  });

  protected readonly form = this.fb.nonNullable.group({
    // Dados da acomodação (PMS)
    nome: ['', Validators.required],
    numero: [101, [Validators.required, Validators.min(1)]],
    idtipo_acomodacao: [null as number | null],
    capacidade: [2, [Validators.required, Validators.min(1)]],
    valor: [0],
    // Dados editoriais (CMS)
    slug: [''],
    subtitulo: ['', Validators.required],
    descricao_curta: [''],
    descricao_longa: [''],
    destaque_editorial: [''],
    camas: [''],
    banheiros: [1 as number | null],
    metragem: [null as number | null],
    vista: [''],
    andar: [''],
    ordem: [1],
    destaque: [true],
  });

  protected readonly widget = signal<{ url: string; qr_svg: string; snippet: string } | null>(null);
  protected readonly qrSrc = computed(() => {
    const svg = this.widget()?.qr_svg;
    return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : '';
  });

  // ---------- site institucional (seções hero/seo/faq) ----------
  protected readonly siteForm = this.fb.nonNullable.group({
    hero_titulo: [''],
    hero_subtitulo: [''],
    seo_titulo: [''],
    seo_descricao: [''],
    seo_keywords: [''],
  });
  protected readonly faq = signal<{ pergunta: string; resposta: string }[]>([]);
  protected readonly salvandoSite = signal(false);

  private cmsVersion = 0;
  private pmsVersion = 0;

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('acomodacao', 'acomodacao_cms', 'acomodacao_midia');
      if (ultimo < 0) { ultimo = v; return; }
      if (v !== ultimo && !this.modalAberto()) { ultimo = v; this.carregar(); }
    });
    effect(() => {
      if (this.previewIdx() !== null) this.lightboxEl()?.nativeElement.focus();
    });
  }

  ngOnInit(): void {
    this.carregar();
    this.api.listarTipos(true).subscribe({
      next: (ts) => this.tipos.set(ts),
      error: () => {},
    });
    this.api.widgetMotor().subscribe({
      next: (w) => this.widget.set(w),
      error: () => {},
    });
    this.carregarSite();
  }

  private carregarSite(): void {
    this.api.listarSiteSecoes().subscribe({
      next: (secoes) => {
        const por = new Map(secoes.map((s) => [s.secao, s.dados]));
        const str = (d: Record<string, unknown> | undefined, k: string) =>
          typeof d?.[k] === 'string' ? (d[k] as string) : '';
        this.siteForm.patchValue({
          hero_titulo: str(por.get('hero'), 'titulo'),
          hero_subtitulo: str(por.get('hero'), 'subtitulo'),
          seo_titulo: str(por.get('seo'), 'titulo'),
          seo_descricao: str(por.get('seo'), 'descricao'),
          seo_keywords: str(por.get('seo'), 'keywords'),
        });
        const itens = por.get('faq')?.['itens'];
        if (Array.isArray(itens)) {
          this.faq.set(
            itens
              .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
              .map((i) => ({
                pergunta: typeof i['pergunta'] === 'string' ? i['pergunta'] : '',
                resposta: typeof i['resposta'] === 'string' ? i['resposta'] : '',
              })),
          );
        }
      },
      error: () => {},
    });
  }

  protected salvarSite(secao: 'hero' | 'seo' | 'faq'): void {
    const v = this.siteForm.getRawValue();
    const dados: M.CmsSecaoDados =
      secao === 'hero'
        ? { titulo: v.hero_titulo.trim(), subtitulo: v.hero_subtitulo.trim() }
        : secao === 'seo'
          ? {
              titulo: v.seo_titulo.trim(),
              descricao: v.seo_descricao.trim(),
              keywords: v.seo_keywords.trim(),
            }
          : {
              itens: this.faq()
                .map((f) => ({ pergunta: f.pergunta.trim(), resposta: f.resposta.trim() }))
                .filter((f) => f.pergunta && f.resposta),
            };
    this.salvandoSite.set(true);
    this.api.salvarSiteSecao(secao, dados).subscribe({
      next: () => {
        this.salvandoSite.set(false);
        this.notify.ok('Seção salva — o site já reflete a mudança.');
      },
      error: (e) => {
        this.salvandoSite.set(false);
        this.notify.erroMsg(e?.error?.erro ?? 'Falha ao salvar a seção.');
      },
    });
  }

  protected addFaq(): void {
    this.faq.update((l) => [...l, { pergunta: '', resposta: '' }]);
  }

  protected delFaq(i: number): void {
    this.faq.update((l) => l.filter((_, j) => j !== i));
  }

  protected setFaq(i: number, campo: 'pergunta' | 'resposta', ev: Event): void {
    const valor = (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.faq.update((l) => l.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
  }

  copiarWidget(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('Copiado.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }

  onEsc(): void {
    if (this.previewIdx() !== null) { this.fecharPreview(); return; }
    if (this.modalAberto()) this.fecharEditor();
  }

  onSeta(dir: 1 | -1): void {
    if (this.previewIdx() !== null) this.navPreview(dir);
  }

  abrirPreview(i: number): void {
    this.previewIdx.set(i);
  }

  fecharPreview(): void {
    this.previewIdx.set(null);
  }

  navPreview(dir: 1 | -1): void {
    const n = this.editandoMidias().length;
    if (n < 2) return;
    this.previewIdx.update((i) => (i === null ? null : (i + dir + n) % n));
  }

  carregar(): void {
    this.api.listarCms().subscribe({
      next: (it) => {
        this.items.set(it);
        this.carregando.set(false);
        this.carregarThumbs(it);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erroMsg('Falha ao carregar os quartos do CMS.');
      },
    });
  }

  contar(a: M.AcomodacaoCmsView, tipo: string): number {
    return a.midias.filter((m) => m.tipo === tipo).length;
  }

  private carregarThumbs(it: M.AcomodacaoCmsView[]): void {
    for (const a of it) {
      const fotos = a.midias.filter((m) => m.tipo === 'foto');
      const capa = fotos.find((m) => m.capa) ?? fotos[0];
      if (capa) {
        this.api.midiaBlob(capa.id).subscribe({
          next: (b) => this.thumbs.update((t) => ({ ...t, [a.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      }
    }
  }

  midiaUrl(id: number): string {
    return this.midiaBlobs()[id] ?? '';
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  abrirNovo(): void {
    const proxNumero = this.items().reduce((m, a) => Math.max(m, a.numero), 100) + 1;
    const proxOrdem = this.items().length + 1;
    this.cmsVersion = 0;
    this.pmsVersion = 0;
    this.modoNovo.set(true);
    this.editando.set(null);
    this.editandoMidias.set([]);
    this.comodidades.set([
      { name: 'Ar-condicionado', icon: 'wind', highlight: true },
      { name: 'Banheiro privativo com chuveiro', icon: 'bath', highlight: true },
      { name: 'Televisão de tela plana', icon: 'tv', highlight: true },
      { name: 'Frigobar', icon: 'coffee', highlight: false },
      { name: 'Wi-Fi nas áreas da pousada', icon: 'wifi', highlight: false },
    ]);
    this.form.reset({
      nome: '',
      numero: proxNumero,
      idtipo_acomodacao: this.tipos()[0]?.id ?? null,
      capacidade: 2,
      valor: 0,
      slug: '',
      subtitulo: '',
      descricao_curta: '',
      descricao_longa: '',
      destaque_editorial: '',
      camas: '1 cama de casal',
      banheiros: 1,
      metragem: null,
      vista: 'Acesso às áreas internas da pousada',
      andar: 'Térreo ou piso superior',
      ordem: proxOrdem,
      destaque: true,
    });
    this.modalAberto.set(true);
  }

  abrirEditor(a: M.AcomodacaoCmsView): void {
    const c = a.cms;
    this.cmsVersion = c?.version ?? 0;
    this.pmsVersion = a.version;
    this.modoNovo.set(false);
    this.editando.set(a);
    this.form.reset({
      nome: a.nome,
      numero: a.numero,
      idtipo_acomodacao: a.idtipo_acomodacao,
      capacidade: a.capacidade,
      valor: Number(a.valor) || 0,
      slug: c?.slug ?? '',
      subtitulo: c?.subtitulo ?? a.descricao ?? '',
      descricao_curta: c?.descricao_curta ?? a.descricao ?? '',
      descricao_longa: c?.descricao_longa ?? '',
      destaque_editorial: c?.destaque_editorial ?? '',
      camas: c?.camas ?? '',
      banheiros: c?.banheiros ?? 1,
      metragem: c?.metragem ? Number(c.metragem) : null,
      vista: c?.vista ?? '',
      andar: c?.andar ?? '',
      ordem: c?.ordem ?? 1,
      destaque: c?.destaque ?? true,
    });
    this.comodidades.set(
      (c?.comodidades ?? []).map((x) => ({
        name: x.name,
        icon: x.icon || 'check',
        highlight: !!x.highlight,
      })),
    );
    this.editandoMidias.set([...a.midias].sort((x, y) => x.ordem - y.ordem || x.id - y.id));
    for (const m of a.midias) {
      if (!this.midiaBlobs()[m.id]) {
        this.api.midiaBlob(m.id).subscribe({
          next: (b) => this.midiaBlobs.update((t) => ({ ...t, [m.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      }
    }
    this.modalAberto.set(true);
  }

  fecharEditor(): void {
    this.previewIdx.set(null);
    this.modalAberto.set(false);
    this.editando.set(null);
  }

  // -- Comodidades ------------------------------------------------------------
  temComodidade(name: string): boolean {
    return this.comodidades().some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  togglePreset(p: ComodidadeForm): void {
    if (this.temComodidade(p.name)) {
      this.comodidades.update((list) =>
        list.filter((c) => c.name.toLowerCase() !== p.name.toLowerCase()),
      );
    } else {
      this.comodidades.update((list) => [...list, { ...p }]);
    }
  }

  addComodidade(): void {
    this.comodidades.update((c) => [...c, { name: '', icon: 'check', highlight: false }]);
  }

  delComodidade(i: number): void {
    this.comodidades.update((c) => c.filter((_, x) => x !== i));
  }

  atualizarComodidadeNome(i: number, ev: Event): void {
    const val = (ev.target as HTMLInputElement).value;
    this.comodidades.update((list) => list.map((item, idx) => (idx === i ? { ...item, name: val } : item)));
  }

  atualizarComodidadeIcone(i: number, val: string): void {
    this.comodidades.update((list) => list.map((item, idx) => (idx === i ? { ...item, icon: val } : item)));
  }

  atualizarComodidadeDestaque(i: number, ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    this.comodidades.update((list) =>
      list.map((item, idx) => (idx === i ? { ...item, highlight: checked } : item)),
    );
  }

  // -- Persistência unificada (PMS + CMS + Publicação) ------------------------
  async salvar(publicarDepois: boolean): Promise<void> {
    const v = this.form.getRawValue();
    if (!v.nome.trim()) {
      this.notify.erroMsg('Informe o nome do quarto.');
      return;
    }
    if (!v.subtitulo.trim()) {
      this.notify.erroMsg('Informe o subtítulo do quarto para o site.');
      return;
    }

    this.salvando.set(true);
    try {
      let acomId = this.editando()?.id;

      const acomInput: M.AcomodacaoInput = {
        idtipo_acomodacao: v.idtipo_acomodacao,
        nome: v.nome.trim(),
        numero: Number(v.numero) || 101,
        valor: Number(v.valor) || 0,
        capacidade: Number(v.capacidade) || 2,
        descricao: v.descricao_curta.trim() || v.subtitulo.trim(),
        cor: this.editando()?.cor ?? '#1a6f8a',
        version: acomId ? this.pmsVersion : undefined,
      };

      if (!acomId) {
        const criada = await firstValueFrom(this.api.criarAcomodacao(acomInput));
        acomId = criada.id;
        this.pmsVersion = criada.version;
        // Cria unidade física padrão para reservas se ainda não existir
        firstValueFrom(this.api.criarQuarto(acomId, String(acomInput.numero))).catch(() => {});
      } else {
        const atualizada = await firstValueFrom(this.api.atualizarAcomodacao(acomId, acomInput));
        this.pmsVersion = atualizada.version;
      }

      const cmsInput: M.CmsInput = {
        slug: v.slug.trim() || null,
        subtitulo: v.subtitulo.trim(),
        descricao_curta: v.descricao_curta.trim() || null,
        descricao_longa: v.descricao_longa.trim() || null,
        destaque_editorial: v.destaque_editorial.trim() || null,
        camas: v.camas.trim() || null,
        banheiros: v.banheiros,
        metragem: v.metragem,
        vista: v.vista.trim() || null,
        andar: v.andar.trim() || null,
        comodidades: this.comodidades().filter((c) => c.name.trim() !== ''),
        destaque: v.destaque,
        ordem: Number(v.ordem) || 0,
        version: this.cmsVersion || undefined,
      };

      const cmsSalvo = await firstValueFrom(this.api.salvarCms(acomId, cmsInput));
      this.cmsVersion = cmsSalvo.version;

      if (publicarDepois) {
        await firstValueFrom(this.api.statusCms(acomId, true));
        this.notify.ok('Quarto gravado e publicado no site em tempo real!');
      } else {
        this.notify.ok('Quarto gravado com sucesso.');
      }

      this.carregar();
      this.fecharEditor();
    } catch (e) {
      this.notify.erro(e);
    } finally {
      this.salvando.set(false);
    }
  }

  togglePublicacao(a: M.AcomodacaoCmsView, publicar: boolean): void {
    this.api.statusCms(a.id, publicar).subscribe({
      next: () => {
        this.notify.ok(publicar ? 'Quarto publicado no site!' : 'Quarto movido para rascunho.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  toggleAtivo(a: M.AcomodacaoCmsView): void {
    this.api.statusAcomodacao(a.id, !a.ativo).subscribe({
      next: () => {
        this.notify.ok(!a.ativo ? 'Quarto ativado.' : 'Quarto desativado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- Upload & Gestão de Mídias (MinIO S3) -----------------------------------
  async upload(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const files = inputEl.files ? Array.from(inputEl.files) : [];
    if (files.length === 0) return;

    let acomId = this.editando()?.id;

    // Se o usuário está criando um quarto novo e já quer subir fotos antes de clicar em Salvar:
    if (!acomId) {
      const v = this.form.getRawValue();
      if (!v.nome.trim()) {
        this.notify.erroMsg('Preencha primeiro o Nome do quarto antes de enviar fotos.');
        inputEl.value = '';
        return;
      }
      try {
        this.enviando.set(true);
        const criada = await firstValueFrom(
          this.api.criarAcomodacao({
            idtipo_acomodacao: v.idtipo_acomodacao,
            nome: v.nome.trim(),
            numero: Number(v.numero) || 101,
            valor: Number(v.valor) || 0,
            capacidade: Number(v.capacidade) || 2,
            descricao: v.subtitulo.trim() || v.nome.trim(),
            cor: '#1a6f8a',
          }),
        );
        acomId = criada.id;
        this.pmsVersion = criada.version;
        this.modoNovo.set(false);
        this.editando.set({
          ...criada,
          cms: null,
          midias: [],
        });
      } catch (e) {
        this.enviando.set(false);
        this.notify.erro(e);
        return;
      }
    }

    this.enviando.set(true);
    for (const file of files) {
      try {
        const m = await firstValueFrom(this.api.uploadMidia(acomId, file));
        this.editandoMidias.update((l) => [...l, m]);
        this.api.midiaBlob(m.id).subscribe({
          next: (b) => this.midiaBlobs.update((t) => ({ ...t, [m.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      } catch (e) {
        this.notify.erro(e);
      }
    }
    this.enviando.set(false);
    inputEl.value = '';
    this.carregar();
  }

  async excluirQuarto(a: M.AcomodacaoCmsView): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o quarto ${a.nome} (Nº${a.numero})? Todo o conteúdo do site e as mídias no S3 serão apagados.`,
      { titulo: 'Excluir quarto', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.api.excluirAcomodacao(a.id).subscribe({
      next: (r) => {
        this.notify.ok(r.mensagem);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  removerMidia(m: M.Midia): void {
    if (!confirm('Remover esta mídia do quarto e do MinIO S3?')) return;
    this.fecharPreview();
    this.api.removerMidia(m.id).subscribe({
      next: () => {
        this.editandoMidias.update((l) => l.filter((x) => x.id !== m.id));
        this.carregar();
      },
      error: () => this.notify.erroMsg('Falha ao remover a mídia.'),
    });
  }

  capa(id: number): void {
    this.api.definirCapa(id).subscribe({
      next: () => {
        this.editandoMidias.update((l) => l.map((x) => ({ ...x, capa: x.id === id })));
        this.carregar();
      },
      error: () => this.notify.erroMsg('Falha ao definir a capa.'),
    });
  }

  mover(i: number, dir: number): void {
    const a = this.editando();
    const l = [...this.editandoMidias()];
    const j = i + dir;
    if (!a || j < 0 || j >= l.length) return;
    this.fecharPreview();
    [l[i], l[j]] = [l[j], l[i]];
    this.editandoMidias.set(l);
    this.api.ordenarMidias(a.id, l.map((m) => m.id)).subscribe({
      error: () => this.notify.erroMsg('Falha ao reordenar.'),
    });
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo ao Conteúdo do site!',
          description:
            'Aqui você controla tudo que aparece no <b>site da pousada</b>: ' +
            'quartos, textos, fotos e vídeos. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '.rt-pill',
        popover: {
          title: 'Sincronização em tempo real',
          description:
            'Quando esta bolinha está <b>ativa</b>, cada publicação chega ao ' +
            'site instantaneamente — quem estiver navegando vê na hora.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-resumo',
        popover: {
          title: 'Situação do site',
          description:
            '<b>No ar</b> = visível no site · <b>Rascunhos</b> = salvos mas ' +
            'ocultos · <b>Sem fotos</b> = quartos que precisam de imagens ' +
            '(aparecem sem capa).',
          side: 'bottom',
        },
      },
      {
        element: '.cms-busca',
        popover: {
          title: 'Busca e filtros',
          description:
            'Busque por <b>nome, número ou slug</b> e use os filtros ' +
            '<b>No ar / Rascunhos</b> para enxergar só o que importa.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de quartos',
          description:
            'Cada linha mostra a <b>capa</b>, dados do quarto, quantas ' +
            '<b>fotos e vídeos</b> tem, e dois controles: <b>Ativo</b> ' +
            '(existe no sistema) e <b>No ar</b> (visível no site).',
          side: 'top',
        },
      },
      {
        element: '#tour-novo',
        popover: {
          title: 'Editor completo',
          description:
            '<b>Novo quarto</b> ou <b>Editar</b> abrem o editor em 4 etapas: ' +
            'dados e tarifa → textos do site → comodidades → fotos e vídeos. ' +
            'Salve como rascunho ou publique direto.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Fluxo ideal: crie o quarto, envie as fotos, marque a capa e ' +
            'publique. O site se atualiza sozinho, sem recarregar.',
        },
      },
    ]);
  }
}
