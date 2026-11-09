"""Circuit breaker por dependência externa (OpenAI, ElevenLabs).

Sem ele, uma queda sustentada do provedor transforma cada turno numa
espera de timeout+retries do SDK — com a MAR falando por voz, isso
significa sessão "morta" por dezenas de segundos. Com o breaker:

- CLOSED → normal; falhas seguidas ≥ `falhas` abrem o circuito;
- OPEN → chamadas falham na hora (`CircuitoAberto`), sem tocar na rede;
- cooldown vencido → HALF-OPEN: uma sonda decide — sucesso fecha,
  falha reabre pelo cooldown inteiro.

`CancelledError` e `CircuitoAberto` não contam como falha (cancelamento
é decisão nossa, não do provedor).
"""
import asyncio
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager

from ..config import get_settings

log = logging.getLogger("maria.resilience")


class CircuitoAberto(RuntimeError):
    """Dependência em circuito aberto — falhe rápido, sem tocar a rede."""


class CircuitBreaker:
    def __init__(self, nome: str, falhas: int = 3, cooldown: float = 60.0):
        self.nome = nome
        self.falhas = max(1, falhas)
        self.cooldown = cooldown
        self._falhas = 0
        self._aberto_em = 0.0
        self._sondando = False

    @property
    def aberto(self) -> bool:
        return self._aberto_em > 0

    @property
    def estado(self) -> str:
        if not self.aberto:
            return "closed"
        if time.monotonic() - self._aberto_em >= self.cooldown:
            return "half-open"
        return "open"

    def _permite(self) -> bool:
        if not self.aberto:
            return True
        if time.monotonic() - self._aberto_em < self.cooldown:
            return False
        # meia-abertura — uma sonda por vez; demais chamadas seguem
        # falhando rápido até a sonda decidir
        if self._sondando:
            return False
        self._sondando = True
        return True

    def sucesso(self) -> None:
        if self.aberto:
            log.info("%s: circuito fechado após sonda", self.nome)
        self._falhas = 0
        self._aberto_em = 0.0
        self._sondando = False

    def falha(self, exc: BaseException | None = None) -> None:
        if self._sondando:
            self._sondando = False
            self._aberto_em = time.monotonic()
            log.warning("%s: sonda falhou — circuito reaberto", self.nome)
            return
        self._falhas += 1
        if self._falhas >= self.falhas and not self.aberto:
            self._aberto_em = time.monotonic()
            log.warning(
                "%s: %d falhas seguidas — circuito aberto por %.0fs",
                self.nome,
                self._falhas,
                self.cooldown,
            )

    @contextmanager
    def vigiar(self) -> Iterator[None]:
        """Guarda um trecho: entrada exige circuito fechado/sondável,
        saída limpa fecha, exceção conta falha e propaga."""
        if not self._permite():
            raise CircuitoAberto(
                f"{self.nome} em circuito aberto — falha rápida"
            )
        try:
            yield
        except CircuitoAberto:
            raise
        except asyncio.CancelledError:
            # cancelamento é nosso — libera a sonda sem contar falha
            self._sondando = False
            raise
        except BaseException as exc:
            self.falha(exc)
            raise
        else:
            self.sucesso()


_breakers: dict[str, CircuitBreaker] = {}


def breaker(nome: str) -> CircuitBreaker:
    """Registry process-global — o estado é compartilhado por todas as
    sessões: a queda de um provedor afeta (e é detectada por) todos."""
    b = _breakers.get(nome)
    if b is None:
        s = get_settings()
        b = CircuitBreaker(nome, s.maria_circuit_failures, s.maria_circuit_cooldown_secs)
        _breakers[nome] = b
    return b


def circuitos() -> dict[str, str]:
    """Estado dos circuitos já tocados — surface do /healthz."""
    return {nome: b.estado for nome, b in _breakers.items()}
