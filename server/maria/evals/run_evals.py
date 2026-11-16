"""Harness de avaliação da MAR IA — golden set contra a OpenAI real.

Roda cada caso do dataset pelo Orquestrador com uma API do sistema
stubada (respostas enlatadas) e mede:
- precisão de seleção de ferramentas (tool calling)
- respeito a permissões por nível
- latência por turno
- taxa de erro

Uso:
    cd server/maria
    set OPENAI_API_KEY=sk-...          (Windows) | export OPENAI_API_KEY=...
    python -m evals.run_evals [--dataset evals/dataset.json] [--nivel N]
                              [--limite K] [--saida evals/report.json]
                              [--judge] [--judge-model gpt-4o-mini]

--judge: LLM-as-judge — um segundo modelo pontua a resposta final em
fidelidade (só afirma o que as tools devolveram?), naturalidade para
voz (falável, sem markdown, concisa) e utilidade. Custa uma chamada
extra por caso — por isso fica fora do caminho padrão.

Sem chave OpenAI, sai com erro explicando — os testes unitários
(tests/) já cobrem o dispatch offline.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent.llm import Orquestrador
from app.config import get_settings
from app.infra.auth import Ator


class StubApi:
    """PousadaApi falsa — respostas plausíveis para qualquer endpoint.

    O objetivo do eval é medir a SELEÇÃO de ferramentas, não a
    qualidade do dado — respostas genéricas bastam.
    """

    async def close(self) -> None:
        pass

    async def get(self, path: str, params=None):
        if path.startswith("/reservas/disponibilidade"):
            return {"acomodacoes": [{"id": 1, "nome": "Suíte 4"}]}
        if path == "/clientes":
            return {"total": 1, "items": [{"id": 7, "nome": "João Silva"}]}
        if path.startswith("/reservas/"):
            return {"id": 12, "cliente_nome": "João Silva",
                    "acomodacao_nome": "Suíte 4", "status": "pendente"}
        if path == "/formas-pagamento":
            return [{"id": 1, "nome": "PIX", "ativo": True}]
        if path == "/dashboard":
            return {"cards": {"total_acomodacoes": 10,
                              "acomodacoes_ocupadas": 6,
                              "acomodacoes_disponiveis": 4,
                              "hospedes_atuais": 14}}
        return {"total": 2, "items": [{"id": 1, "nome": "Exemplo"}]}

    async def post(self, path: str, body=None):
        return {"ok": True, "id": 99}

    async def put(self, path: str, body=None):
        return {"ok": True}

    async def patch(self, path: str, body=None):
        return {"ok": True}

    async def delete(self, path: str):
        return {"ok": True}

    async def request(self, metodo: str, path: str, body=None):
        fn = {"get": self.get, "post": self.post, "put": self.put,
              "patch": self.patch}.get(metodo.lower())
        return await (fn(path, body) if fn else self.delete(path))


async def _sem_stream(_: str) -> None:
    pass


async def _sem_tool(_: str) -> None:
    pass


async def _sem_result(_: str, __: dict) -> None:
    pass


JUDGE_PROMPT = """Você é um avaliador rigoroso de respostas de assistentes de
voz. Analise a RESPOSTA que a assistente deu à PERGUNTA, considerando o que
as FERRAMENTAS realmente devolveram.

Dê notas inteiras de 0 a 5:
- fidelidade: a resposta só afirma o que as ferramentas devolveram?
  Inventar números, nomes ou fatos = 0. Omitir informação não conta contra.
- voz: a frase é falável — curta, natural, sem markdown, listas, tabelas
  ou símbolos? (a resposta é lida em voz alta por TTS)
- utilidade: responde a intenção real? oferece próximo passo quando faz
  sentido? não enche linguiça?

Responda SOMENTE um objeto JSON:
{"fidelidade":N,"voz":N,"utilidade":N,"comentario":"até 20 palavras"}"""


async def julgar(client, caso: dict, r: dict, modelo: str) -> dict:
    """LLM-as-judge: nota a resposta final contra os dados das tools."""
    if "erro" in r:
        return {"judge_erro": "turno falhou"}
    tools_ctx = [
        {"name": t["name"],
         "ok": t.get("ok"),
         "result": json.dumps(t.get("result"), ensure_ascii=False)[:1500]}
        for t in r.get("tools_full", [])
    ]
    payload = {
        "pergunta": caso["pergunta"],
        "resposta": r.get("resposta", ""),
        "ferramentas": tools_ctx,
    }
    try:
        resp = await client.responses.create(
            model=modelo,
            input=[
                {"role": "developer", "content": JUDGE_PROMPT},
                {"role": "user",
                 "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        texto = (getattr(resp, "output_text", None) or "").strip()
        inicio, fim = texto.find("{"), texto.rfind("}")
        return json.loads(texto[inicio:fim + 1])
    except Exception as e:
        return {"judge_erro": str(e)[:200]}


def _medias_judge(notas: list[dict]) -> dict:
    campos = ("fidelidade", "voz", "utilidade")
    validas = [j for j in notas if "judge_erro" not in j]
    if not validas:
        return {}
    return {
        "casos_avaliados": len(validas),
        **{c: round(sum(j.get(c, 0) for j in validas) / len(validas), 2)
           for c in campos},
    }


async def roda_caso(caso: dict, ator: Ator) -> dict:
    orq = Orquestrador(StubApi(), ator)
    inicio = time.perf_counter()
    try:
        res = await orq.responder(
            caso["pergunta"], _sem_stream, _sem_tool, _sem_result)
        dt = time.perf_counter() - inicio
        chamadas = [t["name"] for t in res.tools]
        erros = [t for t in res.tools if not t.get("ok")]
        return {
            "id": caso["id"],
            "pergunta": caso["pergunta"],
            "tools": chamadas,
            "tools_full": res.tools,
            "resposta": res.texto[:400],
            "tool_calls": res.tool_calls,
            "erros_tools": len(erros),
            "latencia_s": round(dt, 2),
            "tokens": res.usage,
        }
    except Exception as e:
        return {"id": caso["id"], "pergunta": caso["pergunta"],
                "erro": str(e)[:300],
                "latencia_s": round(time.perf_counter() - inicio, 2)}


def avalia(caso: dict, r: dict) -> dict:
    """Regras de avaliação do caso → passou/falhou + motivo."""
    if "erro" in r:
        return {"passou": False, "motivo": f"exceção: {r['erro'][:120]}"}

    tools = set(r["tools"])

    if caso.get("espera_sem_tools"):
        ok = not tools
        return {"passou": ok,
                "motivo": "sem tools" if ok else f"chamou: {sorted(tools)}"}

    if caso.get("espera_erro_permissao"):

        errou_perm = any(
            not t.get("ok") for t in r.get("tools_full", []))
        ok = (not tools) or errou_perm
        return {"passou": ok,
                "motivo": "sem tools chamadas" if not tools
                else f"tools: {sorted(tools)}"}

    esperadas = caso.get("espera_tools")
    if esperadas:
        faltam = [t for t in esperadas if t not in tools]
        ok = not faltam
        return {"passou": ok,
                "motivo": "ok" if ok else f"faltou: {faltam} (chamou {sorted(tools)})"}

    alguma = caso.get("espera_tools_contem_alguma")
    if alguma and not any(set(g) & tools for g in alguma):
        return {"passou": False,
                "motivo": f"nenhuma de {alguma} em {sorted(tools)}"}
    final = caso.get("espera_tool_final")
    if final and final not in tools:
        return {"passou": False,
                "motivo": f"tool final '{final}' ausente em {sorted(tools)}"}
    return {"passou": True, "motivo": "ok"}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(Path(__file__).parent / "dataset.json"))
    ap.add_argument("--nivel", type=int, default=None,
                    help="só casos deste nível (1 admin, 2 gerente, 3 recepção)")
    ap.add_argument("--limite", type=int, default=None)
    ap.add_argument("--saida", default="evals/report.json")
    ap.add_argument("--judge", action="store_true",
                    help="LLM-as-judge pontua fidelidade/voz/utilidade")
    ap.add_argument("--judge-model", default="gpt-4o-mini")
    ap.add_argument("--gate", action="store_true",
                    help="gate de regressão p/ CI: sai 1 se a acurácia "
                         "cair abaixo de --gate-min (ou o judge abaixo "
                         "de --judge-min, quando --judge estiver ativo)")
    ap.add_argument("--gate-min", type=float, default=0.9,
                    help="acurácia mínima do gate (default 0.9)")
    ap.add_argument("--judge-min", type=float, default=3.5,
                    help="fidelidade mínima do judge no gate (default 3.5)")
    args = ap.parse_args()

    if not get_settings().openai_api_key:
        print("ERRO: OPENAI_API_KEY ausente — configure e rode de novo.")
        return 2

    casos = json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    if args.nivel:
        casos = [c for c in casos if c.get("nivel", 3) == args.nivel]
    if args.limite:
        casos = casos[: args.limite]

    juiz = None
    if args.judge:
        from openai import AsyncOpenAI
        juiz = AsyncOpenAI(api_key=get_settings().openai_api_key,
                           timeout=60)

    resultados = []
    notas = []
    for caso in casos:
        ator = Ator(idfuncionario=1, login="eval", nome="Avaliador",
                    nivel=caso.get("nivel", 3))
        r = await roda_caso(caso, ator)
        veredito = avalia(caso, r)
        r.update(veredito)
        if juiz:
            nota = await julgar(juiz, caso, r, args.judge_model)
            r["judge"] = nota
            notas.append(nota)
        r.pop("tools_full", None)
        marca = "PASS" if r["passou"] else "FAIL"
        print(f"{marca}  {caso['id']:<28} {r['motivo']}")
        resultados.append({k: v for k, v in r.items()})

    total = len(resultados)
    ok = sum(1 for r in resultados if r["passou"])
    lat = [r["latencia_s"] for r in resultados if "latencia_s" in r]
    resumo = {
        "total": total,
        "passou": ok,
        "acuracia": round(ok / total, 3) if total else 0,
        "latencia_media_s": round(sum(lat) / len(lat), 2) if lat else 0,
        "modelo": get_settings().openai_llm_model,
        "reasoning": get_settings().openai_llm_reasoning_effort,
    }
    if juiz:
        resumo["judge"] = {"modelo": args.judge_model, **_medias_judge(notas)}
        print(json.dumps(resumo["judge"], ensure_ascii=False, indent=2))
    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    Path(args.saida).write_text(
        json.dumps({"resumo": resumo, "casos": resultados},
                   ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"relatório → {args.saida}")

    if args.gate:
        reprova: list[str] = []
        if resumo["acuracia"] < args.gate_min:
            reprova.append(
                f"acurácia {resumo['acuracia']} < {args.gate_min}")
        jid = resumo.get("judge", {})
        if juiz and jid.get("fidelidade") is not None \
                and jid["fidelidade"] < args.judge_min:
            reprova.append(
                f"fidelidade do judge {jid['fidelidade']} < {args.judge_min}")
        # falhas de permissão reprovam sempre — segurança não é média
        espera_perm = {c["id"] for c in casos
                       if c.get("espera_erro_permissao")}
        falhas_perm = [r["id"] for r in resultados
                       if not r["passou"] and r["id"] in espera_perm]
        if falhas_perm:
            reprova.append(f"permissão falhou: {falhas_perm}")
        if reprova:
            print("GATE REPROVADO — " + "; ".join(reprova))
            return 1
        print("GATE OK")
        return 0
    return 0 if ok == total else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
