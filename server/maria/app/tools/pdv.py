"""PDV/salão — mesas, comandas, cozinha, café da manhã, comissões.

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from .helpers import _data, _props

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_mesas",
        "description": "Mesas do salão com número, lugares e status.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_garcons",
        "description": "Garçons cadastrados e percentual de comissão.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_comandas",
        "description": (
            "Comandas do PDV — filtre por tipo (mesa/quarto/balcao), "
            "status (aberta/fechada/cancelada) e período."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={"type": "string", "enum": ["mesa", "quarto", "balcao"]},
                status={"type": "string",
                        "enum": ["aberta", "fechada", "cancelada"]},
                inicio={"type": "string"},
                fim={"type": "string"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_comanda_detalhe",
        "description": "Comanda completa com itens e status de cada item.",
        "parameters": {
            "type": "object",
            "properties": _props(idcomanda={"type": "integer"}),
            "required": ["idcomanda"],
        },
    },
    {
        "type": "function",
        "name": "get_fila_cozinha",
        "description": (
            "Fila da cozinha agora (KDS): itens pendentes, em preparo e "
            "prontos para entrega."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_itens_venda",
        "description": "Itens vendáveis do PDV (cardápio) — id, nome e preço.",
        "parameters": {
            "type": "object",
            "properties": _props(busca={"type": "string"}),
        },
    },
    {
        "type": "function",
        "name": "get_comissoes",
        "description": "Comissões de garçom — pendentes ou por período (gerente+).",
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string"},
                fim={"type": "string"},
                apenas_pendentes={"type": "boolean"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_cafe_quadro",
        "description": (
            "Quadro do café da manhã de uma data (padrão hoje): reservas "
            "esperadas e presenças já marcadas."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(data={"type": "string"}),
        },
    },
    {
        "type": "function",
        "name": "get_cafe_historico",
        "description": "Histórico de presenças no café da manhã.",
        "parameters": {
            "type": "object",
            "properties": _props(inicio={"type": "string"},
                                 fim={"type": "string"}),
        },
    },
    {
        "type": "function",
        "name": "preparar_comanda",
        "description": (
            "Abre uma comanda: tipo='mesa' exige idmesa; 'quarto' exige "
            "idquarto (reserva hospedada); 'balcao' exige rotulo. "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={"type": "string", "enum": ["mesa", "quarto", "balcao"]},
                idmesa={"type": "integer"},
                idquarto={"type": "integer"},
                idcliente={"type": "integer"},
                idgarcom={"type": "integer"},
                rotulo={"type": "string", "description": "Nome/rótulo (balcão)"},
            ),
            "required": ["tipo"],
        },
    },
    {
        "type": "function",
        "name": "preparar_item_comanda",
        "description": (
            "Adiciona item a uma comanda aberta — busque o iditem em "
            "get_itens_venda. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idcomanda={"type": "integer"},
                iditem={"type": "integer", "description": "ID do item vendável"},
                quantidade={"type": "integer", "default": 1},
            ),
            "required": ["idcomanda", "iditem"],
        },
    },
    {
        "type": "function",
        "name": "preparar_fechar_comanda",
        "description": (
            "Fecha uma comanda: modo='pagar' baixa na hora (informe "
            "idconta_financeira/idforma_pagamento); 'faturar' deixa em "
            "aberto no quarto. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idcomanda={"type": "integer"},
                modo={"type": "string", "enum": ["pagar", "faturar"]},
                desconto={"type": "number"},
                idconta_financeira={"type": "integer"},
                idforma_pagamento={"type": "integer"},
                observacao={"type": "string"},
            ),
            "required": ["idcomanda", "modo"],
        },
    },
    {
        "type": "function",
        "name": "preparar_cancelar_comanda",
        "description": "Cancela uma comanda (estorna itens ao estoque). Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                idcomanda={"type": "integer"},
                motivo={"type": "string"},
            ),
            "required": ["idcomanda"],
        },
    },
    {
        "type": "function",
        "name": "preparar_item_comanda_status",
        "description": (
            "Move um item da comanda: preparar (cozinha inicia), pronto "
            "(produzido), entregar (ao cliente), retornar (volta à fila), "
            "cancelar (estorna). Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idcomanda={"type": "integer"},
                iditem_comanda={"type": "integer",
                                "description": "ID do item DENTRO da comanda"},
                acao={"type": "string",
                      "enum": ["preparar", "pronto", "entregar",
                               "retornar", "cancelar"]},
            ),
            "required": ["idcomanda", "iditem_comanda", "acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_mesa",
        "description": "Cria uma mesa do salão (numero obrigatório). Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                numero={"type": "string"},
                lugares={"type": "integer"},
            ),
            "required": ["numero"],
        },
    },
    {
        "type": "function",
        "name": "preparar_presenca_cafe",
        "description": (
            "Marca presença no café da manhã de uma reserva (padrão hoje, "
            "quantidade pessoas). Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer"},
                quantidade={"type": "integer"},
                data={"type": "string", "description": "ISO ou hoje/amanhã"},
            ),
            "required": ["idreserva", "quantidade"],
        },
    },
    {
        "type": "function",
        "name": "preparar_pagar_comissao",
        "description": (
            "Paga uma comissão de garçom — exige idconta_financeira "
            "(get_contas_financeiras) (gerente+). Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idcomissao={"type": "integer"},
                idconta_financeira={"type": "integer"},
                idforma_pagamento={"type": "integer"},
            ),
            "required": ["idcomissao", "idconta_financeira"],
        },
    },
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    """Despacha as tools deste domínio. `ex` é o ToolExecutor
    (api, ator, tz, _exec, _preparar_*).
    """
    tz = ex.tz
    match nome:
        case "get_mesas":
            p = await ex.api.get("/pdv/mesas")
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"mesas": itens[:60]}

        case "get_garcons":
            p = await ex.api.get("/pdv/garcons")
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"garcons": itens[:40]}

        case "get_comandas":
            p = await ex.api.get("/pdv/comandas", {
                "tipo": a.get("tipo"), "status": a.get("status"),
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                "por_pagina": 30,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"total": p.get("total", len(itens)),
                    "comandas": itens[:30]}

        case "get_comanda_detalhe":
            cid = int(a["idcomanda"])
            comanda = await ex.api.get(f"/pdv/comandas/{cid}")
            itens = await ex.api.get(f"/pdv/comandas/{cid}/itens")
            return {"comanda": comanda,
                    "itens": itens if isinstance(itens, list) else itens.get("items", [])}

        case "get_fila_cozinha":
            r = await ex.api.get("/pdv/cozinha/fila")
            return {"fila": r}

        case "get_itens_venda":
            p = await ex.api.get("/pdv/itens-venda", {
                "busca": a.get("busca")})
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"itens": itens[:60]}

        case "get_comissoes":
            p = await ex.api.get("/pdv/comissoes", {
                "apenas_pendentes": a.get("apenas_pendentes", True),
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                "por_pagina": 30,
            })
            resumo = await ex.api.get("/pdv/comissoes/resumo", {
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"total": p.get("total", len(itens)),
                    "comissoes": itens[:30], "resumo": resumo}

        case "get_cafe_quadro":
            d = _data(a.get("data"), tz)
            r = await ex.api.get("/cafe/quadro", {"data": d})
            return {"data": d, "quadro": r}

        case "get_cafe_historico":
            r = await ex.api.get("/cafe/historico", {
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                "por_pagina": 30,
            })
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"historico": itens[:30]}

        case "preparar_comanda":
            return ex._exec(
                "abrir_comanda", "post", "/pdv/comandas",
                {k: v for k, v in {
                    "tipo": a["tipo"],
                    "idmesa": a.get("idmesa"),
                    "idquarto": a.get("idquarto"),
                    "idcliente": a.get("idcliente"),
                    "idgarcom": a.get("idgarcom"),
                    "rotulo": a.get("rotulo"),
                }.items() if v is not None},
                {"tipo": a["tipo"], "mesa": a.get("idmesa"),
                 "quarto": a.get("idquarto"), "rotulo": a.get("rotulo")},
                "Comanda aberta.",
            )

        case "preparar_item_comanda":
            return ex._exec(
                "adicionar_item_comanda", "post",
                f"/pdv/comandas/{int(a['idcomanda'])}/itens",
                {"iditem": int(a["iditem"]),
                 "quantidade": int(a.get("quantidade", 1))},
                {"comanda": a["idcomanda"], "item": a["iditem"],
                 "quantidade": a.get("quantidade", 1)},
                "Item adicionado à comanda.",
            )

        case "preparar_fechar_comanda":
            corpo = {k: v for k, v in {
                "modo": a["modo"],
                "desconto": a.get("desconto"),
                "idconta_financeira": a.get("idconta_financeira"),
                "idforma_pagamento": a.get("idforma_pagamento"),
                "observacao": a.get("observacao"),
            }.items() if v is not None}
            return ex._exec(
                "fechar_comanda", "post",
                f"/pdv/comandas/{int(a['idcomanda'])}/fechar", corpo,
                {"comanda": a["idcomanda"], "modo": a["modo"],
                 "desconto": a.get("desconto")},
                "Comanda fechada.",
            )

        case "preparar_cancelar_comanda":
            return ex._exec(
                "cancelar_comanda", "post",
                f"/pdv/comandas/{int(a['idcomanda'])}/cancelar",
                {"motivo": a.get("motivo") or "cancelada via MAR IA"},
                {"comanda": a["idcomanda"], "motivo": a.get("motivo")},
                "Comanda cancelada.",
            )

        case "preparar_item_comanda_status":
            mapa = {
                "preparar": "preparar", "pronto": "pronto",
                "entregar": "entregar", "retornar": "retornar",
                "cancelar": "cancelar",
            }
            acao_item = mapa[a["acao"]]
            corpo = ({"motivo": a.get("motivo") or "via MAR IA"}
                     if acao_item == "cancelar" else {})
            return ex._exec(
                f"item_comanda_{acao_item}", "post",
                f"/pdv/comandas/{int(a['idcomanda'])}/itens/"
                f"{int(a['iditem_comanda'])}/{acao_item}", corpo,
                {"comanda": a["idcomanda"],
                 "item": a["iditem_comanda"], "acao": acao_item},
                f"Item {acao_item}.",
            )

        case "preparar_mesa":
            return ex._exec(
                "criar_mesa", "post", "/pdv/mesas",
                {k: v for k, v in {
                    "numero": a["numero"],
                    "lugares": a.get("lugares"),
                }.items() if v is not None},
                {"numero": a["numero"], "lugares": a.get("lugares")},
                f"Mesa {a['numero']} criada.",
            )

        case "preparar_presenca_cafe":
            corpo = {"idreserva": int(a["idreserva"]),
                     "quantidade": int(a["quantidade"])}
            if a.get("data"):
                corpo["data"] = _data(a["data"], tz)
            return ex._exec(
                "presenca_cafe", "post", "/cafe/presencas", corpo,
                {"reserva": a["idreserva"],
                 "quantidade": a["quantidade"],
                 "data": corpo.get("data", "hoje")},
                "Presença no café registrada.",
            )

        case "preparar_pagar_comissao":
            corpo = {"idconta_financeira": int(a["idconta_financeira"])}
            if a.get("idforma_pagamento"):
                corpo["idforma_pagamento"] = int(a["idforma_pagamento"])
            return ex._exec(
                "pagar_comissao", "post",
                f"/pdv/comissoes/{int(a['idcomissao'])}/pagar", corpo,
                {"comissao": a["idcomissao"],
                 "conta": a["idconta_financeira"]},
                "Comissão paga.",
            )

        case _:
            return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}
