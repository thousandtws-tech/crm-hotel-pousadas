import { Component, inject, effect } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { SiteContentService } from '../../../../core/services/site-content.service';

/**
 * FAQ editável pelo CMS (`cms_site` → seção `faq`). Só renderiza quando
 * há perguntas publicadas — e emite schema FAQPage para os buscadores.
 */
@Component({
  selector: 'app-faq',
  template: `
    @if (site.faq().length) {
      <section class="section-editorial" aria-labelledby="faq-titulo">
        <div class="container-editorial max-w-4xl">
          <span class="type-eyebrow block mb-3">Dúvidas frequentes</span>
          <h2 id="faq-titulo" class="type-section mb-8">Perguntas e respostas</h2>
          <div class="flex flex-col gap-4">
            @for (f of site.faq(); track $index) {
              <details class="faq-card group">
                <summary class="faq-q">
                  {{ f.pergunta }}
                  <span class="faq-ico" aria-hidden="true">+</span>
                </summary>
                <p class="faq-a">{{ f.resposta }}</p>
              </details>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: `
    .faq-card {
      border: 1px solid rgba(5, 64, 84, 0.12);
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
    }
    .faq-q {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 16px 20px; cursor: pointer; list-style: none;
      font-weight: 600; color: #054054; font-size: 0.95rem;
    }
    .faq-q::-webkit-details-marker { display: none; }
    .faq-ico { font-size: 1.2rem; color: #1a6f8a; transition: transform .2s; }
    .faq-card[open] .faq-ico { transform: rotate(45deg); }
    .faq-a {
      margin: 0; padding: 0 20px 16px;
      color: #5d6d7e; font-size: 0.9rem; line-height: 1.6;
    }
  `,
})
export class FaqComponent {
  protected readonly site = inject(SiteContentService);
  private readonly document = inject(DOCUMENT);
  private schemaEmitido = false;

  constructor() {
    // O fetch do CMS é assíncrono — emite o schema só quando as perguntas chegam.
    effect(() => {
      const itens = this.site.faq();
      if (!itens.length || this.schemaEmitido) return;
      this.schemaEmitido = true;
      this.emitirSchema(itens);
    });
  }

  private emitirSchema(itens: { pergunta: string; resposta: string }[]): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: itens.map((f) => ({
        '@type': 'Question',
        name: f.pergunta,
        acceptedAnswer: { '@type': 'Answer', text: f.resposta },
      })),
    };
    const script = this.document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    this.document.head.appendChild(script);
  }
}
