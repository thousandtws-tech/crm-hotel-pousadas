// View-model da FNRH — transforma o snapshot `Fnrh.dados` em strings
// prontas (formatadas e escapadas) para o template de impressão.

import { TIPOS_DOCUMENTO, TipoDocumento } from '@core/models/clientes.models';
import { Fnrh } from '@core/models/reservas.models';

export interface FnrhView {
  ficha: string;
  reserva: string;
  tituloAba: string;
  emitidaEm: string;
  emitidaPor: string;
  hospedeNome: string;
  hospede: {
    nascimento: string;
    cpf: string;
    nacionalidade: string;
    naturalidade: string;
    profissao: string;
    email: string;
    telefone: string;
    endereco: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
    pais: string;
  };
  estadia: {
    acomodacao: string;
    entradaPrevista: string;
    saidaPrevista: string;
    checkin: string;
    hospedes: string;
    motivo: string;
    placa: string;
  };
  acompanhantes: { nome: string; nascimento: string; parentesco: string; documento: string }[];
}

export const esc = (v: string | number | null | undefined): string =>
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

/** Monta o view-model já escapado/formatado — o template só interpola. */
export function montarFnrhView(f: Fnrh): FnrhView {
  const h = f.dados.hospede;
  const r = f.dados.reserva;
  const endereco = [h.logradouro, h.numero, h.complemento].filter(Boolean).join(', ');
  const acomodacao =
    `${esc(r.acomodacao)} nº ${r.acomodacao_numero}` + (r.quarto ? ` — ${esc(r.quarto)}` : '');

  return {
    ficha: String(f.id),
    reserva: String(r.id),
    tituloAba: `FNRH — Reserva ${r.id} — ${esc(h.nome)}`,
    emitidaEm: dataHoraBr(f.emitida_em),
    emitidaPor: esc(f.dados.emitida_por),
    hospedeNome: esc(h.nome),
    hospede: {
      nascimento: dataBr(h.data_nascimento),
      cpf: esc(h.cpf),
      nacionalidade: esc(h.nacionalidade),
      naturalidade: esc(h.naturalidade),
      profissao: esc(h.profissao),
      email: esc(h.email),
      telefone: esc(h.telefone),
      endereco: esc(endereco),
      bairro: esc(h.bairro),
      cidade: esc(h.cidade),
      uf: esc(h.estado),
      cep: esc(h.cep),
      pais: esc(h.pais),
    },
    estadia: {
      acomodacao,
      entradaPrevista: dataBr(r.entradaprevista),
      saidaPrevista: dataBr(r.saidaprevista),
      checkin: dataHoraBr(r.checkin_em),
      hospedes: String(r.quantidade_hospedes),
      motivo: esc(f.motivo_viagem),
      placa: esc(f.placa_veiculo),
    },
    acompanhantes: f.dados.acompanhantes.map((a) => ({
      nome: esc(a.nome),
      nascimento: dataBr(a.data_nascimento),
      parentesco: esc(a.parentesco),
      documento: `${a.doc_tipo ? esc(tipoDoc(a.doc_tipo)) : ''} ${esc(a.doc_numero)}`.trim(),
    })),
  };
}
