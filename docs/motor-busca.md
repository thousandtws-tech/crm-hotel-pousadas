# Motor de busca — definições de produto

Endpoint: `POST /api/v1/publico/disponibilidade/busca` (leitura; nunca cria
reserva, hold ou pagamento).

O navegador envia a consulta serializada; **o servidor regera e revalida
todos os períodos candidatos** — a prévia do frontend (mesma lógica, em
`search-periods.ts`) existe só para feedback imediato e nunca é
autoridade.

## Aba Datas + tolerância

- Margens válidas: `0` (datas exatas), `±1`, `±2`, `±3`, `±7`, `±14` dias.
- A tolerância desloca **a viagem inteira** para antes/depois, preservando
  o número de noites — entrada e saída nunca variam independentemente.
- `±14` gera no máximo 29 períodos antes dos filtros de data.
- Candidatos com entrada no passado (hoje no fuso `America/Sao_Paulo`) ou
  além do horizonte são descartados individualmente, sem rejeitar a busca.
- Ordenação: correspondência exata primeiro; depois menor |deslocamento|;
  entrada mais próxima como desempate.

## Aba Flexível — duração e meses

Uma duração ativa por consulta; meses são alternativas de mês de entrada
(multi-seleção, até 12):

| Preset | Geração |
| --- | --- |
| `weekend` | Entrada sexta-feira → domingo: 2 noites. |
| `week` | 7 noites a partir de cada dia elegível do mês. |
| `month` | Um mês calendário por entrada, com saída ajustada ao último dia válido do mês seguinte (31/01 → 28/02; 29 em ano bissexto). |

- A saída pode cruzar o mês selecionado (margem de 31 dias após o
  horizonte de entrada).
- Ordenação cronológica por entrada; acomodações em ordem estável.
- Mês passado não é elegível; mês além do horizonte é rejeitado.

## Hóspedes

- `adults` (13+), `children` (2–12), `infants` (<2), `pets` (separado).
- Bebês **contam na capacidade física** — sem isenção automática.
- Pets não filtram o inventário (não há dado pet-friendly) — a resposta
  devolve `aviso` objetivo para o produto informar a limitação.
- Capacidade filtrada por unidade: `capacidade >= adults+children+infants`.

## Política de período e limites

- "Hoje" é o dia civil em `America/Sao_Paulo` (`shared::time::hoje`).
- Horizonte de entrada: 12 meses a partir do mês corrente.
- Máximo 120 períodos candidatos por consulta e 20 pessoas por busca —
  excedidos devolvem validação clara; nunca corte silencioso.
- `acomodacao_slug` (opcional): contexto de categoria — só unidade
  publicada no CMS com aquele slug.
- Resultado só lista unidades **publicadas no CMS** — o site vende o que
  tem página.

## Alternativa → reserva

Cada alternativa carrega suas datas efetivas (`inicio`/`fim`/`noites` e,
no modo datas, `deslocamento`). Ao escolher, o site encaminha **as datas
da alternativa** para `/reservar` (`checkIn`, `checkOut`, `guests`,
`suite`) — nunca as datas-base do rascunho.
