"""Helpers compartilhados das ferramentas — datas locais e
formatação. Sem estado, sem I/O.
"""
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo


def _hoje(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def _data(arg: str | None, tz: ZoneInfo) -> str:
    """'hoje'/'amanha'/None → ISO local; senão devolve como veio."""
    if not arg:
        return _hoje(tz).isoformat()
    t = arg.strip().lower()
    base = _hoje(tz)
    if t in ("hoje",):
        return base.isoformat()
    if t in ("amanha", "amanhã"):
        return (base + timedelta(days=1)).isoformat()
    if t in ("depois de amanha", "depois de amanhã"):
        return (base + timedelta(days=2)).isoformat()
    return arg  # ISO vindo do modelo



def _props(**kv: Any) -> dict[str, Any]:
    return kv




def _resumo(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id"),
        "hospede": r.get("cliente_nome"),
        "acomodacao": r.get("acomodacao_nome"),
        "numero": r.get("acomodacao_numero"),
        "entrada": r.get("entradaprevista"),
        "saida": r.get("saidaprevista"),
        "status": r.get("status"),
        "hospedes": r.get("quantidade_hospedes"),
        "diaria": r.get("valordiaria"),
        "total": r.get("valor_estadia"),
    }
