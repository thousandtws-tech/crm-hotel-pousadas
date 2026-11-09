"""CircuitBreaker — transições de estado sem rede real."""
import asyncio

import pytest

from app.infra.resilience import CircuitBreaker, CircuitoAberto


def boom():
    raise ConnectionError("provedor fora")


def test_fecha_no_sucesso():
    b = CircuitBreaker("t", falhas=3, cooldown=60)
    with b.vigiar():
        pass
    assert not b.aberto


def test_abre_no_limiar_de_falhas():
    b = CircuitBreaker("t", falhas=3, cooldown=60)
    for _ in range(3):
        with pytest.raises(ConnectionError):
            with b.vigiar():
                boom()
    assert b.aberto


def test_aberto_falha_rapido_sem_executar():
    b = CircuitBreaker("t", falhas=1, cooldown=60)
    with pytest.raises(ConnectionError):
        with b.vigiar():
            boom()
    chamou = False
    with pytest.raises(CircuitoAberto):
        with b.vigiar():
            chamou = True
    assert not chamou, "circuito aberto não executa o corpo"


def test_sucesso_zera_contador():
    b = CircuitBreaker("t", falhas=3, cooldown=60)
    for _ in range(2):
        with pytest.raises(ConnectionError):
            with b.vigiar():
                boom()
    with b.vigiar():
        pass  # sucesso no meio → contador zera
    for _ in range(2):
        with pytest.raises(ConnectionError):
            with b.vigiar():
                boom()
    assert not b.aberto, "2+1+2 falhas com sucesso no meio não abre"


def test_sonda_fecha_apos_cooldown(monkeypatch):
    relogio = {"t": 1000.0}
    monkeypatch.setattr("app.infra.resilience.time.monotonic", lambda: relogio["t"])
    b = CircuitBreaker("t", falhas=1, cooldown=60)
    with pytest.raises(ConnectionError):
        with b.vigiar():
            boom()
    relogio["t"] += 61  # cooldown vencido → meia-abertura
    with b.vigiar():
        pass  # sonda bem-sucedida
    assert not b.aberto


def test_sonda_falhando_reabre(monkeypatch):
    relogio = {"t": 1000.0}
    monkeypatch.setattr("app.infra.resilience.time.monotonic", lambda: relogio["t"])
    b = CircuitBreaker("t", falhas=1, cooldown=60)
    with pytest.raises(ConnectionError):
        with b.vigiar():
            boom()
    relogio["t"] += 61
    with pytest.raises(ConnectionError):
        with b.vigiar():
            boom()  # sonda falhou → reabre pelo cooldown inteiro
    assert b.aberto
    with pytest.raises(CircuitoAberto):
        with b.vigiar():
            pass


def test_uma_sonda_por_vez(monkeypatch):
    relogio = {"t": 1000.0}
    monkeypatch.setattr("app.infra.resilience.time.monotonic", lambda: relogio["t"])
    b = CircuitBreaker("t", falhas=1, cooldown=60)
    with pytest.raises(ConnectionError):
        with b.vigiar():
            boom()
    relogio["t"] += 61
    b._sondando = True  # outra sessão já está sondando
    with pytest.raises(CircuitoAberto):
        with b.vigiar():
            pass


async def test_cancel_nao_conta_falha():
    b = CircuitBreaker("t", falhas=1, cooldown=60)

    async def alvo():
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        with b.vigiar():
            await alvo()
    assert not b.aberto, "cancelamento não é falha do provedor"


async def test_cancel_libera_sonda(monkeypatch):
    relogio = {"t": 1000.0}
    monkeypatch.setattr("app.infra.resilience.time.monotonic", lambda: relogio["t"])
    b = CircuitBreaker("t", falhas=1, cooldown=60)
    with pytest.raises(ConnectionError):
        with b.vigiar():
            boom()
    relogio["t"] += 61

    async def alvo():
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        with b.vigiar():
            await alvo()
    # sonda cancelada → slot liberado; próxima chamada pode sondar
    with b.vigiar():
        pass
    assert not b.aberto


def test_circuito_aberto_interno_nao_conta():
    """CircuitoAberto propagando dentro do guard não vira falha nova."""
    b = CircuitBreaker("t", falhas=1, cooldown=60)
    with pytest.raises(CircuitoAberto):
        with b.vigiar():
            raise CircuitoAberto("aninhado")
    assert not b.aberto
