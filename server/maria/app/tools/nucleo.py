"""Leituras do sistema e compras — reservas, hóspedes, acomodações, estoque, fornecedores e pedidos.

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from .helpers import _data, _props, _resumo

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_reservas",
        "description": (
            "Lista reservas do sistema. Filtre por período (inicio/fim ISO), "
            "status (pendente, hospedado, finalizado, cancelada) ou busca "
            "livre (nome do hóspede, nº da reserva ou acomodação)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Data inicial ISO (yyyy-mm-dd)"},
                fim={"type": "string", "description": "Data final ISO"},
                status={
                    "type": "string",
                    "enum": ["pendente", "hospedado", "finalizado", "cancelada"],
                },
                busca={"type": "string", "description": "Texto livre (hóspede, nº, acomodação)"},
                porPagina={"type": "integer", "default": 20},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_reserva_detalhe",
        "description": "Detalhe completo de uma reserva pelo número (id).",
        "parameters": {
            "type": "object",
            "properties": _props(id={"type": "integer", "description": "Número da reserva"}),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "check_disponibilidade",
        "description": (
            "Consulta acomodações disponíveis para um período — use antes de "
            "criar ou sugerir reservas."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Entrada prevista ISO"},
                fim={"type": "string", "description": "Saída prevista ISO"},
            ),
            "required": ["inicio", "fim"],
        },
    },
    {
        "type": "function",
        "name": "get_hospedes_atuais",
        "description": "Hóspedes atualmente hospedados (reservas em curso).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_checkins",
        "description": "Check-ins previstos ou já realizados numa data (padrão: hoje).",
        "parameters": {
            "type": "object",
            "properties": _props(
                data={"type": "string", "description": "Data ISO ou 'hoje'/'amanhã'"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_checkouts",
        "description": "Check-outs previstos ou já realizados numa data (padrão: hoje).",
        "parameters": {
            "type": "object",
            "properties": _props(
                data={"type": "string", "description": "Data ISO ou 'hoje'/'amanhã'"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_situacao_quartos",
        "description": (
            "Situação das acomodações agora: ocupadas, disponíveis e total — "
            "com a taxa de ocupação atual."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_acomodacoes",
        "description": "Lista acomodações ativas com diária, capacidade e tipo.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_clientes",
        "description": "Busca hóspedes cadastrados pelo nome, CPF ou e-mail.",
        "parameters": {
            "type": "object",
            "properties": _props(
                busca={"type": "string", "description": "Nome, CPF ou e-mail"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_financeiro_resumo",
        "description": (
            "Resumo financeiro do período: recebido, previsto, descontos e "
            "contas fechadas."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Data inicial ISO"},
                fim={"type": "string", "description": "Data final ISO"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_dashboard",
        "description": (
            "Painel do dia: ocupação, chegadas/saídas de hoje, pendências e "
            "últimas reservas — use para 'como está a pousada hoje?'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_quartos",
        "description": (
            "Lista os quartos físicos de uma acomodação com status — acha "
            "unidade bloqueada/em manutenção."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idacomodacao={"type": "integer", "description": "ID da acomodação"},
            ),
            "required": ["idacomodacao"],
        },
    },
    {
        "type": "function",
        "name": "get_estoque",
        "description": (
            "Itens do estoque com quantidade e mínimo — descobre o que está "
            "acabando (use critico=true para só os abaixo do mínimo)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                busca={"type": "string", "description": "Nome do item"},
                critico={"type": "boolean", "description": "Só itens abaixo do mínimo"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_movimentacoes_estoque",
        "description": "Últimas movimentações de estoque (entradas/saídas).",
        "parameters": {
            "type": "object",
            "properties": _props(
                limite={"type": "integer", "default": 15},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_frigobares",
        "description": "Frigobares cadastrados, suas acomodações e itens.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_itens_frigobar",
        "description": "Itens (produtos e quantidades) de um frigobar.",
        "parameters": {
            "type": "object",
            "properties": _props(
                idfrigobar={"type": "integer"},
            ),
            "required": ["idfrigobar"],
        },
    },
    {
        "type": "function",
        "name": "get_estacionamento",
        "description": "Vagas de estacionamento — livres/ocupadas/vinculadas.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_comprovantes",
        "description": "Comprovantes de pagamento emitidos (contas fechadas).",
        "parameters": {
            "type": "object",
            "properties": _props(
                busca={"type": "string", "description": "Hóspede, reserva ou acomodação"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_formas_pagamento",
        "description": "Formas de pagamento aceitas pela pousada.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_notificacoes",
        "description": "Notificações operacionais recentes do sistema.",
        "parameters": {
            "type": "object",
            "properties": _props(
                limite={"type": "integer", "default": 10},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_auditoria",
        "description": "Últimas ações registradas na auditoria (admin).",
        "parameters": {
            "type": "object",
            "properties": _props(
                limite={"type": "integer", "default": 15},
            ),
        },
    },
    {
        "type": "function",
        "name": "busca_global",
        "description": (
            "Busca global do sistema — acha reserva, cliente, acomodação, "
            "item de estoque ou funcionário por texto livre."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                q={"type": "string", "description": "Texto da busca"},
            ),
            "required": ["q"],
        },
    },
    {
        "type": "function",
        "name": "get_estabelecimento",
        "description": "Dados cadastrais e endereço da pousada.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_itens_mais_vendidos",
        "description": "Ranking de itens mais vendidos do período.",
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Data inicial ISO"},
                fim={"type": "string", "description": "Data final ISO"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_fornecedores",
        "description": "Lista fornecedores cadastrados (nome, lead time, contato).",
        "parameters": {"type": "object", "properties": _props(
            apenas_ativos={"type": "boolean"})},
    },
    {
        "type": "function",
        "name": "get_pedidos_compra",
        "description": "Lista pedidos de compra (status, fornecedor, previsao, progresso).",
        "parameters": {"type": "object", "properties": _props(
            status={"type": "string", "enum": ["pendente", "parcial", "recebido", "cancelado"]})},
    },
    {
        "type": "function",
        "name": "sugerir_compras",
        "description": (
            "Itens com estoque no minimo ou abaixo — base para sugerir "
            "pedidos de compra ao usuario."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "preparar_pedido_compra",
        "description": (
            "Cria pedido de compra para um fornecedor — aprovado, gera "
            "tambem a conta a pagar (data prevista = hoje + lead time). "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idfornecedor={"type": "integer"},
                itens={"type": "array", "items": {
                    "type": "object",
                    "properties": _props(
                        iditem={"type": "integer"},
                        quantidade={"type": "integer"},
                        valor_unit={"type": "number"}),
                    "required": ["iditem", "quantidade"],
                }},
                vencimento={"type": "string"},
                observacao={"type": "string"},
                gerar_pagamento={"type": "boolean"}),
            "required": ["idfornecedor", "itens"],
        },
    },
    {
        "type": "function",
        "name": "preparar_fornecedor",
        "description": "Cadastra fornecedor (nome obrigatório). Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                nome={"type": "string"},
                cnpj={"type": "string"},
                contato={"type": "string"},
                telefone={"type": "string"},
                lead_time_dias={"type": "integer"},
            ),
            "required": ["nome"],
        },
    },
    {
        "type": "function",
        "name": "preparar_receber_pedido",
        "description": (
            "Confirma recebimento de um pedido de compra — itens com "
            "quantidade recebida (entrada no estoque). Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idpedido={"type": "integer"},
                itens={"type": "array", "items": {
                    "type": "object",
                    "properties": _props(
                        iditem={"type": "integer"},
                        quantidade={"type": "integer"}),
                    "required": ["iditem", "quantidade"],
                }},
            ),
            "required": ["idpedido", "itens"],
        },
    },
    {
        "type": "function",
        "name": "preparar_cancelar_pedido",
        "description": "Cancela um pedido de compra. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(idpedido={"type": "integer"}),
            "required": ["idpedido"],
        },
    },
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    """Despacha as tools deste domínio. `ex` é o ToolExecutor
    (api, ator, tz, _exec, _preparar_*).
    """
    tz = ex.tz
    match nome:
        case "get_reservas":
            p = await ex.api.get("/reservas", {
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                "status": a.get("status"),
                "busca": a.get("busca"),
                "por_pagina": min(int(a.get("porPagina") or 20), 50),
            })
            return {
                "total": p.get("total", 0),
                "reservas": [_resumo(r) for r in p.get("items", [])[:25]],
            }

        case "get_reserva_detalhe":
            r = await ex.api.get(f"/reservas/{int(a['id'])}")
            return {"reserva": r}

        case "check_disponibilidade":
            ini = _data(a["inicio"], tz)
            fim = _data(a["fim"], tz)
            p = await ex.api.get("/reservas/disponibilidade", {
                "inicio": ini, "fim": fim,
            })
            return {
                "periodo": {"inicio": ini, "fim": fim},
                "disponibilidade": p,
            }

        case "get_hospedes_atuais":
            p = await ex.api.get("/reservas", {
                "status": "hospedado", "por_pagina": 50,
            })
            return {
                "total": p.get("total", 0),
                "hospedes": [_resumo(r) for r in p.get("items", [])],
            }

        case "get_checkins":
            d = _data(a.get("data"), tz)
            p = await ex.api.get("/reservas", {
                "inicio": d, "fim": d, "por_pagina": 50,
            })
            return {
                "data": d,
                "total": p.get("total", 0),
                "chegadas": [_resumo(r) for r in p.get("items", [])],
            }

        case "get_checkouts":
            d = _data(a.get("data"), tz)
            # saída prevista = fim do período
            p = await ex.api.get("/reservas", {
                "fim": d, "por_pagina": 50,
            })
            saidas = [
                r for r in p.get("items", [])
                if str(r.get("saidaprevista", "")).startswith(d)
            ]
            return {"data": d, "total": len(saidas), "saidas": [_resumo(r) for r in saidas]}

        case "get_situacao_quartos":
            d = await ex.api.get("/dashboard")
            c = d.get("cards", {})
            total = c.get("total_acomodacoes", 0)
            ocupadas = c.get("acomodacoes_ocupadas", 0)
            return {
                "total_acomodacoes": total,
                "ocupadas": ocupadas,
                "disponiveis": c.get("acomodacoes_disponiveis", 0),
                "hospedes_atuais": c.get("hospedes_atuais", 0),
                "ocupacao_pct": round(ocupadas * 100 / total) if total else 0,
                "nomes_disponiveis": [
                    a.get("nome") for a in d.get("acomodacoes_disponiveis", [])
                ],
                "nomes_ocupadas": [
                    a.get("nome") for a in d.get("acomodacoes_ocupadas", [])
                ],
            }

        case "get_acomodacoes":
            p = await ex.api.get("/acomodacoes")
            itens = p if isinstance(p, list) else p.get("items", [])
            return {
                "acomodacoes": [
                    {
                        "id": x.get("id"),
                        "nome": x.get("nome"),
                        "numero": x.get("numero"),
                        "capacidade": x.get("capacidade"),
                        "valordiaria": x.get("valordiaria"),
                        "tipo": (x.get("tipo") or {}).get("nome") or x.get("tipo_nome"),
                        "ativa": x.get("ativo", True),
                    }
                    for x in itens
                    if x.get("ativo", True)
                ]
            }

        case "get_clientes":
            p = await ex.api.get("/clientes", {
                "busca": a.get("busca"), "por_pagina": 10,
            })
            return {
                "total": p.get("total", 0),
                "clientes": [
                    {
                        "id": c.get("id"),
                        "nome": c.get("nome"),
                        "cpf": c.get("cpf"),
                        "cidade": c.get("cidade"),
                    }
                    for c in p.get("items", [])
                ],
            }

        case "get_financeiro_resumo":
            ini = _data(a.get("inicio"), tz) if a.get("inicio") else None
            fim = _data(a.get("fim"), tz) if a.get("fim") else None
            return await ex.api.get("/financeiro/resumo", {
                "inicio": ini, "fim": fim,
            })

        case "get_dashboard":
            return await ex.api.get("/dashboard")

        case "get_quartos":
            q = await ex.api.get(f"/acomodacoes/{int(a['idacomodacao'])}/quartos")
            itens = q if isinstance(q, list) else q.get("items", q.get("quartos", []))
            return {
                "quartos": [
                    {
                        "id": x.get("id"),
                        "numero": x.get("numero"),
                        "nome": x.get("nome"),
                        "status": x.get("status"),
                        "ativo": x.get("ativo", True),
                    }
                    for x in itens
                ]
            }

        case "get_fornecedores":
            r = await ex.api.get("/compras/fornecedores", {
                "apenas_ativos": a.get("apenas_ativos", True)})
            return {"fornecedores": r}

        case "get_pedidos_compra":
            r = await ex.api.get("/compras/pedidos", {
                "status": a.get("status"), "por_pagina": 50})
            return {"total": r.get("total", 0),
                    "pedidos": r.get("items", [])}

        case "sugerir_compras":
            r = await ex.api.get("/estoque/alertas")
            return {"itens_em_falta": r,
                    "dica": "Sugira pedido de compra com preparar_pedido_compra."}

        case "preparar_pedido_compra":
            return await ex._preparar_pedido_compra(a)

        case "get_estoque":
            p = await ex.api.get("/estoque/itens", {
                "busca": a.get("busca"), "por_pagina": 50,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            saida = [
                {
                    "id": x.get("id"),
                    "nome": x.get("nome"),
                    "quantidade": x.get("quantidade"),
                    "minimo": x.get("minimo") or x.get("estoque_minimo"),
                    "unidade": x.get("unidade"),
                    "categoria": (x.get("categoria") or {}).get("nome")
                        or x.get("categoria_nome"),
                    "preco": x.get("preco") or x.get("valor"),
                }
                for x in itens
                if x.get("ativo", True)
            ]
            if a.get("critico"):
                saida = [
                    x for x in saida
                    if x["minimo"] is not None
                    and x["quantidade"] is not None
                    and x["quantidade"] <= x["minimo"]
                ]
            return {"total": len(saida), "itens": saida}

        case "get_movimentacoes_estoque":
            p = await ex.api.get("/estoque/movimentacoes", {
                "por_pagina": min(int(a.get("limite") or 15), 30),
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"movimentacoes": itens[:30]}

        case "get_frigobares":
            p = await ex.api.get("/frigobares")
            itens = p if isinstance(p, list) else p.get("items", [])
            return {
                "frigobares": [
                    {
                        "id": x.get("id"),
                        "nome": x.get("nome") or x.get("identificacao"),
                        "acomodacao": x.get("acomodacao_nome"),
                        "ativo": x.get("ativo", True),
                        "itens": x.get("total_itens"),
                    }
                    for x in itens
                ]
            }

        case "get_itens_frigobar":
            p = await ex.api.get(f"/frigobares/{int(a['idfrigobar'])}/itens")
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"itens": itens}

        case "get_estacionamento":
            p = await ex.api.get("/estacionamento")
            itens = p if isinstance(p, list) else p.get("items", [])
            vagas = [
                {
                    "id": x.get("id"),
                    "codigo": x.get("codigo") or x.get("numero"),
                    "status": x.get("status"),
                    "idreserva": x.get("idreserva"),
                }
                for x in itens
            ]
            return {
                "total": len(vagas),
                "livres": sum(1 for v in vagas if str(v["status"]).lower() in ("livre", "disponivel", "disponível")),
                "vagas": vagas,
            }

        case "get_comprovantes":
            p = await ex.api.get("/pagamentos/comprovantes", {
                "busca": a.get("busca"), "por_pagina": 20,
            })
            itens = p if isinstance(p, list) else p.get("items", [])
            return {
                "total": p.get("total", len(itens)),
                "comprovantes": [
                    {
                        "id": x.get("id"),
                        "reserva": x.get("idreserva"),
                        "hospede": x.get("cliente_nome"),
                        "total": x.get("valor_total") or x.get("total"),
                        "emitido_em": x.get("emitido_em") or x.get("criado_em"),
                    }
                    for x in itens
                ],
            }

        case "get_formas_pagamento":
            p = await ex.api.get("/formas-pagamento")
            itens = p if isinstance(p, list) else p.get("items", [])
            return {
                "formas": [
                    {"id": x.get("id"), "nome": x.get("nome"), "ativa": x.get("ativo", True)}
                    for x in itens
                ]
            }

        case "get_notificacoes":
            p = await ex.api.get("/notificacoes", {
                "por_pagina": min(int(a.get("limite") or 10), 30),
            })
            itens = p if isinstance(p, list) else (p.get("items") or p.get("notificacoes") or [])
            return {
                "notificacoes": [
                    {
                        "titulo": x.get("titulo"),
                        "mensagem": x.get("mensagem"),
                        "tipo": x.get("tipo"),
                        "lida": x.get("lida"),
                        "criado_em": x.get("criado_em"),
                    }
                    for x in itens[:30]
                ]
            }

        case "get_auditoria":
            if not ex.ator.admin:
                return {
                    "erro": "permissão insuficiente",
                    "mensagem": "Auditoria exige perfil Administrador.",
                }
            p = await ex.api.get("/auditoria/logs", {
                "por_pagina": min(int(a.get("limite") or 15), 30),
            })
            itens = p if isinstance(p, list) else (p.get("items") or p.get("logs") or [])
            return {"logs": itens[:30]}

        case "busca_global":
            r = await ex.api.get("/busca", {"q": a.get("q")})
            itens = r if isinstance(r, list) else r.get("items", [])
            return {
                "resultados": [
                    {
                        "tipo": x.get("tipo"),
                        "id": x.get("id"),
                        "titulo": x.get("titulo"),
                        "sub": x.get("sub"),
                    }
                    for x in itens[:15]
                ]
            }

        case "get_estabelecimento":
            est = await ex.api.get("/estabelecimento")
            end = await ex.api.get("/estabelecimento/endereco")
            return {"estabelecimento": est, "endereco": end}

        case "get_itens_mais_vendidos":
            ini = _data(a.get("inicio"), tz) if a.get("inicio") else None
            fim = _data(a.get("fim"), tz) if a.get("fim") else None
            return await ex.api.get("/financeiro/itens-mais-vendidos", {
                "inicio": ini, "fim": fim,
            })

        case "preparar_fornecedor":
            corpo = {k: v for k, v in {
                "nome": a["nome"], "cnpj": a.get("cnpj"),
                "contato": a.get("contato"),
                "telefone": a.get("telefone"),
                "lead_time_dias": a.get("lead_time_dias"),
            }.items() if v is not None}
            return ex._exec(
                "criar_fornecedor", "post", "/compras/fornecedores", corpo,
                {"nome": a["nome"], "cnpj": a.get("cnpj"),
                 "lead_time": a.get("lead_time_dias")},
                f"Fornecedor {a['nome']} cadastrado.",
            )

        case "preparar_receber_pedido":
            corpo = {"itens": [
                {"iditem": int(i["iditem"]),
                 "quantidade": int(i["quantidade"])}
                for i in a["itens"]
            ]}
            return ex._exec(
                "receber_pedido", "post",
                f"/compras/pedidos/{int(a['idpedido'])}/receber", corpo,
                {"pedido": a["idpedido"], "itens": len(corpo["itens"])},
                "Recebimento registrado — estoque atualizado.",
            )

        case "preparar_cancelar_pedido":
            return ex._exec(
                "cancelar_pedido", "post",
                f"/compras/pedidos/{int(a['idpedido'])}/cancelar", {},
                {"pedido": a["idpedido"]},
                "Pedido de compra cancelado.",
            )

        case _:
            return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}
