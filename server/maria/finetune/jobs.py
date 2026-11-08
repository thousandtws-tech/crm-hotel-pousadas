"""Gerenciador de jobs de fine-tuning na OpenAI.

Subcomandos:
    build     — constrói ft_train/ft_valid.jsonl (delega a dataset.py)
    upload    — envia um .jsonl → file-id
    create    — cria o job (modelo base configurável)
    status    — acompanha um job
    list      — lista jobs recentes
    pipeline  — build + upload + create de uma vez, com guardas

Depois que o job concluir (status=succeeded), o nome do modelo
`ft:...` aparece em `status`/`list` — basta configurar:
    OPENAI_LLM_MODEL=ft:gpt-4o-mini-2024-07-18:org:maria:xxxxxx

Guardas (evitam gasto/bobagem):
- exige OPENAI_API_KEY;
- recusa dataset < 10 exemplos (mínimo da API) e avisa abaixo de 50;
- estimativa bruta de tokens impressa antes de criar o job.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from finetune import dataset  # noqa: E402

_MINIMO_API = 10
_RECOMENDADO = 50


def _client():
    from openai import OpenAI
    s = get_settings()
    if not s.openai_api_key:
        sys.exit("ERRO: OPENAI_API_KEY ausente — configure no .env.")
    return OpenAI(api_key=s.openai_api_key)


def _build(args) -> tuple[Path, Path | None, int]:
    turnos = dataset.carregar_jsonl(args.turnos)
    curados = dataset.carregar_jsonl(args.curados)
    exemplos, stats = dataset.construir(
        turnos, curados, args.incluir_falhos)
    treino, valid = dataset.dividir(exemplos)
    dataset.salvar_jsonl(treino, args.saida)
    n_v = dataset.salvar_jsonl(valid, args.valid) if valid else 0
    print(json.dumps({"stats": stats, "treino": len(treino),
                      "validacao": n_v}, ensure_ascii=False))
    return Path(args.saida), (Path(args.valid) if valid else None), len(treino)


def _tokens_estimados(p: Path) -> int:
    """Estimativa ~4 chars/token — só para sanity-check de custo."""
    return sum(len(ln) for ln in
               p.read_text(encoding="utf-8").splitlines()) // 4


def cmd_build(args) -> int:
    _build(args)
    return 0


def cmd_upload(args) -> int:
    cl = _client()
    p = Path(args.arquivo)
    if not p.exists():
        sys.exit(f"ERRO: {p} não existe — rode `build` antes.")
    f = cl.files.create(file=open(p, "rb"), purpose="fine-tune")
    print(f"file_id={f.id}  ({p.name}, {p.stat().st_size} bytes)")
    return 0


def cmd_create(args) -> int:
    cl = _client()
    s = get_settings()
    modelo = args.modelo or s.openai_ft_base_model
    kw: dict = {}
    if args.valid:
        kw["validation_file"] = args.valid
    if args.epocas:
        kw["hyperparameters"] = {"n_epochs": args.epocas}
    job = cl.fine_tuning.jobs.create(
        training_file=args.train,
        model=modelo,
        suffix="maria",
        **kw,
    )
    print(f"job={job.id}  modelo_base={modelo}  status={job.status}")
    print("acompanhe:  python -m finetune.jobs status " + job.id)
    return 0


def cmd_status(args) -> int:
    cl = _client()
    j = cl.fine_tuning.jobs.retrieve(args.job)
    print(json.dumps({
        "id": j.id, "status": j.status,
        "modelo_final": getattr(j, "fine_tuned_model", None),
        "erro": getattr(getattr(j, "error", None), "message", None),
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_list(args) -> int:
    cl = _client()
    for j in cl.fine_tuning.jobs.list(limit=args.limite).data:
        print(f"{j.id}  {j.status:<12} {j.model} → "
              f"{getattr(j, 'fine_tuned_model', None) or '-'}")
    return 0


def cmd_pipeline(args) -> int:
    train, valid, n = _build(args)
    if n < _MINIMO_API:
        sys.exit(
            f"ERRO: {n} exemplos < mínimo {_MINIMO_API} da API. "
            "Acumule turnos e rode `python -m finetune.revisar`.")
    if n < _RECOMENDADO:
        print(f"AVISO: {n} exemplos — funciona, mas {_RECOMENDADO}+ dá "
              "resultado bem mais estável.")
    tok = _tokens_estimados(train)
    print(f"estimativa: ~{tok:,} tokens de treino "
          f"(×épocas × preço do modelo — confira o billing)")

    cl = _client()
    f_tr = cl.files.create(file=open(train, "rb"), purpose="fine-tune")
    ids = {"train": f_tr.id}
    print(f"train → {f_tr.id}")
    if valid:
        f_va = cl.files.create(file=open(valid, "rb"), purpose="fine-tune")
        ids["valid"] = f_va.id
        print(f"valid → {f_va.id}")

    s = get_settings()
    job = cl.fine_tuning.jobs.create(
        training_file=ids["train"],
        validation_file=ids.get("valid"),
        model=s.openai_ft_base_model,
        suffix="maria",
    )
    print(f"\njob={job.id}  status={job.status}")
    print("acompanhe:  python -m finetune.jobs status " + job.id)
    print("ao concluir: OPENAI_LLM_MODEL=<fine_tuned_model> no .env")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Jobs de fine-tuning da MAR IA")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def _data_args(p):
        p.add_argument("--turnos", default="data/turns.jsonl")
        p.add_argument("--curados", default="data/curated.jsonl")
        p.add_argument("--saida", default="data/ft_train.jsonl")
        p.add_argument("--valid", default="data/ft_valid.jsonl")
        p.add_argument("--incluir-falhos", action="store_true")

    p = sub.add_parser("build")
    _data_args(p)
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser("upload")
    p.add_argument("--arquivo", required=True)
    p.set_defaults(fn=cmd_upload)
    p = sub.add_parser("create")
    p.add_argument("--train", required=True)
    p.add_argument("--valid", default=None)
    p.add_argument("--modelo", default=None)
    p.add_argument("--epocas", type=int, default=None)
    p.set_defaults(fn=cmd_create)
    p = sub.add_parser("status")
    p.add_argument("job")
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser("list")
    p.add_argument("--limite", type=int, default=10)
    p.set_defaults(fn=cmd_list)
    p = sub.add_parser("pipeline")
    _data_args(p)
    p.set_defaults(fn=cmd_pipeline)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
