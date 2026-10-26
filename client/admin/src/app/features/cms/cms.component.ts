// CMS de quartos — conteúdo editorial, mídia e publicação do site público.
// Somente administradores: a rota e todos os endpoints exigem nível admin.

import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService, num } from '@core/services/api.service';
import { AuthStore } from '@core/services/auth.store';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import * as M from '@core/models/api.models';

interface ComodidadeForm {
  name: string;
  icon: string;
  highlight: boolean;
}

@Component({
  selector: 'app-cms',
  imports: [ReactiveFormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h3>Site — Quartos (CMS)</h3>
          <p class="hint">
            Conteúdo público do site das acomodações. Alterações publicadas
            entram no ar em tempo real. A diária vem da tela Acomodações.
          </p>
        </div>
      </div>

      @if (carregando()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      } @else {
        <table class="table plain">
          <thead>
            <tr>
              <th>Capa</th><th>Nº</th><th>Acomodação</th><th>Diária</th>
              <th>Slug</th><th>Mídia</th><th>Status</th><th class="t-r">Ações</th>
            </tr>
          </thead>
          <tbody>
            @for (a of items(); track a.id) {
              <tr>
                <td class="capa-cell">
                  @if (thumbs()[a.id]) {
                    <img [src]="thumbs()[a.id]" alt="" class="capa-thumb" />
                  }
                </td>
                <td>{{ a.numero }}</td>
                <td><strong>{{ a.nome }}</strong></td>
                <td class="t-r">{{ num(a.valor) }}</td>
                <td class="slug">{{ a.cms?.slug ?? '—' }}</td>
                <td>
                  {{ contar(a, 'foto') }} foto{{ contar(a, 'foto') === 1 ? '' : 's' }},
                  {{ contar(a, 'video') }} vídeo{{ contar(a, 'video') === 1 ? '' : 's' }}
                </td>
                <td>
                  @if (!a.cms) {
                    <span class="status-chip chip-vazio">Sem conteúdo</span>
                  } @else if (a.cms!.status === 'publicado') {
                    <button class="status-chip chip-pub badge-toggle" type="button"
                            title="Despublicar" (click)="togglePublicacao(a, false)">
                      Publicado
                    </button>
                  } @else {
                    <button class="status-chip chip-rasc badge-toggle" type="button"
                            title="Publicar" (click)="togglePublicacao(a, true)">
                      Rascunho
                    </button>
                  }
                </td>
                <td class="t-r">
                  <button class="btn-dark-blue" type="button" (click)="abrirEditor(a)">
                    Editar
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- ================= editor ================= -->
      @if (editando(); as a) {
        <div class="overlay" (click.self)="fecharEditor()">
          <div class="modal-inn modal-cms" role="dialog" aria-modal="true" aria-labelledby="tit-cms">
            <div class="modal-head">
              <h5 id="tit-cms">Conteúdo do site — {{ a.nome }}</h5>
              <button class="close" type="button" (click)="fecharEditor()">×</button>
            </div>
            <div class="modal-body">
              <form [formGroup]="form" (ngSubmit)="salvar()" class="form-grid">
                <label class="f-full">
                  Slug (URL do site — vazio deriva do nome)
                  <input formControlName="slug" placeholder="suite-mar" />
                </label>
                <label class="f-full">
                  Subtítulo <span class="req">*</span>
                  <input formControlName="subtitulo"
                         placeholder="A poucos passos da Praia do Peró" />
                </label>
                <label class="f-full">
                  Descrição curta (card do site)
                  <textarea formControlName="descricao_curta" rows="2"></textarea>
                </label>
                <label class="f-full">
                  Descrição longa (página de detalhe)
                  <textarea formControlName="descricao_longa" rows="4"></textarea>
                </label>
                <label class="f-full">
                  Frase de efeito (destaque editorial)
                  <input formControlName="destaque_editorial"
                         placeholder="O mar te espera" />
                </label>
                <label>
                  Camas
                  <input formControlName="camas" placeholder="1 casal + 1 solteiro" />
                </label>
                <label>
                  Banheiros
                  <input type="number" formControlName="banheiros" min="0" />
                </label>
                <label>
                  Área (m²)
                  <input type="number" formControlName="metragem" min="0" step="0.5" />
                </label>
                <label>
                  Vista
                  <input formControlName="vista" placeholder="Mar / jardim" />
                </label>
                <label>
                  Andar
                  <input formControlName="andar" placeholder="Térreo / superior" />
                </label>
                <label>
                  Ordem no site
                  <input type="number" formControlName="ordem" />
                </label>
                <label class="check f-full">
                  <input type="checkbox" formControlName="destaque" />
                  Destacar no site (featured)
                </label>
              </form>

              <!-- comodidades -->
              <div class="bloco">
                <div class="bloco-head">
                  <strong>Comodidades</strong>
                  <button class="btn-gray" type="button" (click)="addComodidade()">
                    <mat-icon>add</mat-icon> Adicionar
                  </button>
                </div>
                @for (c of comodidades(); track c; let i = $index) {
                  <div class="como-row">
                    <input [value]="c.name" (input)="c.name = $any($event.target).value" placeholder="Wi-Fi" />
                    <input [value]="c.icon" (input)="c.icon = $any($event.target).value" placeholder="wifi" class="ic" />
                    <label class="check"><input type="checkbox"
                      [checked]="c.highlight"
                      (change)="c.highlight = $any($event.target).checked" /> destaque</label>
                    <button class="btn-icon" type="button" (click)="delComodidade(i)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                }
              </div>

              <!-- mídia -->
              <div class="bloco">
                <div class="bloco-head">
                  <strong>Fotos e vídeos</strong>
                  <label class="btn-dark-blue upload-btn">
                    <mat-icon>upload</mat-icon> Enviar
                    <input type="file" hidden accept="image/*,video/mp4,video/webm"
                           (change)="upload($event)" />
                  </label>
                </div>
                @if (enviando()) {
                  <div class="loading"><mat-spinner diameter="24" /> Enviando…</div>
                }
                <div class="midia-grid">
                  @for (m of editandoMidias(); track m.id; let i = $index) {
                    <div class="midia-card" [class.capa]="m.capa">
                      @if (m.tipo === 'foto') {
                        <img [src]="midiaUrl(m.id)" alt="" />
                      } @else {
                        <video [src]="midiaUrl(m.id)" muted></video>
                      }
                      @if (m.capa) { <span class="capa-tag">Capa</span> }
                      <div class="midia-ops">
                        <button type="button" title="Mover para cima" (click)="mover(i, -1)">
                          <mat-icon>arrow_upward</mat-icon>
                        </button>
                        <button type="button" title="Mover para baixo" (click)="mover(i, 1)">
                          <mat-icon>arrow_downward</mat-icon>
                        </button>
                        @if (m.tipo === 'foto' && !m.capa) {
                          <button type="button" title="Definir como capa" (click)="capa(m.id)">
                            <mat-icon>star</mat-icon>
                          </button>
                        }
                        <button type="button" class="del" title="Remover" (click)="removerMidia(m)">
                          <mat-icon>delete</mat-icon>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="button" [disabled]="salvando()"
                      (click)="salvar()">
                <mat-icon>save</mat-icon> Gravar
              </button>
              @if (a.cms?.status !== 'publicado') {
                <button class="btn-dark-blue" type="button" (click)="salvarEPublicar()">
                  <mat-icon>public</mat-icon> Gravar e publicar
                </button>
              }
              <button class="btn-gray" type="button" (click)="fecharEditor()">Fechar</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .page-head h3 { margin: 0; }
    .hint { color: #6c757d; font-size: 12px; margin: 4px 0 0; }
    .loading { display: flex; align-items: center; gap: 10px; padding: 30px; justify-content: center; color: #6c757d; }
    .capa-cell { width: 72px; }
    .capa-thumb { width: 64px; height: 42px; object-fit: cover; border-radius: 4px; display: block; }
    .slug { color: #1a6f8a; font-family: monospace; font-size: 12px; }
    .chip-pub { background: #198754; color: #fff; }
    .chip-rasc { background: #dda554; color: #054054; }
    .chip-vazio { background: #e9ecef; color: #6c757d; }
    .modal-cms { max-width: 720px; width: 92vw; }
    .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 14px; }
    .f-full { grid-column: 1 / -1; }
    label { font-size: 12px; color: #444; display: flex; flex-direction: column; gap: 3px; }
    label.check { flex-direction: row; align-items: center; gap: 8px; }
    .req { color: #b00; }
    input, textarea { border: 1px solid #d2d6de; border-radius: 4px; padding: 6px 8px; font: inherit; }
    input:focus, textarea:focus { border-color: #4b95ab; outline: none; }
    .bloco { margin-top: 18px; border-top: 1px solid #e9ecef; padding-top: 12px; }
    .bloco-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .como-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .como-row input { flex: 1; }
    .como-row input.ic { max-width: 110px; font-family: monospace; }
    .btn-icon { background: none; border: none; color: #b00; cursor: pointer; }
    .upload-btn { cursor: pointer; }
    .midia-grid { display: grid; grid-template-columns: repeat(auto-fill, 118px); gap: 10px; }
    .midia-card { position: relative; border: 2px solid transparent; border-radius: 6px; }
    .midia-card.capa { border-color: #dda554; }
    .midia-card img, .midia-card video { width: 100%; height: 78px; object-fit: cover; border-radius: 4px; display: block; background: #f2f6f8; }
    .capa-tag { position: absolute; top: 3px; left: 3px; background: #dda554; color: #054054; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; }
    .midia-ops { display: flex; justify-content: center; gap: 2px; margin-top: 3px; }
    .midia-ops button { background: none; border: none; cursor: pointer; color: #054054; padding: 2px; }
    .midia-ops button.del { color: #b00; }
    .midia-ops mat-icon { font-size: 17px; width: 17px; height: 17px; }
  `],
})
export class CmsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly rt = inject(Realtime);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<M.AcomodacaoCmsView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly editando = signal<M.AcomodacaoCmsView | null>(null);
  protected readonly editandoMidias = signal<M.Midia[]>([]);
  protected readonly thumbs = signal<Record<number, string>>({});
  protected readonly midiaBlobs = signal<Record<number, string>>({});
  protected readonly enviando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly comodidades = signal<ComodidadeForm[]>([]);
  protected readonly num = num;

  protected readonly form = this.fb.nonNullable.group({
    slug: [''],
    subtitulo: ['', Validators.required],
    descricao_curta: [''],
    descricao_longa: [''],
    destaque_editorial: [''],
    camas: [''],
    banheiros: [null as number | null],
    metragem: [null as number | null],
    vista: [''],
    andar: [''],
    ordem: [0],
    destaque: [false],
  });
  private version = 0;

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('acomodacao', 'acomodacao_cms', 'acomodacao_midia');
      if (ultimo < 0) { ultimo = v; return; }
      if (v !== ultimo && !this.editando()) { ultimo = v; this.carregar(); }
    });
  }

  ngOnInit(): void { this.carregar(); }

  carregar(): void {
    this.api.listarCms().subscribe({
      next: (it) => {
        this.items.set(it);
        this.carregando.set(false);
        this.carregarThumbs(it);
      },
      error: () => { this.carregando.set(false); this.notify.erroMsg('Falha ao carregar o CMS.'); },
    });
  }

  contar(a: M.AcomodacaoCmsView, tipo: string): number {
    return a.midias.filter((m) => m.tipo === tipo).length;
  }

  private carregarThumbs(it: M.AcomodacaoCmsView[]): void {
    for (const a of it) {
      const capa = a.midias.find((m) => m.capa && m.tipo === 'foto');
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

  abrirEditor(a: M.AcomodacaoCmsView): void {
    const c = a.cms;
    this.version = c?.version ?? 0;
    this.form.reset({
      slug: c?.slug ?? '',
      subtitulo: c?.subtitulo ?? '',
      descricao_curta: c?.descricao_curta ?? '',
      descricao_longa: c?.descricao_longa ?? '',
      destaque_editorial: c?.destaque_editorial ?? '',
      camas: c?.camas ?? '',
      banheiros: c?.banheiros ?? null,
      metragem: c?.metragem ? Number(c.metragem) : null,
      vista: c?.vista ?? '',
      andar: c?.andar ?? '',
      ordem: c?.ordem ?? 0,
      destaque: c?.destaque ?? false,
    });
    this.comodidades.set(
      (c?.comodidades ?? []).map((x) => ({ name: x.name, icon: x.icon, highlight: !!x.highlight })),
    );
    this.editandoMidias.set([...a.midias].sort((x, y) => x.ordem - y.ordem || x.id - y.id));
    // blobs das mídias para preview
    for (const m of a.midias) {
      if (!this.midiaBlobs()[m.id]) {
        this.api.midiaBlob(m.id).subscribe({
          next: (b) => this.midiaBlobs.update((t) => ({ ...t, [m.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      }
    }
    this.editando.set(a);
  }

  fecharEditor(): void { this.editando.set(null); }

  addComodidade(): void {
    this.comodidades.update((c) => [...c, { name: '', icon: '', highlight: false }]);
  }
  delComodidade(i: number): void {
    this.comodidades.update((c) => c.filter((_, x) => x !== i));
  }

  salvar(publicarDepois = false): void {
    const a = this.editando();
    if (!a) return;
    this.salvando.set(true);
    const v = this.form.getRawValue();
    const input: M.CmsInput = {
      slug: v.slug || null,
      subtitulo: v.subtitulo || null,
      descricao_curta: v.descricao_curta || null,
      descricao_longa: v.descricao_longa || null,
      destaque_editorial: v.destaque_editorial || null,
      camas: v.camas || null,
      banheiros: v.banheiros,
      metragem: v.metragem,
      vista: v.vista || null,
      andar: v.andar || null,
      comodidades: this.comodidades().filter((c) => c.name.trim() !== ''),
      destaque: v.destaque,
      ordem: v.ordem,
      version: this.version || undefined,
    };
    this.api.salvarCms(a.id, input).subscribe({
      next: (c) => {
        this.salvando.set(false);
        this.version = c.version;
        const terminar = () => { this.carregar(); if (!publicarDepois) this.fecharEditor(); };
        if (publicarDepois) {
          this.api.statusCms(a.id, true).subscribe({
            next: () => { this.notify.ok('Gravado e publicado.'); terminar(); this.fecharEditor(); },
            error: (e) => { this.notify.erro(e); terminar(); this.fecharEditor(); },
          });
        } else { this.notify.ok('Conteúdo gravado.'); terminar(); }
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e);
      },
    });
  }

  salvarEPublicar(): void { this.salvar(true); }

  togglePublicacao(a: M.AcomodacaoCmsView, publicar: boolean): void {
    this.api.statusCms(a.id, publicar).subscribe({
      next: () => { this.notify.ok(publicar ? 'Publicado no site.' : 'Voltou para rascunho.'); this.carregar(); },
      error: (e) => this.notify.erro(e),
    });
  }

  upload(ev: Event): void {
    const a = this.editando();
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!a || !file) return;
    this.enviando.set(true);
    this.api.uploadMidia(a.id, file).subscribe({
      next: (m) => {
        this.enviando.set(false);
        this.editandoMidias.update((l) => [...l, m]);
        this.api.midiaBlob(m.id).subscribe({
          next: (b) => this.midiaBlobs.update((t) => ({ ...t, [m.id]: URL.createObjectURL(b) })),
          error: () => {},
        });
      },
      error: (e) => { this.enviando.set(false); this.notify.erro(e); },
    });
  }

  removerMidia(m: M.Midia): void {
    if (!confirm('Remover esta mídia?')) return;
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
      next: () => this.editandoMidias.update((l) => l.map((x) => ({ ...x, capa: x.id === id }))),
      error: () => this.notify.erroMsg('Falha ao definir a capa.'),
    });
  }

  mover(i: number, dir: number): void {
    const a = this.editando();
    const l = [...this.editandoMidias()];
    const j = i + dir;
    if (!a || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    this.editandoMidias.set(l);
    this.api.ordenarMidias(a.id, l.map((m) => m.id)).subscribe({
      error: () => this.notify.erroMsg('Falha ao reordenar.'),
    });
  }
}
