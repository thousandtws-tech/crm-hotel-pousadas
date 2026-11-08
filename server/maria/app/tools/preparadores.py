"""Mixin de preparação de ações — constrói resumos/planos para o
fluxo preparar→confirmar (herdada por ToolExecutor).

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from ..infra.api_client import ApiError
from .constantes import (
    _CAMPOS_ACOMODACAO,
    _CAMPOS_CLIENTE,
    _CAMPOS_ENDERECO,
    _CAMPOS_ESTABELECIMENTO,
    _CAMPOS_FUNCIONARIO,
    _PATHS,
)
from .helpers import _data


class Preparadores:
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
            "motivo": a.get("motivo") or "lançamento via MAR IA",
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

    async def _preparar_conta_financeira(self, a: dict[str, Any]) -> dict[str, Any]:
        campos = ("nome", "tipo", "banco", "agencia", "conta",
                  "saldo_inicial", "saldo_inicial_em")
        if a["acao"] == "criar":
            if not (a.get("nome") and a.get("tipo")):
                return {
                    "erro": "dados_incompletos",
                    "mensagem": "Criar conta exige nome e tipo (caixa/banco/aplicacao).",
                }
            corpo = {k: a.get(k) for k in campos if a.get(k) is not None}
            return self._exec(
                "criar_conta_financeira", "post", "/financeiro/contas", corpo,
                {"nome": a["nome"], "tipo": a["tipo"]},
                f"Conta {a['nome']} criada.",
            )
        cid = int(a["id"])
        version = await self._versao(
            f"/financeiro/contas/{cid}", "/financeiro/contas", cid)
        corpo = {k: a[k] for k in campos if a.get(k) is not None}
        if version is not None:
            corpo["version"] = version
        return self._exec(
            "atualizar_conta_financeira", "put",
            f"/financeiro/contas/{cid}", corpo,
            {"id": cid, "alterando": ", ".join(
                k for k in corpo if k != "version")},
            "Conta financeira atualizada.",
        )


