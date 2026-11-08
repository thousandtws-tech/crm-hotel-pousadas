"""Helpers compartilhados das ferramentas — datas locais e
formatação. Sem estado, sem I/O.
"""
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo


def _hoje(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def _data(arg: str | None, tz: ZoneInfo) -> str:
    """'hoje'/'amanha'/None → ISO local; senão devolve como veio."""
    if not arg:
        return _hoje(tz).isoformat()
    t = arg.strip().lower()
    base = _hoje(tz)
    if t in ("hoje",):
        return base.isoformat()
    if t in ("amanha", "amanhã"):
        return (base + timedelta(days=1)).isoformat()
    if t in ("depois de amanha", "depois de amanhã"):
        return (base + timedelta(days=2)).isoformat()
    return arg  # ISO vindo do modelo



def _props(**kv: Any) -> dict[str, Any]:
    return kv




def _resumo(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id"),
        "hospede": r.get("cliente_nome"),
        "acomodacao": r.get("acomodacao_nome"),
        "numero": r.get("acomodacao_numero"),
        "entrada": r.get("entradaprevista"),
        "saida": r.get("saidaprevista"),
        "status": r.get("status"),
        "hospedes": r.get("quantidade_hospedes"),
        "diaria": r.get("valordiaria"),
        "total": r.get("valor_estadia"),
    }


# ---------------------------------------------------------- rótulo UI --

# Nome técnico da tool nunca vai para a tela — o evento `tool` carrega
# um rótulo em gerúndio ("consultando reservas…") gerado aqui.
_ESPECIAIS = {
    "confirmar_acao": "confirmando a ação",
    "salvar_memoria": "memorizando",
    "esquecer_memoria": "esquecendo",
    "listar_memorias": "relembrando",
    "buscar_conhecimento": "consultando a base de conhecimento",
    "abrir_pagina": "abrindo a tela",
    "saudar": "saudando",
}

_PREFIXOS = (
    ("preparar_", "preparando"),
    ("get_", "consultando"),
    ("listar_", "consultando"),
    ("buscar_", "buscando"),
    ("criar_", "criando"),
    ("salvar_", "salvando"),
    ("atualizar_", "atualizando"),
    ("excluir_", "excluindo"),
    ("fechar_", "fechando"),
    ("abrir_", "abrindo"),
    ("executar_", "executando"),
    ("verificar_", "verificando"),
    ("gerar_", "gerando"),
)


def rotulo_tool(nome: str) -> str:
    """Nome técnico → frase amigável para a UI do widget."""
    if nome in _ESPECIAIS:
        return _ESPECIAIS[nome]
    for prefixo, gerundio in _PREFIXOS:
        if nome.startswith(prefixo):
            base = nome[len(prefixo):].replace("_", " ").strip()
            return f"{gerundio} {base}" if base else gerundio
    return "processando" if not nome else f"verificando {nome.replace('_', ' ')}"
