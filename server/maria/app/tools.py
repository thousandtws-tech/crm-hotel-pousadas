"""Ferramentas (function calling) do MAR IA → API do sistema.

Cada ferramenta mapeia um endpoint real do backend Rust e executa com o
Bearer do usuário conectado — autorização por nível continua válida.

Ações de escrita (criar/alterar/cancelar reserva) são executadas em duas
etapas: `preparar_*` devolve um resumo para confirmação; a execução só
acontece via `confirmar_acao` — nunca direto pelo LLM.
"""
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .api_client import PousadaApi, ApiError
from .auth import Ator
from .config import get_settings
from . import memory


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


# ---------------------------------------------------------------- schemas --

def _props(**kv: Any) -> dict[str, Any]:
    return kv


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_reservas",
        "description": (
            "Lista reservas do sistema. Filtre por período (inicio/fim ISO), "
            "status (pendente, hospedado, finalizado, cancelada) ou busca "
            "livre (nome do hóspede, nº da reserva ou acomodação)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Data inicial ISO (yyyy-mm-dd)"},
                fim={"type": "string", "description": "Data final ISO"},
                status={
                    "type": "string",
                    "enum": ["pendente", "hospedado", "finalizado", "cancelada"],
                },
                busca={"type": "string", "description": "Texto livre (hóspede, nº, acomodação)"},
                porPagina={"type": "integer", "default": 20},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_reserva_detalhe",
        "description": "Detalhe completo de uma reserva pelo número (id).",
        "parameters": {
            "type": "object",
            "properties": _props(id={"type": "integer", "description": "Número da reserva"}),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "check_disponibilidade",
        "description": (
            "Consulta acomodações disponíveis para um período — use antes de "
            "criar ou sugerir reservas."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Entrada prevista ISO"},
                fim={"type": "string", "description": "Saída prevista ISO"},
            ),
            "required": ["inicio", "fim"],
        },
    },
    {
        "type": "function",
        "name": "get_hospedes_atuais",
        "description": "Hóspedes atualmente hospedados (reservas em curso).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_checkins",
        "description": "Check-ins previstos ou já realizados numa data (padrão: hoje).",
        "parameters": {
            "type": "object",
            "properties": _props(
                data={"type": "string", "description": "Data ISO ou 'hoje'/'amanhã'"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_checkouts",
        "description": "Check-outs previstos ou já realizados numa data (padrão: hoje).",
        "parameters": {
            "type": "object",
            "properties": _props(
                data={"type": "string", "description": "Data ISO ou 'hoje'/'amanhã'"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_situacao_quartos",
        "description": (
            "Situação das acomodações agora: ocupadas, disponíveis e total — "
            "com a taxa de ocupação atual."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_acomodacoes",
        "description": "Lista acomodações ativas com diária, capacidade e tipo.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_clientes",
        "description": "Busca hóspedes cadastrados pelo nome, CPF ou e-mail.",
        "parameters": {
            "type": "object",
            "properties": _props(
                busca={"type": "string", "description": "Nome, CPF ou e-mail"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_financeiro_resumo",
        "description": (
            "Resumo financeiro do período: recebido, previsto, descontos e "
            "contas fechadas."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Data inicial ISO"},
                fim={"type": "string", "description": "Data final ISO"},
            ),
        },
    },
    # ----- cobertura do sistema inteiro (leitura) -----
    {
        "type": "function",
        "name": "get_dashboard",
        "description": (
            "Painel do dia: ocupação, chegadas/saídas de hoje, pendências e "
            "últimas reservas — use para 'como está a pousada hoje?'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_quartos",
        "description": (
            "Lista os quartos físicos de uma acomodação com status — acha "
            "unidade bloqueada/em manutenção."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idacomodacao={"type": "integer", "description": "ID da acomodação"},
            ),
            "required": ["idacomodacao"],
        },
    },
    {
        "type": "function",
        "name": "get_estoque",
        "description": (
            "Itens do estoque com quantidade e mínimo — descobre o que está "
            "acabando (use critico=true para só os abaixo do mínimo)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                busca={"type": "string", "description": "Nome do item"},
                critico={"type": "boolean", "description": "Só itens abaixo do mínimo"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_movimentacoes_estoque",
        "description": "Últimas movimentações de estoque (entradas/saídas).",
        "parameters": {
            "type": "object",
            "properties": _props(
                limite={"type": "integer", "default": 15},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_frigobares",
        "description": "Frigobares cadastrados, suas acomodações e itens.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_itens_frigobar",
        "description": "Itens (produtos e quantidades) de um frigobar.",
        "parameters": {
            "type": "object",
            "properties": _props(
                idfrigobar={"type": "integer"},
            ),
            "required": ["idfrigobar"],
        },
    },
    {
        "type": "function",
        "name": "get_estacionamento",
        "description": "Vagas de estacionamento — livres/ocupadas/vinculadas.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_comprovantes",
        "description": "Comprovantes de pagamento emitidos (contas fechadas).",
        "parameters": {
            "type": "object",
            "properties": _props(
                busca={"type": "string", "description": "Hóspede, reserva ou acomodação"},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_formas_pagamento",
        "description": "Formas de pagamento aceitas pela pousada.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_notificacoes",
        "description": "Notificações operacionais recentes do sistema.",
        "parameters": {
            "type": "object",
            "properties": _props(
                limite={"type": "integer", "default": 10},
            ),
        },
    },
    {
        "type": "function",
        "name": "get_auditoria",
        "description": "Últimas ações registradas na auditoria (admin).",
        "parameters": {
            "type": "object",
            "properties": _props(
                limite={"type": "integer", "default": 15},
            ),
        },
    },
    {
        "type": "function",
        "name": "busca_global",
        "description": (
            "Busca global do sistema — acha reserva, cliente, acomodação, "
            "item de estoque ou funcionário por texto livre."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                q={"type": "string", "description": "Texto da busca"},
            ),
            "required": ["q"],
        },
    },
    {
        "type": "function",
        "name": "get_estabelecimento",
        "description": "Dados cadastrais e endereço da pousada.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "get_itens_mais_vendidos",
        "description": "Ranking de itens mais vendidos do período.",
        "parameters": {
            "type": "object",
            "properties": _props(
                inicio={"type": "string", "description": "Data inicial ISO"},
                fim={"type": "string", "description": "Data final ISO"},
            ),
        },
    },
    # ----- memória (aprendizado no dia a dia) -----
    {
        "type": "function",
        "name": "salvar_memoria",
        "description": (
            "Memoriza um fato durável que o usuário ensinou ou corrigiu "
            "(preferência, rotina da casa, informação operacional estável). "
            "escopo='pousada' vale para todos; 'usuario' só para quem falou. "
            "Não memorize dados sensíveis nem o que já está no sistema."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                escopo={"type": "string", "enum": ["usuario", "pousada"]},
                texto={"type": "string", "description": "Fato a memorizar, em uma frase"},
            ),
            "required": ["escopo", "texto"],
        },
    },
    {
        "type": "function",
        "name": "esquecer_memoria",
        "description": "Apaga uma memória pelo id (quando o usuário pede para esquecer).",
        "parameters": {
            "type": "object",
            "properties": _props(
                id={"type": "string", "description": "ID da memória"},
            ),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "listar_memorias",
        "description": "Lista o que a MAR IA memorizou (pousada + deste usuário).",
        "parameters": {"type": "object", "properties": {}},
    },
    # ----- ações de escrita (preparação) -----
    {
        "type": "function",
        "name": "preparar_reserva",
        "description": (
            "Prepara a criação de uma reserva: valida dados, consulta "
            "disponibilidade e devolve um resumo para confirmação. "
            "NÃO cria a reserva — a execução exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idcliente={"type": "integer", "description": "ID do hóspede (busque antes com get_clientes)"},
                idacomodacao={"type": "integer", "description": "ID da acomodação (consulte check_disponibilidade)"},
                entradaprevista={"type": "string", "description": "Entrada ISO"},
                saidaprevista={"type": "string", "description": "Saída ISO"},
                quantidade_hospedes={"type": "integer", "default": 1},
                valordiaria={"type": "number", "description": "Diária em reais, se informada"},
            ),
            "required": ["idcliente", "idacomodacao", "entradaprevista", "saidaprevista"],
        },
    },
    {
        "type": "function",
        "name": "preparar_cancelamento",
        "description": (
            "Prepara o cancelamento de uma reserva — devolve o resumo para "
            "confirmação. NÃO cancela diretamente."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer", "description": "Número da reserva"},
            ),
            "required": ["idreserva"],
        },
    },
    {
        "type": "function",
        "name": "preparar_checkin",
        "description": (
            "Prepara o check-in de uma reserva — devolve resumo para "
            "confirmação. NÃO executa; a execução exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer", "description": "Número da reserva"},
            ),
            "required": ["idreserva"],
        },
    },
    {
        "type": "function",
        "name": "preparar_checkout",
        "description": (
            "Prepara o check-out de uma reserva — devolve resumo para "
            "confirmação. NÃO executa; a execução exige confirmar_acao. "
            "Informe idforma_pagamento (get_formas_pagamento) — se ausente, "
            "usa a primeira forma ativa."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer", "description": "Número da reserva"},
                idforma_pagamento={"type": "integer", "description": "ID da forma de pagamento"},
                total_desconto={"type": "number", "description": "Desconto em reais, se houver"},
            ),
            "required": ["idreserva"],
        },
    },
    {
        "type": "function",
        "name": "preparar_consumo",
        "description": (
            "Prepara o lançamento de um item consumido na conta de uma "
            "reserva — exige confirmar_acao. iditem_frigobar é o ID do item "
            "DENTRO do frigobar (veja get_itens_frigobar)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer", "description": "Número da reserva"},
                iditem_frigobar={"type": "integer", "description": "ID do item no frigobar"},
                quantidade={"type": "integer", "default": 1},
            ),
            "required": ["idreserva", "iditem_frigobar"],
        },
    },
    # ----- CRUD completo — criação/edição por entidade -----
    {
        "type": "function",
        "name": "preparar_cliente",
        "description": (
            "Cria ou atualiza o cadastro de um hóspede. acao='criar' exige "
            "nome, cpf e data_nascimento; 'atualizar' exige id e só altera "
            "os campos informados. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer", "description": "ID do cliente (atualizar)"},
                nome={"type": "string"},
                cpf={"type": "string"},
                data_nascimento={"type": "string", "description": "ISO yyyy-mm-dd"},
                email={"type": "string"},
                telefone={"type": "string"},
                cidade={"type": "string"},
                estado={"type": "string", "description": "UF, ex.: CE"},
                nacionalidade={"type": "string"},
                profissao={"type": "string"},
            ),
            "required": ["acao", "nome"],
        },
    },
    {
        "type": "function",
        "name": "preparar_funcionario",
        "description": (
            "Cria ou atualiza um funcionário (admin). acao='criar' exige "
            "nome, login, senha e nivel (1=admin, 2=gerente, 3=recepção); "
            "'atualizar' altera só os campos informados. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                nome={"type": "string"},
                login={"type": "string"},
                senha={"type": "string"},
                nivel={"type": "integer", "description": "1 admin, 2 gerente, 3 recepção"},
                cpf={"type": "string"},
                data_nascimento={"type": "string"},
            ),
            "required": ["acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_tipo_acomodacao",
        "description": "Cria ou renomeia um tipo de acomodação (ex.: Suíte). Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                nome={"type": "string"},
            ),
            "required": ["acao", "nome"],
        },
    },
    {
        "type": "function",
        "name": "preparar_acomodacao",
        "description": (
            "Cria ou atualiza uma acomodação (suíte/quarto/chalé). Criar "
            "exige nome, numero e capacidade. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                idtipo_acomodacao={"type": "integer"},
                nome={"type": "string"},
                numero={"type": "integer"},
                valor={"type": "number", "description": "Diária em reais"},
                capacidade={"type": "integer"},
                descricao={"type": "string"},
                cor={"type": "string", "description": "Cor no mapa, ex.: #1a6f8a"},
            ),
            "required": ["acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_quarto",
        "description": "Cria um quarto físico dentro de uma acomodação. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                idacomodacao={"type": "integer"},
                numero={"type": "string", "description": "Número do quarto, ex.: '104'"},
            ),
            "required": ["idacomodacao", "numero"],
        },
    },
    {
        "type": "function",
        "name": "preparar_categoria_estoque",
        "description": "Cria uma categoria de estoque (ex.: 'Bebidas'). Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                nome={"type": "string"},
            ),
            "required": ["nome"],
        },
    },
    {
        "type": "function",
        "name": "preparar_item_estoque",
        "description": (
            "Cria ou atualiza um item de estoque. Criar exige nome; "
            "atualizar altera nome/categoria/preço. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                nome={"type": "string"},
                idcategoria={"type": "integer"},
                quantidade_inicial={"type": "integer"},
                valor_unitario={"type": "number"},
            ),
            "required": ["acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_movimentacao_estoque",
        "description": (
            "Entrada ou saída manual de estoque (ex.: chegaram 12 cervejas). "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                iditem={"type": "integer"},
                tipo={"type": "string", "enum": ["entrada", "saida"]},
                quantidade={"type": "integer"},
                motivo={"type": "string"},
            ),
            "required": ["iditem", "tipo", "quantidade"],
        },
    },
    {
        "type": "function",
        "name": "preparar_frigobar",
        "description": "Cria ou atualiza um frigobar vinculado a uma acomodação. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                idacomodacao={"type": "integer"},
                modelo={"type": "string"},
                patrimonio={"type": "string"},
            ),
            "required": ["acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_item_frigobar",
        "description": (
            "Adiciona produto ao frigobar (acao='criar': idfrigobar + "
            "iditem + quantidade) ou ajusta quantidade ('atualizar': id do "
            "item do frigobar + quantidade). Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer", "description": "ID do item do frigobar (atualizar)"},
                idfrigobar={"type": "integer"},
                iditem={"type": "integer", "description": "ID do item de estoque"},
                quantidade={"type": "integer"},
            ),
            "required": ["acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_vaga",
        "description": (
            "Cria vaga de estacionamento (acao='criar' + numero) ou vincula "
            "vaga a uma acomodação ('vincular' + idvaga + idacomodacao). "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "vincular"]},
                numero={"type": "string", "description": "Número/código da vaga"},
                idvaga={"type": "integer"},
                idacomodacao={"type": "integer", "description": "null desvincula"},
            ),
            "required": ["acao"],
        },
    },
    {
        "type": "function",
        "name": "preparar_forma_pagamento",
        "description": "Cria ou renomeia uma forma de pagamento. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                acao={"type": "string", "enum": ["criar", "atualizar"]},
                id={"type": "integer"},
                nome={"type": "string"},
            ),
            "required": ["acao", "nome"],
        },
    },
    {
        "type": "function",
        "name": "preparar_estabelecimento",
        "description": (
            "Atualiza dados cadastrais da pousada (admin): e-mail, "
            "telefone, celular, site, CNPJ, razão social ou impressora. "
            "Só altera campos informados. Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                cnpj={"type": "string"},
                razao_social={"type": "string"},
                site={"type": "string"},
                email={"type": "string"},
                telefone={"type": "string"},
                celular={"type": "string"},
                impressora_ip={"type": "string"},
                impressora_porta={"type": "integer"},
                impressora_ativa={"type": "boolean"},
            ),
        },
    },
    {
        "type": "function",
        "name": "preparar_endereco",
        "description": "Atualiza o endereço da pousada (admin). Só altera campos informados. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                logradouro={"type": "string"},
                numero={"type": "string"},
                complemento={"type": "string"},
                bairro={"type": "string"},
                cidade={"type": "string"},
                cep={"type": "string"},
            ),
        },
    },
    {
        "type": "function",
        "name": "preparar_acompanhante",
        "description": "Adiciona um acompanhante (criança, cônjuge) a uma reserva. Exige confirmar_acao.",
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer"},
                nome={"type": "string"},
                data_nascimento={"type": "string"},
                parentesco={"type": "string"},
                doc_tipo={"type": "string", "description": "rg, cpf, cnh, passaporte, rne, outro"},
                doc_numero={"type": "string"},
            ),
            "required": ["idreserva", "nome"],
        },
    },
    {
        "type": "function",
        "name": "preparar_adicional",
        "description": (
            "Lança um valor avulso na conta da reserva (ex.: late check-out "
            "R$ 80, taxa extra). Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idreserva={"type": "integer"},
                motivo={"type": "string"},
                valor={"type": "number"},
            ),
            "required": ["idreserva", "motivo", "valor"],
        },
    },
    # ----- status e exclusão genéricos (um tool p/ todas as entidades) -----
    {
        "type": "function",
        "name": "preparar_status",
        "description": (
            "Ativa ou desativa um registro (gerente+): cliente, funcionario "
            "(admin), tipo_acomodacao, acomodacao, quarto, categoria_estoque, "
            "item_estoque, frigobar, item_frigobar, vaga, forma_pagamento. "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={
                    "type": "string",
                    "enum": ["cliente", "funcionario", "tipo_acomodacao", "acomodacao",
                             "quarto", "categoria_estoque", "item_estoque", "frigobar",
                             "item_frigobar", "vaga", "forma_pagamento"],
                },
                id={"type": "integer"},
                ativo={"type": "boolean"},
            ),
            "required": ["tipo", "id", "ativo"],
        },
    },
    {
        "type": "function",
        "name": "preparar_excluir",
        "description": (
            "Exclui DEFINITIVAMENTE um registro (gerente+; funcionario só "
            "admin). Tipos: cliente, funcionario, tipo_acomodacao, "
            "acomodacao, quarto, categoria_estoque, item_estoque, frigobar, "
            "item_frigobar, vaga, forma_pagamento, reserva. Exige "
            "confirmar_acao — destrutivo."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                tipo={
                    "type": "string",
                    "enum": ["cliente", "funcionario", "tipo_acomodacao", "acomodacao",
                             "quarto", "categoria_estoque", "item_estoque", "frigobar",
                             "item_frigobar", "vaga", "forma_pagamento", "reserva"],
                },
                id={"type": "integer"},
            ),
            "required": ["tipo", "id"],
        },
    },
    {
        "type": "function",
        "name": "marcar_notificacao_lida",
        "description": "Marca uma notificação como lida (ação segura, sem confirmação).",
        "parameters": {
            "type": "object",
            "properties": _props(
                id={"type": "integer"},
            ),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "abrir_pagina",
        "description": (
            "Navega o usuário para uma tela do sistema — use quando pedir "
            "para abrir/mostrar/ir para uma página ('abre as reservas', "
            "'me leva ao estoque'), ou quando a resposta ficar melhor "
            "vendo a tela completa. Também abre o detalhe de uma reserva "
            "(pagina='reservas' + idreserva)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                pagina={
                    "type": "string",
                    "enum": ["dashboard", "reservas", "clientes", "acomodacoes",
                             "estoque", "frigobares", "estacionamento",
                             "pagamentos", "financeiro", "cms", "estabelecimento",
                             "funcionarios", "auditoria"],
                },
                idreserva={"type": "integer",
                           "description": "Para abrir o detalhe de uma reserva"},
            ),
            "required": ["pagina"],
        },
    },
    {
        "type": "function",
        "name": "confirmar_acao",
        "description": (
            "Executa a ação preparada APÓS confirmação explícita do usuário. "
            "Use somente quando o usuário confirmar (por voz ou botão)."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idacao={"type": "string", "description": "ID da ação preparada"},
            ),
            "required": ["idacao"],
        },
    },
    {
        "type": "function",
        "name": "get_fornecedores",
        "description": "Lista fornecedores cadastrados (nome, lead time, contato).",
        "parameters": {"type": "object", "properties": _props(
            apenas_ativos={"type": "boolean"})},
    },
    {
        "type": "function",
        "name": "get_pedidos_compra",
        "description": "Lista pedidos de compra (status, fornecedor, previsao, progresso).",
        "parameters": {"type": "object", "properties": _props(
            status={"type": "string", "enum": ["pendente", "parcial", "recebido", "cancelado"]})},
    },
    {
        "type": "function",
        "name": "sugerir_compras",
        "description": (
            "Itens com estoque no minimo ou abaixo — base para sugerir "
            "pedidos de compra ao usuario."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "preparar_pedido_compra",
        "description": (
            "Cria pedido de compra para um fornecedor — aprovado, gera "
            "tambem a conta a pagar (data prevista = hoje + lead time). "
            "Exige confirmar_acao."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                idfornecedor={"type": "integer"},
                itens={"type": "array", "items": {
                    "type": "object",
                    "properties": _props(
                        iditem={"type": "integer"},
                        quantidade={"type": "integer"},
                        valor_unit={"type": "number"}),
                    "required": ["iditem", "quantidade"],
                }},
                vencimento={"type": "string"},
                observacao={"type": "string"},
                gerar_pagamento={"type": "boolean"}),
            "required": ["idfornecedor", "itens"],
        },
    },
]

# Gerente/admin: operações destrutivas ou de alteração de cadastro.
_ACOES_RESTRITAS = {
    "preparar_cancelamento",
    "preparar_excluir",
    "preparar_status",
    "preparar_tipo_acomodacao",
    "preparar_acomodacao",
    "preparar_quarto",
    "preparar_categoria_estoque",
    "preparar_item_estoque",
    "preparar_frigobar",
    "preparar_item_frigobar",
    "preparar_vaga",
    "preparar_forma_pagamento",
    "preparar_pedido_compra",
}
# Somente administrador.
_ACOES_ADMIN = {
    "preparar_funcionario",
    "preparar_estabelecimento",
    "preparar_endereco",
}
# Mapa tipo → caminho REST (status e exclusão compartilham prefixos).
_PATHS: dict[str, str] = {
    "cliente": "/clientes",
    "funcionario": "/funcionarios",
    "tipo_acomodacao": "/tipos-acomodacao",
    "acomodacao": "/acomodacoes",
    "quarto": "/quartos",
    "categoria_estoque": "/estoque/categorias",
    "item_estoque": "/estoque/itens",
    "frigobar": "/frigobares",
    "item_frigobar": "/frigobares/itens",
    "vaga": "/estacionamento",
    "forma_pagamento": "/formas-pagamento",
    "reserva": "/reservas",
}
# Telas restritas a administrador (mesmo guard do router Angular).
_PAGINAS_ADMIN = {"cms", "estabelecimento", "funcionarios"}
_ROTULO_PAGINA = {
    "dashboard": "o Painel",
    "reservas": "as Reservas",
    "clientes": "os Hóspedes",
    "acomodacoes": "as Acomodações",
    "estoque": "o Estoque",
    "frigobares": "os Frigobares",
    "estacionamento": "o Estacionamento",
    "pagamentos": "os Pagamentos",
    "financeiro": "o Financeiro",
    "cms": "o Site/CMS",
    "estabelecimento": "o Estabelecimento",
    "funcionarios": "os Funcionários",
    "auditoria": "a Auditoria",
}
# Campos mutáveis por entidade (merge com o GET atual no PUT).
_CAMPOS_CLIENTE = ("nome", "cpf", "data_nascimento", "email", "telefone",
                   "cidade", "estado", "nacionalidade", "profissao")
_CAMPOS_FUNCIONARIO = ("nome", "login", "senha", "nivel", "cpf", "data_nascimento")
_CAMPOS_ACOMODACAO = ("idtipo_acomodacao", "nome", "numero", "valor",
                      "capacidade", "descricao", "cor")
_CAMPOS_ESTABELECIMENTO = ("cnpj", "razao_social", "site", "email", "telefone",
                           "celular", "impressora_ip", "impressora_porta",
                           "impressora_ativa")
_CAMPOS_ENDERECO = ("logradouro", "numero", "complemento", "bairro", "cidade", "cep")


class ToolExecutor:
    """Executa ferramentas contra a API real com o Bearer do usuário."""

    def __init__(self, api: PousadaApi, ator: Ator):
        self.api = api
        self.ator = ator
        self.tz = get_settings().tz
        # Ações preparadas aguardando confirmação (idempotentes por id).
        self._pendentes: dict[str, dict[str, Any]] = {}
        self._seq = 0

    async def run(self, nome: str, args: dict[str, Any]) -> dict[str, Any]:
        if nome in _ACOES_RESTRITAS and not self.ator.gerente_ou_admin:
            return {
                "erro": "permissão insuficiente",
                "mensagem": "Essa operação exige perfil Gerente ou Administrador.",
            }
        if nome in _ACOES_ADMIN and not self.ator.admin:
            return {
                "erro": "permissão insuficiente",
                "mensagem": "Essa operação exige perfil Administrador.",
            }
        try:
            if nome == "confirmar_acao":
                return await self._confirmar(args.get("idacao", ""))
            resultado = await self._dispatch(nome, args)
            if isinstance(resultado, dict) and resultado.get("status") == "preparada":
                self._seq += 1
                idacao = f"ac{self._seq}"
                self._pendentes[idacao] = {
                    "acao": resultado["acao"],
                    "args": dict(args),
                    "exec": resultado.get("exec"),
                    "msg": resultado.get("msg"),
                }
                resultado["idacao"] = idacao
            return resultado
        except ApiError as e:
            return {"erro": f"api {e.status}", "mensagem": e.detail}
        except Exception as e:  # falha interna — reporta sem stack ao modelo
            return {"erro": "interno", "mensagem": str(e)[:200]}

    def pendente(self, idacao: str) -> dict[str, Any] | None:
        return self._pendentes.get(idacao)

    async def _confirmar(self, idacao: str) -> dict[str, Any]:
        """Executa a ação preparada — único caminho de escrita real."""
        pend = self._pendentes.pop(idacao, None)
        if not pend:
            return {
                "erro": "acao_expirada",
                "mensagem": "Ação não encontrada ou já executada.",
            }
        if pend["acao"] == "criar_reserva":
            r = await self.api.post("/reservas", {
                "idcliente": pend["args"]["idcliente"],
                "idacomodacao": pend["args"]["idacomodacao"],
                "entradaprevista": pend["args"]["entradaprevista"],
                "saidaprevista": pend["args"]["saidaprevista"],
                "quantidade_hospedes": pend["args"].get("quantidade_hospedes", 1),
                "valordiaria": pend["args"].get("valordiaria"),
            })
            return {
                "status": "executada",
                "acao": "criar_reserva",
                "resultado": r,
                "mensagem": f"Reserva criada — nº {r.get('id', r.get('idreserva', '?'))}.",
            }
        if pend["acao"] == "cancelar_reserva":
            r = await self.api.post(
                f"/reservas/{pend['args']['idreserva']}/cancelar", {}
            )
            return {
                "status": "executada",
                "acao": "cancelar_reserva",
                "resultado": r,
                "mensagem": f"Reserva {pend['args']['idreserva']} cancelada.",
            }
        if pend["acao"] == "checkin":
            agora = datetime.now(self.tz)
            r = await self.api.post(
                f"/reservas/{pend['args']['idreserva']}/check-in",
                {"data": agora.date().isoformat(), "hora": agora.strftime("%H:%M")},
            )
            return {
                "status": "executada",
                "acao": "checkin",
                "resultado": r,
                "mensagem": f"Check-in da reserva {pend['args']['idreserva']} realizado.",
            }
        if pend["acao"] == "lancar_consumo":
            r = await self.api.post(
                f"/reservas/{pend['args']['idreserva']}/itens-consumidos",
                {
                    "iditem_frigobar": pend["args"]["iditem_frigobar"],
                    "quantidade": pend["args"].get("quantidade", 1),
                },
            )
            return {
                "status": "executada",
                "acao": "lancar_consumo",
                "resultado": r,
                "mensagem": "Consumo lançado na conta.",
            }
        # Execução genérica — CRUD novo carrega o plano REST pronto.
        if pend.get("exec"):
            ex = pend["exec"]
            r = await self.api.request(ex["metodo"], ex["path"], ex.get("corpo"))
            return {
                "status": "executada",
                "acao": pend["acao"],
                "resultado": r,
                "mensagem": pend.get("msg") or "Ação executada.",
            }
        return {"erro": "acao_desconhecida", "mensagem": pend["acao"]}

    async def _dispatch(self, nome: str, a: dict[str, Any]) -> dict[str, Any]:
        tz = self.tz
        match nome:
            case "get_reservas":
                p = await self.api.get("/reservas", {
                    "inicio": _data(a.get("inicio"), tz) if a.get("inicio") else None,
                    "fim": _data(a.get("fim"), tz) if a.get("fim") else None,
                    "status": a.get("status"),
                    "busca": a.get("busca"),
                    "por_pagina": min(int(a.get("porPagina") or 20), 50),
                })
                return {
                    "total": p.get("total", 0),
                    "reservas": [_resumo(r) for r in p.get("items", [])[:25]],
                }

            case "get_reserva_detalhe":
                r = await self.api.get(f"/reservas/{int(a['id'])}")
                return {"reserva": r}

            case "check_disponibilidade":
                ini = _data(a["inicio"], tz)
                fim = _data(a["fim"], tz)
                p = await self.api.get("/reservas/disponibilidade", {
                    "inicio": ini, "fim": fim,
                })
                return {
                    "periodo": {"inicio": ini, "fim": fim},
                    "disponibilidade": p,
                }

            case "get_hospedes_atuais":
                p = await self.api.get("/reservas", {
                    "status": "hospedado", "por_pagina": 50,
                })
                return {
                    "total": p.get("total", 0),
                    "hospedes": [_resumo(r) for r in p.get("items", [])],
                }

            case "get_checkins":
                d = _data(a.get("data"), tz)
                p = await self.api.get("/reservas", {
                    "inicio": d, "fim": d, "por_pagina": 50,
                })
                return {
                    "data": d,
                    "total": p.get("total", 0),
                    "chegadas": [_resumo(r) for r in p.get("items", [])],
                }

            case "get_checkouts":
                d = _data(a.get("data"), tz)
                # saída prevista = fim do período
                p = await self.api.get("/reservas", {
                    "fim": d, "por_pagina": 50,
                })
                saidas = [
                    r for r in p.get("items", [])
                    if str(r.get("saidaprevista", "")).startswith(d)
                ]
                return {"data": d, "total": len(saidas), "saidas": [_resumo(r) for r in saidas]}

            case "get_situacao_quartos":
                d = await self.api.get("/dashboard")
                c = d.get("cards", {})
                total = c.get("total_acomodacoes", 0)
                ocupadas = c.get("acomodacoes_ocupadas", 0)
                return {
                    "total_acomodacoes": total,
                    "ocupadas": ocupadas,
                    "disponiveis": c.get("acomodacoes_disponiveis", 0),
                    "hospedes_atuais": c.get("hospedes_atuais", 0),
                    "ocupacao_pct": round(ocupadas * 100 / total) if total else 0,
                    "nomes_disponiveis": [
                        a.get("nome") for a in d.get("acomodacoes_disponiveis", [])
                    ],
                    "nomes_ocupadas": [
                        a.get("nome") for a in d.get("acomodacoes_ocupadas", [])
                    ],
                }

            case "get_acomodacoes":
                p = await self.api.get("/acomodacoes")
                itens = p if isinstance(p, list) else p.get("items", [])
                return {
                    "acomodacoes": [
                        {
                            "id": x.get("id"),
                            "nome": x.get("nome"),
                            "numero": x.get("numero"),
                            "capacidade": x.get("capacidade"),
                            "valordiaria": x.get("valordiaria"),
                            "tipo": (x.get("tipo") or {}).get("nome") or x.get("tipo_nome"),
                            "ativa": x.get("ativo", True),
                        }
                        for x in itens
                        if x.get("ativo", True)
                    ]
                }

            case "get_clientes":
                p = await self.api.get("/clientes", {
                    "busca": a.get("busca"), "por_pagina": 10,
                })
                return {
                    "total": p.get("total", 0),
                    "clientes": [
                        {
                            "id": c.get("id"),
                            "nome": c.get("nome"),
                            "cpf": c.get("cpf"),
                            "cidade": c.get("cidade"),
                        }
                        for c in p.get("items", [])
                    ],
                }

            case "get_financeiro_resumo":
                ini = _data(a.get("inicio"), tz) if a.get("inicio") else None
                fim = _data(a.get("fim"), tz) if a.get("fim") else None
                return await self.api.get("/financeiro/resumo", {
                    "inicio": ini, "fim": fim,
                })

            case "get_dashboard":
                return await self.api.get("/dashboard")

            case "get_quartos":
                q = await self.api.get(f"/acomodacoes/{int(a['idacomodacao'])}/quartos")
                itens = q if isinstance(q, list) else q.get("items", q.get("quartos", []))
                return {
                    "quartos": [
                        {
                            "id": x.get("id"),
                            "numero": x.get("numero"),
                            "nome": x.get("nome"),
                            "status": x.get("status"),
                            "ativo": x.get("ativo", True),
                        }
                        for x in itens
                    ]
                }

            case "get_fornecedores":
                r = await self.api.get("/compras/fornecedores", {
                    "apenas_ativos": a.get("apenas_ativos", True)})
                return {"fornecedores": r}

            case "get_pedidos_compra":
                r = await self.api.get("/compras/pedidos", {
                    "status": a.get("status"), "por_pagina": 50})
                return {"total": r.get("total", 0),
                        "pedidos": r.get("items", [])}

            case "sugerir_compras":
                r = await self.api.get("/estoque/alertas")
                return {"itens_em_falta": r,
                        "dica": "Sugira pedido de compra com preparar_pedido_compra."}

            case "preparar_pedido_compra":
                return await self._preparar_pedido_compra(a)

            case "get_estoque":
                p = await self.api.get("/estoque/itens", {
                    "busca": a.get("busca"), "por_pagina": 50,
                })
                itens = p if isinstance(p, list) else p.get("items", [])
                saida = [
                    {
                        "id": x.get("id"),
                        "nome": x.get("nome"),
                        "quantidade": x.get("quantidade"),
                        "minimo": x.get("minimo") or x.get("estoque_minimo"),
                        "unidade": x.get("unidade"),
                        "categoria": (x.get("categoria") or {}).get("nome")
                            or x.get("categoria_nome"),
                        "preco": x.get("preco") or x.get("valor"),
                    }
                    for x in itens
                    if x.get("ativo", True)
                ]
                if a.get("critico"):
                    saida = [
                        x for x in saida
                        if x["minimo"] is not None
                        and x["quantidade"] is not None
                        and x["quantidade"] <= x["minimo"]
                    ]
                return {"total": len(saida), "itens": saida}

            case "get_movimentacoes_estoque":
                p = await self.api.get("/estoque/movimentacoes", {
                    "por_pagina": min(int(a.get("limite") or 15), 30),
                })
                itens = p if isinstance(p, list) else p.get("items", [])
                return {"movimentacoes": itens[:30]}

            case "get_frigobares":
                p = await self.api.get("/frigobares")
                itens = p if isinstance(p, list) else p.get("items", [])
                return {
                    "frigobares": [
                        {
                            "id": x.get("id"),
                            "nome": x.get("nome") or x.get("identificacao"),
                            "acomodacao": x.get("acomodacao_nome"),
                            "ativo": x.get("ativo", True),
                            "itens": x.get("total_itens"),
                        }
                        for x in itens
                    ]
                }

            case "get_itens_frigobar":
                p = await self.api.get(f"/frigobares/{int(a['idfrigobar'])}/itens")
                itens = p if isinstance(p, list) else p.get("items", [])
                return {"itens": itens}

            case "get_estacionamento":
                p = await self.api.get("/estacionamento")
                itens = p if isinstance(p, list) else p.get("items", [])
                vagas = [
                    {
                        "id": x.get("id"),
                        "codigo": x.get("codigo") or x.get("numero"),
                        "status": x.get("status"),
                        "idreserva": x.get("idreserva"),
                    }
                    for x in itens
                ]
                return {
                    "total": len(vagas),
                    "livres": sum(1 for v in vagas if str(v["status"]).lower() in ("livre", "disponivel", "disponível")),
                    "vagas": vagas,
                }

            case "get_comprovantes":
                p = await self.api.get("/pagamentos/comprovantes", {
                    "busca": a.get("busca"), "por_pagina": 20,
                })
                itens = p if isinstance(p, list) else p.get("items", [])
                return {
                    "total": p.get("total", len(itens)),
                    "comprovantes": [
                        {
                            "id": x.get("id"),
                            "reserva": x.get("idreserva"),
                            "hospede": x.get("cliente_nome"),
                            "total": x.get("valor_total") or x.get("total"),
                            "emitido_em": x.get("emitido_em") or x.get("criado_em"),
                        }
                        for x in itens
                    ],
                }

            case "get_formas_pagamento":
                p = await self.api.get("/formas-pagamento")
                itens = p if isinstance(p, list) else p.get("items", [])
                return {
                    "formas": [
                        {"id": x.get("id"), "nome": x.get("nome"), "ativa": x.get("ativo", True)}
                        for x in itens
                    ]
                }

            case "get_notificacoes":
                p = await self.api.get("/notificacoes", {
                    "por_pagina": min(int(a.get("limite") or 10), 30),
                })
                itens = p if isinstance(p, list) else (p.get("items") or p.get("notificacoes") or [])
                return {
                    "notificacoes": [
                        {
                            "titulo": x.get("titulo"),
                            "mensagem": x.get("mensagem"),
                            "tipo": x.get("tipo"),
                            "lida": x.get("lida"),
                            "criado_em": x.get("criado_em"),
                        }
                        for x in itens[:30]
                    ]
                }

            case "get_auditoria":
                if not self.ator.admin:
                    return {
                        "erro": "permissão insuficiente",
                        "mensagem": "Auditoria exige perfil Administrador.",
                    }
                p = await self.api.get("/auditoria/logs", {
                    "por_pagina": min(int(a.get("limite") or 15), 30),
                })
                itens = p if isinstance(p, list) else (p.get("items") or p.get("logs") or [])
                return {"logs": itens[:30]}

            case "busca_global":
                r = await self.api.get("/busca", {"q": a.get("q")})
                itens = r if isinstance(r, list) else r.get("items", [])
                return {
                    "resultados": [
                        {
                            "tipo": x.get("tipo"),
                            "id": x.get("id"),
                            "titulo": x.get("titulo"),
                            "sub": x.get("sub"),
                        }
                        for x in itens[:15]
                    ]
                }

            case "get_estabelecimento":
                est = await self.api.get("/estabelecimento")
                end = await self.api.get("/estabelecimento/endereco")
                return {"estabelecimento": est, "endereco": end}

            case "get_itens_mais_vendidos":
                ini = _data(a.get("inicio"), tz) if a.get("inicio") else None
                fim = _data(a.get("fim"), tz) if a.get("fim") else None
                return await self.api.get("/financeiro/itens-mais-vendidos", {
                    "inicio": ini, "fim": fim,
                })

            case "salvar_memoria":
                if not get_settings().maria_memory_enabled:
                    return {"erro": "memória desabilitada"}
                return await memory.lembrar(
                    a.get("escopo", "usuario"),
                    self.ator.idfuncionario,
                    a.get("texto", ""),
                )

            case "esquecer_memoria":
                return await memory.esquecer(str(a.get("id", "")))

            case "listar_memorias":
                return {"memorias": await memory.listar(self.ator.idfuncionario)}

            case "preparar_reserva":
                return await self._preparar_reserva(a)
            case "preparar_cancelamento":
                return await self._preparar_cancelamento(a)
            case "preparar_checkin":
                return await self._preparar_checkin(a)
            case "preparar_checkout":
                return await self._preparar_checkout(a)
            case "preparar_consumo":
                return await self._preparar_consumo(a)

            # ----- CRUD completo -----
            case "preparar_cliente":
                return await self._preparar_cliente(a)
            case "preparar_funcionario":
                return await self._preparar_funcionario(a)
            case "preparar_tipo_acomodacao":
                return await self._preparar_tipo(a)
            case "preparar_acomodacao":
                return await self._preparar_acomodacao(a)
            case "preparar_quarto":
                return self._exec(
                    "criar_quarto", "post",
                    f"/acomodacoes/{int(a['idacomodacao'])}/quartos",
                    {"numero": a["numero"]},
                    {"acomodacao": a.get("idacomodacao"), "numero": a["numero"]},
                    f"Quarto {a['numero']} criado.",
                )
            case "preparar_categoria_estoque":
                return self._exec(
                    "criar_categoria", "post", "/estoque/categorias",
                    {"nome": a["nome"]},
                    {"nome": a["nome"]},
                    f"Categoria '{a['nome']}' criada.",
                )
            case "preparar_item_estoque":
                return await self._preparar_item_estoque(a)
            case "preparar_movimentacao_estoque":
                return await self._preparar_movimentacao(a)
            case "preparar_frigobar":
                return await self._preparar_frigobar(a)
            case "preparar_item_frigobar":
                return await self._preparar_item_frigobar(a)
            case "preparar_vaga":
                return await self._preparar_vaga(a)
            case "preparar_forma_pagamento":
                return await self._preparar_forma_pagamento(a)
            case "preparar_estabelecimento":
                return await self._preparar_estabelecimento(a)
            case "preparar_endereco":
                return await self._preparar_endereco(a)
            case "preparar_acompanhante":
                return await self._preparar_acompanhante(a)
            case "preparar_adicional":
                return await self._preparar_adicional(a)
            case "preparar_status":
                return await self._preparar_status(a)
            case "preparar_excluir":
                return await self._preparar_excluir(a)
            case "marcar_notificacao_lida":
                await self.api.post(f"/notificacoes/{int(a['id'])}/ler", {})
                return {"ok": True, "mensagem": "Notificação marcada como lida."}

            case "abrir_pagina":
                pagina = a["pagina"]
                if pagina in _PAGINAS_ADMIN and not self.ator.admin:
                    return {
                        "erro": "permissão insuficiente",
                        "mensagem": f"A tela de {pagina} é exclusiva de Administrador.",
                    }
                if a.get("idreserva") and pagina == "reservas":
                    rota = f"/reservas/{int(a['idreserva'])}"
                else:
                    rota = f"/{pagina}"
                return {
                    "navegar": rota,
                    "pagina": pagina,
                    "mensagem": f"Abrindo {_ROTULO_PAGINA.get(pagina, pagina)}…",
                }

            case _:
                return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}

    # ------------------------------------------------------------- ações --

    async def _preparar_reserva(self, a: dict[str, Any]) -> dict[str, Any]:
        ini = _data(a["entradaprevista"], self.tz)
        fim = _data(a["saidaprevista"], self.tz)
        disp = await self.api.get("/reservas/disponibilidade", {
            "inicio": ini, "fim": fim,
        })
        # tenta achar a acomodação pedida ainda disponível
        livres = disp.get("acomodacoes") or disp.get("disponiveis") or []
        alvo = next(
            (x for x in livres if x.get("id") == a.get("idacomodacao")),
            None,
        )
        disponivel = alvo is not None if livres else None
        return {
            "status": "preparada",
            "acao": "criar_reserva",
            "disponivel_agora": disponivel,
            "resumo": {
                "idcliente": a.get("idcliente"),
                "idacomodacao": a.get("idacomodacao"),
                "acomodacao": (alvo or {}).get("nome"),
                "entradaprevista": ini,
                "saidaprevista": fim,
                "quantidade_hospedes": a.get("quantidade_hospedes", 1),
                "valordiaria": a.get("valordiaria"),
            },
            "instrucao": (
                "Apresente este resumo ao usuário e peça confirmação. "
                "A criação real ocorre somente com confirmar_acao."
            ),
        }

    async def _preparar_cancelamento(self, a: dict[str, Any]) -> dict[str, Any]:
        r = await self.api.get(f"/reservas/{int(a['idreserva'])}")
        return {
            "status": "preparada",
            "acao": "cancelar_reserva",
            "resumo": {
                "id": r.get("id"),
                "hospede": r.get("cliente_nome") or (r.get("cliente") or {}).get("nome"),
                "acomodacao": r.get("acomodacao_nome"),
                "status": r.get("status"),
            },
            "instrucao": (
                "Apresente o resumo e peça confirmação explícita. "
                "O cancelamento real ocorre somente com confirmar_acao."
            ),
        }

    async def _resumo_reserva(self, idreserva: int) -> dict[str, Any]:
        r = await self.api.get(f"/reservas/{idreserva}")
        return {
            "id": r.get("id"),
            "hospede": r.get("cliente_nome") or (r.get("cliente") or {}).get("nome"),
            "acomodacao": r.get("acomodacao_nome"),
            "status": r.get("status"),
        }

    async def _preparar_checkin(self, a: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": "preparada",
            "acao": "checkin",
            "resumo": await self._resumo_reserva(int(a["idreserva"])),
            "instrucao": "Peça confirmação — o check-in real ocorre com confirmar_acao.",
        }

    async def _preparar_checkout(self, a: dict[str, Any]) -> dict[str, Any]:
        resumo = await self._resumo_reserva(int(a["idreserva"]))
        # forma de pagamento: usa a informada ou a 1ª ativa (visível no card)
        idforma = a.get("idforma_pagamento")
        formas = await self.api.get("/formas-pagamento")
        itens = formas if isinstance(formas, list) else formas.get("items", [])
        ativas = [f for f in itens if f.get("ativo", True)]
        escolhida = next((f for f in ativas if f.get("id") == idforma), None) or (
            ativas[0] if ativas else None
        )
        corpo: dict[str, Any] = {
            "idforma_pagamento": (escolhida or {}).get("id"),
            "adicionais": [],
        }
        if a.get("total_desconto") is not None:
            corpo["total_desconto"] = a["total_desconto"]
        resumo["pagamento"] = (escolhida or {}).get("nome") or "—"
        if a.get("total_desconto"):
            resumo["desconto"] = a["total_desconto"]
        return self._exec(
            "checkout", "post",
            f"/reservas/{int(a['idreserva'])}/check-out", corpo,
            resumo, f"Check-out da reserva {a['idreserva']} realizado.",
        )

    async def _preparar_consumo(self, a: dict[str, Any]) -> dict[str, Any]:
        resumo = await self._resumo_reserva(int(a["idreserva"]))
        resumo["quantidade"] = a.get("quantidade", 1)
        try:
            item = await self.api.get(f"/frigobares/itens/{int(a['iditem_frigobar'])}")
            resumo["item"] = item.get("nome") or item.get("item_nome")
            resumo["valor_unitario"] = item.get("preco") or item.get("valor")
        except ApiError:
            resumo["item_frigobar"] = a["iditem_frigobar"]
        return {
            "status": "preparada",
            "acao": "lancar_consumo",
            "resumo": resumo,
            "instrucao": "Peça confirmação — o lançamento real ocorre com confirmar_acao.",
        }

    # ------------------------------------------------------ CRUD genérico --

    async def _preparar_pedido_compra(self, a: dict[str, Any]) -> dict[str, Any]:
        forn = None
        try:
            forn = await self.api.get(
                f"/compras/fornecedores/{int(a['idfornecedor'])}")
        except ApiError:
            pass
        corpo = {
            "idfornecedor": int(a["idfornecedor"]),
            "origem": "maria",
            "itens": [
                {"iditem": int(i["iditem"]),
                 "quantidade": int(i["quantidade"]),
                 **({"valor_unit": i["valor_unit"]} if i.get("valor_unit") is not None else {})}
                for i in a["itens"]
            ],
            "gerar_pagamento": a.get("gerar_pagamento", True),
        }
        if a.get("vencimento"):
            corpo["vencimento"] = a["vencimento"]
        if a.get("observacao"):
            corpo["observacao"] = a["observacao"]
        return self._exec(
            "criar_pedido_compra", "post", "/compras/pedidos", corpo,
            {"fornecedor": (forn or {}).get("nome") or a["idfornecedor"],
             "itens": len(corpo["itens"]),
             "gerar_pagamento": corpo["gerar_pagamento"]},
            "Pedido de compra criado com conta a pagar.",
        )

    def _exec(
        self,
        acao: str,
        metodo: str,
        path: str,
        corpo: dict[str, Any] | None,
        resumo: dict[str, Any],
        msg: str,
    ) -> dict[str, Any]:
        """Plano de execução para o card de confirmação — o `_confirmar`
        genérico roda `metodo path corpo` após o usuário aprovar."""
        return {
            "status": "preparada",
            "acao": acao,
            "exec": {"metodo": metodo, "path": path, "corpo": corpo},
            "msg": msg,
            "resumo": resumo,
            "instrucao": (
                "Apresente o resumo e peça confirmação explícita — "
                "a ação real ocorre somente com confirmar_acao."
            ),
        }

    async def _versao(self, get_path: str, list_path: str, id_: int) -> int | None:
        """Conc. otimista: tenta GET único; cai para a lista se não existir."""
        try:
            x = await self.api.get(get_path)
            if isinstance(x, dict):
                return x.get("version")
        except ApiError:
            pass
        try:
            p = await self.api.get(list_path)
            itens = p if isinstance(p, list) else p.get("items", [])
            x = next((i for i in itens if i.get("id") == id_), None)
            return (x or {}).get("version")
        except ApiError:
            return None

    def _campos(self, a: dict[str, Any], atual: dict[str, Any] | None,
                campos: tuple[str, ...]) -> dict[str, Any]:
        """Mescla campos informados com o registro atual (PUT completo)."""
        return {
            k: (a[k] if a.get(k) is not None else (atual or {}).get(k))
            for k in campos
        }

    async def _preparar_cliente(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            if not (a.get("cpf") and a.get("data_nascimento")):
                return {
                    "erro": "dados_incompletos",
                    "mensagem": "Cadastrar hóspede exige nome, CPF e data de nascimento.",
                }
            corpo = {k: a.get(k) for k in _CAMPOS_CLIENTE if a.get(k) is not None}
            return self._exec(
                "criar_cliente", "post", "/clientes", corpo,
                {"nome": a["nome"], "cpf": a.get("cpf")},
                f"Hóspede {a['nome']} cadastrado.",
            )
        cid = int(a["id"])
        atual = await self.api.get(f"/clientes/{cid}")
        corpo = self._campos(a, atual, _CAMPOS_CLIENTE)
        corpo["version"] = atual.get("version")
        return self._exec(
            "atualizar_cliente", "put", f"/clientes/{cid}", corpo,
            {"hospede": atual.get("nome"), "alterando": ", ".join(
                k for k in _CAMPOS_CLIENTE if a.get(k) is not None)},
            "Cadastro do hóspede atualizado.",
        )

    async def _preparar_funcionario(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            faltam = [k for k in ("nome", "login", "senha", "nivel") if a.get(k) is None]
            if faltam:
                return {
                    "erro": "dados_incompletos",
                    "mensagem": f"Criar funcionário exige: {', '.join(faltam)}.",
                }
            corpo = {k: a.get(k) for k in _CAMPOS_FUNCIONARIO if a.get(k) is not None}
            return self._exec(
                "criar_funcionario", "post", "/funcionarios", corpo,
                {"nome": a["nome"], "login": a.get("login"), "nivel": a.get("nivel")},
                f"Funcionário {a['nome']} criado.",
            )
        fid = int(a["id"])
        version = await self._versao(f"/funcionarios/{fid}", "/funcionarios", fid)
        corpo = {k: a[k] for k in _CAMPOS_FUNCIONARIO if a.get(k) is not None}
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_funcionario", "put", f"/funcionarios/{fid}", corpo,
            {"id": fid, "alterando": ", ".join(
                k for k in corpo if k != "version")},
            "Funcionário atualizado.",
        )

    async def _preparar_tipo(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            return self._exec(
                "criar_tipo_acomodacao", "post", "/tipos-acomodacao",
                {"nome": a["nome"]}, {"nome": a["nome"]},
                f"Tipo '{a['nome']}' criado.",
            )
        tid = int(a["id"])
        version = await self._versao(f"/tipos-acomodacao/{tid}", "/tipos-acomodacao", tid)
        corpo: dict[str, Any] = {"nome": a["nome"]}
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_tipo_acomodacao", "put", f"/tipos-acomodacao/{tid}", corpo,
            {"id": tid, "nome": a["nome"]}, "Tipo de acomodação atualizado.",
        )

    async def _preparar_acomodacao(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            faltam = [k for k in ("nome", "numero", "capacidade") if a.get(k) is None]
            if faltam:
                return {
                    "erro": "dados_incompletos",
                    "mensagem": f"Criar acomodação exige: {', '.join(faltam)}.",
                }
            corpo = {k: a.get(k) for k in _CAMPOS_ACOMODACAO if a.get(k) is not None}
            return self._exec(
                "criar_acomodacao", "post", "/acomodacoes", corpo,
                {"nome": a["nome"], "numero": a.get("numero"),
                 "capacidade": a.get("capacidade")},
                f"Acomodação {a['nome']} criada.",
            )
        aid = int(a["id"])
        atual = await self.api.get(f"/acomodacoes/{aid}")
        corpo = self._campos(a, atual, _CAMPOS_ACOMODACAO)
        corpo["version"] = atual.get("version")
        return self._exec(
            "atualizar_acomodacao", "put", f"/acomodacoes/{aid}", corpo,
            {"acomodacao": atual.get("nome"), "alterando": ", ".join(
                k for k in _CAMPOS_ACOMODACAO if a.get(k) is not None)},
            "Acomodação atualizada.",
        )

    async def _preparar_item_estoque(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            if not a.get("nome"):
                return {"erro": "dados_incompletos", "mensagem": "Informe o nome do item."}
            corpo = {
                k: a.get(k)
                for k in ("nome", "idcategoria", "quantidade_inicial", "valor_unitario")
                if a.get(k) is not None
            }
            return self._exec(
                "criar_item_estoque", "post", "/estoque/itens", corpo,
                {"nome": a["nome"], "quantidade": a.get("quantidade_inicial"),
                 "preco": a.get("valor_unitario")},
                f"Item {a['nome']} cadastrado no estoque.",
            )
        iid = int(a["id"])
        version = await self._versao(f"/estoque/itens/{iid}", "/estoque/itens", iid)
        corpo = {
            k: a[k]
            for k in ("nome", "idcategoria", "valor_unitario")
            if a.get(k) is not None
        }
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_item_estoque", "put", f"/estoque/itens/{iid}", corpo,
            {"id": iid, "alterando": ", ".join(k for k in corpo if k != "version")},
            "Item de estoque atualizado.",
        )

    async def _preparar_movimentacao(self, a: dict[str, Any]) -> dict[str, Any]:
        nome_item = None
        try:
            item = await self.api.get(f"/estoque/itens/{int(a['iditem'])}")
            nome_item = item.get("nome")
        except ApiError:
            pass
        corpo = {"movimentos": [{
            "iditem": int(a["iditem"]),
            "tipo": a["tipo"],
            "quantidade": int(a["quantidade"]),
            "motivo": a.get("motivo") or f"lançamento via MAR IA",
        }]}
        return self._exec(
            "movimentar_estoque", "post", "/estoque/movimentacoes", corpo,
            {"item": nome_item or a["iditem"], "tipo": a["tipo"],
             "quantidade": a["quantidade"], "motivo": a.get("motivo") or "—"},
            f"{a['tipo'].capitalize()} de {a['quantidade']} un. registrada.",
        )

    async def _preparar_frigobar(self, a: dict[str, Any]) -> dict[str, Any]:
        campos = ("idacomodacao", "modelo", "patrimonio")
        if a["acao"] == "criar":
            if a.get("idacomodacao") is None:
                return {"erro": "dados_incompletos",
                        "mensagem": "Informe a acomodação do frigobar."}
            corpo = {k: a.get(k) for k in campos if a.get(k) is not None}
            return self._exec(
                "criar_frigobar", "post", "/frigobares", corpo,
                {"acomodacao": a.get("idacomodacao"), "modelo": a.get("modelo")},
                "Frigobar criado.",
            )
        fid = int(a["id"])
        version = await self._versao(f"/frigobares/{fid}", "/frigobares", fid)
        corpo = {k: a[k] for k in campos if a.get(k) is not None}
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_frigobar", "put", f"/frigobares/{fid}", corpo,
            {"id": fid}, "Frigobar atualizado.",
        )

    async def _preparar_item_frigobar(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            if a.get("idfrigobar") is None or a.get("iditem") is None:
                return {"erro": "dados_incompletos",
                        "mensagem": "Informe idfrigobar e iditem."}
            corpo = {"iditem": int(a["iditem"]),
                     "quantidade": int(a.get("quantidade", 1))}
            return self._exec(
                "adicionar_item_frigobar", "post",
                f"/frigobares/{int(a['idfrigobar'])}/itens", corpo,
                {"frigobar": a.get("idfrigobar"), "item": a.get("iditem"),
                 "quantidade": corpo["quantidade"]},
                "Item adicionado ao frigobar.",
            )
        iid = int(a["id"])
        version = await self._versao(f"/frigobares/itens/{iid}", "/frigobares", iid)
        corpo: dict[str, Any] = {"quantidade": int(a.get("quantidade", 0))}
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_item_frigobar", "put", f"/frigobares/itens/{iid}", corpo,
            {"id": iid, "quantidade": corpo["quantidade"]},
            "Quantidade do item no frigobar atualizada.",
        )

    async def _preparar_vaga(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            if not a.get("numero"):
                return {"erro": "dados_incompletos",
                        "mensagem": "Informe o número da vaga."}
            return self._exec(
                "criar_vaga", "post", "/estacionamento",
                {"numero": a["numero"]}, {"numero": a["numero"]},
                f"Vaga {a['numero']} criada.",
            )
        vid = int(a["idvaga"])
        corpo = {"idacomodacao": a.get("idacomodacao")}
        return self._exec(
            "vincular_vaga", "patch", f"/estacionamento/{vid}/vinculo", corpo,
            {"vaga": vid, "acomodacao": a.get("idacomodacao") or "desvincular"},
            "Vínculo da vaga atualizado.",
        )

    async def _preparar_forma_pagamento(self, a: dict[str, Any]) -> dict[str, Any]:
        if a["acao"] == "criar":
            return self._exec(
                "criar_forma_pagamento", "post", "/formas-pagamento",
                {"nome": a["nome"]}, {"nome": a["nome"]},
                f"Forma de pagamento '{a['nome']}' criada.",
            )
        fid = int(a["id"])
        version = await self._versao(
            f"/formas-pagamento/{fid}", "/formas-pagamento", fid)
        corpo: dict[str, Any] = {"nome": a["nome"]}
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_forma_pagamento", "put", f"/formas-pagamento/{fid}", corpo,
            {"id": fid, "nome": a["nome"]}, "Forma de pagamento atualizada.",
        )

    async def _preparar_estabelecimento(self, a: dict[str, Any]) -> dict[str, Any]:
        atual = await self.api.get("/estabelecimento")
        corpo = self._campos(a, atual, _CAMPOS_ESTABELECIMENTO)
        corpo["version"] = atual.get("version")
        alterando = [k for k in _CAMPOS_ESTABELECIMENTO if a.get(k) is not None]
        return self._exec(
            "atualizar_estabelecimento", "put", "/estabelecimento", corpo,
            {"alterando": ", ".join(alterando)},
            "Dados da pousada atualizados.",
        )

    async def _preparar_endereco(self, a: dict[str, Any]) -> dict[str, Any]:
        atual = await self.api.get("/estabelecimento/endereco")
        corpo = self._campos(a, atual, _CAMPOS_ENDERECO)
        corpo["version"] = atual.get("version")
        alterando = [k for k in _CAMPOS_ENDERECO if a.get(k) is not None]
        return self._exec(
            "atualizar_endereco", "put", "/estabelecimento/endereco", corpo,
            {"alterando": ", ".join(alterando)},
            "Endereço da pousada atualizado.",
        )

    async def _preparar_acompanhante(self, a: dict[str, Any]) -> dict[str, Any]:
        resumo = await self._resumo_reserva(int(a["idreserva"]))
        corpo = {
            k: a.get(k)
            for k in ("nome", "data_nascimento", "parentesco", "doc_tipo", "doc_numero")
            if a.get(k) is not None
        }
        resumo["acompanhante"] = a["nome"]
        return self._exec(
            "adicionar_acompanhante", "post",
            f"/reservas/{int(a['idreserva'])}/acompanhantes", corpo,
            resumo, f"Acompanhante {a['nome']} adicionado à reserva {a['idreserva']}.",
        )

    async def _preparar_adicional(self, a: dict[str, Any]) -> dict[str, Any]:
        resumo = await self._resumo_reserva(int(a["idreserva"]))
        resumo["motivo"] = a["motivo"]
        resumo["valor"] = a["valor"]
        return self._exec(
            "lancar_adicional", "post",
            f"/reservas/{int(a['idreserva'])}/adicionais",
            {"motivo": a["motivo"], "valor": a["valor"]},
            resumo, f"Adicional de R$ {a['valor']} lançado ({a['motivo']}).",
        )

    async def _preparar_status(self, a: dict[str, Any]) -> dict[str, Any]:
        tipo = a["tipo"]
        if tipo == "funcionario" and not self.ator.admin:
            return {"erro": "permissão insuficiente",
                    "mensagem": "Status de funcionário exige Administrador."}
        if tipo == "reserva":
            return {"erro": "tipo_invalido",
                    "mensagem": "Reserva não tem status por PATCH — use cancelar/check-in/check-out."}
        base = _PATHS[tipo]
        iid = int(a["id"])
        nome = None
        try:
            x = await self.api.get(f"{base}/{iid}")
            nome = x.get("nome") or x.get("numero")
        except ApiError:
            pass
        return self._exec(
            f"status_{tipo}", "patch", f"{base}/{iid}/status",
            {"ativo": bool(a["ativo"])},
            {"tipo": tipo, "id": iid, "registro": nome,
             "operacao": "ativar" if a["ativo"] else "desativar"},
            f"{tipo.replace('_', ' ')} {'ativado' if a['ativo'] else 'desativado'}.",
        )

    async def _preparar_excluir(self, a: dict[str, Any]) -> dict[str, Any]:
        tipo = a["tipo"]
        if tipo == "funcionario" and not self.ator.admin:
            return {"erro": "permissão insuficiente",
                    "mensagem": "Excluir funcionário exige Administrador."}
        base = _PATHS[tipo]
        iid = int(a["id"])
        nome = None
        try:
            x = await self.api.get(f"{base}/{iid}")
            nome = x.get("nome") or x.get("numero") or x.get("cliente_nome")
        except ApiError:
            pass
        return self._exec(
            f"excluir_{tipo}", "delete", f"{base}/{iid}", None,
            {"tipo": tipo, "id": iid, "registro": nome,
             "operacao": "EXCLUIR (permanente)"},
            f"{tipo.replace('_', ' ')} excluído.",
        )


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
