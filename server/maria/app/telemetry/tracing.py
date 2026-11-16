"""Tracing OpenTelemetry — spans de turno, chamada LLM e execução
de tool, exportados por OTLP/HTTP para qualquer collector (Tempo,
Jaeger, Datadog, Langfuse via endpoint OTLP).

Desligado por padrão: `OTEL_ENDPOINT` vazio → `span()` é um no-op de
custo zero. Quando configurado, `init_tracing(app)` cria o provider,
registra o exportador em batch e instrumenta o FastAPI (spans HTTP
automáticos por request — o span de turno aparece como filho do POST
/mcp ou do handler WS).

Spans produzidos:

- maria.turno — um por chamada a `Orquestrador.responder`
    attrs: turno, modelo, usuario, origem; tokens ao final
- maria.llm — um por tentativa de modelo na cadeia de fallback
    attrs: modelo, modo (responses|chat), fallback
- maria.tool — uma por tool executada
    attrs: nome, ok/erro
"""
from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from ..config import get_settings

log = logging.getLogger("maria.tracing")

try:
    from opentelemetry import trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    _OTEL = True
except ImportError:  # pacote opcional — sem ele, tudo é no-op
    _OTEL = False

_ativo = False


def init_tracing(app: Any | None = None) -> None:
    """Liga o tracing quando `OTEL_ENDPOINT` está configurado.

    Chamado uma vez no boot (main.py). Sem endpoint → no-op: custo
    zero e nenhuma dependência de rede.
    """
    global _ativo
    s = get_settings()
    if not (_OTEL and s.otel_endpoint):
        return
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create(
            {"service.name": s.otel_service_name}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
            endpoint=f"{s.otel_endpoint.rstrip('/')}/v1/traces")))
        trace.set_tracer_provider(provider)
        _ativo = True
        if app is not None:
            try:
                from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
                FastAPIInstrumentor.instrument_app(app)
            except ImportError:
                log.info("instrumentação fastapi ausente — spans "
                         "manuais ainda exportam")
        log.info("tracing otel → %s", s.otel_endpoint)
    except Exception:
        log.exception("falha ao iniciar tracing — seguindo sem spans")
        _ativo = False


@contextmanager
def span(nome: str, **attrs: Any) -> Iterator[Any]:
    """Abre um span quando o tracing está ativo; no-op caso contrário."""
    if not _ativo:
        yield None
        return
    with trace.get_tracer("maria").start_as_current_span(nome) as sp:
        for k, v in attrs.items():
            try:
                sp.set_attribute(k, v)
            except Exception:  # noqa: BLE001 — atributo ruim não quebra span
                pass
        yield sp
