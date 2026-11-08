"""Caixa e tesouraria — lançamentos, DRE, fluxo, extrato.

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from .helpers import _data, _props

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_caixa_turnos",
        "description": (
            "Turnos de caixa — status, operador e totais. Com "
            "idconta_financeira informado, retorna o turno ABERTO daquela "
            "conta (ou null se não houver)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                status={"type": "string", "enum": ["aberto", "fechado"]},
                inicio={"type": "string"},
                fim={"type": "string"},
                idconta_financeira={"type": "integer"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_plano_contas",
        "description": "Plano de contas — classificação de receitas e despesas (gerente+).",
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={"type": "string", "enum": ["pagar", "receber"]}),
        },
    },
    {
        "type": "function",
        "name": "get_contas_financeiras",
        "description": (
            "Contas financeiras (caixa físico, bancos) com ids — consulte "
            "antes de abrir caixa, baixar título ou pagar comissão (gerente+)."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_lancamentos",
        "description": (
            "Contas a pagar/receber — filtre tipo, status, vencidos, "
            "período ou texto (gerente+)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={"type": "string", "enum": ["pagar", "receber"]},
                status={"type": "string",
                        "enum": ["aberto", "parcial", "liquidado", "cancelado"]},
                vencidos={"type": "boolean"},
                inicio={"type": "string"},
                fim={"type": "string"},
                busca={"type": "string"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_fluxo_caixa",
        "description": "Fluxo de caixa do período — entradas, saídas e saldo (gerente+).",
        "parameters": {
            "type": "object",
            "properties": _props(inicio={"type": "string"},
                                 fim={"type": "string"}),
        },
    },
    {
        "type": "function",
        "name": "get_dre",
        "description": (
            "DRE do período — receita bruta, deduções, custos, despesas "
            "operacionais e resultado (gerente+)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(inicio={"type": "string"},
                                 fim={"type": "string"}),
        },
    },
    {
        "type": "function",
        "name": "get_extrato",
        "description": "Linhas do extrato bancário para conciliação (gerente+).",
        "parameters": {
            "type": "object",
            "properties": _props(
                idconta_financeira={"type": "integer"},
                status={"type": "string",
                        "enum": ["pendente", "conciliado", "ignorado"]},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_serie_financeira",
        "description": (
            "Série temporal financeira (gerente+): recebido | por-pagamento "
            "| reservas | vendas | por-acomodacao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                serie={"type": "string",
                       "enum": ["recebido", "por-pagamento", "reservas",
                                "vendas", "por-acomodacao"]},
                inicio={"type": "string"},
                fim={"type": "string"},
            ),
            "required": ["serie"],
        },
    },
    {
        "type": "function",
        "name": "get_split_resumo",
        "description": (
            "Split payment IBS/CBS — tributos provisionados, segregados "
            "e recolhidos (gerente+)."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "preparar_abrir_caixa",
        "description": (
            "Abre turno de caixa numa conta tipo 'caixa' — exige "
            "idconta_financeira e saldo_inicial em dinheiro. "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idconta_financeira={"type": "integer"},
                saldo_inicial={"type": "number"},
                observacao={"type": "string"},
            ),
            "required": ["idconta_financeira", "saldo_inicial"],
        },
    },
    {
        "type": "function",
        "name": "preparar_movimento_caixa",
        "description": (
            "Sangria (retirada) ou suprimento (reforço) de dinheiro no "
            "turno aberto. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idturno={"type": "integer"},
                tipo={"type": "string", "enum": ["sangria", "suprimento"]},
                valor={"type": "number"},
                motivo={"type": "string"},
            ),
            "required": ["idturno", "tipo", "valor", "motivo"],
        },
    },
    {
        "type": "function",
        "name": "preparar_fechar_caixa",
        "description": (
            "Fecha o turno de caixa — exige o valor CONTADO em dinheiro "
            "na gaveta. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idturno={"type": "integer"},
                valor_contado={"type": "number"},
                observacao={"type": "string"},
            ),
            "required": ["idturno", "valor_contado"],
        },
    },
    {
        "type": "function",
        "name": "preparar_lancamento",
        "description": (
            "Cria conta a pagar ou a receber (ex.: 'lança 450 de luz pra "
            "sexta'). tipo=pagar|receber, valor, vencimento obrigatórios; "
            "parcelas divide mensalmente. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={"type": "string", "enum": ["pagar", "receber"]},
                descricao={"type": "string"},
                valor={"type": "number"},
                vencimento={"type": "string", "description": "ISO ou hoje/amanhã"},
                idplano_conta={"type": "integer"},
                idconta_financeira={"type": "integer"},
                favorecido={"type": "string"},
                parcelas={"type": "integer"},
                competencia={"type": "string"},
                observacao={"type": "string"},
                idreserva={"type": "integer"},
                idcliente={"type": "integer"},
            ),
            "required": ["tipo", "descricao", "valor", "vencimento"],
        },
    },
    {
        "type": "function",
        "name": "preparar_baixa_lancamento",
        "description": (
            "Baixa (paga/recebe) um título — exige idconta_financeira e "
            "valor; parcial deixa o resto em aberto. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idlancamento={"type": "integer"},
                idconta_financeira={"type": "integer"},
                valor={"type": "number"},
                data={"type": "string"},
                idforma_pagamento={"type": "integer"},
                observacao={"type": "string"},
            ),
            "required": ["idlancamento", "idconta_financeira", "valor"],
        },
    },
    {
        "type": "function",
        "name": "preparar_cancelar_lancamento",
        "description": "Cancela um título a pagar/receber. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(idlancamento={"type": "integer"}),
            "required": ["idlancamento"],
        },
    },
    {
        "type": "function",
        "name": "preparar_plano_conta",
        "description": (
            "Cria conta no plano de contas — codigo, nome, tipo "
            "(pagar|receber) e grupo_dre (receita_bruta|deducoes|custos|"
            "despesas_operacionais|resultado_financeiro|outras). "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                codigo={"type": "string"},
                nome={"type": "string"},
                tipo={"type": "string", "enum": ["pagar", "receber"]},
                grupo_dre={"type": "string",
                           "enum": ["receita_bruta", "deducoes", "custos",
                                    "despesas_operacionais",
                                    "resultado_financeiro", "outras"]},
            ),
            "required": ["codigo", "nome", "tipo", "grupo_dre"],
        },
    },
    {
        "type": "function",
        "name": "preparar_conta_financeira",
        "description": (
            "Cria ou atualiza conta financeira — tipo caixa|banco|"
            "aplicacao; criar exige nome e tipo. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                nome={"type": "string"},
                tipo={"type": "string",
                      "enum": ["caixa", "banco", "aplicacao"]},
                banco={"type": "string"},
                agencia={"type": "string"},
                conta={"type": "string"},
                saldo_inicial={"type": "number"},
                saldo_inicial_em={"type": "string"},
            ),
            "required": ["acao"],
        },
    },
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    """Despacha as tools deste domínio. `ex` é o ToolExecutor
    (api, ator, tz, _exec, _preparar_*).
    """
    tz = ex.tz
    match nome:
        case "get_caixa_turnos":
            if a.get("idconta_financeira"):
                r = await ex.api.get("/financeiro/caixa/aberto", {
                    "idconta_financeira": int(a["idconta_financeira"])})
                return {"turno_aberto": r}
            p = await ex.api.get("/financeiro/caixa/turnos", {
                "status": a.get("status"),
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                "por_pagina": 20,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"total": p.get("total", len(itens)),
                    "turnos": itens[:20]}

        case "get_plano_contas":
            r = await ex.api.get("/financeiro/plano-contas", {
                "tipo": a.get("tipo"), "todas": True})
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"plano_contas": itens[:80]}

        case "get_contas_financeiras":
            r = await ex.api.get("/financeiro/contas", {"todas": True})
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"contas": itens}

        case "get_lancamentos":
            p = await ex.api.get("/financeiro/lancamentos", {
                "tipo": a.get("tipo"), "status": a.get("status"),
                "vencidos": a.get("vencidos"),
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                "busca": a.get("busca"), "por_pagina": 30,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"total": p.get("total", len(itens)),
                    "lancamentos": itens[:30]}

        case "get_fluxo_caixa":
            return {"fluxo_caixa": await ex.api.get(
                "/financeiro/fluxo-caixa", {
                    "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                    "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                })}

        case "get_dre":
            return {"dre": await ex.api.get("/financeiro/dre", {
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
            })}

        case "get_extrato":
            p = await ex.api.get("/financeiro/extrato", {
                "idconta_financeira": a.get("idconta_financeira"),
                "status": a.get("status"), "por_pagina": 30,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"total": p.get("total", len(itens)),
                    "extrato": itens[:30]}

        case "get_serie_financeira":
            r = await ex.api.get(
                f"/financeiro/series/{a['serie']}", {
                    "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                    "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                })
            return {"serie": a["serie"], "dados": r}

        case "get_split_resumo":
            return {"split": await ex.api.get("/financeiro/split/resumo")}

        case "preparar_abrir_caixa":
            return ex._exec(
                "abrir_caixa", "post", "/financeiro/caixa/turnos",
                {k: v for k, v in {
                    "idconta_financeira": int(a["idconta_financeira"]),
                    "saldo_inicial": a["saldo_inicial"],
                    "observacao": a.get("observacao"),
                }.items() if v is not None},
                {"conta": a["idconta_financeira"],
                 "saldo_inicial": a["saldo_inicial"]},
                "Caixa aberto.",
            )

        case "preparar_movimento_caixa":
            return ex._exec(
                "movimento_caixa", "post",
                f"/financeiro/caixa/turnos/{int(a['idturno'])}/movimentos",
                {"tipo": a["tipo"], "valor": a["valor"],
                 "motivo": a["motivo"]},
                {"turno": a["idturno"], "tipo": a["tipo"],
                 "valor": a["valor"], "motivo": a["motivo"]},
                f"{a['tipo'].capitalize()} de R$ {a['valor']} registrada.",
            )

        case "preparar_fechar_caixa":
            return ex._exec(
                "fechar_caixa", "post",
                f"/financeiro/caixa/turnos/{int(a['idturno'])}/fechar",
                {k: v for k, v in {
                    "valor_contado": a["valor_contado"],
                    "observacao": a.get("observacao"),
                }.items() if v is not None},
                {"turno": a["idturno"],
                 "valor_contado": a["valor_contado"]},
                "Caixa fechado.",
            )

        case "preparar_lancamento":
            corpo = {k: v for k, v in {
                "tipo": a["tipo"], "descricao": a["descricao"],
                "valor": a["valor"],
                "vencimento": _data(a["vencimento"], tz),
                "idplano_conta": a.get("idplano_conta"),
                "idconta_financeira": a.get("idconta_financeira"),
                "favorecido": a.get("favorecido"),
                "parcelas": a.get("parcelas"),
                "competencia": _data(a["competencia"], tz) if a.get("competencia") else None,
                "observacao": a.get("observacao"),
                "idreserva": a.get("idreserva"),
                "idcliente": a.get("idcliente"),
            }.items() if v is not None}
            return ex._exec(
                "criar_lancamento", "post", "/financeiro/lancamentos", corpo,
                {"tipo": a["tipo"], "descricao": a["descricao"],
                 "valor": a["valor"], "vencimento": corpo["vencimento"],
                 "parcelas": a.get("parcelas", 1)},
                f"Conta a {a['tipo']} de R$ {a['valor']} lançada.",
            )

        case "preparar_baixa_lancamento":
            corpo = {k: v for k, v in {
                "idconta_financeira": int(a["idconta_financeira"]),
                "valor": a["valor"],
                "data": _data(a["data"], tz) if a.get("data") else None,
                "idforma_pagamento": a.get("idforma_pagamento"),
                "observacao": a.get("observacao"),
            }.items() if v is not None}
            return ex._exec(
                "baixar_lancamento", "post",
                f"/financeiro/lancamentos/{int(a['idlancamento'])}/baixar",
                corpo,
                {"lancamento": a["idlancamento"], "valor": a["valor"],
                 "conta": a["idconta_financeira"]},
                f"Baixa de R$ {a['valor']} registrada.",
            )

        case "preparar_cancelar_lancamento":
            return ex._exec(
                "cancelar_lancamento", "post",
                f"/financeiro/lancamentos/{int(a['idlancamento'])}/cancelar",
                {},
                {"lancamento": a["idlancamento"]},
                "Lançamento cancelado.",
            )

        case "preparar_plano_conta":
            return ex._exec(
                "criar_plano_conta", "post", "/financeiro/plano-contas",
                {"codigo": a["codigo"], "nome": a["nome"],
                 "tipo": a["tipo"], "grupo_dre": a["grupo_dre"]},
                {"codigo": a["codigo"], "nome": a["nome"],
                 "tipo": a["tipo"], "grupo_dre": a["grupo_dre"]},
                f"Conta {a['nome']} criada no plano.",
            )

        case "preparar_conta_financeira":
            return await ex._preparar_conta_financeira(a)

        case _:
            return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}
