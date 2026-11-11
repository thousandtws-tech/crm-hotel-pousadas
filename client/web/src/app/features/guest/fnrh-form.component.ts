import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { GuestService, PreFichaInfo } from '../../core/services/guest.service';
import { Meta } from '@angular/platform-browser';
import { SeoService } from '../../core/services/seo.service';

type Estado = 'carregando' | 'form' | 'enviando' | 'enviado' | 'erro';

/** Pré-ficha FNRH digital — link único por reserva, recebido pelo hóspede. */
@Component({
  selector: 'app-fnrh-form',
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  template: `
    <header class="pt-32 pb-12 bg-[#032B38] text-white">
      <div class="max-w-3xl mx-auto px-6">
        <p class="text-sm uppercase tracking-[0.2em] text-[#8FBECB] mb-2">Check-in online</p>
        <h1 class="text-3xl sm:text-4xl font-semibold">Ficha Nacional de Registro de Hóspedes</h1>
        @if (info(); as i) {
          <p class="mt-3 text-white/80">
            {{ i.cliente_nome }} · {{ i.acomodacao }} ·
            {{ i.entrada | date: 'dd/MM/yyyy' }} → {{ i.saida | date: 'dd/MM/yyyy' }}
          </p>
        }
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-10">
      @switch (estado()) {
        @case ('carregando') {
          <p class="text-center text-gray-500 py-16">Carregando sua reserva…</p>
        }
        @case ('erro') {
          <div class="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-red-800">Link inválido ou ficha já preenchida</h2>
            <p class="mt-2 text-red-700">
              Este link de check-in não está mais disponível. Se precisar de ajuda,
              fale com a recepção pelo WhatsApp.
            </p>
            <a routerLink="/" class="inline-block mt-6 text-[#032B38] underline">Voltar ao site</a>
          </div>
        }
        @case ('enviado') {
          <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-emerald-800">Ficha enviada com sucesso</h2>
            <p class="mt-2 text-emerald-700">
              Seu check-in online está pronto — no dia da chegada é só apresentar um
              documento com foto. Até breve!
            </p>
          </div>
        }
        @default {
          <form [formGroup]="form" (ngSubmit)="enviar()" class="space-y-8">
            <fieldset class="rounded-xl border border-gray-200 p-6">
              <legend class="px-2 text-lg font-semibold text-[#032B38]">Identificação</legend>
              <div class="grid sm:grid-cols-2 gap-4 mt-2">
                <label class="block sm:col-span-2">
                  <span class="text-sm font-medium">Nome completo *</span>
                  <input formControlName="nome" required autocomplete="name" class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Data de nascimento *</span>
                  <input type="date" formControlName="nascimento" required class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Nacionalidade *</span>
                  <input formControlName="nacionalidade" required class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Profissão</span>
                  <input formControlName="profissao" class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Telefone *</span>
                  <input type="tel" formControlName="telefone" required autocomplete="tel" class="mt-1 w-full" />
                </label>
              </div>
            </fieldset>

            <fieldset class="rounded-xl border border-gray-200 p-6">
              <legend class="px-2 text-lg font-semibold text-[#032B38]">Documentos</legend>
              <div class="grid sm:grid-cols-3 gap-4 mt-2">
                <label class="block">
                  <span class="text-sm font-medium">Tipo *</span>
                  <select formControlName="doc_tipo" required class="mt-1 w-full">
                    <option value="RG">RG</option>
                    <option value="CNH">CNH</option>
                    <option value="Passaporte">Passaporte</option>
                    <option value="RNE">RNE</option>
                  </select>
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Número *</span>
                  <input formControlName="doc_numero" required class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Órgão emissor</span>
                  <input formControlName="doc_orgao" class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">CPF *</span>
                  <input formControlName="cpf" required inputmode="numeric"
                    placeholder="000.000.000-00" class="mt-1 w-full" />
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-sm font-medium">E-mail *</span>
                  <input type="email" formControlName="email" required autocomplete="email" class="mt-1 w-full" />
                </label>
              </div>
            </fieldset>

            <fieldset class="rounded-xl border border-gray-200 p-6">
              <legend class="px-2 text-lg font-semibold text-[#032B38]">Endereço</legend>
              <div class="grid sm:grid-cols-3 gap-4 mt-2">
                <label class="block sm:col-span-2">
                  <span class="text-sm font-medium">Logradouro *</span>
                  <input formControlName="logradouro" required autocomplete="street-address" class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Número *</span>
                  <input formControlName="numero" required class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Complemento</span>
                  <input formControlName="complemento" class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Bairro *</span>
                  <input formControlName="bairro" required class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">CEP</span>
                  <input formControlName="cep" inputmode="numeric" placeholder="00000-000" class="mt-1 w-full" />
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-sm font-medium">Cidade *</span>
                  <input formControlName="cidade" required class="mt-1 w-full" />
                </label>
                <label class="block">
                  <span class="text-sm font-medium">UF *</span>
                  <input formControlName="uf" required maxlength="2" class="mt-1 w-full uppercase" />
                </label>
              </div>
            </fieldset>

            <fieldset class="rounded-xl border border-gray-200 p-6">
              <legend class="px-2 text-lg font-semibold text-[#032B38]">Viagem</legend>
              <div class="grid sm:grid-cols-2 gap-4 mt-2">
                <label class="block">
                  <span class="text-sm font-medium">Motivo da viagem</span>
                  <select formControlName="motivo" class="mt-1 w-full">
                    <option value="Lazer">Lazer</option>
                    <option value="Negócios">Negócios</option>
                    <option value="Evento">Evento</option>
                    <option value="Outro">Outro</option>
                  </select>
                </label>
                <label class="block">
                  <span class="text-sm font-medium">Meio de transporte</span>
                  <select formControlName="transporte" class="mt-1 w-full">
                    <option value="Carro próprio">Carro próprio</option>
                    <option value="Ônibus">Ônibus</option>
                    <option value="Avião">Avião</option>
                    <option value="Aplicativo">Aplicativo</option>
                    <option value="Outro">Outro</option>
                  </select>
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-sm font-medium">Acompanhantes (nomes e idades)</span>
                  <textarea formControlName="acompanhantes" rows="2" class="mt-1 w-full"></textarea>
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-sm font-medium">Observações para a recepção</span>
                  <textarea formControlName="observacoes" rows="2" class="mt-1 w-full"></textarea>
                </label>
              </div>
            </fieldset>

            @if (info()?.fnrh_assinatura) {
              <fieldset class="rounded-xl border border-gray-200 p-6">
                <legend class="px-2 text-lg font-semibold text-[#032B38]">Assinatura do hóspede</legend>
                <p class="text-sm text-gray-600 mt-1">Assine com o dedo ou mouse no quadro abaixo.</p>
                <canvas #sigCanvas width="600" height="160"
                  class="mt-2 w-full rounded-lg border border-gray-300 bg-white"
                  style="touch-action: none; cursor: crosshair"
                  (pointerdown)="sigDown($event)" (pointermove)="sigMove($event)"
                  (pointerup)="sigUp()" (pointerleave)="sigUp()"></canvas>
                <button type="button" (click)="limparAssinatura()"
                  class="mt-2 text-sm text-[#032B38] underline">Limpar assinatura</button>
              </fieldset>
            }

            @if (erroEnvio()) {
              <p class="text-red-700 text-sm" role="alert">{{ erroEnvio() }}</p>
            }
            <button type="submit" [disabled]="form.invalid || estado() === 'enviando'"
              class="w-full rounded-lg bg-[#032B38] px-6 py-4 text-white font-semibold disabled:opacity-50">
              {{ estado() === 'enviando' ? 'Enviando…' : 'Enviar ficha de hospedagem' }}
            </button>
            <p class="text-xs text-gray-500 text-center">
              Dados utilizados exclusivamente para o registro legal de hóspedes (FNRH).
            </p>
          </form>
        }
      }
    </main>
  `,
})
export class FnrhFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly guest = inject(GuestService);
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);
  private readonly fb = inject(FormBuilder);

  readonly estado = signal<Estado>('carregando');
  readonly info = signal<PreFichaInfo | null>(null);
  readonly erroEnvio = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    nascimento: ['', Validators.required],
    nacionalidade: ['Brasileira', Validators.required],
    profissao: [''],
    telefone: ['', Validators.required],
    doc_tipo: ['RG', Validators.required],
    doc_numero: ['', Validators.required],
    doc_orgao: [''],
    cpf: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    logradouro: ['', Validators.required],
    numero: ['', Validators.required],
    complemento: [''],
    bairro: ['', Validators.required],
    cep: [''],
    cidade: ['', Validators.required],
    uf: ['', [Validators.required, Validators.maxLength(2)]],
    motivo: ['Lazer'],
    transporte: ['Carro próprio'],
    acompanhantes: [''],
    observacoes: [''],
  });

  ngOnInit(): void {
    this.seo.updateSeo({ title: 'Check-in online', description: 'Ficha digital de hospedagem' });
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.guest.preFicha(token).subscribe({
      next: (i) => {
        this.info.set(i);
        this.estado.set('form');
      },
      error: () => this.estado.set('erro'),
    });
  }

  readonly assinatura = signal<string | null>(null);
  readonly sigCanvas = viewChild<ElementRef<HTMLCanvasElement>>('sigCanvas');
  private desenhando = false;

  sigDown(e: PointerEvent): void {
    const c = this.sigCanvas()?.nativeElement;
    if (!c) return;
    this.desenhando = true;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const p = this.sigPos(c, e);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
  }

  sigMove(e: PointerEvent): void {
    const c = this.sigCanvas()?.nativeElement;
    const ctx = c?.getContext('2d');
    if (!this.desenhando || !c || !ctx) return;
    const p = this.sigPos(c, e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#032B38';
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }

  sigUp(): void {
    if (!this.desenhando) return;
    this.desenhando = false;
    this.assinatura.set(this.sigCanvas()?.nativeElement.toDataURL('image/png') ?? null);
  }

  limparAssinatura(): void {
    const c = this.sigCanvas()?.nativeElement;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    this.assinatura.set(null);
  }

  private sigPos(c: HTMLCanvasElement, e: PointerEvent): [number, number] {
    const r = c.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (c.width / r.width),
      (e.clientY - r.top) * (c.height / r.height),
    ];
  }

  enviar(): void {
    if (this.form.invalid) return;
    if (this.info()?.fnrh_assinatura && !this.assinatura()) {
      this.erroEnvio.set('Assine a ficha no quadro antes de enviar.');
      return;
    }
    this.estado.set('enviando');
    this.erroEnvio.set(null);
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    const payload = { ...this.form.getRawValue(), assinatura: this.assinatura() };
    this.guest.gravarPreFicha(token, payload).subscribe({
      next: () => this.estado.set('enviado'),
      error: (e) => {
        this.estado.set('form');
        this.erroEnvio.set(
          e?.status === 409 || e?.status === 422
            ? 'Esta ficha já foi preenchida.'
            : 'Não foi possível enviar. Tente novamente em instantes.'
        );
      },
    });
  }
}
