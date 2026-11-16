"""Testes do estado compartilhado — MemState, RedisState com cliente
falso e seleção de backend em get_state."""

from app.infra.state import MemState, RedisState, _reset_state, get_state

# ------------------------------------------------------------- MemState --

async def test_mem_set_get_delete():
    st = MemState()
    await st.set("k", {"a": 1}, 60)
    assert await st.get("k") == {"a": 1}
    await st.delete("k")
    assert await st.get("k") is None


async def test_mem_incr_soma_e_preserva_expiracao():
    st = MemState()
    assert await st.incr("rate", 1, 120) == 1
    assert await st.incr("rate", 5, 120) == 6
    # segunda chamada não estica a janela — expiração da 1ª escrita vale
    _, expira = st._dados["rate"]
    assert expira > 0


async def test_mem_nao_distribuido():
    assert MemState().distribuido is False


# ------------------------------------------------------------ RedisState --

class _FakeRedis:
    """Duck-type do redis.asyncio — dict + log de chamadas."""

    def __init__(self):
        self.d: dict[str, str] = {}
        self.expirados: dict[str, int] = {}

    async def get(self, k):
        return self.d.get(k)

    async def set(self, k, v, ex=None):
        self.d[k] = v
        if ex:
            self.expirados[k] = ex

    async def delete(self, k):
        self.d.pop(k, None)

    async def incrby(self, k, n):
        novo = int(self.d.get(k) or 0) + n
        self.d[k] = str(novo)
        return novo

    async def expire(self, k, ttl):
        self.expirados[k] = ttl

    async def aclose(self):
        pass


async def test_redis_json_roundtrip():
    fake = _FakeRedis()
    st = RedisState(client=fake)
    assert st.distribuido is True
    await st.set("pend:x", {"acao": "checkin"}, 900)
    assert await st.get("pend:x") == {"acao": "checkin"}
    assert fake.expirados["pend:x"] == 900
    await st.delete("pend:x")
    assert await st.get("pend:x") is None


async def test_redis_incr_expira_na_primeira_escrita():
    fake = _FakeRedis()
    st = RedisState(client=fake)
    assert await st.incr("rate:1:202401011200", 1, 120) == 1
    assert fake.expirados["rate:1:202401011200"] == 120
    # segunda escrita não re-marcate expire (janela não estica)
    fake.expirados.clear()
    assert await st.incr("rate:1:202401011200", 1, 120) == 2
    assert "rate:1:202401011200" not in fake.expirados


# ------------------------------------------------------------- get_state --

async def test_get_state_sem_redis_e_memstate():
    _reset_state()
    st = await get_state()
    assert isinstance(st, MemState)
    assert st.distribuido is False


async def test_get_state_com_redis_indisponivel_cai_em_mem():
    """REDIS_URL setada + falha de conexão → fallback MemState (o
    serviço sobe e degrada em vez de morrer no boot)."""
    from app.config import get_settings
    s = get_settings()
    antigo = s.redis_url
    s.redis_url = "redis://host-inexistente:6399/0"
    _reset_state()
    try:
        st = await get_state()
        # sem lib redis ou sem servidor → sempre MemState
        assert isinstance(st, MemState)
    finally:
        s.redis_url = antigo
        _reset_state()


# --------------------------------------------------------------- tracing --

async def test_span_inativo_e_noop():
    """Sem OTEL_ENDPOINT, span() é no-op de custo zero — nem importa
    o SDK."""
    from app.telemetry.tracing import span
    with span("maria.teste", atributo=1) as sp:
        assert sp is None
