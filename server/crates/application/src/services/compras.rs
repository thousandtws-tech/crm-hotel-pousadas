//! Casos de uso de compras: fornecedores, pedidos com a pagar e recebimento.

use crate::actor::Ator;
use crate::dto::{FornecedorInput, PedidoCompraInput, RecebimentoRequest};
use crate::error::AppResult;
use clarituz_domain::entities::{Fornecedor, PedidoCompra, PedidoCompraItem};
use clarituz_domain::ports::{
    ComprasRepository, EstoqueRepository, NovoFornecedor, NovoPedido, NovoPedidoItem,
    RecebimentoItem,
};
use clarituz_domain::queries::{PedidoCompraView, PedidoItemView};
use clarituz_domain::DomainError;
use clarituz_shared::{money, Page, PageParams};
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct ComprasService {
    repo: Arc<dyn ComprasRepository>,
    estoque: Arc<dyn EstoqueRepository>,
}

impl ComprasService {
    pub fn new(repo: Arc<dyn ComprasRepository>, estoque: Arc<dyn EstoqueRepository>) -> Self {
        Self { repo, estoque }
    }

    // -- fornecedores -----------------------------------------------------------

    pub async fn listar_fornecedores(&self, apenas_ativos: bool) -> AppResult<Vec<Fornecedor>> {
        Ok(self.repo.listar_fornecedores(apenas_ativos).await?)
    }

    pub async fn salvar_fornecedor(
        &self,
        ator: &Ator,
        input: FornecedorInput,
    ) -> AppResult<Fornecedor> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome do fornecedor é obrigatório.").into());
        }
        let lead = input.lead_time_dias.unwrap_or(2);
        if lead < 0 {
            return Err(DomainError::validacao("Lead time inválido.").into());
        }
        let novo = NovoFornecedor {
            nome: nome.to_string(),
            cnpj: input
                .cnpj
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            contato: input
                .contato
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            telefone: input
                .telefone
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            lead_time_dias: lead,
        };
        let log = ator.log(
            "fornecedor",
            format!("Salvou o fornecedor '{nome}' (lead time {lead}d)"),
            "fornecedor",
            0,
            None,
        );
        Ok(self.repo.salvar_fornecedor(&novo, log).await?)
    }

    pub async fn status_fornecedor(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<Fornecedor> {
        let log = ator.log(
            "fornecedor",
            format!(
                "{} o fornecedor Nº{id}",
                if ativo { "Ativou" } else { "Desativou" }
            ),
            "fornecedor",
            id,
            None,
        );
        Ok(self.repo.definir_fornecedor_ativo(id, ativo, log).await?)
    }

    // -- pedidos -----------------------------------------------------------------

    pub async fn listar_pedidos(
        &self,
        status: Option<&str>,
        page: PageParams,
    ) -> AppResult<Page<PedidoCompraView>> {
        Ok(self.repo.listar_pedidos(status, page).await?)
    }

    pub async fn buscar_pedido(
        &self,
        id: i64,
    ) -> AppResult<(PedidoCompraView, Vec<PedidoItemView>)> {
        self.repo
            .buscar_pedido(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Pedido não encontrado.").into())
    }

    /// Cria o pedido: data_prevista = hoje + lead_time do fornecedor e,
    /// na mesma transação, a conta a pagar vinculada.
    pub async fn criar_pedido(
        &self,
        ator: &Ator,
        input: PedidoCompraInput,
    ) -> AppResult<(PedidoCompra, Vec<PedidoCompraItem>)> {
        let fornecedor = self
            .repo
            .buscar_fornecedor(input.idfornecedor)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Fornecedor não encontrado."))?;
        if !fornecedor.ativo {
            return Err(DomainError::regra("Fornecedor inativo.").into());
        }
        if input.itens.is_empty() {
            return Err(DomainError::validacao("O pedido precisa de itens.").into());
        }

        let origem = match input.origem.as_deref() {
            Some("maria") => "maria",
            _ => "manual",
        };

        let mut itens = Vec::with_capacity(input.itens.len());
        let mut vistos = std::collections::HashSet::new();
        let mut total = Decimal::ZERO;
        for it in &input.itens {
            if !vistos.insert(it.iditem) {
                return Err(DomainError::validacao("Item duplicado no pedido.").into());
            }
            if it.quantidade <= 0 {
                return Err(DomainError::validacao("Quantidade deve ser maior que zero.").into());
            }
            let valor = it.valor_unit.unwrap_or(Decimal::ZERO);
            if valor < Decimal::ZERO {
                return Err(DomainError::validacao("Valor unitário inválido.").into());
            }
            // item precisa existir e estar ativo
            let item = self.estoque.buscar_item(it.iditem).await?.ok_or_else(|| {
                DomainError::validacao(format!("Item de estoque Nº{} não existe.", it.iditem))
            })?;
            if !item.ativo {
                return Err(
                    DomainError::validacao(format!("Item '{}' está inativo.", item.nome)).into(),
                );
            }
            let valor = if valor == Decimal::ZERO {
                item.valor_unitario
            } else {
                valor
            };
            total += valor * Decimal::from(it.quantidade);
            itens.push(NovoPedidoItem {
                iditem: it.iditem,
                quantidade: it.quantidade,
                valor_unit: money::round2(valor),
            });
        }

        let hoje = chrono::Local::now().date_naive();
        let data_prevista = hoje + chrono::Duration::days(i64::from(fornecedor.lead_time_dias));
        let vencimento = input
            .vencimento
            .as_deref()
            .and_then(|s| chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
            .unwrap_or(data_prevista);

        let pedido = NovoPedido {
            idfornecedor: input.idfornecedor,
            data_prevista,
            valor_total: money::round2(total),
            origem: origem.to_string(),
            observacao: input
                .observacao
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            gerar_pagamento: input.gerar_pagamento.unwrap_or(true),
            vencimento,
        };
        let log = ator.log(
            "pedido_compra",
            format!(
                "Pedido de compra para '{}' ({} itens, prev. {data_prevista})",
                fornecedor.nome,
                itens.len()
            ),
            "pedido_compra",
            0,
            None,
        );
        Ok(self
            .repo
            .criar_pedido(&pedido, &itens, &fornecedor, ator.id, log)
            .await?)
    }

    /// Recebimento parcial/total — o repo valida anti-duplicação por linha.
    pub async fn receber_pedido(
        &self,
        ator: &Ator,
        idpedido: i64,
        req: RecebimentoRequest,
    ) -> AppResult<PedidoCompra> {
        if req.itens.is_empty() {
            return Err(DomainError::validacao("Informe os itens recebidos.").into());
        }
        let mut vistos = std::collections::HashSet::new();
        let mut itens = Vec::with_capacity(req.itens.len());
        for it in &req.itens {
            if !vistos.insert(it.iditem) {
                return Err(DomainError::validacao("Item repetido no recebimento.").into());
            }
            if it.quantidade <= 0 {
                return Err(DomainError::validacao("Quantidade recebida inválida.").into());
            }
            itens.push(RecebimentoItem {
                iditem: it.iditem,
                quantidade: it.quantidade,
            });
        }
        let log = ator.log(
            "recebimento",
            format!("Recebeu {} item(ns) do pedido Nº{idpedido}", itens.len()),
            "pedido_compra",
            idpedido,
            None,
        );
        Ok(self
            .repo
            .receber_pedido(idpedido, &itens, ator.id, log)
            .await?)
    }

    pub async fn cancelar_pedido(&self, ator: &Ator, id: i64) -> AppResult<()> {
        let log = ator.log(
            "pedido_compra",
            format!("Cancelou o pedido Nº{id}"),
            "pedido_compra",
            id,
            None,
        );
        Ok(self.repo.cancelar_pedido(id, log).await?)
    }
}
