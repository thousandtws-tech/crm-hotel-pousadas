"""Fixtures dos testes da MAR IA — rodam 100% offline.

A PousadaApi é substituída por uma FakeApi que registra as chamadas e
devolve respostas enlatadas — nada bate na API real nem na OpenAI.
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Variáveis ANTES de importar app.* (get_settings é lru_cached).
_TMP = Path(tempfile.mkdtemp(prefix="maria-test-"))
os.environ.setdefault("MARIA_MEMORY_FILE", str(_TMP / "memories.json"))
os.environ.setdefault("MARIA_TRANSCRIPT_FILE", str(_TMP / "turns.jsonl"))
os.environ.setdefault("MARIA_TRANSCRIPT_ENABLED", "true")
os.environ.setdefault("MARIA_STORAGE", "json")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.infra.auth import Ator  # noqa: E402


class FakeApi:
    """Mesma interface de PousadaApi, sem HTTP.

    `rotas` mapeia (metodo, prefixo) → resposta; sem rota registrada,
    responde {} / [] conforme o método.
    """

    def __init__(self, rotas: dict | None = None):
        self.rotas = rotas or {}
        self.calls: list[tuple[str, str, object]] = []

    async def close(self) -> None:
        pass

    def _resposta(self, metodo: str, path: str):
        for (m, prefixo), resp in self.rotas.items():
            if m == metodo and path.startswith(prefixo):
                return resp(self, path) if callable(resp) else resp
        return [] if metodo == "get" else {"ok": True}

    async def get(self, path: str, params: dict | None = None):
        self.calls.append(("get", path, params))
        return self._resposta("get", path)

    async def post(self, path: str, body=None):
        self.calls.append(("post", path, body))
        return self._resposta("post", path)

    async def put(self, path: str, body=None):
        self.calls.append(("put", path, body))
        return self._resposta("put", path)

    async def patch(self, path: str, body=None):
        self.calls.append(("patch", path, body))
        return self._resposta("patch", path)

    async def delete(self, path: str):
        self.calls.append(("delete", path, None))
        return self._resposta("delete", path)

    async def request(self, metodo: str, path: str, body=None):
        return await getattr(self, metodo.lower())(path, body) \
            if metodo.lower() != "delete" else await self.delete(path)


@pytest.fixture(autouse=True)
def _breakers_limpos():
    """Circuit breakers são registry process-global — sem reset, falhas
    de um teste abrem o circuito para os seguintes."""
    from app.infra.resilience import _breakers
    _breakers.clear()
    yield
    _breakers.clear()


@pytest.fixture
def api() -> FakeApi:
    return FakeApi()


@pytest.fixture
def admin() -> Ator:
    return Ator(idfuncionario=1, login="admin", nome="Admin", nivel=1)


@pytest.fixture
def gerente() -> Ator:
    return Ator(idfuncionario=2, login="ger", nome="Gerente", nivel=2)


@pytest.fixture
def recepcao() -> Ator:
    return Ator(idfuncionario=3, login="rec", nome="Recepção", nivel=3)
