"""Construção do dataset de fine-tuning (formato SFT da OpenAI).

Cada exemplo vira:
```json
{"messages": [
   {"role": "system", "content": SYSTEM_PROMPT},
   {"role": "user", "content": "<pergunta>"},
   {"role": "assistant", "content": null,
    "tool_calls": [{"id": "call_0", "type": "function",
                    "function": {"name": ..., "arguments": "<json>"}}]},
   {"role": "tool", "tool_call_id": "call_0", "content": "<resultado>"},
   {"role": "assistant", "content": "<resposta falada>"}
 ],
 "tools": [ {"type": "function", "function": {...schema...}} ]}
```

Notas:
- O turno real pode ter várias rodadas de tools; o log é achatado em
  uma única sequência — suficiente para ensinar seleção + estilo.
- Turnos antigos sem `result` nas tools não viram exemplo com tool
  (não dá para ensinar function-calling sem a resposta da ferramenta)
  — mas o texto final ainda serve se `--simples` estiver ativo? Não:
  mantemos rigor — exemplo só entra completo ou sem tools.
- A lista `tools` do exemplo segue o formato Chat Completions
  ({"function": {...}}), que é o que a API de fine-tuning espera.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent.prompts import SYSTEM_PROMPT  # noqa: E402
from app.tools import TOOLS  # noqa: E402

_TOOL_NAMES = {t["name"] for t in TOOLS}


def _tools_chat() -> list[dict]:
    """TOOLS no formato esperado pelo fine-tuning (Chat Completions)."""
    return [
        {"type": "function",
         "function": {"name": t["name"], "description": t["description"],
                      "parameters": t["parameters"]}}
        for t in TOOLS
    ]


def _valida_tools(ferramentas: list[dict]) -> list[dict]:
    """Só ferramentas que existem no catálogo e com resultado salvo."""
    ok = []
    for t in ferramentas or []:
        if not isinstance(t, dict) or t.get("name") not in _TOOL_NAMES:
            continue
        if "result" not in t:
            continue
        ok.append(t)
    return ok


def _resultado_str(t: dict) -> str:
    r = t.get("result")
    if isinstance(r, str):
        return r[:2000]
    try:
        return json.dumps(r, ensure_ascii=False)[:2000]
    except (TypeError, ValueError):
        return str(r)[:2000]


def exemplo(pergunta: str, resposta: str,
            ferramentas: list[dict] | None = None) -> dict | None:
    """Monta um exemplo SFT; None se incompleto."""
    pergunta = (pergunta or "").strip()
    resposta = (resposta or "").strip()
    if not pergunta or not resposta:
        return None
    tools = _valida_tools(ferramentas or [])

    if ferramentas and not tools:
        return None

    msgs: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": pergunta},
    ]
    if tools:
        calls = []
        for i, t in enumerate(tools):
            calls.append({
                "id": f"call_{i}",
                "type": "function",
                "function": {
                    "name": t["name"],
                    "arguments": json.dumps(t.get("args") or {},
                                            ensure_ascii=False),
                },
            })
        msgs.append({"role": "assistant", "content": None,
                     "tool_calls": calls})
        for i, t in enumerate(tools):
            msgs.append({"role": "tool", "tool_call_id": f"call_{i}",
                         "content": _resultado_str(t)})
    msgs.append({"role": "assistant", "content": resposta})

    ex: dict = {"messages": msgs}
    if tools:
        ex["tools"] = _tools_chat()
    return ex


def turno_para_exemplo(turno: dict, incluir_falhos: bool = False) -> dict | None:
    """Converte um registro de data/turns.jsonl em exemplo SFT."""
    tools = turno.get("tools") or []
    if not incluir_falhos and any(t.get("ok") is False for t in tools):
        return None
    return exemplo(turno.get("pergunta", ""), turno.get("resposta", ""),
                   tools)


def curado_para_exemplo(reg: dict) -> dict | None:
    """Converte um registro de data/curated.jsonl em exemplo SFT."""
    return exemplo(reg.get("pergunta", ""), reg.get("resposta", ""),
                   reg.get("tools") or [])


def carregar_jsonl(caminho: str | Path) -> list[dict]:
    p = Path(caminho)
    if not p.exists():
        return []
    out = []
    for linha in p.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha:
            continue
        try:
            out.append(json.loads(linha))
        except json.JSONDecodeError:
            continue
    return out


def construir(
    turnos: list[dict],
    curados: list[dict] | None = None,
    incluir_falhos: bool = False,
) -> tuple[list[dict], dict[str, int]]:
    """Curados primeiro (prioridade), depois turnos bons; dedup por pergunta."""
    stats = {"curados": 0, "turnos_ok": 0, "descartados": 0, "duplicados": 0}
    exemplos: list[dict] = []
    vistos: set[str] = set()

    def _add(ex: dict | None) -> None:
        if ex is None:
            stats["descartados"] += 1
            return
        pergunta = ex["messages"][1]["content"].strip().lower()
        if pergunta in vistos:
            stats["duplicados"] += 1
            return
        vistos.add(pergunta)
        exemplos.append(ex)

    for reg in curados or []:
        antes = len(exemplos)
        _add(curado_para_exemplo(reg))
        if len(exemplos) > antes:
            stats["curados"] += 1
    for t in turnos:
        antes = len(exemplos)
        _add(turno_para_exemplo(t, incluir_falhos))
        if len(exemplos) > antes:
            stats["turnos_ok"] += 1
    return exemplos, stats


def dividir(exemplos: list[dict], frac_valid: float = 0.1,
            seed: int = 42) -> tuple[list[dict], list[dict]]:
    """Split treino/validação determinístico. <20 exs → tudo treino."""
    if len(exemplos) < 20:
        return exemplos, []
    rnd = random.Random(seed)
    idx = list(range(len(exemplos)))
    rnd.shuffle(idx)
    n_valid = max(1, int(len(idx) * frac_valid))
    valid_i = set(idx[:n_valid])
    treino = [e for i, e in enumerate(exemplos) if i not in valid_i]
    valid = [e for i, e in enumerate(exemplos) if i in valid_i]
    return treino, valid


def salvar_jsonl(exemplos: list[dict], caminho: str | Path) -> int:
    p = Path(caminho)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        for ex in exemplos:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    return len(exemplos)


def main() -> int:
    ap = argparse.ArgumentParser(description="Constrói dataset SFT da MAR IA")
    ap.add_argument("--turnos", default="data/turns.jsonl")
    ap.add_argument("--curados", default="data/curated.jsonl")
    ap.add_argument("--saida", default="data/ft_train.jsonl")
    ap.add_argument("--valid", default="data/ft_valid.jsonl")
    ap.add_argument("--incluir-falhos", action="store_true",
                    help="inclui turnos com erro de tool (ensina a lidar com falha)")
    args = ap.parse_args()

    turnos = carregar_jsonl(args.turnos)
    curados = carregar_jsonl(args.curados)
    exemplos, stats = construir(turnos, curados, args.incluir_falhos)
    treino, valid = dividir(exemplos)

    n_t = salvar_jsonl(treino, args.saida)
    n_v = salvar_jsonl(valid, args.valid) if valid else 0
    print(json.dumps({
        "entrada": {"turnos": len(turnos), "curados": len(curados)},
        "stats": stats,
        "treino": n_t, "validacao": n_v,
        "arquivos": [args.saida] + ([args.valid] if valid else []),
    }, ensure_ascii=False, indent=2))
    if n_t < 10:
        print("AVISO: menos de 10 exemplos — a OpenAI exige no mínimo 10; "
              "recomendado 50+. Rode finetune.revisar para curar turnos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
