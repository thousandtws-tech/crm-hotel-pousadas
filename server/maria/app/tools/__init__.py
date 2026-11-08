"""Ferramentas (function calling) do MAR IA → API do sistema.

Pacote dividido por domínio:
- `registro` — TOOLS + mapa nome→handler;
- `executor` — ToolExecutor (permissões, confirmação, roteamento);
- `preparadores` — construção dos planos preparar→confirmar;
- `nucleo|pdv|financeiro|operacional|acoes|pessoal` — schemas +
  dispatch de cada domínio;
- `constantes`/`helpers` — compartilhados.

API pública preservada: `from .tools import TOOLS, ToolExecutor`.
"""
from .executor import ToolExecutor
from .helpers import _data, _hoje, _props, _resumo
from .registro import TOOLS

__all__ = ["TOOLS", "ToolExecutor", "_data", "_hoje", "_props", "_resumo"]
