"""Ações preparadas de reservas e cadastros + navegação.

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from .constantes import _PAGINAS_ADMIN, _ROTA_PAGINA, _ROTULO_PAGINA
from .helpers import _props

SCHEMAS: list[dict[str, Any]] = [
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
                             "estoque", "insumos", "compras", "frigobares",
                             "estacionamento", "pagamentos", "pdv", "cozinha",
                             "cafe", "financeiro", "financeiro_contas",
                             "financeiro_fluxo", "financeiro_dre",
                             "financeiro_conciliacao", "financeiro_split",
                             "financeiro_caixa", "cms", "estabelecimento",
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
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    """Despacha as tools deste domínio. `ex` é o ToolExecutor
    (api, ator, tz, _exec, _preparar_*).
    """
    match nome:
        case "preparar_reserva":
            return await ex._preparar_reserva(a)
        case "preparar_cancelamento":
            return await ex._preparar_cancelamento(a)
        case "preparar_checkin":
            return await ex._preparar_checkin(a)
        case "preparar_checkout":
            return await ex._preparar_checkout(a)
        case "preparar_consumo":
            return await ex._preparar_consumo(a)

        # ----- CRUD completo -----
        case "preparar_cliente":
            return await ex._preparar_cliente(a)
        case "preparar_funcionario":
            return await ex._preparar_funcionario(a)
        case "preparar_tipo_acomodacao":
            return await ex._preparar_tipo(a)
        case "preparar_acomodacao":
            return await ex._preparar_acomodacao(a)
        case "preparar_quarto":
            return ex._exec(
                "criar_quarto", "post",
                f"/acomodacoes/{int(a['idacomodacao'])}/quartos",
                {"numero": a["numero"]},
                {"acomodacao": a.get("idacomodacao"), "numero": a["numero"]},
                f"Quarto {a['numero']} criado.",
            )
        case "preparar_categoria_estoque":
            return ex._exec(
                "criar_categoria", "post", "/estoque/categorias",
                {"nome": a["nome"]},
                {"nome": a["nome"]},
                f"Categoria '{a['nome']}' criada.",
            )
        case "preparar_item_estoque":
            return await ex._preparar_item_estoque(a)
        case "preparar_movimentacao_estoque":
            return await ex._preparar_movimentacao(a)
        case "preparar_frigobar":
            return await ex._preparar_frigobar(a)
        case "preparar_item_frigobar":
            return await ex._preparar_item_frigobar(a)
        case "preparar_vaga":
            return await ex._preparar_vaga(a)
        case "preparar_forma_pagamento":
            return await ex._preparar_forma_pagamento(a)
        case "preparar_estabelecimento":
            return await ex._preparar_estabelecimento(a)
        case "preparar_endereco":
            return await ex._preparar_endereco(a)
        case "preparar_acompanhante":
            return await ex._preparar_acompanhante(a)
        case "preparar_adicional":
            return await ex._preparar_adicional(a)
        case "preparar_status":
            return await ex._preparar_status(a)
        case "preparar_excluir":
            return await ex._preparar_excluir(a)
        case "marcar_notificacao_lida":
            await ex.api.post(f"/notificacoes/{int(a['id'])}/ler", {})
            return {"ok": True, "mensagem": "Notificação marcada como lida."}

        # ================= PDV / café / caixa / tesouraria =================
        case "abrir_pagina":
            pagina = a["pagina"]
            if pagina in _PAGINAS_ADMIN and not ex.ator.admin:
                return {
                    "erro": "permissão insuficiente",
                    "mensagem": f"A tela de {pagina} é exclusiva de Administrador.",
                }
            if a.get("idreserva") and pagina == "reservas":
                rota = f"/reservas/{int(a['idreserva'])}"
            else:
                rota = _ROTA_PAGINA.get(pagina, f"/{pagina}")
            return {
                "navegar": rota,
                "pagina": pagina,
                "mensagem": f"Abrindo {_ROTULO_PAGINA.get(pagina, pagina)}…",
            }

        case _:
            return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}
