// Impressão da FNRH — Ficha Nacional de Registro de Hóspedes.
// Renderiza o snapshot imutável `Fnrh.dados` em um iframe oculto
// (não depende de window.open, que pode ser bloqueado).
//
// Separação: fnrh-print.view-model.ts monta os dados escapados,
// fnrh-print.template.ts renderiza o documento, este arquivo só
// cuida da mecânica de impressão.

import { Fnrh } from '@core/models/reservas.models';
import { montarFnrhView } from './fnrh-print.view-model';
import { fnrhHtml } from './fnrh-print.template';

/** Abre a ficha em iframe oculto e dispara a impressão do navegador. */
export function imprimirFnrh(f: Fnrh): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }
  const doc = win.document;
  doc.open();
  doc.write(fnrhHtml(montarFnrhView(f)));
  doc.close();
  // Espera o layout assentar antes de imprimir; remove o iframe depois.
  win.addEventListener('afterprint', () => iframe.remove());
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 60_000);
  }, 50);
}
