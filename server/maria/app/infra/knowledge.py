"""RAG — base de conhecimento editorial da pousada.

Documentos .md em `MARIA_RAG_DIR` (versionados no repositório) são
fatiados em trechos por títulos (##/###), embedados via OpenAI
(`OPENAI_EMBED_MODEL`) e recuperados por similaridade de cosseno.

Por que RAG e não memória/fine-tuning:
- Conhecimento editorial (políticas, horários, procedimentos) muda por
  decisão do dono — um arquivo .md é o formato mais editável e
  auditável. Fine-tuning não ensina fatos; memória é para o que o
  usuário ensina no dia a dia.

Vetores são cacheados no store (`kv "embeddings"` — JSON em data/ ou
SQLite conforme MARIA_STORAGE) com hash do conteúdo — reindexação só
re-embeda o que mudou.

Testabilidade: `buscar(pergunta, embedder=fn)` aceita um embedder falso
para rodar offline.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from ..config import get_settings
from .resilience import breaker
from .storage import Store, get_store

log = logging.getLogger("maria.knowledge")

_KV_CHAVE = "embeddings"

Embedder = Callable[[list[str]], Awaitable[list[list[float]]]]

_TITULO = re.compile(r"^#{2,4}\s+", re.M)
_CHUNK_MAX = 1200


@dataclass
class Trecho:
    """Um pedaço recuperável da base."""
    fonte: str
    texto: str
    vec: list[float] = field(default_factory=list)


def fatiar(texto: str, arquivo: str) -> list[Trecho]:
    """Corta um .md em trechos por títulos ##/###.

    Sem títulos: arquivo inteiro vira um trecho (desde que caiba; senão
    corta em parágrafos acumulados até o limite).
    """
    texto = texto.strip()
    if not texto:
        return []
    secoes = _TITULO.sub("\x00", texto).split("\x00")
    trechos: list[Trecho] = []
    cabeca = secoes[0].strip()
    if cabeca:
        trechos += _em_blocos(cabeca, arquivo)
    for sec in secoes[1:]:
        sec = sec.strip()
        if not sec:
            continue
        titulo, _, corpo = sec.partition("\n")
        fonte = f"{arquivo} › {titulo.strip()}"
        trechos += _em_blocos(corpo.strip() or titulo.strip(), fonte)
    return trechos


def _em_blocos(texto: str, fonte: str) -> list[Trecho]:
    """Agrupa parágrafos até _CHUNK_MAX chars por trecho."""
    texto = texto[:2000]
    if len(texto) <= _CHUNK_MAX:
        return [Trecho(fonte=fonte, texto=texto)]
    out, buf = [], ""
    for par in re.split(r"\n\s*\n", texto):
        if buf and len(buf) + len(par) + 2 > _CHUNK_MAX:
            out.append(Trecho(fonte=fonte, texto=buf.strip()))
            buf = par
        else:
            buf = f"{buf}\n\n{par}" if buf else par
    if buf.strip():
        out.append(Trecho(fonte=fonte, texto=buf.strip()))
    return out



def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


_LEX_RX = re.compile(r"[a-z0-9áàâãéêíóôõúç]+")
_LEX_STOP = frozenset(
    "de da do das dos e ou a o as os em no na nos nas um uma uns umas "
    "para pra com por se que qual quais como quando onde tem ter é são "
    "foi ser ao aos à às me te lhe você voce eu ele ela isso esse essa "
    "este esta muito mais menos já ja ainda também tambem não nao sim "
    "só so até ate sobre entre contra".split())


def _tokens(texto: str) -> list[str]:
    """Termos indexáveis — minúsculos, sem stopwords, 3+ chars."""
    return [t for t in _LEX_RX.findall(texto.lower())
            if t not in _LEX_STOP and len(t) > 2]


def _bm25(docs: list[list[str]], query: list[str],
          k1: float = 1.5, b: float = 0.75) -> list[float]:
    """BM25 puro — sinal lexical independente de embeddings.

    Captura o que o vetor perde: termos exatos do domínio (FNRH, frigobar,
    números de protocolo) têm IDF alto e ranqueiam forte."""
    n = len(docs)
    if not n or not query:
        return [0.0] * n
    avgdl = sum(len(d) for d in docs) / n
    df: dict[str, int] = {}
    for d in docs:
        for t in set(d):
            df[t] = df.get(t, 0) + 1
    out: list[float] = []
    for d in docs:
        tf: dict[str, int] = {}
        for t in d:
            tf[t] = tf.get(t, 0) + 1
        sc = 0.0
        for q in query:
            if q not in tf:
                continue
            idf = math.log(
                1 + (n - df.get(q, 0) + 0.5) / (df.get(q, 0) + 0.5))
            sc += idf * tf[q] * (k1 + 1) / (
                tf[q] + k1 * (1 - b + b * len(d) / max(avgdl, 1)))
        out.append(sc)
    return out


def _rrf(ordenacoes: list[list[int]], k: int = 60) -> dict[int, float]:
    """Reciprocal Rank Fusion — funde rankings de escalas diferentes
    (cosseno ~0.3 vs BM25 ~12) sem normalização."""
    fused: dict[int, float] = {}
    for ordenada in ordenacoes:
        for rank, idx in enumerate(ordenada):
            fused[idx] = fused.get(idx, 0.0) + 1.0 / (k + rank + 1)
    return fused


def _cos(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class BaseConhecimento:
    """Carrega docs, mantém vetores em cache e responde buscas.

    `diretorio`/`store` podem ser injetados — os testes apontam para
    pastas/store temporários em vez de mexer nas settings globais.
    """

    def __init__(self, diretorio: Path | None = None,
                 store: Store | None = None) -> None:
        self._dir_override = diretorio
        self._store = store
        self._sig: str | None = None
        self._trechos: list[Trecho] = []
        self._client: AsyncOpenAI | None = None

    def _dir(self) -> Path:
        return self._dir_override or Path(get_settings().maria_rag_dir)

    def _store_ref(self) -> Store:
        return self._store or get_store()

    def _listar_docs(self) -> list[Path]:
        d = self._dir()
        if not d.is_dir():
            return []
        return sorted(d.glob("*.md"))

    async def _embed_openai(self, textos: list[str]) -> list[list[float]]:
        s = get_settings()
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=s.openai_api_key,
                timeout=s.openai_timeout_secs,
                max_retries=s.openai_max_retries,
            )

        with breaker("openai-embed").vigiar():
            r = await self._client.embeddings.create(
                model=s.openai_embed_model, input=textos)
        return [d.embedding for d in r.data]

    async def _carregar_cache(self) -> dict[str, Any]:
        try:
            return await self._store_ref().kv_get(_KV_CHAVE) or {}
        except Exception:
            return {}

    async def _salvar_cache(self, cache: dict[str, Any]) -> None:
        try:
            await self._store_ref().kv_set(_KV_CHAVE, cache)
        except Exception:
            log.exception("falha ao gravar cache de embeddings")

    async def _indice(self, embedder: Embedder | None) -> list[Trecho] | None:
        """Trechos com vetores; None se embedding indisponível.

        Reindexa quando a assinatura (arquivos + mtimes) muda — a cada
        busca, mas re-embedando apenas trechos novos/alterados.
        """
        docs = self._listar_docs()
        sig = _hash("|".join(f"{p.name}:{p.stat().st_mtime_ns}" for p in docs))
        if sig == self._sig and self._trechos:
            return self._trechos

        s = get_settings()
        cache = await self._carregar_cache()
        modelo = s.openai_embed_model
        vecs: dict[str, list[float]] = (
            cache.get(modelo, {}).get("vetores", {}))

        trechos: list[Trecho] = []
        pendentes: list[Trecho] = []
        for p in docs:
            try:
                txt = p.read_text(encoding="utf-8")
            except OSError:
                continue
            for t in fatiar(txt, p.name):
                h = _hash(t.texto)
                if h in vecs:
                    t.vec = vecs[h]
                    trechos.append(t)
                else:
                    pendentes.append(t)

        if pendentes:
            if embedder is None and not s.openai_api_key:
                # sem embedder disponível — devolve tudo sem vetores;
                # a busca híbrida ainda responde pelo lado lexical
                self._trechos, self._sig = trechos + pendentes, sig
                return self._trechos
            fn = embedder or self._embed_openai
            try:
                novos = await fn([t.texto for t in pendentes])
            except Exception:
                log.exception("falha ao embedar conhecimento")
                # parcial: vetores antigos + trechos crus — lexical
                # cobre o que faltou; sig não muda → retenta depois
                self._trechos = trechos + pendentes
                return self._trechos
            for t, v in zip(pendentes, novos, strict=True):
                t.vec = v
                vecs[_hash(t.texto)] = v
                trechos.append(t)
            cache.setdefault(modelo, {})["vetores"] = vecs
            await self._salvar_cache(cache)

        self._trechos, self._sig = trechos, sig
        return trechos

    async def buscar(
        self,
        pergunta: str,
        embedder: Embedder | None = None,
    ) -> dict[str, Any]:
        """Top-k trechos mais relevantes para a pergunta."""
        s = get_settings()
        if not s.maria_rag_enabled:
            return {"erro": "conhecimento desabilitado",
                    "mensagem": "A base de conhecimento está desligada."}
        pergunta = (pergunta or "").strip()
        if not pergunta:
            return {"erro": "pergunta vazia"}

        trechos = await self._indice(embedder)
        if trechos is None:
            return {"erro": "embeddings indisponíveis",
                    "mensagem": "Não consegui consultar a base de conhecimento."}
        if not trechos:
            return {"trechos": [],
                    "mensagem": "A base de conhecimento está vazia."}
        tem_vec = any(t.vec for t in trechos)
        hibrido = s.maria_rag_hybrid
        if not tem_vec and not hibrido:
            return {"erro": "base não indexada",
                    "mensagem": "Configure OPENAI_API_KEY para indexar o conhecimento."}

        qv: list[float] | None = None
        if tem_vec:
            fn = embedder or (self._embed_openai
                              if s.openai_api_key else None)
            if fn is None:
                if not hibrido:
                    return {"erro": "embeddings indisponíveis"}
            else:
                try:
                    qv = (await fn([pergunta]))[0]
                except Exception:
                    log.exception("falha ao embedar pergunta")
                    if not hibrido:
                        return {
                            "erro": "embeddings indisponíveis",
                            "mensagem": "Não consegui consultar a base "
                                        "de conhecimento."}

        if hibrido:
            # vetor (semântico) + BM25 (léxico) fundidos por RRF; sem
            # vetores o lado lexical carrega sozinho — a base responde
            # mesmo com a OpenAI de embeddings fora.
            lex = _bm25(
                [_tokens(t.fonte + " " + t.texto) for t in trechos],
                _tokens(pergunta))
            ordenacoes = [sorted(range(len(trechos)), key=lambda i: -lex[i])]
            vec_sc = [0.0] * len(trechos)
            if qv is not None:
                vec_sc = [
                    _cos(qv, t.vec) if t.vec else 0.0 for t in trechos]
                ordenacoes.insert(0, sorted(
                    range(len(trechos)), key=lambda i: -vec_sc[i]))
            fused = _rrf(ordenacoes)
            melhores = [
                i for i in sorted(fused, key=lambda i: -fused[i])
                if vec_sc[i] > 0 or lex[i] > 0
            ][: s.maria_rag_top_k]
            top = [{"fonte": trechos[i].fonte, "texto": trechos[i].texto,
                    "relevancia": round(fused[i], 4)} for i in melhores]
        else:
            ranqueado = sorted(
                ((t, _cos(qv, t.vec)) for t in trechos if t.vec),
                key=lambda x: -x[1],
            )
            top = [
                {"fonte": t.fonte, "texto": t.texto,
                 "relevancia": round(sc, 3)}
                for t, sc in ranqueado[: s.maria_rag_top_k]
                if sc >= s.maria_rag_min_score
            ]
        if not top:
            return {"trechos": [],
                    "mensagem": "Nada na base responde a isso ainda."}
        return {"trechos": top}


_BASE = BaseConhecimento()


async def buscar(
    pergunta: str,
    embedder: Embedder | None = None,
) -> dict[str, Any]:
    return await _BASE.buscar(pergunta, embedder)
