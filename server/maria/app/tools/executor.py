"""ToolExecutor — orquestra permissões, confirmação e roteamento
das tools para os handlers de domínio.

Parte do pacote app.tools — ver __init__.py.
"""
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any

from ..config import get_settings
from ..infra import knowledge
from ..infra.api_client import ApiError, PousadaApi
from ..infra.auth import Ator
from ..infra.state import SharedState
from .constantes import (
    _ACOES_ADMIN,
    _ACOES_RESTRITAS,
    _LEITURAS_ADMIN,
    _LEITURAS_RESTRITAS,
)
from .preparadores import Preparadores
from .registro import HANDLERS

log = logging.getLogger("maria.tools")

# Prefixos das tools de leitura — só elas entram no cache de sessão.
_READ_PREFIXES = ("get_", "listar_", "buscar_", "ver_")
# Ações preparadas expiram — defesa contra confirmar_acao tardio
# (principalmente no modo MCP, onde o dict é compartilhado entre requests).
_PENDENTE_TTL_SECS = 15 * 60


class ToolExecutor(Preparadores):
    """Executa ferramentas contra a API real com o Bearer do
    usuário. Mantém o estado das ações pendentes de confirmação.

    `pendentes` injetável: o modo MCP (stateless) compartilha um dict
    por usuário entre requests, para o fluxo preparar→confirmar funcionar
    fora da sessão WebSocket.

    `state` + `escopo`: com Redis, pendentes e cache de leituras vivem
    no estado compartilhado — a confirmação funciona em qualquer
    réplica e o cache de um usuário reaproveita entre sessões.
    `escopo` isola por usuário/canal (ex.: "7", "mcp:7").
    """

    def __init__(self, api: PousadaApi, ator: Ator,
                 embedder: "knowledge.Embedder | None" = None,
                 pendentes: dict[str, dict[str, Any]] | None = None,
                 state: SharedState | None = None,
                 escopo: str | None = None):
        self.api = api
        self.ator = ator
        self._embedder = embedder  # injetável p/ testes offline
        self.tz = get_settings().tz
        self._state = state
        self._escopo = escopo or str(ator.idfuncionario)
        # Ações preparadas aguardando confirmação (idempotentes por id).
        self._pendentes = pendentes if pendentes is not None else {}
        self._compartilhado = pendentes is not None or state is not None
        self._seq = 0
        # Cache de leituras desta sessão — (monotonic, resultado) por chave.
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    async def run(self, nome: str, args: dict[str, Any]) -> dict[str, Any]:
        if (nome in _ACOES_RESTRITAS or nome in _LEITURAS_RESTRITAS) \
                and not self.ator.gerente_ou_admin:
            return {
                "erro": "permissão insuficiente",
                "mensagem": "Essa operação exige perfil Gerente ou Administrador.",
            }
        if (nome in _ACOES_ADMIN or nome in _LEITURAS_ADMIN) \
                and not self.ator.admin:
            return {
                "erro": "permissão insuficiente",
                "mensagem": "Essa operação exige perfil Administrador.",
            }
        try:
            if nome == "confirmar_acao":
                await self._invalidar_cache()
                return await self._confirmar(args.get("idacao", ""))

            s = get_settings()
            leitura = nome.startswith(_READ_PREFIXES)
            chave = None
            if s.maria_tool_cache_enabled and leitura:
                chave = _cache_key(nome, args)
                hit = await self._cache_get(chave)
                if hit is not None:
                    log.info("tool %s — cache hit", nome)
                    return dict(hit)

            resultado = await self._dispatch(nome, args)
            if isinstance(resultado, dict) and resultado.get("status") == "preparada":
                if self._compartilhado:
                    self._podar_pendentes()
                    idacao = f"ac-{uuid.uuid4().hex[:10]}"
                else:
                    self._seq += 1
                    idacao = f"ac{self._seq}"
                await self._pend_salvar(idacao, {
                    "acao": resultado["acao"],
                    "args": dict(args),
                    "exec": resultado.get("exec"),
                    "msg": resultado.get("msg"),
                    "criado_em": time.time(),
                })
                resultado["idacao"] = idacao
                return resultado
            # leitura bem-sucedida cacheia; escrita invalida o cache todo
            if leitura:
                if chave and not (isinstance(resultado, dict)
                                  and resultado.get("erro")):
                    await self._cache_set(chave, resultado)
            else:
                await self._invalidar_cache()
            return resultado
        except ApiError as e:
            return {"erro": f"api {e.status}", "mensagem": e.detail}
        except Exception as e:  # falha interna — reporta sem stack ao modelo
            return {"erro": "interno", "mensagem": str(e)[:200]}

    def usar_state(self, state: SharedState, escopo: str) -> None:
        """Conecta o executor ao estado compartilhado — pendentes e
        cache passam a viver fora do processo (Redis)."""
        self._state = state
        self._escopo = escopo
        self._compartilhado = True

    async def pendente(self, idacao: str) -> dict[str, Any] | None:
        return await self._pend_get(idacao)

    # --------------------------------------------- cache de leituras --
    # Chaves no estado compartilhado: tc:{escopo}:{geracao}:{key} — a
    # invalidação incrementa tgen:{escopo}, então escritas tornam todas
    # as entradas antigas invisíveis de uma vez (sem scan/delete).

    async def _cache_get(self, chave: str) -> dict[str, Any] | None:
        s = get_settings()
        if self._state is not None:
            gen = await self._state.get(
                f"tgen:{self._escopo}") or 0
            return await self._state.get(
                f"tc:{self._escopo}:{gen}:{chave}")
        hit = self._cache.get(chave)
        if hit and time.monotonic() - hit[0] < s.maria_tool_cache_ttl_secs:
            return hit[1]
        return None

    async def _cache_set(self, chave: str,
                         resultado: dict[str, Any]) -> None:
        s = get_settings()
        ttl = int(max(s.maria_tool_cache_ttl_secs, 1))
        if self._state is not None:
            gen = await self._state.get(f"tgen:{self._escopo}") or 0
            await self._state.set(
                f"tc:{self._escopo}:{gen}:{chave}", resultado, ttl)
            return
        self._cache[chave] = (time.monotonic(), resultado)

    async def _invalidar_cache(self) -> None:
        if self._state is not None:
            await self._state.incr(f"tgen:{self._escopo}", 1, 3600)
        elif self._cache:
            self._cache.clear()

    # ------------------------------------------- pendentes de ação --

    async def _pend_salvar(self, idacao: str,
                           pend: dict[str, Any]) -> None:
        if self._state is not None:
            await self._state.set(
                f"pend:{self._escopo}:{idacao}", pend, _PENDENTE_TTL_SECS)
        else:
            self._pendentes[idacao] = pend

    async def _pend_get(self, idacao: str) -> dict[str, Any] | None:
        if self._state is not None:
            return await self._state.get(
                f"pend:{self._escopo}:{idacao}")
        return self._pendentes.get(idacao)

    async def _pend_pop(self, idacao: str) -> dict[str, Any] | None:
        if self._state is not None:
            chave = f"pend:{self._escopo}:{idacao}"
            pend = await self._state.get(chave)
            await self._state.delete(chave)
            return pend
        return self._pendentes.pop(idacao, None)

    def _podar_pendentes(self) -> None:
        """Modo dict: pendentes compartilhados expiram — sessões MCP
        não têm teardown. Com estado remoto, o TTL da chave resolve."""
        if self._state is not None:
            return
        agora = time.time()
        velhos = [k for k, v in self._pendentes.items()
                  if agora - v.get("criado_em", agora) > _PENDENTE_TTL_SECS]
        for k in velhos:
            self._pendentes.pop(k, None)

    async def _confirmar(self, idacao: str) -> dict[str, Any]:
        """Executa a ação preparada — único caminho de escrita real."""
        pend = await self._pend_pop(idacao)
        if not pend:
            return {
                "erro": "acao_expirada",
                "mensagem": "Ação não encontrada ou já executada.",
            }
        if pend["acao"] == "criar_reserva":
            r = await self.api.post("/reservas", {
                "idcliente": pend["args"]["idcliente"],
                "idacomodacao": pend["args"]["idacomodacao"],
                "entradaprevista": pend["args"]["entradaprevista"],
                "saidaprevista": pend["args"]["saidaprevista"],
                "quantidade_hospedes": pend["args"].get("quantidade_hospedes", 1),
                "valordiaria": pend["args"].get("valordiaria"),
            })
            return {
                "status": "executada",
                "acao": "criar_reserva",
                "resultado": r,
                "mensagem": f"Reserva criada — nº {r.get('id', r.get('idreserva', '?'))}.",
            }
        if pend["acao"] == "cancelar_reserva":
            r = await self.api.post(
                f"/reservas/{pend['args']['idreserva']}/cancelar", {}
            )
            return {
                "status": "executada",
                "acao": "cancelar_reserva",
                "resultado": r,
                "mensagem": f"Reserva {pend['args']['idreserva']} cancelada.",
            }
        if pend["acao"] == "checkin":
            agora = datetime.now(self.tz)
            r = await self.api.post(
                f"/reservas/{pend['args']['idreserva']}/check-in",
                {"data": agora.date().isoformat(), "hora": agora.strftime("%H:%M")},
            )
            return {
                "status": "executada",
                "acao": "checkin",
                "resultado": r,
                "mensagem": f"Check-in da reserva {pend['args']['idreserva']} realizado.",
            }
        if pend["acao"] == "lancar_consumo":
            r = await self.api.post(
                f"/reservas/{pend['args']['idreserva']}/itens-consumidos",
                {
                    "iditem_frigobar": pend["args"]["iditem_frigobar"],
                    "quantidade": pend["args"].get("quantidade", 1),
                },
            )
            return {
                "status": "executada",
                "acao": "lancar_consumo",
                "resultado": r,
                "mensagem": "Consumo lançado na conta.",
            }
        # Execução genérica — CRUD novo carrega o plano REST pronto.
        if pend.get("exec"):
            ex = pend["exec"]
            r = await self.api.request(ex["metodo"], ex["path"], ex.get("corpo"))
            return {
                "status": "executada",
                "acao": pend["acao"],
                "resultado": r,
                "mensagem": pend.get("msg") or "Ação executada.",
            }
        return {"erro": "acao_desconhecida", "mensagem": pend["acao"]}

    async def _dispatch(self, nome: str, a: dict[str, Any]) -> dict[str, Any]:
        """Roteia ao handler do domínio dono do nome."""
        handler = HANDLERS.get(nome)
        if handler is None:
            return {"erro": "desconhecida",
                    "mensagem": f"Ferramenta '{nome}' não existe."}
        return await handler(self, nome, a)


def _cache_key(nome: str, args: dict[str, Any]) -> str:
    """Chave determinística do cache — tool + args canônicos (ordem e
    tipos normalizados pelo json)."""
    return nome + "|" + json.dumps(args or {}, sort_keys=True,
                                   ensure_ascii=False)
