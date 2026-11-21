import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { NewsletterService } from '../../core/services/newsletter.service';
import { SeoService } from '../../core/services/seo.service';
import { WhatsappFloatComponent } from '../../shared/components/whatsapp-float/whatsapp-float.component';

/** Página "Em breve" — teaser standalone (sem header/footer) com captura de e-mail. */
@Component({
  selector: 'app-coming-soon',
  imports: [ReactiveFormsModule, WhatsappFloatComponent],
  template: `
    <main class="palco">
      <img
        src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2400&q=90"
        alt=""
        aria-hidden="true"
        class="fundo"
      />
      <div class="overlay" aria-hidden="true"></div>

      <section class="conteudo">
        <img src="/logo.svg" alt="Pousada Espírito do Mar" class="marca" />

        <h1>Em breve, uma nova experiência à beira-mar.</h1>

        <p class="sub">
          Estamos preparando algo especial para os nossos hóspedes.
          Deixe seu <span class="nb">e-mail</span> e seja avisado quando estiver no ar.
        </p>

        @if (!inscrito()) {
          <form class="captura" novalidate (submit)="enviar($event)">
            <label class="sr-only" for="nl-email">Seu e-mail</label>
            <input
              id="nl-email"
              type="email"
              [formControl]="email"
              placeholder="seu@email.com"
              autocomplete="email"
            />
            <button type="submit" [disabled]="enviando()">
              {{ enviando() ? 'Enviando…' : 'Avise-me' }}
            </button>
          </form>
          <p class="msg" role="status" aria-live="polite">
            @if (erro()) {
              <span class="err">Não foi possível inscrever agora — tente novamente.</span>
            } @else if (email.invalid && (email.dirty || email.touched)) {
              <span class="err">Informe um e-mail válido.</span>
            }
          </p>
        } @else {
          <p class="msg ok" role="status">Inscrição confirmada — avisamos você por e-mail.</p>
        }

      </section>
      <app-whatsapp-float></app-whatsapp-float>
    </main>
  `,
  styles: `
    .palco {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      background: #032b38;
      padding: 3rem 1.5rem;
    }
    .fundo {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      filter: brightness(0.78);
    }
    .overlay {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(rgba(3, 43, 56, 0.45), rgba(3, 43, 56, 0.45)),
        linear-gradient(to top, rgba(3, 43, 56, 0.95), rgba(3, 43, 56, 0.35) 55%, transparent);
      pointer-events: none;
    }
    .conteudo {
      position: relative;
      z-index: 1;
      width: min(34rem, 100%);
      text-align: center;
      animation: subir 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .marca {
      height: 9rem;
      width: auto;
      margin: 0 auto 2.25rem;
      filter: brightness(0) invert(1) drop-shadow(0 4px 18px rgba(0, 0, 0, 0.45));
    }
    h1 {
      font-family: var(--font-serif);
      font-weight: 400;
      font-size: clamp(2.1rem, 5.4vw, 3.4rem);
      line-height: 1.12;
      color: #f7f5f0;
      margin: 0 0 1.2rem;
      text-wrap: balance;
    }
    .sub {
      font-size: 1rem;
      line-height: 1.65;
      color: #a9c3cb;
      max-width: 27rem;
      margin: 0 auto 2.4rem;
      text-wrap: balance;
    }
    .nb { white-space: nowrap; }
    .captura {
      display: flex;
      gap: 0.6rem;
      max-width: 26rem;
      margin: 0 auto;
    }
    .captura input {
      flex: 1;
      min-width: 0;
      padding: 0.8rem 1rem;
      border-radius: 8px;
      border: 1px solid rgba(238, 244, 246, 0.22);
      background: rgba(238, 244, 246, 0.06);
      color: #f7f5f0;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s, background 0.2s;
    }
    .captura input::placeholder { color: #7d97a1; }
    .captura input:focus {
      border-color: #4b95ab;
      background: rgba(238, 244, 246, 0.09);
    }
    .captura button {
      padding: 0.8rem 1.5rem;
      border: 0;
      border-radius: 8px;
      background: #dda554;
      color: #032b38;
      font-weight: 700;
      font-size: 0.92rem;
      cursor: pointer;
      transition: background 0.2s, transform 0.15s;
      white-space: nowrap;
    }
    .captura button:hover:not(:disabled) { background: #f2c06f; }
    .captura button:active:not(:disabled) { transform: scale(0.98); }
    .captura button:disabled { opacity: 0.65; cursor: default; }
    .msg {
      min-height: 1.4rem;
      margin: 0.8rem 0 0;
      font-size: 0.85rem;
    }
    .msg .err { color: #f2a9a0; }
    .msg.ok { color: #a8d5b0; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    @keyframes subir {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .conteudo { animation: none; }
    }
    @media (max-width: 480px) {
      .captura { flex-direction: column; }
      .captura button { padding: 0.85rem; }
    }
  `,
})
export class ComingSoonComponent {
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);
  private readonly newsletter = inject(NewsletterService);

  protected readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
  protected readonly enviando = signal(false);
  protected readonly inscrito = signal(false);
  protected readonly erro = signal(false);

  constructor() {
    this.seo.updateSeo({
      title: 'Em breve',
      description: `Estamos preparando uma nova experiência em ${HOTEL_CONFIG.name}. Deixe seu e-mail e seja avisado.`,
    });
    // Teaser não deve ser indexado enquanto estiver no ar.
    this.meta.addTag({ name: 'robots', content: 'noindex' });
  }

  protected async enviar(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (this.email.invalid) {
      this.email.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.erro.set(false);
    const ok = await this.newsletter.inscrever(this.email.value.trim(), 'em-breve');
    this.enviando.set(false);
    ok ? this.inscrito.set(true) : this.erro.set(true);
  }
}
