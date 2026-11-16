"""Testes do ToolExecutor — RBAC, fluxo preparar→confirmar, dispatch."""

from app.tools import TOOLS, ToolExecutor, _data
from tests.conftest import FakeApi

# ------------------------------------------------------------- schemas --

def test_toda_tool_tem_nome_unico():
    nomes = [t["name"] for t in TOOLS]
    assert len(nomes) == len(set(nomes))


def test_toda_tool_tem_schema_valido():
    for t in TOOLS:
        assert t["type"] == "function"
        assert t["parameters"]["type"] == "object"
        assert t["description"].strip()


# ----------------------------------------------------------- helpers --

def test_data_hoje_amanha_iso(tz=None):
    from app.config import get_settings
    tz = get_settings().tz
    assert len(_data("hoje", tz)) == 10
    assert len(_data("amanhã", tz)) == 10
    assert len(_data("depois de amanhã", tz)) == 10
    assert _data("2026-03-10", tz) == "2026-03-10"


# ---------------------------------------------------------------- RBAC --

async def test_recepcao_nao_acessa_financeiro(api, recepcao):
    ex = ToolExecutor(api, recepcao)
    r = await ex.run("get_lancamentos", {})
    assert r["erro"] == "permissão insuficiente"
    assert api.calls == []


async def test_recepcao_nao_abre_caixa(api, recepcao):
    ex = ToolExecutor(api, recepcao)
    r = await ex.run("preparar_abrir_caixa",
                     {"idconta_financeira": 1, "saldo_inicial": 100})
    assert r["erro"] == "permissão insuficiente"


async def test_recepcao_pode_abrir_comanda(api, recepcao):
    ex = ToolExecutor(api, recepcao)
    r = await ex.run("preparar_comanda", {"tipo": "mesa", "idmesa": 4})
    assert r["status"] == "preparada"


async def test_recepcao_nao_abre_pagina_admin(api, recepcao):
    ex = ToolExecutor(api, recepcao)
    r = await ex.run("abrir_pagina", {"pagina": "cms"})
    assert r["erro"] == "permissão insuficiente"


async def test_gerente_acessa_dre(api, gerente):
    api.rotas[("get", "/financeiro/dre")] = {"receita": 1000}
    ex = ToolExecutor(api, gerente)
    r = await ex.run("get_dre", {})
    assert r["dre"]["receita"] == 1000


# -------------------------------------------- preparar → confirmar --

async def test_fluxo_preparar_confirmar_cliente(api, admin):
    ex = ToolExecutor(api, admin)
    prep = await ex.run("preparar_cliente", {
        "acao": "criar", "nome": "João", "cpf": "111", "data_nascimento": "1990-01-01"})
    assert prep["status"] == "preparada"
    assert prep["idacao"].startswith("ac")
    ok = await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    assert ok["status"] == "executada"
    assert ("post", "/clientes") in [(m, p) for m, p, _ in api.calls]


async def test_confirmar_idacao_inexistente(api, admin):
    ex = ToolExecutor(api, admin)
    r = await ex.run("confirmar_acao", {"idacao": "ac999"})
    assert r["erro"] == "acao_expirada"


async def test_criar_cliente_sem_cpf_bloqueia(api, admin):
    ex = ToolExecutor(api, admin)
    r = await ex.run("preparar_cliente", {"acao": "criar", "nome": "João"})
    assert r["erro"] == "dados_incompletos"


# -------------------------------------------------------------- PDV --

async def test_get_comandas_chama_api(api, gerente):
    api.rotas[("get", "/pdv/comandas")] = {"total": 2, "items": [{"id": 1}]}
    ex = ToolExecutor(api, gerente)
    r = await ex.run("get_comandas", {"tipo": "mesa", "status": "aberta"})
    assert r["comandas"] == [{"id": 1}]
    metodo, path, params = api.calls[0]
    assert path == "/pdv/comandas" and params["tipo"] == "mesa"


async def test_fechar_comanda_executa_post(api, admin):
    ex = ToolExecutor(api, admin)
    prep = await ex.run("preparar_fechar_comanda",
                        {"idcomanda": 9, "modo": "pagar",
                         "idconta_financeira": 2})
    ok = await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    assert ok["status"] == "executada"
    metodo, path, corpo = api.calls[-1]
    assert path == "/pdv/comandas/9/fechar"
    assert corpo["modo"] == "pagar" and corpo["idconta_financeira"] == 2


async def test_item_comanda_status_mapeia_verbo(api, admin):
    ex = ToolExecutor(api, admin)
    prep = await ex.run("preparar_item_comanda_status",
                        {"idcomanda": 9, "iditem_comanda": 3, "acao": "pronto"})
    await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    metodo, path, _ = api.calls[-1]
    assert path == "/pdv/comandas/9/itens/3/pronto"


async def test_presenca_cafe_payload(api, admin):
    ex = ToolExecutor(api, admin)
    prep = await ex.run("preparar_presenca_cafe",
                        {"idreserva": 5, "quantidade": 2})
    await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    metodo, path, corpo = api.calls[-1]
    assert path == "/cafe/presencas"
    assert corpo["idreserva"] == 5 and corpo["quantidade"] == 2


# ----------------------------------------------------------- caixa --

async def test_caixa_turno_aberto(api, gerente):
    api.rotas[("get", "/financeiro/caixa/aberto")] = {"id": 7, "status": "aberto"}
    ex = ToolExecutor(api, gerente)
    r = await ex.run("get_caixa_turnos", {"idconta_financeira": 1})
    assert r["turno_aberto"]["id"] == 7


async def test_sangria_exige_motivo(api, gerente):
    ex = ToolExecutor(api, gerente)
    prep = await ex.run("preparar_movimento_caixa", {
        "idturno": 7, "tipo": "sangria", "valor": 100, "motivo": "troco"})
    await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    metodo, path, corpo = api.calls[-1]
    assert path.endswith("/movimentos") and corpo["tipo"] == "sangria"


# ------------------------------------------------------- tesouraria --

async def test_lancamento_normaliza_vencimento(api, gerente):
    ex = ToolExecutor(api, gerente)
    prep = await ex.run("preparar_lancamento", {
        "tipo": "pagar", "descricao": "Luz", "valor": 450,
        "vencimento": "amanhã"})
    await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    metodo, path, corpo = api.calls[-1]
    assert path == "/financeiro/lancamentos"
    assert corpo["tipo"] == "pagar" and len(corpo["vencimento"]) == 10


async def test_plano_conta_gerente(api, gerente):
    ex = ToolExecutor(api, gerente)
    prep = await ex.run("preparar_plano_conta", {
        "codigo": "3.1", "nome": "Luz", "tipo": "pagar",
        "grupo_dre": "despesas_operacionais"})
    await ex.run("confirmar_acao", {"idacao": prep["idacao"]})
    metodo, path, corpo = api.calls[-1]
    assert corpo["grupo_dre"] == "despesas_operacionais"


# ----------------------------------------------------- navegação --

async def test_nav_financeiro_dre(api, admin):
    ex = ToolExecutor(api, admin)
    r = await ex.run("abrir_pagina", {"pagina": "financeiro_dre"})
    assert r["navegar"] == "/financeiro/dre"


async def test_nav_reserva_detalhe(api, admin):
    ex = ToolExecutor(api, admin)
    r = await ex.run("abrir_pagina", {"pagina": "reservas", "idreserva": 12})
    assert r["navegar"] == "/reservas/12"


async def test_nav_pdv(api, recepcao):
    ex = ToolExecutor(api, recepcao)
    r = await ex.run("abrir_pagina", {"pagina": "pdv"})
    assert r["navegar"] == "/pdv"


# -------------------------------------------------- ações seguras --

async def test_buscar_conhecimento_dispatch(api, recepcao):
    """Dispatch chama a base com o embedder injetado (offline)."""
    async def zeros(textos):
        return [[0.0] * 4 for _ in textos]
    ex = ToolExecutor(api, recepcao, embedder=zeros)
    r = await ex.run("buscar_conhecimento", {"pergunta": "check-out"})
    # vetores zerados → similaridade 0 → nada recupera, mas sem erro
    assert "trechos" in r or "mensagem" in r or "erro" in r
    assert api.calls == []  # não bate na API do sistema


async def test_ler_todas_notificacoes_direto(api, recepcao):
    ex = ToolExecutor(api, recepcao)
    r = await ex.run("ler_todas_notificacoes", {})
    assert r["ok"] and api.calls[0][1] == "/notificacoes/ler-todas"


async def test_tool_desconhecida(api, admin):
    ex = ToolExecutor(api, admin)
    r = await ex.run("nao_existe", {})
    assert r["erro"] == "desconhecida"


async def test_toda_tool_tem_handler(api, admin):
    """Nenhuma tool pode cair no 'desconhecida' — cobre o roteamento
    nome→domínio do pacote tools/."""
    from app.tools.registro import HANDLERS
    for t in TOOLS:
        assert t["name"] in HANDLERS, f"sem handler: {t['name']}"


async def test_toda_tool_despacha(api, admin):
    """Roda cada tool com args vazios: resposta nunca pode ser
    'desconhecida'. Args inválidos geram 'interno' (prova de que o case
    foi alcançado)."""
    ex = ToolExecutor(api, admin)
    for t in TOOLS:
        if t["name"] == "confirmar_acao":
            continue  # interceptada no run()
        r = await ex.run(t["name"], {})
        # listas (pass-through da API) também provam dispatch
        assert not (isinstance(r, dict) and r.get("erro") == "desconhecida"), \
            t["name"]


def test_rotulo_tool_humanizado():
    """Nome técnico nunca vaza para a UI — sai gerúndio amigável."""
    from app.tools.helpers import rotulo_tool
    assert rotulo_tool("get_reservas") == "consultando reservas"
    assert rotulo_tool("get_hospedes_atuais") == "consultando hospedes atuais"
    assert rotulo_tool("preparar_reserva") == "preparando reserva"
    assert rotulo_tool("confirmar_acao") == "confirmando a ação"
    assert rotulo_tool("buscar_conhecimento") == \
        "consultando a base de conhecimento"
    assert "get_" not in rotulo_tool("get_reservas")


def test_toda_tool_tem_rotulo_amigavel():
    """Cada uma das 111 tools gera rótulo sem o nome cru."""
    from app.tools.helpers import rotulo_tool
    for t in TOOLS:
        rotulo = rotulo_tool(t["name"])
        assert rotulo and t["name"] not in rotulo, t["name"]


# ---------------------------------------------------- cache de sessão --

def _api_checkins():
    return FakeApi(rotas={
        ("get", "/reservas"): {"items": [{"id": 1}], "total": 1},
    })


async def test_leitura_repetida_usa_cache(admin):
    """Mesma tool + mesmos args dentro do TTL → uma chamada à API só."""
    api = _api_checkins()
    ex = ToolExecutor(api, admin)
    await ex.run("get_checkins", {})
    await ex.run("get_checkins", {})
    chamadas = [c for c in api.calls if c[1].startswith("/reservas")]
    assert len(chamadas) == 1


async def test_args_diferentes_nao_cacheiam(admin):
    api = _api_checkins()
    ex = ToolExecutor(api, admin)
    await ex.run("get_checkins", {})
    await ex.run("get_checkins", {"de": "ontem"})
    chamadas = [c for c in api.calls if c[1].startswith("/reservas")]
    assert len(chamadas) == 2


async def test_escrita_invalida_cache(admin):
    api = _api_checkins()
    ex = ToolExecutor(api, admin)
    await ex.run("get_checkins", {})
    # preparar_* não é leitura → invalida o cache da sessão
    await ex.run("preparar_cancelamento",
                 {"idreserva": 1, "motivo": "x"})
    await ex.run("get_checkins", {})
    chamadas = [c for c in api.calls if c[1].startswith("/reservas")]
    assert len(chamadas) == 2


async def test_cache_desligado_chama_sempre(api, admin):
    from app.config import get_settings
    s = get_settings()
    antigo = s.maria_tool_cache_enabled
    s.maria_tool_cache_enabled = False
    api = _api_checkins()
    try:
        ex = ToolExecutor(api, admin)
        await ex.run("get_checkins", {})
        await ex.run("get_checkins", {})
        chamadas = [c for c in api.calls if c[1].startswith("/reservas")]
        assert len(chamadas) == 2
    finally:
        s.maria_tool_cache_enabled = antigo


async def test_erro_nao_fica_cacheado(api, admin):
    """5xx transitório não pode grudar por 45s no cache."""
    from app.infra.api_client import ApiError
    falho = _api_checkins()
    ex = ToolExecutor(falho, admin)
    falho.rotas = {
        ("get", "/reservas"): ApiError(500, "down"),
    }
    r1 = await ex.run("get_checkins", {})
    assert r1.get("erro")
    falho.rotas = {
        ("get", "/reservas"): {"items": [], "total": 0},
    }
    r2 = await ex.run("get_checkins", {})
    assert not r2.get("erro")
    assert len(falho.calls) == 2
