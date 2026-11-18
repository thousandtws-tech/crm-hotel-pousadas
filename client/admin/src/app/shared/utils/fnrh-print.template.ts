// Interpolação do documento FNRH — markup em fnrh-print.template.html,
// estilos em fnrh-print.template.css, linha de acompanhante em
// fnrh-acompanhante.html. Recebe o view-model já escapado e só
// substitui os placeholders {{TOKEN}}; não contém lógica de dados.

import { FnrhView } from './fnrh-print.view-model';
import HTML from './fnrh-print.template.html';
import CSS from './fnrh-print.template.css?raw';
import ACOMPANHANTE from './fnrh-acompanhante.html';

const VAZIO =
  '<tr><td colspan="4" style="text-align:center;color:#777">Sem acompanhantes</td></tr>';

const preencher = (doc: string, tokens: Record<string, string>): string =>
  Object.entries(tokens).reduce(
    (acc, [k, v]) => acc.replaceAll(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v),
    doc,
  );

/** Renderiza o documento HTML completo da ficha. */
export function fnrhHtml(v: FnrhView): string {
  const h = v.hospede;
  const e = v.estadia;
  const linhas = v.acompanhantes
    .map((a) =>
      preencher(ACOMPANHANTE, {
        NOME: a.nome,
        NASCIMENTO: a.nascimento,
        PARENTESCO: a.parentesco,
        DOCUMENTO: a.documento,
      }),
    )
    .join('');

  return preencher(HTML, {
    CSS,
    TITULO_ABA: v.tituloAba,
    FICHA: v.ficha,
    RESERVA: v.reserva,
    EMITIDA_EM: v.emitidaEm,
    EMITIDA_POR: v.emitidaPor,
    HOSPEDE_NOME: v.hospedeNome,
    NASCIMENTO: h.nascimento,
    CPF: h.cpf,
    NACIONALIDADE: h.nacionalidade,
    NATURALIDADE: h.naturalidade,
    PROFISSAO: h.profissao,
    EMAIL: h.email,
    TELEFONE: h.telefone,
    ENDERECO: h.endereco,
    BAIRRO: h.bairro,
    CIDADE: h.cidade,
    UF: h.uf,
    CEP: h.cep,
    PAIS: h.pais,
    ACOMODACAO: e.acomodacao,
    ENTRADA_PREVISTA: e.entradaPrevista,
    SAIDA_PREVISTA: e.saidaPrevista,
    CHECKIN: e.checkin,
    HOSPEDES: e.hospedes,
    MOTIVO: e.motivo,
    PLACA: e.placa,
    ACOMPANHANTES: linhas || VAZIO,
  });
}
