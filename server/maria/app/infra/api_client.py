"""Cliente HTTP da API do sistema — cada chamada usa o Bearer do usuário,
mantendo as regras de autorização (nível) aplicadas pelo backend Rust.

Resiliência: timeout de 12s em toda chamada e 1 retry com backoff só em
GET (idempotente) — writes nunca retentam, senão uma falha de rede
poderia duplicar reservas/lançamentos.
"""
import asyncio
from typing import Any

import httpx

from ..config import get_settings

_RETRY_STATUS = {502, 503, 504}


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class PousadaApi:
    def __init__(self, token: str):
        s = get_settings()
        self._client = httpx.AsyncClient(
            base_url=s.api_base,
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(12.0),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        params = _limpa(params or {})
        for tentativa in range(2):
            try:
                r = await self._client.get(path, params=params)
            except httpx.TransportError:
                if tentativa == 0:
                    await asyncio.sleep(0.25)
                    continue
                raise
            if r.status_code not in _RETRY_STATUS or tentativa == 1:
                return self._ok(r)
            await asyncio.sleep(0.25)
        raise AssertionError("inalcançável")

    async def post(self, path: str, body: Any = None) -> Any:
        r = await self._client.post(path, json=body)
        return self._ok(r)

    async def put(self, path: str, body: Any = None) -> Any:
        r = await self._client.put(path, json=body)
        return self._ok(r)

    async def patch(self, path: str, body: Any = None) -> Any:
        r = await self._client.patch(path, json=body)
        return self._ok(r)

    async def delete(self, path: str) -> Any:
        r = await self._client.delete(path)
        return self._ok(r)

    async def request(self, metodo: str, path: str, body: Any = None) -> Any:
        m = metodo.lower()
        if m == "get":
            return await self.get(path)
        if m == "post":
            return await self.post(path, body)
        if m == "put":
            return await self.put(path, body)
        if m == "patch":
            return await self.patch(path, body)
        if m == "delete":
            return await self.delete(path)
        raise ValueError(f"método inválido: {metodo}")

    @staticmethod
    def _ok(r: httpx.Response) -> Any:
        if r.status_code >= 400:
            try:
                detail = r.json().get("mensagem") or r.json().get("message") or r.text[:200]
            except Exception:
                detail = r.text[:200] or f"HTTP {r.status_code}"
            raise ApiError(r.status_code, detail)
        if r.status_code == 204 or not r.content:
            return {"ok": True}
        return r.json()


def _limpa(params: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in params.items() if v is not None}
