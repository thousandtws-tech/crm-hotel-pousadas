"""Servidor MCP (Model Context Protocol) — expõe as tools da MAR IA
para qualquer cliente MCP (Claude, IDEs, outros agentes).

Transporte: Streamable HTTP **stateless** — `POST /mcp` com uma mensagem
JSON-RPC 2.0 (ou um batch) recebe `application/json` de volta. Sem sessão
de servidor: cada request carrega o JWT do funcionário no header
`Authorization: Bearer …`, validado como no WebSocket de voz. As tools
executam com as permissões daquele usuário — o RBAC do backend vale
igual em qualquer cliente.

preparar→confirmar em modo stateless: ações preparadas ficam num store
em memória chaveado por funcionário (podas por TTL em
`tools/executor.py`), porque requests independentes precisam enxergar o
mesmo conjunto de pendências. O `idacao` volta no resultado e o cliente
confirma com `confirmar_acao`.
"""
import json
import logging
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .infra.api_client import PousadaApi
from .infra.auth import AuthError, validar_token
from .tools import TOOLS, ToolExecutor

log = logging.getLogger("maria.mcp")

router = APIRouter(tags=["mcp"])

PROTOCOLO = "2025-06-18"
SERVIDOR = {"name": "maria-mcp", "version": "1.0.0", "title": "MAR IA — Pousada Espírito do Mar"}
INSTRUCOES = (
    "Assistente operacional da Pousada Espírito do Mar. Tools de leitura "
    "respondem dados ao vivo do sistema (reservas, hóspedes, PDV, caixa, "
    "financeiro). Toda escrita usa uma tool preparar_* e só executa com "
    "confirmar_acao — apresente o resumo ao usuário antes de confirmar."
)

# Pendências compartilhadas por funcionário — chave: idfuncionario.
_PENDENTES: dict[int, dict[str, dict[str, Any]]] = {}


def _pendentes_usuario(idfuncionario: int) -> dict[str, dict[str, Any]]:
    return _PENDENTES.setdefault(idfuncionario, {})


def _erro_rpc(rid: Any, code: int, msg: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid,
            "error": {"code": code, "message": msg}}


def _tools_mcp() -> list[dict[str, Any]]:
    """Schemas OpenAI (type=function/parameters) → formato MCP
    (inputSchema)."""
    return [
        {
            "name": t["name"],
            "description": t.get("description", ""),
            "inputSchema": t.get("parameters", {"type": "object"}),
        }
        for t in TOOLS
    ]


async def _handle(msg: dict[str, Any], ator_token: tuple[Any, str]) -> dict[str, Any] | None:
    """Uma mensagem JSON-RPC → resposta (None para notificações)."""
    ator, token = ator_token
    rid = msg.get("id")
    metodo = msg.get("method")
    params = msg.get("params") or {}

    if metodo == "initialize":
        return _resultado(rid, {
            "protocolVersion": params.get("protocolVersion") or PROTOCOLO,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVIDOR,
            "instructions": INSTRUCOES,
        })
    if metodo == "ping":
        return _resultado(rid, {})
    if metodo and metodo.startswith("notifications/"):
        return None  # notificações não têm resposta

    if metodo == "tools/list":
        return _resultado(rid, {"tools": _tools_mcp()})

    if metodo == "tools/call":
        nome = params.get("name") or ""
        args = params.get("arguments") or {}
        if not nome:
            return _erro_rpc(rid, -32602, "params.name ausente")
        api = PousadaApi(token)
        try:
            exec_ = ToolExecutor(
                api, ator, pendentes=_pendentes_usuario(ator.idfuncionario))
            resultado = await exec_.run(nome, args)
        finally:
            await api.close()
        erro = isinstance(resultado, dict) and bool(resultado.get("erro"))
        return _resultado(rid, {
            "content": [{
                "type": "text",
                "text": json.dumps(resultado, ensure_ascii=False),
            }],
            **({"isError": True} if erro else {}),
        })

    if rid is None:
        return None
    return _erro_rpc(rid, -32601, f"Método desconhecido: {metodo}")


def _resultado(rid: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


@router.post("/mcp")
async def mcp_post(request: Request) -> Response:
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        return JSONResponse({"error": "Bearer token ausente"}, status_code=401)
    try:
        ator = await validar_token(token)
    except AuthError as e:
        return JSONResponse({"error": str(e)}, status_code=401)

    try:
        corpo = await request.json()
    except Exception:
        return JSONResponse(_erro_rpc(None, -32700, "JSON inválido"),
                            status_code=400)

    ator_token = (ator, token)
    if isinstance(corpo, list):
        respostas = [r for r in
                     [await _handle(m, ator_token) for m in corpo]
                     if r is not None]
        if not respostas:
            return Response(status_code=202)
        return JSONResponse(respostas)
    if not isinstance(corpo, dict):
        return JSONResponse(_erro_rpc(None, -32600,
                                    "Request deve ser objeto ou batch"),
                            status_code=400)

    resp = await _handle(corpo, ator_token)
    if resp is None:
        return Response(status_code=202)
    return JSONResponse(resp)


@router.get("/mcp")
async def mcp_get() -> Response:
    """SSE de servidor não existe no modo stateless — 405 explícito."""
    return JSONResponse(
        {"error": "Servidor stateless — use POST /mcp."}, status_code=405)


@router.delete("/mcp")
async def mcp_delete() -> Response:
    return Response(status_code=200)
