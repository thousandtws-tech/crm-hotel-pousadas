"""Validação do JWT emitido pelo backend Rust.

Duas estratégias, em ordem:
1. Verificação local HS256 — rápida, quando JWT_SECRET confere com o backend.
   Claims: sub (id do funcionário), login, nome, nivel (1=admin,2=gerente,
   3=recepção), exp, iat, iss='clarituz-api'.
2. Introspecção via GET /auth/me na própria API — sempre correta, dispensa
   compartilhar o segredo (deploy com segredos diferentes por ambiente).
"""
from dataclasses import dataclass

import httpx
import jwt

from ..config import get_settings


@dataclass(frozen=True)
class Ator:
    idfuncionario: int
    login: str
    nome: str
    nivel: int

    @property
    def admin(self) -> bool:
        return self.nivel == 1

    @property
    def gerente_ou_admin(self) -> bool:
        return self.nivel <= 2


class AuthError(Exception):
    pass


def _validar_local(token: str) -> Ator:
    s = get_settings()
    claims = jwt.decode(
        token,
        s.jwt_secret,
        algorithms=["HS256"],
        issuer=s.jwt_issuer,
        options={"require": ["exp", "sub", "iss"]},
    )
    return Ator(
        idfuncionario=int(claims["sub"]),
        login=str(claims.get("login", "")),
        nome=str(claims.get("nome", "")),
        nivel=int(claims.get("nivel", 3)),
    )


async def _validar_via_api(token: str) -> Ator:
    """Introspecção: o próprio backend valida — nunca diverge dele."""
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=8) as cli:
            r = await cli.get(
                f"{s.api_base}/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as e:
        raise AuthError("API de autenticação inacessível.") from e
    if r.status_code != 200:
        raise AuthError("Token inválido ou expirado.")
    f = r.json()
    if not f.get("ativo", True):
        raise AuthError("Usuário inativo.")
    return Ator(
        idfuncionario=int(f["id"]),
        login=str(f.get("login", "")),
        nome=str(f.get("nome", "")),
        nivel=int(f.get("nivel", 3)),
    )


async def validar_token(token: str) -> Ator:
    s = get_settings()
    if s.jwt_secret:
        try:
            return _validar_local(token)
        except jwt.PyJWTError:
            pass  # segredo local pode não ser o do backend — tenta a API
    return await _validar_via_api(token)
