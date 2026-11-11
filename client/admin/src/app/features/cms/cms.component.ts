import { Component, inject, signal, computed, OnInit, effect, viewChild, ElementRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ApiService, num } from '@core/services/api.service';
import { AuthStore } from '@core/services/auth.store';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import * as M from '@core/models/api.models';
import { PaginasEditorComponent } from './paginas-editor.component';

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
type AbaCms = 'quartos' | 'site' | 'widget';

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
    PaginasEditorComponent,
  ],
  template: `
    <div class="page cms-shell">
      <header class="cms-head">
        <div class="cms-head-copy">
          <h1 class="cms-titulo">Conteúdo do site</h1>
          <p class="cms-sub">Gerencie acomodações, páginas institucionais, SEO e integração do motor de reservas.</p>
        </div>
        <div class="cms-acoes">
          <span
            class="rt-pill"
            [class.on]="rt.online()"
            [title]="rt.online() ? 'Publicações chegam ao site instantaneamente' : 'Sem conexão em tempo real'"
          >
            <span class="dot"></span>
            {{ rt.online() ? 'Tempo real ativo' : 'Reconectando…' }}
          </span>
          <button class="btn-ghost" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            Tutorial
          </button>
          <button id="tour-novo" class="btn-primary" type="button" (click)="abrirNovo()">
            <mat-icon>add</mat-icon>
            Novo quarto
          </button>
        </div>
      </header>

      <nav class="cms-tabs" role="tablist" aria-label="Seções do conteúdo do site">
        <button
          type="button"
          role="tab"
          class="cms-tab"
          [class.ativo]="aba() === 'quartos'"
          [attr.aria-selected]="aba() === 'quartos'"
          (click)="aba.set('quartos')"
        >
          Acomodações
          <span class="tab-count">{{ items().length }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="cms-tab"
          [class.ativo]="aba() === 'site'"
          [attr.aria-selected]="aba() === 'site'"
          (click)="aba.set('site')"
        >
          Páginas e SEO
        </button>
        @if (widget()) {
          <button
            type="button"
            role="tab"
            class="cms-tab"
            [class.ativo]="aba() === 'widget'"
            [attr.aria-selected]="aba() === 'widget'"
            (click)="aba.set('widget')"
          >
            Motor e integração
          </button>
        }
      </nav>

      @if (aba() === 'quartos') {
        <section class="cms-section" aria-label="Gestão de acomodações no site">
          <div class="cms-resumo" id="tour-resumo">
            <div class="cms-est">
              <span class="cms-est-lbl">Total de quartos</span>
              <span class="cms-est-num">{{ items().length }}</span>
            </div>
            <div class="cms-est">
              <span class="cms-est-lbl">Publicados no site</span>
              <span class="cms-est-num">{{ totalPublicados() }}</span>
            </div>
            <div class="cms-est">
              <span class="cms-est-lbl">Rascunhos ou ocultos</span>
              <span class="cms-est-num">{{ totalRascunhos() }}</span>
            </div>
            <div class="cms-est">
              <span class="cms-est-lbl">Sem fotos</span>
              <span class="cms-est-num">{{ semFotos() }}</span>
            </div>
          </div>

          <div class="cms-panel" id="tour-tabela">
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

              <div class="seg-group" role="group" aria-label="Filtrar por status de publicação">
                <button
                  type="button"
                  class="seg-btn"
                  [class.ativo]="filtro() === 'todos'"
                  [attr.aria-pressed]="filtro() === 'todos'"
                  (click)="filtro.set('todos')"
                >
                  Todos
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  [class.ativo]="filtro() === 'pub'"
                  [attr.aria-pressed]="filtro() === 'pub'"
                  (click)="filtro.set('pub')"
                >
                  No ar
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  [class.ativo]="filtro() === 'rasc'"
                  [attr.aria-pressed]="filtro() === 'rasc'"
                  (click)="filtro.set('rasc')"
                >
                  Rascunhos
                </button>
              </div>
            </div>

            <div class="cms-tabela-wrap">
              <table class="cms-tabela">
                <thead>
                  <tr>
                    <th class="col-capa">Capa</th>
                    <th>Acomodação</th>
                    <th class="tr">Diária base</th>
                    <th>Mídia</th>
                    <th class="tc">Sistema</th>
                    <th class="tc">Publicação</th>
                    <th class="tr">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  @if (carregando()) {
                    @for (s of skel; track s) {
                      <tr class="skel-row">
                        <td><span class="skel sk-capa"></span></td>
                        <td><span class="skel sk-txt-l"></span><span class="skel sk-txt-s"></span></td>
                        <td><span class="skel sk-txt tr-auto"></span></td>
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
                            <div class="capa-vazia" title="Sem foto de capa">
                              <mat-icon>image</mat-icon>
                            </div>
                          }
                        </td>
                        <td>
                          <div class="q-cell">
                            <div class="q-title-row">
                              <strong class="q-name">{{ a.nome }}</strong>
                              @if (a.cms?.destaque) {
                                <span class="tag-neutral" title="Exibido na vitrine da página inicial">Destaque</span>
                              }
                            </div>
                            <small class="q-meta">
                              Nº {{ a.numero }} · {{ a.capacidade }} hóspede{{ a.capacidade === 1 ? '' : 's' }}
                              @if (a.cms?.slug) {
                                · <span class="slug">/{{ a.cms!.slug }}</span>
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
                          <span class="midia-n" [class.off]="contar(a, 'foto') === 0">
                            {{ contar(a, 'foto') }} foto{{ contar(a, 'foto') === 1 ? '' : 's' }}
                          </span>
                          <span class="midia-sep">·</span>
                          <span class="midia-n" [class.off]="contar(a, 'video') === 0">
                            {{ contar(a, 'video') }} vídeo{{ contar(a, 'video') === 1 ? '' : 's' }}
                          </span>
                        </td>
                        <td class="tc">
                          <button
                            class="pill-toggle"
                            [class.pill-solid]="a.ativo"
                            type="button"
                            [title]="a.ativo ? 'Clique para desativar quarto no PMS' : 'Clique para reativar quarto'"
                            (click)="toggleAtivo(a)"
                          >
                            <span class="pill-dot"></span>
                            {{ a.ativo ? 'Ativo' : 'Inativo' }}
                          </button>
                        </td>
                        <td class="tc">
                          @if (!a.cms) {
                            <span class="pill-static">Sem conteúdo</span>
                          } @else if (a.cms!.status === 'publicado' && a.ativo) {
                            <button
                              class="pill-toggle pill-solid"
                              type="button"
                              title="Clique para mover para rascunho"
                              (click)="togglePublicacao(a, false)"
                            >
                              <span class="pill-dot"></span>
                              No ar
                            </button>
                          } @else {
                            <button
                              class="pill-toggle"
                              type="button"
                              title="Clique para publicar imediatamente no site"
                              (click)="togglePublicacao(a, true)"
                            >
                              <span class="pill-dot"></span>
                              Rascunho
                            </button>
                          }
                        </td>
                        <td class="tr">
                          <div class="cms-acoes-linha">
                            <button
                              class="btn-row"
                              type="button"
                              title="Abrir editor do quarto"
                              (click)="abrirEditor(a)"
                            >
                              Editar
                            </button>
                            @if (auth.isAdmin()) {
                              <button
                                class="btn-icon-row"
                                type="button"
                                title="Excluir quarto"
                                aria-label="Excluir quarto {{ a.nome }}"
                                (click)="excluirQuarto(a)"
                              >
                                <mat-icon>delete_outline</mat-icon>
                              </button>
                            }
                          </div>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="7" class="cms-vazio">
                          <p class="vazio-tit">
                            {{ termo() || filtro() !== 'todos'
                              ? 'Nenhuma acomodação encontrada para os filtros aplicados.'
                              : 'Nenhuma acomodação cadastrada.' }}
                          </p>
                          @if (!termo() && filtro() === 'todos') {
                            <p class="vazio-sub">Clique em "Novo quarto" no canto superior direito para cadastrar a primeira acomodação.</p>
                          }
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>
      }

      @if (aba() === 'site') {
        <section class="cms-section" aria-label="Páginas do site institucional">
          <div class="site-topbar">
            <p class="settings-desc">
              Todas as páginas do site são editáveis aqui — textos, imagens, vídeos, chamadas e SEO.
              As alterações publicadas atualizam o site em tempo real.
            </p>
            @if (siteUrl()) {
              <a class="btn-ghost btn-sm" [href]="siteUrl()" target="_blank" rel="noopener">
                Ver site
              </a>
            }
          </div>
          <app-paginas-editor />
        </section>
      }

      @if (aba() === 'widget' && widget(); as w) {
        <section class="cms-section" aria-label="Integração do motor de reservas">
          <div class="settings-row">
            <div class="settings-aside">
              <h2 class="settings-tit">Link direto e QR Code</h2>
              <p class="settings-desc">
                Compartilhe em redes sociais, materiais impressos na recepção ou atendimento via WhatsApp.
              </p>
              <a class="btn-ghost btn-sm" [href]="w.url" target="_blank" rel="noopener">
                Abrir motor em nova aba
              </a>
            </div>
            <div class="settings-card wg-card-grid">
              <img
                class="wg-qr"
                alt="QR code para o motor de reservas"
                [src]="qrSrc()"
              />
              <div class="wg-url-box">
                <label class="field">
                  <span class="field-lbl">Endereço público do motor</span>
                  <div class="copy-row">
                    <input class="cms-input mono" readonly [value]="w.url" aria-label="Link do motor de reservas" />
                    <button type="button" class="btn-ghost" (click)="copiarWidget(w.url)">Copiar link</button>
                  </div>
                </label>
                <p class="field-help">
                  As reservas concluídas no motor sincronizam disponibilidade, pagamento e ficha do hóspede automaticamente.
                </p>
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-aside">
              <h2 class="settings-tit">Widget HTML incorporável</h2>
              <p class="settings-desc">
                Cole este trecho em qualquer página externa para exibir um seletor de datas conectado direto ao motor.
              </p>
              <button type="button" class="btn-primary btn-sm" (click)="copiarWidget(w.snippet)">
                Copiar código HTML
              </button>
            </div>
            <div class="settings-card">
              <label class="field">
                <span class="field-lbl">Snippet de incorporação</span>
                <textarea
                  class="cms-input mono wg-snippet"
                  readonly
                  rows="7"
                  [value]="w.snippet"
                  aria-label="Código HTML do widget"
                ></textarea>
              </label>
            </div>
          </div>
        </section>
      }

      @if (modalAberto()) {
        <div class="overlay" (click.self)="fecharEditor()">
          <div class="modal-cms" role="dialog" aria-modal="true" aria-labelledby="tit-cms">
            <div class="modal-head">
              <div>
                <h2 id="tit-cms" class="modal-tit">
                  {{ modoNovo() ? 'Nova acomodação' : 'Editar acomodação' }}
                </h2>
                <p class="modal-sub">
                  {{ modoNovo() ? 'Cadastro operacional e conteúdo exibido no site' : form.controls.nome.value }}
                </p>
              </div>
              <button class="btn-icon-row" type="button" aria-label="Fechar janela" (click)="fecharEditor()">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <div class="modal-body">
              <form [formGroup]="form" (ngSubmit)="salvar(false)">
                <div class="sec-block">
                  <div class="sec-header">
                    <span class="sec-step">01</span>
                    <h3 class="sec-title">Identificação e tarifa</h3>
                  </div>
                  <div class="form-grid">
                    <label class="field f-span2">
                      <span class="field-lbl">Nome da acomodação <span class="req">*</span></span>
                      <input class="cms-input" formControlName="nome" placeholder="Ex.: Suíte Master com Varanda" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Número / código <span class="req">*</span></span>
                      <input class="cms-input" type="number" formControlName="numero" min="1" placeholder="101" />
                    </label>

                    <label class="field">
                      <span class="field-lbl">Categoria</span>
                      <select class="cms-input" formControlName="idtipo_acomodacao">
                        <option [ngValue]="null">Sem categoria</option>
                        @for (t of tipos(); track t.id) {
                          <option [ngValue]="t.id">{{ t.nome }}</option>
                        }
                      </select>
                    </label>
                    <label class="field">
                      <span class="field-lbl">Capacidade (hóspedes) <span class="req">*</span></span>
                      <input class="cms-input" type="number" formControlName="capacidade" min="1" max="20" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Diária base (R$) <span class="field-hint">0 = Sob consulta</span></span>
                      <input class="cms-input" type="number" formControlName="valor" min="0" step="0.01" placeholder="0,00" />
                    </label>
                  </div>
                </div>

                <div class="sec-block">
                  <div class="sec-header">
                    <span class="sec-step">02</span>
                    <h3 class="sec-title">Textos e ficha técnica</h3>
                  </div>
                  <div class="form-grid">
                    <label class="field f-span2">
                      <span class="field-lbl">Subtítulo de apresentação <span class="req">*</span></span>
                      <input
                        class="cms-input"
                        formControlName="subtitulo"
                        placeholder="Ex.: Conforto e silêncio a poucos passos da praia"
                      />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Slug da URL <span class="field-hint">opcional</span></span>
                      <input class="cms-input mono" formControlName="slug" placeholder="suite-master-varanda" />
                    </label>

                    <label class="field f-full">
                      <span class="field-lbl">Descrição curta (listagens e cards)</span>
                      <textarea
                        class="cms-input"
                        formControlName="descricao_curta"
                        rows="2"
                        placeholder="Resumo objetivo exibido nos cards de acomodação."
                      ></textarea>
                    </label>
                    <label class="field f-full">
                      <span class="field-lbl">Descrição completa (página da acomodação)</span>
                      <textarea
                        class="cms-input"
                        formControlName="descricao_longa"
                        rows="4"
                        placeholder="Texto completo apresentando o espaço, iluminação, enxoval e diferenciais."
                      ></textarea>
                    </label>
                    <label class="field f-full">
                      <span class="field-lbl">Frase em destaque</span>
                      <input
                        class="cms-input"
                        formControlName="destaque_editorial"
                        placeholder="Citação curta exibida em destaque na página individual."
                      />
                    </label>

                    <label class="field">
                      <span class="field-lbl">Camas</span>
                      <input class="cms-input" formControlName="camas" placeholder="1 cama queen" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Banheiros</span>
                      <input class="cms-input" type="number" formControlName="banheiros" min="0" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Área (m²)</span>
                      <input class="cms-input" type="number" formControlName="metragem" min="0" step="0.5" placeholder="Opcional" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Vista / ambiente</span>
                      <input class="cms-input" formControlName="vista" placeholder="Vista para o jardim" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Andar / localização</span>
                      <input class="cms-input" formControlName="andar" placeholder="Térreo" />
                    </label>
                    <label class="field">
                      <span class="field-lbl">Ordem de exibição</span>
                      <input class="cms-input" type="number" formControlName="ordem" min="0" />
                    </label>

                    <label class="check-row f-full">
                      <input type="checkbox" formControlName="destaque" />
                      <span>
                        <strong>Exibir na vitrine da página inicial</strong>
                        <small>Destaca esta acomodação na seção principal da Home.</small>
                      </span>
                    </label>
                  </div>
                </div>
              </form>

              <div class="sec-block">
                <div class="sec-header sec-between">
                  <div class="sec-header-left">
                    <span class="sec-step">03</span>
                    <div>
                      <h3 class="sec-title">Comodidades</h3>
                      <p class="sec-sub">Selecione itens rápidos ou cadastre comodidades específicas.</p>
                    </div>
                  </div>
                  <button class="btn-ghost btn-sm" type="button" (click)="addComodidade()">
                    <mat-icon>add</mat-icon>
                    Item personalizado
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

                @if (comodidades().length > 0) {
                  <div class="como-list">
                    @for (c of comodidades(); track $index; let i = $index) {
                      <div class="como-row">
                        <input
                          class="cms-input como-nome"
                          [value]="c.name"
                          [attr.aria-label]="'Nome da comodidade ' + (i + 1)"
                          (input)="atualizarComodidadeNome(i, $event)"
                          placeholder="Nome da comodidade"
                        />
                        <select
                          class="cms-input ic-sel"
                          [attr.aria-label]="'Ícone da comodidade ' + (i + 1)"
                          (change)="atualizarComodidadeIcone(i, valorDe($event))"
                        >
                          @for (ic of iconesSite; track ic.id) {
                            <option [value]="ic.id" [selected]="ic.id === c.icon">{{ ic.label }}</option>
                          }
                        </select>
                        <label class="como-check">
                          <input
                            type="checkbox"
                            [checked]="c.highlight"
                            (change)="atualizarComodidadeDestaque(i, $event)"
                          />
                          <span>Destaque</span>
                        </label>
                        <button
                          class="btn-icon-row"
                          type="button"
                          title="Remover comodidade"
                          [attr.aria-label]="'Remover comodidade ' + (i + 1)"
                          (click)="delComodidade(i)"
                        >
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>

              <div class="sec-block">
                <div class="sec-header sec-between">
                  <div class="sec-header-left">
                    <span class="sec-step">04</span>
                    <div>
                      <h3 class="sec-title">Fotos e vídeos</h3>
                      <p class="sec-sub">Defina a imagem de capa e ordene a sequência da galeria.</p>
                    </div>
                  </div>
                  <label class="btn-primary btn-sm upload-lbl">
                    <mat-icon>upload</mat-icon>
                    Enviar arquivos
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
                  <div class="loading-bar">
                    <mat-spinner diameter="18" />
                    <span>Enviando arquivos para o armazenamento…</span>
                  </div>
                }

                @if (editandoMidias().length === 0 && !enviando()) {
                  <div class="midia-empty">
                    Nenhum arquivo enviado. Formatos aceitos: JPG, PNG, WebP, MP4 e WebM.
                  </div>
                } @else {
                  <div class="midia-grid">
                    @for (m of editandoMidias(); track m.id; let i = $index) {
                      <div class="midia-card" [class.capa]="m.capa">
                        @if (m.tipo === 'foto') {
                          <img
                            [src]="midiaUrl(m.id)"
                            [alt]="m.capa ? 'Foto de capa' : 'Foto ' + (i + 1)"
                            title="Clique para ampliar"
                            (click)="abrirPreview(i)"
                          />
                        } @else {
                          <video
                            [src]="midiaUrl(m.id)"
                            muted
                            preload="metadata"
                            title="Clique para ampliar"
                            (click)="abrirPreview(i)"
                          ></video>
                          <span class="media-badge right">Vídeo</span>
                        }
                        @if (m.capa) {
                          <span class="media-badge left">Capa</span>
                        }
                        <div class="midia-ops">
                          <button type="button" title="Mover para trás" aria-label="Mover mídia para trás" (click)="mover(i, -1)">
                            <mat-icon>arrow_back</mat-icon>
                          </button>
                          <button type="button" title="Mover para frente" aria-label="Mover mídia para frente" (click)="mover(i, 1)">
                            <mat-icon>arrow_forward</mat-icon>
                          </button>
                          @if (m.tipo === 'foto' && !m.capa) {
                            <button type="button" title="Definir como capa" aria-label="Definir como foto de capa" (click)="capa(m.id)">
                              <mat-icon>star_outline</mat-icon>
                            </button>
                          }
                          <button type="button" title="Remover mídia" aria-label="Remover mídia" (click)="removerMidia(m)">
                            <mat-icon>delete_outline</mat-icon>
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="modal-foot">
              <button class="btn-ghost" type="button" (click)="fecharEditor()">Cancelar</button>
              <div class="foot-right">
                <button class="btn-ghost" type="button" [disabled]="salvando()" (click)="salvar(false)">
                  Salvar rascunho
                </button>
                <button class="btn-primary" type="button" [disabled]="salvando()" (click)="salvar(true)">
                  {{ editando()?.cms?.status === 'publicado' ? 'Salvar e atualizar' : 'Salvar e publicar' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      @if (preview(); as p) {
        <div
          class="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Pré-visualização de mídia"
          tabindex="-1"
          #lightbox
          (click)="fecharPreview()"
        >
          <button type="button" class="lb-btn lb-close" aria-label="Fechar visualização" (click)="fecharPreview()">
            <mat-icon>close</mat-icon>
          </button>
          @if (editandoMidias().length > 1) {
            <button
              type="button"
              class="lb-btn lb-nav prev"
              aria-label="Mídia anterior"
              (click)="navPreview(-1); $event.stopPropagation()"
            >
              <mat-icon>chevron_left</mat-icon>
            </button>
            <button
              type="button"
              class="lb-btn lb-nav next"
              aria-label="Próxima mídia"
              (click)="navPreview(1); $event.stopPropagation()"
            >
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
              @if (p.capa) { <span>Capa · </span> }
              {{ (previewIdx() ?? 0) + 1 }} / {{ editandoMidias().length }}
            </figcaption>
          </figure>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; --c-bg: #fff; --c-sub: #fafafa; --c-mut: #f4f4f5; --c-brd: #e4e4e7; --c-brd2: #d4d4d8; --c-ink: #09090b; --c-ink2: #3f3f46; --c-ink3: #52525b; --c-txt: #71717a; --mdc-circular-progress-active-indicator-color: #18181b; }
    .cms-shell { background: var(--c-bg); border: 1px solid var(--c-brd); border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.03); padding: 24px 28px; color: var(--c-ink); font-family: var(--font-body); }
    .cms-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; padding-bottom: 20px; }
    .cms-titulo, .settings-tit, .modal-tit { font-family: var(--font-body) !important; font-weight: 600 !important; color: var(--c-ink) !important; margin: 0; }
    .cms-titulo { font-size: 1.35rem !important; letter-spacing: -.02em; line-height: 1.25; }
    .cms-sub { margin: 4px 0 0; font-size: .84rem; color: var(--c-txt); line-height: 1.45; }
    .cms-acoes, .aside-actions, .foot-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rt-pill { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--c-brd); background: var(--c-sub); color: var(--c-ink3); font-size: .76rem; font-weight: 500; }
    .rt-pill .dot, .pill-toggle .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: #a1a1aa; }
    .rt-pill.on .dot { background: var(--c-ink); }
    .btn-primary, .btn-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 6px; font: 500 .82rem var(--font-body); cursor: pointer; text-decoration: none; white-space: nowrap; }
    .btn-primary { background: #18181b; color: #fff; border: 1px solid #18181b; }
    .btn-primary:hover:not(:disabled) { background: #27272a; border-color: #27272a; color: #fff; }
    .btn-ghost { background: #fff; color: var(--c-ink); border: 1px solid var(--c-brd); }
    .btn-ghost:hover:not(:disabled) { background: var(--c-sub); border-color: var(--c-brd2); color: var(--c-ink); }
    .btn-primary:disabled, .btn-ghost:disabled { opacity: .5; cursor: not-allowed; }
    .btn-sm { height: 32px; padding: 0 12px; font-size: .78rem; }
    :is(.btn-primary,.btn-ghost,.cms-limpar,.btn-icon-row,.midia-ops button) mat-icon { font-size: 16px; width: 16px; height: 16px; }
    :is(.btn-primary,.btn-ghost,.cms-tab,.seg-btn,.pill-toggle,.btn-row,.btn-icon-row,.preset-chip):focus-visible { outline: 2px solid var(--c-ink); outline-offset: 2px; }
    .cms-tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--c-brd); margin-bottom: 22px; overflow-x: auto; }
    .cms-tab { position: relative; display: inline-flex; align-items: center; gap: 7px; background: none; border: none; padding: 10px 2px 12px; font: 500 .85rem var(--font-body); color: var(--c-txt); cursor: pointer; white-space: nowrap; }
    .cms-tab:hover, .cms-tab.ativo { color: var(--c-ink); }
    .cms-tab.ativo { font-weight: 600; }
    .cms-tab.ativo::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--c-ink); }
    .tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--c-mut); color: var(--c-ink3); font-size: .72rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .cms-resumo { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--c-brd); border-radius: 8px; margin-bottom: 18px; overflow: hidden; }
    .cms-est { display: flex; flex-direction: column; gap: 6px; padding: 14px 18px; border-left: 1px solid var(--c-brd); }
    .cms-est:first-child { border-left: none; }
    .cms-est-lbl { font-size: .74rem; font-weight: 500; color: var(--c-txt); }
    .cms-est-num { font-size: 1.35rem; font-weight: 600; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .cms-panel { border: 1px solid var(--c-brd); border-radius: 8px; overflow: hidden; }
    .cms-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--c-brd); background: var(--c-sub); }
    .cms-busca { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; max-width: 360px; background: var(--c-bg); border: 1px solid var(--c-brd); border-radius: 6px; padding: 0 10px; height: 34px; }
    .cms-busca.foco, .cms-input:focus { border-color: var(--c-ink); outline: none; }
    .cms-busca-icone { color: var(--c-txt); font-size: 17px; width: 17px; height: 17px; }
    .cms-busca-input { flex: 1; border: none; outline: none; background: none; font: .84rem var(--font-body); color: var(--c-ink); height: 100%; }
    .cms-busca-input::placeholder, .cms-input::placeholder { color: #a1a1aa; }
    .cms-busca-input::-webkit-search-cancel-button { display: none; }
    .cms-limpar, .btn-icon-row { border: none; background: none; width: 28px; height: 28px; border-radius: 5px; cursor: pointer; color: var(--c-txt); display: inline-flex; align-items: center; justify-content: center; padding: 0; }
    .cms-limpar:hover, .btn-icon-row:hover { background: var(--c-mut); color: var(--c-ink); }
    .seg-group { display: inline-flex; padding: 2px; border-radius: 6px; background: var(--c-mut); border: 1px solid var(--c-brd); }
    .seg-btn { border: none; background: none; color: var(--c-ink3); font: 500 .78rem var(--font-body); height: 28px; padding: 0 12px; border-radius: 4px; cursor: pointer; }
    .seg-btn:hover { color: var(--c-ink); }
    .seg-btn.ativo { background: var(--c-bg); color: var(--c-ink); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
    .cms-tabela-wrap { overflow-x: auto; }
    .cms-tabela { width: 100%; border-collapse: collapse; font-size: .85rem; }
    .cms-tabela thead th { color: var(--c-txt); font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--c-brd); white-space: nowrap; }
    .col-capa { width: 88px; }
    .cms-tabela tbody td { padding: 12px 16px; border-bottom: 1px solid var(--c-brd); vertical-align: middle; color: var(--c-ink2); }
    .cms-tabela tbody tr:last-child td { border-bottom: none; }
    .cms-tabela tbody tr:hover { background: var(--c-sub); }
    .tc { text-align: center !important; }
    .tr { text-align: right !important; }
    .inativo-row { opacity: .55; }
    .capa-thumb, .capa-vazia { width: 68px; height: 46px; border-radius: 5px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--c-brd); object-fit: cover; }
    .capa-vazia { background: var(--c-mut); color: #a1a1aa; }
    .q-cell { display: flex; flex-direction: column; gap: 3px; min-width: 180px; }
    .q-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .q-name { font-size: .88rem; font-weight: 600; color: var(--c-ink); }
    .tag-neutral { display: inline-flex; align-items: center; height: 19px; padding: 0 7px; border-radius: 4px; border: 1px solid var(--c-brd); background: var(--c-sub); color: var(--c-ink3); font-size: .68rem; font-weight: 500; }
    .q-meta { font-size: .76rem; color: var(--c-txt); white-space: nowrap; }
    .slug, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .76rem; }
    .preco-cell { font-weight: 600; color: var(--c-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sob-consulta { font-size: .78rem; color: var(--c-txt); font-weight: 400; }
    .midias-cell { white-space: nowrap; font-size: .8rem; color: var(--c-ink3); font-variant-numeric: tabular-nums; }
    .midia-n.off { color: #a1a1aa; }
    .midia-sep { margin: 0 6px; color: var(--c-brd2); }
    .pill-toggle, .pill-static { display: inline-flex; align-items: center; gap: 6px; height: 25px; padding: 0 10px; border-radius: 999px; font: 500 .74rem var(--font-body); white-space: nowrap; }
    .pill-toggle { cursor: pointer; background: var(--c-bg); color: var(--c-ink3); border: 1px solid var(--c-brd); }
    .pill-toggle:hover { border-color: var(--c-ink); color: var(--c-ink); }
    .pill-toggle.pill-solid { background: #18181b; color: #fff; border-color: #18181b; }
    .pill-toggle.pill-solid:hover { background: #27272a; border-color: #27272a; }
    .pill-toggle.pill-solid .pill-dot { background: #fff; }
    .pill-static { background: var(--c-mut); color: var(--c-txt); }
    .cms-acoes-linha { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .btn-row { height: 28px; padding: 0 11px; border-radius: 5px; border: 1px solid var(--c-brd); background: var(--c-bg); color: var(--c-ink); font: 500 .78rem var(--font-body); cursor: pointer; }
    .btn-row:hover { background: var(--c-mut); border-color: var(--c-brd2); }
    .cms-vazio { text-align: center; padding: 48px 20px !important; }
    .vazio-tit { margin: 0; font-size: .88rem; font-weight: 500; color: var(--c-ink2); }
    .vazio-sub { margin: 6px 0 0; font-size: .8rem; color: var(--c-txt); }
    .skel { display: block; border-radius: 4px; background: #f4f4f5; height: 14px; }
    .sk-capa { width: 68px; height: 46px; }
    .sk-txt-l { width: 160px; margin-bottom: 6px; }
    .sk-txt-s { width: 105px; height: 11px; }
    .sk-txt { width: 76px; }
    .tr-auto { margin-left: auto; }
    .sk-chip { width: 72px; height: 24px; border-radius: 999px; margin: 0 auto; }
    .sk-acoes { width: 84px; height: 28px; margin-left: auto; }
    .settings-row { display: grid; grid-template-columns: 260px 1fr; gap: 28px; padding: 22px 0; border-bottom: 1px solid var(--c-brd); align-items: start; }
    .site-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 16px; border-bottom: 1px solid var(--c-brd); }
    .settings-row:last-child { border-bottom: none; }
    .settings-aside { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .settings-tit { font-size: .94rem !important; }
    .settings-desc, .field-help { margin: 0; font-size: .79rem; color: var(--c-txt); line-height: 1.5; }
    .settings-card { border: 1px solid var(--c-brd); border-radius: 8px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field-lbl { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: .78rem; font-weight: 500; color: var(--c-ink2); }
    .field-hint { font-size: .72rem; font-weight: 400; color: var(--c-txt); }
    .cms-input { width: 100%; border: 1px solid var(--c-brd); border-radius: 6px; background: var(--c-bg); color: var(--c-ink); font: .85rem var(--font-body); padding: 8px 11px; }
    input.cms-input, select.cms-input { height: 36px; padding: 0 11px; }
    textarea.cms-input { resize: vertical; line-height: 1.45; }
    .cms-input:hover:not(:focus) { border-color: var(--c-brd2); }
    .empty-inline { font-size: .82rem; color: var(--c-txt); padding: 8px 0; }
    .faq-list, .como-list { display: flex; flex-direction: column; gap: 10px; }
    .faq-item { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--c-brd); border-radius: 6px; background: var(--c-sub); }
    .faq-item-head { display: flex; align-items: center; justify-content: space-between; }
    .faq-num { font-size: .74rem; font-weight: 600; color: var(--c-ink3); }
    .wg-card-grid { display: flex; flex-direction: row; gap: 20px; align-items: center; flex-wrap: wrap; }
    .wg-qr { width: 132px; height: 132px; border: 1px solid var(--c-brd); border-radius: 6px; padding: 6px; background: #fff; }
    .wg-url-box { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 10px; }
    .copy-row { display: flex; gap: 8px; }
    .wg-snippet { background: var(--c-sub); }
    .overlay { position: fixed; inset: 0; z-index: 100; background: rgba(9,9,11,.48); display: flex; align-items: flex-start; justify-content: center; padding: 2rem 1rem; backdrop-filter: blur(2px); }
    .modal-cms { width: 95vw; max-width: 840px; max-height: 90vh; background: var(--c-bg); border: 1px solid var(--c-brd); border-radius: 10px; box-shadow: 0 20px 50px rgba(0,0,0,.18); display: flex; flex-direction: column; }
    .modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 24px; border-bottom: 1px solid var(--c-brd); }
    .modal-tit { font-size: 1.05rem !important; }
    .modal-sub, .sec-sub { margin: 2px 0 0; font-size: .78rem; color: var(--c-txt); }
    .modal-body { padding: 20px 24px; overflow-y: auto; }
    .modal-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 24px; border-top: 1px solid var(--c-brd); background: var(--c-sub); border-radius: 0 0 10px 10px; }
    .sec-block { padding: 20px 0; border-top: 1px solid var(--c-brd); }
    .sec-block:first-child { padding-top: 0; border-top: none; }
    .sec-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .sec-between { justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
    .sec-header-left { display: flex; align-items: flex-start; gap: 10px; }
    .sec-step { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 5px; border: 1px solid var(--c-brd); background: var(--c-sub); color: var(--c-ink3); font-size: .72rem; font-weight: 600; flex-shrink: 0; }
    .sec-title { margin: 0; font-size: .88rem; font-weight: 600; line-height: 24px; }
    .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 14px; }
    .f-span2 { grid-column: span 2; }
    .f-full { grid-column: 1 / -1; }
    .check-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-brd); border-radius: 6px; background: var(--c-sub); cursor: pointer; }
    .check-row input, .como-check input { accent-color: #18181b; margin-top: 2px; }
    .check-row span { display: flex; flex-direction: column; gap: 2px; font-size: .82rem; }
    .check-row small { font-size: .76rem; color: var(--c-txt); }
    .presets-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .preset-chip { height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--c-brd); background: var(--c-bg); color: var(--c-ink3); font: 500 .76rem var(--font-body); cursor: pointer; }
    .preset-chip:hover { border-color: var(--c-ink); color: var(--c-ink); }
    .preset-chip.ativo { background: #18181b; border-color: #18181b; color: #fff; }
    .como-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .como-nome { flex: 1; min-width: 180px; }
    .ic-sel { width: 220px; flex-shrink: 0; }
    .como-check { display: inline-flex; align-items: center; gap: 6px; font-size: .78rem; color: var(--c-ink3); cursor: pointer; white-space: nowrap; }
    .upload-lbl { cursor: pointer; }
    .loading-bar { display: flex; align-items: center; gap: 10px; padding: 12px; margin-bottom: 12px; border: 1px solid var(--c-brd); border-radius: 6px; background: var(--c-sub); color: var(--c-ink3); font-size: .82rem; }
    .midia-empty { padding: 24px 16px; border: 1px dashed var(--c-brd2); border-radius: 6px; background: var(--c-sub); text-align: center; color: var(--c-txt); font-size: .8rem; }
    .midia-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 10px; }
    .midia-card { position: relative; border: 1px solid var(--c-brd); border-radius: 6px; padding: 5px; }
    .midia-card.capa { border-color: var(--c-ink); box-shadow: inset 0 0 0 1px var(--c-ink); }
    .midia-card img, .midia-card video { width: 100%; height: 96px; object-fit: cover; border-radius: 4px; display: block; background: var(--c-mut); cursor: zoom-in; }
    .media-badge { position: absolute; top: 10px; background: rgba(9,9,11,.82); color: #fff; font-size: .66rem; font-weight: 600; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; }
    .media-badge.left { left: 10px; }
    .media-badge.right { right: 10px; }
    .midia-ops { display: flex; gap: 4px; margin-top: 5px; }
    .midia-ops button { flex: 1; height: 26px; border: 1px solid var(--c-brd); border-radius: 4px; background: var(--c-sub); color: var(--c-ink3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
    .midia-ops button:hover { background: var(--c-mut); color: var(--c-ink); }
    .lightbox { position: fixed; inset: 0; z-index: 300; background: rgba(9,9,11,.92); display: flex; align-items: center; justify-content: center; outline: none; }
    .lb-midia { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: min(1100px, 92vw); }
    .lb-midia img, .lb-midia video { max-width: 100%; max-height: 80vh; object-fit: contain; border-radius: 6px; }
    .lb-midia figcaption { color: #d4d4d8; font-size: .8rem; font-variant-numeric: tabular-nums; }
    .lb-btn { position: fixed; z-index: 301; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.2); background: rgba(24,24,27,.85); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .lb-btn:hover, .lb-btn:focus-visible { background: #fff; color: #09090b; outline: none; }
    .lb-close { top: 18px; right: 20px; }
    .lb-nav { top: 50%; transform: translateY(-50%); }
    .lb-nav.prev { left: 16px; }
    .lb-nav.next { right: 16px; }
    @media (max-width: 860px) { .cms-shell { padding: 16px; } .cms-resumo { grid-template-columns: repeat(2, 1fr); } .cms-est:nth-child(odd) { border-left: none; } .cms-est:nth-child(n+3) { border-top: 1px solid var(--c-brd); } .settings-row, .form-grid { grid-template-columns: 1fr; gap: 14px; } .f-span2 { grid-column: span 1; } }
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

  protected readonly aba = signal<AbaCms>('quartos');
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
    nome: ['', Validators.required],
    numero: [101, [Validators.required, Validators.min(1)]],
    idtipo_acomodacao: [null as number | null],
    capacidade: [2, [Validators.required, Validators.min(1)]],
    valor: [0],
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
  protected readonly siteUrl = computed(() => {
    const u = this.widget()?.url;
    return u ? u.replace(/\/reservar\/?$/, '') : '';
  });
  protected readonly qrSrc = computed(() => {
    const svg = this.widget()?.qr_svg;
    return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : '';
  });

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
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
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
        cor: this.editando()?.cor ?? '#18181b',
        version: acomId ? this.pmsVersion : undefined,
      };

      if (!acomId) {
        const criada = await firstValueFrom(this.api.criarAcomodacao(acomInput));
        acomId = criada.id;
        this.pmsVersion = criada.version;
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
        this.notify.ok('Quarto gravado e publicado no site em tempo real.');
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
        this.notify.ok(publicar ? 'Quarto publicado no site.' : 'Quarto movido para rascunho.');
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

  async upload(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const files = inputEl.files ? Array.from(inputEl.files) : [];
    if (files.length === 0) return;

    let acomId = this.editando()?.id;

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
            cor: '#18181b',
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
      `Excluir o quarto ${a.nome} (Nº${a.numero})? Todo o conteúdo do site e as mídias armazenadas serão apagados.`,
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

  async removerMidia(m: M.Midia): Promise<void> {
    const ok = await this.confirm.perguntar(
      'Remover esta mídia da galeria e do armazenamento?',
      { titulo: 'Remover mídia', confirmar: 'Remover' },
    );
    if (!ok) return;
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

  iniciarTour(): void {
    this.aba.set('quartos');
    this.tour.iniciar([
      {
        popover: {
          title: 'Conteúdo do site',
          description:
            'Gerencie as <b>acomodações</b>, a <b>página inicial / SEO</b> e a <b>integração do motor</b> em abas separadas.',
        },
      },
      {
        element: '.rt-pill',
        popover: {
          title: 'Sincronização em tempo real',
          description:
            'Quando ativa, cada alteração publicada chega ao site imediatamente.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-resumo',
        popover: {
          title: 'Resumo da operação',
          description:
            'Acompanhe o total de acomodações, quantas estão publicadas, em rascunho ou sem fotos.',
          side: 'bottom',
        },
      },
      {
        element: '.cms-busca',
        popover: {
          title: 'Busca e filtros',
          description:
            'Filtre por nome, número ou slug e alterne entre todos, publicados e rascunhos.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de acomodações',
          description:
            'Alterne o status do sistema e da publicação direto na linha ou abra o editor completo.',
          side: 'top',
        },
      },
      {
        element: '#tour-novo',
        popover: {
          title: 'Editor unificado',
          description:
            'Cadastre dados e tarifa, textos editoriais, comodidades e galeria de fotos e vídeos.',
          side: 'bottom',
        },
      },
    ]);
  }
}
