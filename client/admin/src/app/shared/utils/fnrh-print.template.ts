// Template do documento FNRH — markup + estilos de impressão.
// Recebe o view-model já escapado; não contém lógica de dados.

import { FnrhView } from './fnrh-print.view-model';

const CSS = `
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
`;

const VAZIO =
  '<tr><td colspan="4" style="text-align:center;color:#777">Sem acompanhantes</td></tr>';

/** Renderiza o documento HTML completo da ficha. */
export function fnrhHtml(v: FnrhView): string {
  const h = v.hospede;
  const e = v.estadia;
  const linhas = v.acompanhantes
    .map(
      (a) => `<tr>
        <td>${a.nome}</td>
        <td>${a.nascimento}</td>
        <td>${a.parentesco}</td>
        <td>${a.documento}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${v.tituloAba}</title>
<style>${CSS}</style>
</head>
<body>
  <h1>FICHA NACIONAL DE REGISTRO DE HÓSPEDES — FNRH</h1>
  <p class="sub">Ficha nº ${v.ficha} · Reserva nº ${v.reserva} · Emitida em ${v.emitidaEm}</p>

  <fieldset>
    <legend>Hóspede responsável</legend>
    <div class="grid">
      <div class="f g3"><label>Nome completo</label><span>${v.hospedeNome}</span></div>
      <div class="f"><label>Data de nascimento</label><span>${h.nascimento}</span></div>
      <div class="f"><label>CPF</label><span>${h.cpf}</span></div>
      <div class="f"><label>Nacionalidade</label><span>${h.nacionalidade}</span></div>
      <div class="f"><label>Naturalidade</label><span>${h.naturalidade}</span></div>
      <div class="f"><label>Profissão</label><span>${h.profissao}</span></div>
      <div class="f g2"><label>E-mail</label><span>${h.email}</span></div>
      <div class="f g2"><label>Telefone</label><span>${h.telefone}</span></div>
      <div class="f g3"><label>Endereço</label><span>${h.endereco}</span></div>
      <div class="f"><label>Bairro</label><span>${h.bairro}</span></div>
      <div class="f g2"><label>Cidade</label><span>${h.cidade}</span></div>
      <div class="f"><label>UF</label><span>${h.uf}</span></div>
      <div class="f"><label>CEP</label><span>${h.cep}</span></div>
      <div class="f"><label>País</label><span>${h.pais}</span></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Estadia</legend>
    <div class="grid">
      <div class="f g2"><label>Acomodação</label><span>${e.acomodacao}</span></div>
      <div class="f"><label>Entrada prevista</label><span>${e.entradaPrevista}</span></div>
      <div class="f"><label>Saída prevista</label><span>${e.saidaPrevista}</span></div>
      <div class="f"><label>Check-in</label><span>${e.checkin}</span></div>
      <div class="f"><label>Hóspedes</label><span>${e.hospedes}</span></div>
      <div class="f"><label>Motivo da viagem</label><span>${e.motivo}</span></div>
      <div class="f"><label>Placa do veículo</label><span>${e.placa}</span></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Acompanhantes</legend>
    <table>
      <thead><tr><th>Nome</th><th>Nascimento</th><th>Parentesco</th><th>Documento</th></tr></thead>
      <tbody>${linhas || VAZIO}</tbody>
    </table>
  </fieldset>

  <div class="assinaturas">
    <div class="assinatura"><div class="linha">Assinatura do hóspede</div></div>
    <div class="assinatura"><div class="linha">${v.emitidaPor} — Recepção</div></div>
  </div>

  <div class="rodape">
    <span>Documento gerado eletronicamente — registro nº ${v.ficha}</span>
    <span>Reserva ${v.reserva} · ${v.hospedeNome}</span>
  </div>
</body>
</html>`;
}
