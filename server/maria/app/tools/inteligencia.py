"""Tools de inteligência preditiva — leem os endpoints /ia/* do backend
(análise determinística: ocupação, receita, fluxo 70/30, risco de no-show,
perfil LTV/churn, pace, headcount ideal, upsell, estoque e manutenção
preventiva). É assim que a Inná "explica tendências" com números reais.
"""
from typing import Any

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_inteligencia",
        "description": (
            "Resumo executivo de inteligência: ocupação projetada 14 dias, "
            "receita prevista 4 semanas, fluxo de caixa 30d (modelo 70/30), "
            "pace de vendas vs ano anterior, contagem de riscos de no-show, "
            "oportunidades de upsell e perfis de hóspedes (VIP/Ativo/Risco/"
            "Churn). Use para 'como está a projeção?', 'como anda o ritmo?'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_historico_12m",
        "description": (
            "Indicadores mensais dos últimos 12 meses: ocupação %, diárias "
            "vendidas, diária média (ADR) e receita — use para explicar "
            "tendências ('o movimento cresceu?', 'qual o melhor mês?')."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_risco_reservas",
        "description": (
            "Reservas futuras com score de risco de cancelamento/no-show "
            "(0-100, sinais e ação preventiva sugerida). Use para 'alguma "
            "reserva pode furar?', 'quem devo ligar pra confirmar?'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_upsell",
        "description": (
            "Oportunidades de upgrade: reservas próximas com acomodação "
            "superior livre no mesmo período e o ganho potencial. Use para "
            "'dá pra oferecer upgrade pra alguém?'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_operacao_prevista",
        "description": (
            "Otimização operacional: headcount ideal por setor nos próximos "
            "14 dias, itens de estoque que acabam no período e quartos com "
            "risco de falha (manutenção preventiva). Use para 'falta gente "
            "em algum dia?', 'o que compro essa semana?'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    match nome:
        case "get_inteligencia":
            return await ex.api.get("/ia/resumo")

        case "get_historico_12m":
            return await ex.api.get("/ia/historico-12m")

        case "get_risco_reservas":
            return await ex.api.get("/ia/risco-cancelamentos")

        case "get_upsell":
            return await ex.api.get("/ia/upsell")

        case "get_operacao_prevista":
            escala = await ex.api.get("/ia/escala-ideal")
            estoque = await ex.api.get("/ia/estoque-previsto")
            manut = await ex.api.get("/ia/manutencao-preventiva")
            return {
                "escala_ideal": [
                    e for e in (escala if isinstance(escala, list) else [])
                    if e.get("deficit", 0) != 0
                ],
                "estoque_critico": [
                    i for i in (estoque if isinstance(estoque, list) else [])
                    if i.get("dias_restantes") is not None and i["dias_restantes"] < 14
                ],
                "quartos_risco": [
                    q for q in (manut if isinstance(manut, list) else [])
                    if q.get("nivel") != "verde"
                ],
            }

        case _:
            return {"erro": "desconhecido", "mensagem": nome}
