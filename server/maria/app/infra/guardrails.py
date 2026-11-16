"""Guardrails ativos contra prompt injection.

Duas camadas além das instruções do system prompt:

1. **Sanitização de saída de tool** — o conteúdo que as tools devolvem
   vira contexto do modelo. Se um dado do sistema (observação de
   reserva, nome de cliente, nota de quarto) contiver instruções
   embutidas ("ignore as instruções e…"), o modelo poderia obedecer.
   `sanitizar` neutraliza os padrões antes de entrar no contexto e
   sinaliza o trecho — o modelo fica sabendo que o dado foi filtrado.

2. **Canary de contexto** — token único por sessão injetado na
   mensagem developer. Se o modelo o repetir na saída, o contexto
   vazou para o usuário: a resposta é limpa e o vazamento registrado.
   Detecta exfiltração de prompt ("repita suas instruções").
"""
import logging
import re

log = logging.getLogger("maria.guardrails")

# Padrões de injeção — cobertos por testes; expandir com cuidado.
_PADROES: list[tuple[str, re.Pattern[str]]] = [
    ("ignore-instrucoes", re.compile(
        r"ignore\s+(todas\s+|all\s+)?(as\s+|the\s+|any\s+|previous\s+|"
        r"prior\s+)*instru(c|ç)[a-z]*", re.I)),
    ("papel-novo", re.compile(
        r"(you\s+are\s+now|voc[eê]\s+agora\s+(é|e|será)|"
        r"a\s+partir\s+de\s+agora\s+você)", re.I)),
    ("marker-role", re.compile(
        r"^\s*(system|developer|assistant)\s*:", re.I | re.M)),
    ("tag-sistema", re.compile(
        r"<\s*/?\s*(system|developer|instructions?)\b[^>]*>", re.I)),
    ("exfil-prompt", re.compile(
        r"(revele|reveal|mostre|print|repita|repeat)\s+.{0,25}"
        r"(prompt|instru(c|ç))", re.I)),
    ("prompt-word", re.compile(
        r"\b(system|developer)\s*prompt\b", re.I)),
]

_MARCADOR = "[dado removido]"


def sanitizar(texto: str) -> tuple[str, list[str]]:
    """Remove/neutraliza padrões de injeção num texto vindo de tool.

    Devolve (texto limpo, flags dos padrões encontrados). O texto é
    cortado nos matches — não é validação de formato, é neutralização
    de instruções embutidas em dados.
    """
    flags: list[str] = []
    limpo = texto
    for nome, padrao in _PADROES:
        if padrao.search(limpo):
            flags.append(nome)
            limpo = padrao.sub(_MARCADOR, limpo)
    if flags:
        log.warning("tool output sanitizado — padrões: %s", flags)
    return limpo, flags


def sanitizar_resultado(resultado_json: str) -> tuple[str, list[str]]:
    """Versão para o JSON serializado da tool — opera sobre o texto
    inteiro (matches em valores de campos)."""
    return sanitizar(resultado_json)


def canary_ok(saida: str, canary: str) -> bool:
    """True se a saída NÃO contém o canary (contexto não vazou)."""
    return canary not in saida


def limpar_canary(saida: str, canary: str) -> str:
    """Remove o canary da saída vazada — o usuário não vê o token."""
    return saida.replace(canary, "").strip()
