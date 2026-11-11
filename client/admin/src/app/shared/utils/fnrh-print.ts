// Impressão da FNRH — Ficha Nacional de Registro de Hóspedes.
// Renderiza o snapshot imutável `Fnrh.dados` em um iframe oculto
// (não depende de window.open, que pode ser bloqueado).

import { TIPOS_DOCUMENTO, TipoDocumento } from '@core/models/clientes.models';
import { Fnrh } from '@core/models/reservas.models';

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const dataBr = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

const dataHoraBr = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const tipoDoc = (t: string | null | undefined): string =>
  t ? (TIPOS_DOCUMENTO[t as TipoDocumento] ?? t) : '—';

function html(f: Fnrh): string {
  const h = f.dados.hospede;
  const r = f.dados.reserva;
  const endereco = [h.logradouro, h.numero, h.complemento]
    .filter(Boolean)
    .join(', ');
  const acompanhantes = f.dados.acompanhantes
    .map(
      (a) => `<tr>
        <td>${esc(a.nome)}</td>
        <td>${dataBr(a.data_nascimento)}</td>
        <td>${esc(a.parentesco)}</td>
        <td>${esc(a.doc_tipo ? tipoDoc(a.doc_tipo) : '')} ${esc(a.doc_numero)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>FNRH — Reserva ${r.id} — ${esc(h.nome)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; letter-spacing: .04em; }
  .sub { text-align: center; font-size: 10px; color: #444; margin-bottom: 12px; }
  fieldset { border: 1px solid #999; border-radius: 3px; padding: 8px 10px 10px; margin: 0 0 10px; }
  legend { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 0 6px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 12px; }
  .g2 { grid-column: span 2; } .g3 { grid-column: span 3; } .g4 { grid-column: span 4; }
  .f label { display: block; font-size: 8.5px; text-transform: uppercase; color: #555; letter-spacing: .03em; }
  .f span { display: block; border-bottom: 1px solid #bbb; min-height: 15px; padding: 1px 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
  th { background: #eee; text-transform: uppercase; font-size: 8.5px; letter-spacing: .03em; }
  .assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 48px; }
  .assinatura { text-align: center; }
  .assinatura .linha { border-top: 1px solid #333; padding-top: 4px; font-size: 9.5px; }
  .rodape { margin-top: 14px; font-size: 8.5px; color: #555; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <h1>FICHA NACIONAL DE REGISTRO DE HÓSPEDES — FNRH</h1>
  <p class="sub">Ficha nº ${f.id} · Reserva nº ${r.id} · Emitida em ${dataHoraBr(f.emitida_em)}</p>

  <fieldset>
    <legend>Hóspede responsável</legend>
    <div class="grid">
      <div class="f g3"><label>Nome completo</label><span>${esc(h.nome)}</span></div>
      <div class="f"><label>Data de nascimento</label><span>${dataBr(h.data_nascimento)}</span></div>
      <div class="f"><label>CPF</label><span>${esc(h.cpf)}</span></div>
      <div class="f"><label>Nacionalidade</label><span>${esc(h.nacionalidade)}</span></div>
      <div class="f"><label>Naturalidade</label><span>${esc(h.naturalidade)}</span></div>
      <div class="f"><label>Profissão</label><span>${esc(h.profissao)}</span></div>
      <div class="f g2"><label>E-mail</label><span>${esc(h.email)}</span></div>
      <div class="f g2"><label>Telefone</label><span>${esc(h.telefone)}</span></div>
      <div class="f g3"><label>Endereço</label><span>${esc(endereco)}</span></div>
      <div class="f"><label>Bairro</label><span>${esc(h.bairro)}</span></div>
      <div class="f g2"><label>Cidade</label><span>${esc(h.cidade)}</span></div>
      <div class="f"><label>UF</label><span>${esc(h.estado)}</span></div>
      <div class="f"><label>CEP</label><span>${esc(h.cep)}</span></div>
      <div class="f"><label>País</label><span>${esc(h.pais)}</span></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Estadia</legend>
    <div class="grid">
      <div class="f g2"><label>Acomodação</label><span>${esc(r.acomodacao)} nº ${r.acomodacao_numero}${r.quarto ? ' — ' + esc(r.quarto) : ''}</span></div>
      <div class="f"><label>Entrada prevista</label><span>${dataBr(r.entradaprevista)}</span></div>
      <div class="f"><label>Saída prevista</label><span>${dataBr(r.saidaprevista)}</span></div>
      <div class="f"><label>Check-in</label><span>${dataHoraBr(r.checkin_em)}</span></div>
      <div class="f"><label>Hóspedes</label><span>${r.quantidade_hospedes}</span></div>
      <div class="f"><label>Motivo da viagem</label><span>${esc(f.motivo_viagem)}</span></div>
      <div class="f"><label>Placa do veículo</label><span>${esc(f.placa_veiculo)}</span></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Acompanhantes</legend>
    <table>
      <thead><tr><th>Nome</th><th>Nascimento</th><th>Parentesco</th><th>Documento</th></tr></thead>
      <tbody>${acompanhantes || '<tr><td colspan="4" style="text-align:center;color:#777">Sem acompanhantes</td></tr>'}</tbody>
    </table>
  </fieldset>

  <div class="assinaturas">
    <div class="assinatura"><div class="linha">Assinatura do hóspede</div></div>
    <div class="assinatura"><div class="linha">${esc(f.dados.emitida_por)} — Recepção</div></div>
  </div>

  <div class="rodape">
    <span>Documento gerado eletronicamente — registro nº ${f.id}</span>
    <span>Reserva ${r.id} · ${esc(h.nome)}</span>
  </div>
</body>
</html>`;
}

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
  doc.write(html(f));
  doc.close();
  // Espera o layout assentar antes de imprimir; remove o iframe depois.
  win.addEventListener('afterprint', () => iframe.remove());
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 60_000);
  }, 50);
}
