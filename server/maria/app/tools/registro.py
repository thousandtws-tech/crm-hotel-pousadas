"""Registro de tools — monta TOOLS (schemas) e o mapa
nome→handler de cada domínio. Ordem dos módulos define a
ordem das tools apresentadas ao modelo.
"""
from collections.abc import Awaitable, Callable
from typing import Any

from . import acoes, financeiro, nucleo, operacional, pdv, pessoal

Handler = Callable[[Any, str, dict], Awaitable[dict]]

MODULOS = (nucleo, pessoal, acoes, pdv, financeiro, operacional)

TOOLS: list[dict[str, Any]] = [
    s for m in MODULOS for s in m.SCHEMAS
]

HANDLERS: dict[str, Handler] = {}
for _m in MODULOS:
    for _s in _m.SCHEMAS:
        _n = _s["name"]
        assert _n not in HANDLERS, f"tool duplicada: {_n}"
        HANDLERS[_n] = _m.handle
