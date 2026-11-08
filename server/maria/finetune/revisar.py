"""Curadoria humana dos turnos — o passo que transforma log em ouro.

Percorre data/turns.jsonl e pergunta o que fazer com cada turno:
  [a] aprovar como está
  [e] aprovar EDITANDO a resposta ideal (corrige estilo/fato)
  [r] rejeitar (não vai pro dataset)
  [p] pular (decide depois)
  [s] sair

Aprovados/editados vão para data/curated.jsonl — a fonte prioritária
do `finetune.dataset`. Turnos já curados não reaparecem.

Uso:
    python -m finetune.revisar                  # interativo
    python -m finetune.revisar --auto           # aprova turnos sem erro
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from finetune.dataset import carregar_jsonl  # noqa: E402


def _ja_curados(curados: list[dict]) -> set[str]:
    """Chave de dedup: timestamp do turno de origem."""
    return {str(r.get("ts_origem")) for r in curados if r.get("ts_origem")}


def _aprovavel(turno: dict) -> bool:
    """Turno limpo: sem erro de tool e com resposta não vazia."""
    if not (turno.get("resposta") or "").strip():
        return False
    return not any(t.get("ok") is False for t in turno.get("tools") or [])


def _para_curado(turno: dict, resposta: str | None = None,
                 nota: str = "") -> dict:
    return {
        "ts_origem": turno.get("ts"),
        "origem": turno.get("origem"),
        "pergunta": turno.get("pergunta", ""),
        "resposta": resposta if resposta is not None
                    else turno.get("resposta", ""),
        "tools": turno.get("tools") or [],
        "nota": nota,
    }


def _append_jsonl(caminho: Path, reg: dict) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "a", encoding="utf-8") as f:
        f.write(json.dumps(reg, ensure_ascii=False) + "\n")


def _mostra(i: int, total: int, t: dict) -> None:
    print(f"\n──── turno {i + 1}/{total} ─ {t.get('ts')} ─ {t.get('origem')}")
    print(f"  P: {t.get('pergunta', '')[:300]}")
    for tool in t.get("tools") or []:
        flag = "" if tool.get("ok", True) else "  ✗ ERRO"
        print(f"  → {tool.get('name')}({json.dumps(tool.get('args') or {}, ensure_ascii=False)[:120]}){flag}")
    print(f"  R: {t.get('resposta', '')[:500]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Curadoria de turnos p/ fine-tuning")
    ap.add_argument("--turnos", default="data/turns.jsonl")
    ap.add_argument("--curados", default="data/curated.jsonl")
    ap.add_argument("--auto", action="store_true",
                    help="aprova automaticamente turnos sem erro (sem editar)")
    args = ap.parse_args()

    turnos = carregar_jsonl(args.turnos)
    curados = carregar_jsonl(args.curados)
    feitos = _ja_curados(curados)
    pendentes = [t for t in turnos if t.get("ts") not in feitos]
    alvo = Path(args.curados)

    if not pendentes:
        print(f"Nada a revisar — {len(curados)} já curados, "
              f"{len(turnos)} turnos no total.")
        return 0

    aprovados = rejeitados = pulados = 0
    if args.auto:
        for t in pendentes:
            if _aprovavel(t):
                _append_jsonl(alvo, _para_curado(t, nota="auto"))
                aprovados += 1
            else:
                pulados += 1
        print(f"auto: {aprovados} aprovados, {pulados} com erro/pulos "
              f"→ {alvo}")
        return 0

    print(f"{len(pendentes)} turnos pendentes "
          f"({len(curados)} já curados). Comandos: a/e/r/p/s")
    try:
        for i, t in enumerate(pendentes):
            _mostra(i, len(pendentes), t)
            op = input("  [a/e/r/p/s] ").strip().lower() or "p"
            if op == "s":
                break
            if op == "a":
                _append_jsonl(alvo, _para_curado(t))
                aprovados += 1
            elif op == "e":
                nova = input("  resposta ideal (uma linha): ").strip()
                if not nova:
                    print("  vazio — pulado")
                    pulados += 1
                    continue
                _append_jsonl(alvo, _para_curado(t, resposta=nova,
                                               nota="editado"))
                aprovados += 1
            elif op == "r":
                _append_jsonl(alvo, {**_para_curado(t, resposta=""),
                                   "rejeitado": True})
                rejeitados += 1
            else:
                pulados += 1
    except (EOFError, KeyboardInterrupt):
        print()
    print(f"\nfim: {aprovados} aprovados, {rejeitados} rejeitados, "
          f"{pulados} pulados → {alvo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
