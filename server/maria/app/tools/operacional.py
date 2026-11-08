"""Operacional — FNRH, documentos, impressoras, CMS, eventos e notificações.

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from .helpers import _data, _props

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_reserva_eventos",
        "description": "Calendário de reservas — entradas/saídas num período.",
        "parameters": {
            "type": "object",
            "properties": _props(inicio={"type": "string"},
                                 fim={"type": "string"}),
        },
    },
    {
        "type": "function",
        "name": "get_acompanhantes",
        "description": "Acompanhantes (criança, cônjuge) de uma reserva.",
        "parameters": {
            "type": "object",
            "properties": _props(idreserva={"type": "integer"}),
            "required": ["idreserva"],
        },
    },
    {
        "type": "function",
        "name": "get_fnrh",
        "description": "FNRHs já emitidas de uma reserva.",
        "parameters": {
            "type": "object",
            "properties": _props(idreserva={"type": "integer"}),
            "required": ["idreserva"],
        },
    },
    {
        "type": "function",
        "name": "get_documentos_cliente",
        "description": "Documentos de identidade cadastrados de um hóspede.",
        "parameters": {
            "type": "object",
            "properties": _props(idcliente={"type": "integer"}),
            "required": ["idcliente"],
        },
    },
    {
        "type": "function",
        "name": "get_comprovante_texto",
        "description": "Texto completo de um comprovante de pagamento.",
        "parameters": {
            "type": "object",
            "properties": _props(id={"type": "integer"}),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "get_funcionarios",
        "description": "Funcionários cadastrados (gerente+).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_tipos_acomodacao",
        "description": (
            "Tipos de acomodação com ids (Suíte, Chalé…) — consulte antes "
            "de criar/editar acomodação."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_categorias_estoque",
        "description": (
            "Categorias de estoque com ids — consulte antes de cadastrar item."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_impressoras",
        "description": "Impressoras de setor (KOT/cupom) e status.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_cms_acomodacoes",
        "description": "Acomodações no site/CMS com status de publicação (admin).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "ler_todas_notificacoes",
        "description": "Marca TODAS as notificações como lidas (ação segura).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "excluir_notificacao",
        "description": "Remove uma notificação do inbox (ação segura).",
        "parameters": {
            "type": "object",
            "properties": _props(id={"type": "integer"}),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "testar_impressora",
        "description": "Imprime página de teste numa impressora de setor.",
        "parameters": {
            "type": "object",
            "properties": _props(id={"type": "integer"}),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "preparar_emitir_fnrh",
        "description": (
            "Emite a FNRH de uma reserva (ficha nacional de registro de "
            "hóspedes) — motivo_viagem e placa opcionais. "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer"},
                motivo_viagem={"type": "string"},
                placa_veiculo={"type": "string"},
            ),
            "required": ["idreserva"],
        },
    },
    {
        "type": "function",
        "name": "preparar_imprimir_comprovante",
        "description": "Imprime um comprovante de pagamento. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(idcomprovante={"type": "integer"}),
            "required": ["idcomprovante"],
        },
    },
    {
        "type": "function",
        "name": "preparar_imprimir_consumo",
        "description": (
            "Imprime a ficha de consumo/produção de uma reserva (KOT). "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(idreserva={"type": "integer"}),
            "required": ["idreserva"],
        },
    },
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    """Despacha as tools deste domínio. `ex` é o ToolExecutor
    (api, ator, tz, _exec, _preparar_*).
    """
    tz = ex.tz
    match nome:
        case "get_reserva_eventos":
            r = await ex.api.get("/reservas/eventos", {
                "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
            })
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"eventos": itens[:60]}

        case "get_acompanhantes":
            r = await ex.api.get(
                f"/reservas/{int(a['idreserva'])}/acompanhantes")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"acompanhantes": itens}

        case "get_fnrh":
            r = await ex.api.get(f"/reservas/{int(a['idreserva'])}/fnrh")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"fnrns": itens}

        case "get_documentos_cliente":
            r = await ex.api.get(
                f"/clientes/{int(a['idcliente'])}/documentos")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"documentos": itens}

        case "get_comprovante_texto":
            r = await ex.api.get(
                f"/pagamentos/comprovantes/{int(a['id'])}")
            return {"comprovante": r}

        case "get_funcionarios":
            p = await ex.api.get("/funcionarios", {"por_pagina": 50})
            itens = p if isinstance(p, list) else p.get("items", [])
            return {"funcionarios": [
                {"id": x.get("id"), "nome": x.get("nome"),
                 "login": x.get("login"), "nivel": x.get("nivel"),
                 "ativo": x.get("ativo", True)}
                for x in itens
            ]}

        case "get_tipos_acomodacao":
            r = await ex.api.get("/tipos-acomodacao")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"tipos": [
                {"id": x.get("id"), "nome": x.get("nome"),
                 "ativo": x.get("ativo", True)}
                for x in itens
            ]}

        case "get_categorias_estoque":
            r = await ex.api.get("/estoque/categorias")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"categorias": [
                {"id": x.get("id"), "nome": x.get("nome"),
                 "ativo": x.get("ativo", True)}
                for x in itens
            ]}

        case "get_impressoras":
            r = await ex.api.get("/impressoras")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"impressoras": itens}

        case "get_cms_acomodacoes":
            r = await ex.api.get("/cms/acomodacoes")
            itens = r if isinstance(r, list) else r.get("items", [])
            return {"cms": [
                {"id": x.get("id"), "nome": x.get("nome"),
                 "slug": x.get("slug"),
                 "publicado": x.get("publicado"),
                 "destaque": x.get("destaque")}
                for x in itens
            ]}

        # ----- ações seguras -----
        case "ler_todas_notificacoes":
            await ex.api.post("/notificacoes/ler-todas", {})
            return {"ok": True, "mensagem": "Todas as notificações lidas."}

        case "excluir_notificacao":
            await ex.api.delete(f"/notificacoes/{int(a['id'])}")
            return {"ok": True, "mensagem": "Notificação removida."}

        case "testar_impressora":
            await ex.api.post(f"/impressoras/{int(a['id'])}/testar", {})
            return {"ok": True, "mensagem": "Teste de impressão enviado."}

        # ----- PDV / café / caixa / tesouraria — escrita -----
        case "preparar_emitir_fnrh":
            corpo = {k: v for k, v in {
                "motivo_viagem": a.get("motivo_viagem"),
                "placa_veiculo": a.get("placa_veiculo"),
            }.items() if v is not None}
            return ex._exec(
                "emitir_fnrh", "post",
                f"/reservas/{int(a['idreserva'])}/fnrh", corpo,
                {"reserva": a["idreserva"],
                 "motivo_viagem": a.get("motivo_viagem")},
                "FNRH emitida.",
            )

        case "preparar_imprimir_comprovante":
            return ex._exec(
                "imprimir_comprovante", "post",
                f"/pagamentos/comprovantes/{int(a['idcomprovante'])}/imprimir",
                {},
                {"comprovante": a["idcomprovante"]},
                "Comprovante enviado à impressora.",
            )

        case "preparar_imprimir_consumo":
            return ex._exec(
                "imprimir_consumo", "post",
                f"/reservas/{int(a['idreserva'])}/consumo/imprimir", {},
                {"reserva": a["idreserva"]},
                "Ficha de consumo enviada à impressora.",
            )

        case _:
            return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}
