# Base de conhecimento da MAR IA (RAG)

Cada arquivo `.md` desta pasta vira parte da "memória editorial" da
MAR IA. Quando alguém pergunta políticas, horários, regras ou "como
funciona X", a ferramenta `buscar_conhecimento` recupera os trechos
mais relevantes por similaridade semântica.

## Como editar

1. Escreva em português claro, frases curtas — os trechos são lidos
   em voz alta pelo LLM como contexto.
2. Use títulos `##` por assunto: cada seção vira um trecho indexado
   com a fonte (`arquivo › seção`), então mantenha um assunto por
   seção.
3. Seções curtas (até ~1200 caracteres) recuperam melhor.
4. Salve o arquivo — a reindexação é automática na próxima busca
   (só trechos alterados são re-embedados; cache em `data/`).

## O que colocar aqui

- Políticas: check-in/out, cancelamento, pets, fumantes, crianças.
- Horários: café da manhã, piscina, recepção, silêncio.
- Senhas/serviços: wi-fi, estacionamento, praia, passeios parceiros.
- Procedimentos internos: como resolver situações recorrentes.
- Respostas prontas: perguntas frequentes de hóspedes e da equipe.

## O que NÃO colocar

- Dados que mudam (disponibilidade, preços de hoje, estoque) — isso
  vem das ferramentas em tempo real.
- Segredos, senhas de sistemas, dados de hóspedes.
- Informação que você não quer que qualquer usuário da MAR IA ouça —
  `buscar_conhecimento` é acessível a todos os níveis.

## Verificando

```bash
cd server/maria
python -m pytest tests/test_knowledge.py   # chunking e busca offline
```
