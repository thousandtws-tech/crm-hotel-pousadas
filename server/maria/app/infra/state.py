"""Estado compartilhado entre réplicas — Redis quando `REDIS_URL` está
configurada, memória de processo caso contrário.

O que viaja por aqui (em vez de ficar preso num processo):

- ações preparadas aguardando confirmação (`pend:{escopo}:{idacao}`)
- cache de leituras de tools (`tc:{escopo}:{geracao}:{chave}` +
  `tgen:{escopo}` — invalidar = incrementar a geração)
- histórico/resumo da conversa por usuário (`hist:{idfuncionario}`)
- rate limit e budget de tokens (`rate:{id}:{minuto}`,
  `budget:{id}:{dia}`)

Contrato pequeno — get/set com TTL, delete e incr. `distribuido`
distingue os backends: com MemState, pendentes e histórico continuam
locais ao processo (uma réplica não precisa deles compartilhados);
com Redis, tudo funciona em N réplicas e sobrevive a restart.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Protocol

from ..config import get_settings

log = logging.getLogger("maria.state")


class SharedState(Protocol):
    """Contrato do backend de estado — chave-valor com TTL."""

    distribuido: bool

    async def get(self, chave: str) -> Any: ...
    async def set(self, chave: str, valor: Any, ttl_secs: int) -> None: ...
    async def delete(self, chave: str) -> None: ...
    async def incr(self, chave: str, n: int, ttl_secs: int) -> int: ...
    async def fechar(self) -> None: ...


class MemState:
    """Backend em memória de processo — dev, testes, réplica única."""

    distribuido = False

    def __init__(self) -> None:
        self._dados: dict[str, tuple[float, Any]] = {}

    def _vivo(self, chave: str) -> bool:
        item = self._dados.get(chave)
        if item is None:
            return False
        expira, _ = item
        if expira and time.monotonic() > expira:
            self._dados.pop(chave, None)
            return False
        return True

    async def get(self, chave: str) -> Any:
        return self._dados[chave][1] if self._vivo(chave) else None

    async def set(self, chave: str, valor: Any, ttl_secs: int) -> None:
        expira = time.monotonic() + ttl_secs if ttl_secs else 0.0
        self._dados[chave] = (expira, valor)

    async def delete(self, chave: str) -> None:
        self._dados.pop(chave, None)

    async def incr(self, chave: str, n: int, ttl_secs: int) -> int:
        atual = await self.get(chave) or 0
        novo = int(atual) + n
        # preserva a expiração original — janela deslizante não estica
        item = self._dados.get(chave)
        expira = item[0] if item else (
            time.monotonic() + ttl_secs if ttl_secs else 0.0)
        self._dados[chave] = (expira, novo)
        return novo

    async def fechar(self) -> None:
        self._dados.clear()


class RedisState:
    """Backend Redis — compartilha estado entre réplicas e restarts."""

    distribuido = True

    def __init__(self, client: Any | None = None) -> None:
        if client is not None:
            self._r = client
            return
        try:
            import redis.asyncio as aioredis
        except ImportError as exc:  # pragma: no cover — depende do ambiente
            raise RuntimeError(
                "REDIS_URL configurada mas pacote 'redis' ausente "
                "— pip install redis") from exc
        s = get_settings()
        self._r = aioredis.from_url(
            s.redis_url, decode_responses=True,
            socket_connect_timeout=3, socket_timeout=5)

    async def get(self, chave: str) -> Any:
        bruto = await self._r.get(chave)
        if bruto is None:
            return None
        try:
            return json.loads(bruto)
        except (TypeError, json.JSONDecodeError):
            return bruto

    async def set(self, chave: str, valor: Any, ttl_secs: int) -> None:
        bruto = json.dumps(valor, ensure_ascii=False)
        if ttl_secs:
            await self._r.set(chave, bruto, ex=ttl_secs)
        else:
            await self._r.set(chave, bruto)

    async def delete(self, chave: str) -> None:
        await self._r.delete(chave)

    async def incr(self, chave: str, n: int, ttl_secs: int) -> int:
        novo = await self._r.incrby(chave, n)
        if novo == n and ttl_secs:
            # primeira escrita da janela — marca a expiração
            await self._r.expire(chave, ttl_secs)
        return int(novo)

    async def fechar(self) -> None:
        await self._r.aclose()


_STATE: SharedState | None = None
_STATE_LOCK = asyncio.Lock()


async def get_state() -> SharedState:
    """Backend global do processo — Redis quando configurado."""
    global _STATE
    async with _STATE_LOCK:
        if _STATE is None:
            s = get_settings()
            if s.redis_url:
                try:
                    _STATE = RedisState()
                    # prova a conexão já no boot — falha rápida, não
                    # descobre o problema no primeiro turno
                    await _STATE.incr("maria:boot", 1, 60)
                    log.info("estado compartilhado: redis")
                except Exception:
                    log.exception(
                        "redis indisponível — caindo para estado em "
                        "memória (réplica única)")
                    _STATE = MemState()
            else:
                _STATE = MemState()
    return _STATE


def _reset_state() -> None:
    """Testes trocam o backend entre casos."""
    global _STATE
    _STATE = None
