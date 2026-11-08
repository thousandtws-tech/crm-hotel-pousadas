"""Constantes de domínio das ferramentas — permissões, caminhos
REST, telas e campos mutáveis. Separadas para facilitar revisão
de segurança em um só lugar.
"""


# Gerente/admin: operações destrutivas, financeiras ou de cadastro.
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
    "preparar_cancelar_comanda",
    "preparar_pagar_comissao",
    "preparar_abrir_caixa",
    "preparar_movimento_caixa",
    "preparar_fechar_caixa",
    "preparar_lancamento",
    "preparar_baixa_lancamento",
    "preparar_cancelar_lancamento",
    "preparar_plano_conta",
    "preparar_conta_financeira",
    "preparar_fornecedor",
    "preparar_receber_pedido",
    "preparar_cancelar_pedido",
    "preparar_mesa",
}
# Leituras restritas a gerente/admin (dados financeiros e cadastros
# sensíveis — defense-in-depth além do RBAC do backend).
_LEITURAS_RESTRITAS = {
    "get_plano_contas",
    "get_contas_financeiras",
    "get_lancamentos",
    "get_fluxo_caixa",
    "get_dre",
    "get_extrato",
    "get_serie_financeira",
    "get_split_resumo",
    "get_comissoes",
    "get_caixa_turnos",
    "get_funcionarios",
}
# Somente administrador.
_ACOES_ADMIN = {
    "preparar_funcionario",
    "preparar_estabelecimento",
    "preparar_endereco",
}
_LEITURAS_ADMIN = {
    "get_cms_acomodacoes",
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
    "insumos": "os Insumos",
    "compras": "as Compras",
    "frigobares": "os Frigobares",
    "estacionamento": "o Estacionamento",
    "pagamentos": "os Pagamentos",
    "pdv": "o PDV/Salão",
    "cozinha": "a Cozinha",
    "cafe": "o Café da Manhã",
    "financeiro": "o Financeiro",
    "financeiro_contas": "as Contas e Lançamentos",
    "financeiro_fluxo": "o Fluxo de Caixa",
    "financeiro_dre": "o DRE",
    "financeiro_conciliacao": "a Conciliação",
    "financeiro_split": "o Split de Tributos",
    "financeiro_caixa": "o Caixa",
    "cms": "o Site/CMS",
    "estabelecimento": "o Estabelecimento",
    "funcionarios": "os Funcionários",
    "auditoria": "a Auditoria",
}
# Páginas cuja rota não é simplesmente "/<pagina>".
_ROTA_PAGINA = {
    "financeiro_contas": "/financeiro/contas",
    "financeiro_fluxo": "/financeiro/fluxo-caixa",
    "financeiro_dre": "/financeiro/dre",
    "financeiro_conciliacao": "/financeiro/conciliacao",
    "financeiro_split": "/financeiro/split",
    "financeiro_caixa": "/financeiro/caixa",
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


