//! Casos de uso de estoque: categorias, itens e movimentações em lote.

use crate::actor::Ator;
use crate::dto::{
    ConversaoInput, FichaItemInput, ItemEstoqueInput, ItemEstoqueUpdate, MovimentacoesRequest,
    NfeImportRequest, NfeItemPreview, NfePreview, NfePreviewRequest, NomeInput,
};
use crate::error::AppResult;
use clarituz_domain::entities::{
    CategoriaEstoque, ConversaoUnidade, FichaTecnica, ItemEstoque, NfeImport,
};
use clarituz_domain::ports::{
    AtualizaItem, EstoqueRepository, Movimentacao, NfeItemConfirmado, NfeRegistro, NovoItem,
};
use clarituz_domain::queries::{EstoqueBaixoView, FichaItemView, MovimentoView};
use clarituz_domain::DomainError;
use clarituz_shared::{money, Page, PageParams};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct EstoqueService {
    repo: Arc<dyn EstoqueRepository>,
    /// Impressora dedicada a etiquetas + fila do agente (opcionais —
    /// etiqueta só é gerada quando ambos existem).
    impressoras: Option<Arc<dyn clarituz_domain::ports::ImpressoraRepository>>,
    spool: Option<Arc<dyn clarituz_domain::ports::ImpressoraGateway>>,
}

impl EstoqueService {
    pub fn new(repo: Arc<dyn EstoqueRepository>) -> Self {
        Self {
            repo,
            impressoras: None,
            spool: None,
        }
    }

    pub fn com_etiquetas(
        mut self,
        impressoras: Arc<dyn clarituz_domain::ports::ImpressoraRepository>,
        spool: Arc<dyn clarituz_domain::ports::ImpressoraGateway>,
    ) -> Self {
        self.impressoras = Some(impressoras);
        self.spool = Some(spool);
        self
    }

    /// Enfileira etiqueta do item na impressora dedicada — falha nunca
    /// impede o cadastro (log só em warn).
    async fn etiqueta_do_item(&self, id: i64, nome: &str, preco: &str) {
        let (Some(imp), Some(spool)) = (&self.impressoras, &self.spool) else {
            return;
        };
        let Ok(lista) = imp.listar().await else {
            return;
        };
        let Some(p) = lista.into_iter().find(|p| p.etiqueta && p.ativa) else {
            return;
        };
        let texto = format!(
            "{nome}
{preco}
COD {id:06}"
        );
        if let Err(e) = spool.etiqueta(&p.ip, p.porta as u16, &texto).await {
            tracing::warn!(item = id, error = %e, "falha ao enfileirar etiqueta");
        }
    }

    /// Reimpressão manual da etiqueta do item.
    pub async fn imprimir_etiqueta(&self, _ator: &Ator, id: i64) -> AppResult<()> {
        let item = self
            .repo
            .buscar_item(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Item não encontrado."))?;
        self.etiqueta_do_item(id, &item.nome, &format!("R$ {}", item.valor_unitario))
            .await;
        Ok(())
    }

    // -- categorias ------------------------------------------------------------

    pub async fn listar_categorias(&self, apenas_ativas: bool) -> AppResult<Vec<CategoriaEstoque>> {
        self.repo
            .listar_categorias(apenas_ativas)
            .await
            .map_err(Into::into)
    }

    pub async fn criar_categoria(
        &self,
        ator: &Ator,
        input: NomeInput,
    ) -> AppResult<CategoriaEstoque> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let log = ator.log(
            "cadastro",
            format!("Cadastrou a categoria de estoque '{nome}'"),
            "categoriaestoque",
            0,
            None,
        );
        Ok(self.repo.criar_categoria(nome, log).await?)
    }

    pub async fn status_categoria(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<CategoriaEstoque> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status da categoria Nº{id}"),
            "categoriaestoque",
            id,
            None,
        );
        Ok(self.repo.definir_categoria_ativa(id, ativo, log).await?)
    }

    /// Roteamento KOT — define para qual impressora de setor os itens
    /// desta categoria imprimem ticket de produção (`None` = sem ticket).
    pub async fn definir_impressora_categoria(
        &self,
        ator: &Ator,
        id: i64,
        impressora_id: Option<i64>,
    ) -> AppResult<CategoriaEstoque> {
        ator.exigir_admin()?;
        let log = ator.log(
            "edição",
            format!("Roteou a categoria Nº{id} para impressora {impressora_id:?}"),
            "categoriaestoque",
            id,
            None,
        );
        Ok(self
            .repo
            .definir_impressora_categoria(id, impressora_id, log)
            .await?)
    }

    // -- itens ------------------------------------------------------------------

    pub async fn buscar_item(&self, id: i64) -> AppResult<ItemEstoque> {
        self.repo
            .buscar_item(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Item não encontrado.").into())
    }

    pub async fn listar_itens(
        &self,
        apenas_ativos: bool,
        page: PageParams,
    ) -> AppResult<Page<ItemEstoque>> {
        self.repo
            .listar_itens(apenas_ativos, page)
            .await
            .map_err(Into::into)
    }

    pub async fn criar_item(&self, ator: &Ator, input: ItemEstoqueInput) -> AppResult<ItemEstoque> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let qtd = input.quantidade_inicial.unwrap_or(0);
        if qtd < 0 {
            return Err(DomainError::validacao("Quantidade inicial inválida.").into());
        }
        let valor = input.valor_unitario.unwrap_or(Decimal::ZERO);
        if valor < Decimal::ZERO {
            return Err(DomainError::validacao("Valor unitário inválido.").into());
        }

        let novo = NovoItem {
            nome: nome.to_string(),
            idcategoria: input.idcategoria,
            quantidade_inicial: qtd,
            valor_unitario: money::round2(valor),
            unidade: input
                .unidade
                .map(|u| u.trim().to_lowercase())
                .filter(|u| !u.is_empty()),
            estoque_minimo: input.estoque_minimo.filter(|m| *m >= 0),
            eh_insumo: input.eh_insumo.unwrap_or(false),
        };
        let log = ator.log(
            "cadastro",
            format!("Cadastrou o item '{nome}' com {qtd} unidade(s)"),
            "estoque",
            0,
            None,
        );
        let item = self.repo.criar_item(&novo, ator.id, log).await?;
        self.etiqueta_do_item(item.id, &item.nome, &format!("R$ {}", item.valor_unitario))
            .await;
        Ok(item)
    }

    pub async fn atualizar_item(
        &self,
        ator: &Ator,
        id: i64,
        input: ItemEstoqueUpdate,
    ) -> AppResult<ItemEstoque> {
        self.buscar_item(id).await?;
        if let Some(v) = input.valor_unitario {
            if v < Decimal::ZERO {
                return Err(DomainError::validacao("Valor unitário inválido.").into());
            }
        }
        let dados = AtualizaItem {
            nome: input
                .nome
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty()),
            idcategoria: input.idcategoria,
            valor_unitario: input.valor_unitario.map(money::round2),
            unidade: input
                .unidade
                .map(|u| u.trim().to_lowercase())
                .filter(|u| !u.is_empty()),
            estoque_minimo: input.estoque_minimo.filter(|m| *m >= 0),
            eh_insumo: input.eh_insumo,
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou o item de estoque Nº{id}"),
            "estoque",
            id,
            None,
        );
        Ok(self.repo.atualizar_item(id, &dados, log).await?)
    }

    pub async fn status_item(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<ItemEstoque> {
        ator.exigir_admin()?;
        self.buscar_item(id).await?;
        let log = ator.log(
            "status",
            format!("Alterou status do item Nº{id}"),
            "estoque",
            id,
            None,
        );
        Ok(self.repo.definir_item_ativo(id, ativo, log).await?)
    }

    /// Entradas/saídas em lote (equivalente a `gEntrada.php`/`gSaida.php`),
    /// com a vantagem de ser uma transação única.
    pub async fn movimentar(&self, ator: &Ator, req: MovimentacoesRequest) -> AppResult<u64> {
        if req.movimentos.is_empty() {
            return Err(DomainError::validacao("Nenhuma movimentação informada.").into());
        }
        let movimentos: Vec<Movimentacao> = req
            .movimentos
            .into_iter()
            .map(|m| Movimentacao {
                iditem: m.iditem,
                tipo: m.tipo,
                quantidade: m.quantidade,
                motivo: m.motivo.unwrap_or_else(|| {
                    match m.tipo {
                        clarituz_domain::enums::TipoMovimento::Entrada => "compra",
                        clarituz_domain::enums::TipoMovimento::Saida => "venda",
                    }
                    .to_string()
                }),
            })
            .collect();

        if movimentos
            .iter()
            .any(|m| m.iditem <= 0 || m.quantidade <= 0)
        {
            return Err(DomainError::validacao(
                "Item e quantidade (>0) são obrigatórios em cada movimentação.",
            )
            .into());
        }

        let log = ator.log(
            "movimentação",
            format!(
                "Registrou {} movimentação(ões) de estoque",
                movimentos.len()
            ),
            "estoque",
            0,
            None,
        );
        Ok(self.repo.movimentar(&movimentos, ator.id, log).await?)
    }

    pub async fn listar_movimentos(
        &self,
        iditem: Option<i64>,
        page: PageParams,
    ) -> AppResult<Page<MovimentoView>> {
        self.repo
            .listar_movimentos(iditem, page)
            .await
            .map_err(Into::into)
    }

    pub async fn remover_categoria(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu a categoria de estoque Nº{id}"),
            "categoria_estoque",
            id,
            None,
        );
        Ok(self.repo.remover_categoria(id, log).await?)
    }

    /// Exclui o item junto com seus movimentos e vínculos de frigobar —
    /// falha (409) se já consumido em reservas.
    pub async fn remover_item(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o item de estoque Nº{id}"),
            "estoque",
            id,
            None,
        );
        Ok(self.repo.remover_item(id, log).await?)
    }
    // -- ficha tecnica ---------------------------------------------------------

    pub async fn listar_ficha(&self, idproduto: i64) -> AppResult<Vec<FichaItemView>> {
        self.buscar_item(idproduto).await?;
        Ok(self.repo.listar_ficha(idproduto).await?)
    }

    pub async fn salvar_ficha_item(
        &self,
        ator: &Ator,
        idproduto: i64,
        input: FichaItemInput,
    ) -> AppResult<FichaTecnica> {
        self.buscar_item(idproduto).await?;
        let insumo = self.buscar_item(input.idinsumo).await?;
        if input.quantidade <= 0 {
            return Err(
                DomainError::validacao("Quantidade do insumo deve ser maior que zero.").into(),
            );
        }
        if input.idinsumo == idproduto {
            return Err(
                DomainError::validacao("O produto nao pode ser insumo de si mesmo.").into(),
            );
        }
        let log = ator.log(
            "ficha_tecnica",
            format!(
                "Ficha do produto Nº{idproduto}: {} un. de '{}'",
                input.quantidade, insumo.nome
            ),
            "ficha_tecnica",
            0,
            None,
        );
        Ok(self
            .repo
            .salvar_ficha_item(idproduto, input.idinsumo, input.quantidade, log)
            .await?)
    }

    pub async fn remover_ficha_item(&self, ator: &Ator, idficha: i64) -> AppResult<()> {
        let log = ator.log(
            "ficha_tecnica",
            format!("Removeu o item Nº{idficha} de uma ficha tecnica"),
            "ficha_tecnica",
            idficha,
            None,
        );
        Ok(self.repo.remover_ficha_item(idficha, log).await?)
    }

    // -- conversoes de unidade --------------------------------------------------

    pub async fn listar_conversoes(&self, iditem: i64) -> AppResult<Vec<ConversaoUnidade>> {
        self.buscar_item(iditem).await?;
        Ok(self.repo.listar_conversoes(iditem).await?)
    }

    pub async fn salvar_conversao(
        &self,
        ator: &Ator,
        iditem: i64,
        input: ConversaoInput,
    ) -> AppResult<ConversaoUnidade> {
        let item = self.buscar_item(iditem).await?;
        let unidade = input.unidade_compra.trim().to_uppercase();
        if unidade.is_empty() {
            return Err(DomainError::validacao("Unidade de compra e obrigatoria.").into());
        }
        if input.fator <= 0 {
            return Err(
                DomainError::validacao("Fator de conversao deve ser maior que zero.").into(),
            );
        }
        let log = ator.log(
            "conversao",
            format!(
                "Conversao de '{}': 1 {unidade} = {}",
                item.nome, input.fator
            ),
            "estoque_conversao",
            0,
            None,
        );
        Ok(self
            .repo
            .salvar_conversao(iditem, &unidade, input.fator, log)
            .await?)
    }

    pub async fn remover_conversao(&self, ator: &Ator, id: i64) -> AppResult<()> {
        let log = ator.log(
            "conversao",
            format!("Removeu a conversao Nº{id}"),
            "estoque_conversao",
            id,
            None,
        );
        Ok(self.repo.remover_conversao(id, log).await?)
    }

    // -- alertas -----------------------------------------------------------------

    pub async fn alertas_minimo(&self) -> AppResult<Vec<EstoqueBaixoView>> {
        Ok(self.repo.alertas_minimo().await?)
    }

    // -- NF-e ---------------------------------------------------------------------

    /// Le o XML da NF-e e devolve o que sera importado — nada persiste.
    pub async fn preview_nfe(&self, input: NfePreviewRequest) -> AppResult<NfePreview> {
        let nfe = parse_nfe(&input.xml)?;
        let ja_importada = self.repo.nfe_ja_importada(&nfe.chave).await?;

        // sugestao de mapeamento por nome exato + fator conhecido da unidade
        let catalogo = self
            .repo
            .listar_itens(
                true,
                PageParams {
                    page: 1,
                    per_page: 500,
                },
            )
            .await?;
        let mut itens = Vec::with_capacity(nfe.itens.len());
        for d in &nfe.itens {
            let iditem_sugerido = catalogo
                .items
                .iter()
                .find(|i| i.nome.trim().eq_ignore_ascii_case(d.nome.trim()))
                .map(|i| i.id);
            let fator_sugerido = match iditem_sugerido {
                Some(id) => self
                    .repo
                    .listar_conversoes(id)
                    .await?
                    .into_iter()
                    .find(|c| c.unidade_compra.eq_ignore_ascii_case(&d.unidade))
                    .map(|c| c.fator),
                None => None,
            };
            itens.push(NfeItemPreview {
                nome: d.nome.clone(),
                unidade_compra: d.unidade.clone(),
                quantidade: d.quantidade,
                valor_unit: d.valor_unit,
                valor_total: d.valor_total,
                iditem_sugerido,
                fator_sugerido,
            });
        }

        Ok(NfePreview {
            chave: nfe.chave,
            numero: nfe.numero,
            emitente: nfe.emitente,
            cnpj: nfe.cnpj,
            emissao: nfe.emissao,
            total: nfe.total,
            ja_importada,
            itens,
        })
    }

    /// Confirma a importacao: entrada de estoque + lancamento a pagar, tx unica.
    pub async fn importar_nfe(&self, ator: &Ator, req: NfeImportRequest) -> AppResult<NfeImport> {
        let chave = req.chave.trim().replace("NFe", "");
        if chave.len() != 44 || !chave.chars().all(|c| c.is_ascii_digit()) {
            return Err(DomainError::validacao("Chave da NF-e deve ter 44 digitos.").into());
        }
        if req.itens.is_empty() {
            return Err(DomainError::validacao("A nota nao tem itens.").into());
        }
        if self.repo.nfe_ja_importada(&chave).await? {
            return Err(DomainError::conflito("Esta NF-e ja foi importada.").into());
        }
        if req.total < Decimal::ZERO {
            return Err(DomainError::validacao("Total da nota invalido.").into());
        }

        let mut itens = Vec::with_capacity(req.itens.len());
        for it in &req.itens {
            let nome = it.nome.trim();
            if nome.is_empty() {
                return Err(DomainError::validacao("Item da nota sem nome.").into());
            }
            if let Some(id) = it.iditem {
                self.buscar_item(id).await?;
            }
            let fator = it.fator.unwrap_or(1);
            if fator <= 0 {
                return Err(DomainError::validacao(format!(
                    "Fator de conversao invalido em '{nome}'."
                ))
                .into());
            }
            if it.quantidade <= Decimal::ZERO || it.valor_total < Decimal::ZERO {
                return Err(DomainError::validacao(format!(
                    "Quantidade/valor invalido em '{nome}'."
                ))
                .into());
            }
            let qtd_base = (it.quantidade * Decimal::from(fator))
                .round()
                .to_i32()
                .unwrap_or(0);
            if qtd_base <= 0 {
                return Err(DomainError::validacao(format!(
                    "Quantidade convertida de '{nome}' ficou zerada."
                ))
                .into());
            }
            itens.push(NfeItemConfirmado {
                iditem: it.iditem,
                nome: nome.to_string(),
                unidade_compra: it.unidade_compra.trim().to_uppercase(),
                fator,
                quantidade: it.quantidade,
                valor_total: money::round2(it.valor_total),
                quantidade_base: qtd_base,
            });
        }

        let emissao = req
            .emissao
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| &s[..10.min(s.len())])
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        let vencimento = req
            .vencimento
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .or(emissao)
            .unwrap_or_else(|| chrono::Local::now().date_naive());
        if req.gerar_pagamento && req.vencimento.is_none() && emissao.is_none() {
            return Err(
                DomainError::validacao("Informe o vencimento para gerar a conta a pagar.").into(),
            );
        }

        let registro = NfeRegistro {
            chave: chave.clone(),
            numero: req
                .numero
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty()),
            emitente: req
                .emitente
                .map(|e| e.trim().to_string())
                .filter(|e| !e.is_empty()),
            cnpj: req
                .cnpj
                .map(|c| c.trim().to_string())
                .filter(|c| !c.is_empty()),
            emissao,
            total: money::round2(req.total),
            vencimento,
            gerar_pagamento: req.gerar_pagamento,
        };
        let log = ator.log(
            "nfe",
            format!("Importou a NF-e {chave} ({} itens)", itens.len()),
            "estoque_nfe",
            0,
            None,
        );
        Ok(self
            .repo
            .registrar_nfe(&registro, &itens, ator.id, log)
            .await?)
    }
}

// ---------------------------------------------------------------------------
// parser de NF-e (layout 4.00 — infNFe/ide/emit/det/total)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct ParsedNfe {
    chave: String,
    numero: Option<String>,
    emitente: Option<String>,
    cnpj: Option<String>,
    emissao: Option<String>,
    total: Decimal,
    itens: Vec<ParsedDet>,
}

#[derive(Debug, Default)]
struct ParsedDet {
    nome: String,
    unidade: String,
    quantidade: Decimal,
    valor_unit: Decimal,
    valor_total: Decimal,
}

fn dec(s: &str) -> Decimal {
    s.trim().replace(',', ".").parse().unwrap_or(Decimal::ZERO)
}

/// Extrai o essencial do infNFe sem validar esquema — NF-e nao tem
/// ambiguidade de nomes nos campos que usamos.
fn parse_nfe(xml: &str) -> Result<ParsedNfe, DomainError> {
    use quick_xml::{events::Event, Reader};

    let mut r = Reader::from_str(xml);
    r.config_mut().trim_text(true);

    let mut nfe = ParsedNfe::default();
    let mut stack: Vec<String> = Vec::new();
    let mut det = ParsedDet::default();
    let mut in_det = false;

    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "infNFe" {
                    for a in e.attributes().flatten() {
                        if a.key.as_ref() == b"Id" {
                            let id = String::from_utf8_lossy(&a.value).to_string();
                            nfe.chave = id.trim_start_matches("NFe").to_string();
                        }
                    }
                }
                if name == "det" {
                    det = ParsedDet::default();
                    in_det = true;
                }
                stack.push(name);
            }
            Ok(Event::Empty(e)) => {
                // <det/> vazio nao acontece; ignora
                let _ = e;
            }
            Ok(Event::Text(t)) => {
                let v = t.decode().unwrap_or_default().to_string();
                let path: Vec<&str> = stack.iter().map(String::as_str).collect();
                match path.as_slice() {
                    [.., "ide", "nNF"] => nfe.numero = Some(v),
                    [.., "ide", "dhEmi"] | [.., "ide", "dEmi"] => {
                        nfe.emissao = Some(v[..10.min(v.len())].to_string())
                    }
                    [.., "emit", "CNPJ"] => nfe.cnpj = Some(v),
                    [.., "emit", "xNome"] => nfe.emitente = Some(v),
                    [.., "ICMSTot", "vNF"] => nfe.total = dec(&v),
                    _ if in_det => match stack.last().map(String::as_str) {
                        Some("xProd") => det.nome = v,
                        Some("uCom") => det.unidade = v,
                        Some("qCom") => det.quantidade = dec(&v),
                        Some("vUnCom") => det.valor_unit = dec(&v),
                        Some("vProd") => det.valor_total = dec(&v),
                        _ => {}
                    },
                    _ => {}
                }
            }
            Ok(Event::CData(t)) => {
                if stack.last().map(String::as_str) == Some("xProd") && in_det {
                    det.nome = String::from_utf8_lossy(t.as_ref()).to_string();
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "det" {
                    in_det = false;
                    if !det.nome.trim().is_empty() {
                        nfe.itens.push(std::mem::take(&mut det));
                    }
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(DomainError::validacao(format!("XML invalido: {e}"))),
            _ => {}
        }
    }

    if nfe.chave.len() != 44 || !nfe.chave.chars().all(|c| c.is_ascii_digit()) {
        return Err(DomainError::validacao(
            "Nao encontrei a chave de 44 digitos no XML — este e um arquivo de NF-e?",
        ));
    }
    if nfe.itens.is_empty() {
        return Err(DomainError::validacao("A NF-e nao tem itens."));
    }
    Ok(nfe)
}

#[cfg(test)]
mod tests {
    //! Validacoes do `EstoqueService` + parser de NF-e — repo nao e chamado.
    use super::*;
    use async_trait::async_trait;
    use clarituz_domain::entities::NovoLog;
    use clarituz_domain::enums::NivelAcesso;

    struct RepoStub {
        ja_importada: bool,
    }

    fn item_fake(id: i64, nome: &str) -> ItemEstoque {
        ItemEstoque {
            id,
            nome: nome.into(),
            idcategoria: None,
            quantidade: 10,
            valor_unitario: Decimal::new(5, 0),
            unidade: "un".into(),
            estoque_minimo: 0,
            eh_insumo: false,
            ativo: true,
            version: 1,
            criado_em: chrono::Utc::now(),
            atualizado_em: chrono::Utc::now(),
        }
    }

    #[async_trait]
    impl EstoqueRepository for RepoStub {
        async fn listar_categorias(&self, _a: bool) -> Result<Vec<CategoriaEstoque>, DomainError> {
            unimplemented!()
        }
        async fn criar_categoria(
            &self,
            _n: &str,
            _l: NovoLog,
        ) -> Result<CategoriaEstoque, DomainError> {
            unimplemented!()
        }
        async fn definir_impressora_categoria(
            &self,
            _i: i64,
            _p: Option<i64>,
            _l: NovoLog,
        ) -> Result<CategoriaEstoque, DomainError> {
            unimplemented!()
        }
        async fn definir_categoria_ativa(
            &self,
            _i: i64,
            _a: bool,
            _l: NovoLog,
        ) -> Result<CategoriaEstoque, DomainError> {
            unimplemented!()
        }
        async fn remover_categoria(&self, _i: i64, _l: NovoLog) -> Result<(), DomainError> {
            unimplemented!()
        }
        async fn buscar_item(&self, id: i64) -> Result<Option<ItemEstoque>, DomainError> {
            Ok(Some(item_fake(id, "Fardo Skol 350ml")))
        }
        async fn listar_itens(
            &self,
            _a: bool,
            _p: PageParams,
        ) -> Result<Page<ItemEstoque>, DomainError> {
            Ok(Page {
                items: vec![],
                page: 1,
                per_page: 20,
                total: 0,
            })
        }
        async fn criar_item(
            &self,
            _n: &NovoItem,
            _f: i64,
            _l: NovoLog,
        ) -> Result<ItemEstoque, DomainError> {
            unimplemented!()
        }
        async fn atualizar_item(
            &self,
            _i: i64,
            _d: &AtualizaItem,
            _l: NovoLog,
        ) -> Result<ItemEstoque, DomainError> {
            unimplemented!()
        }
        async fn definir_item_ativo(
            &self,
            _i: i64,
            _a: bool,
            _l: NovoLog,
        ) -> Result<ItemEstoque, DomainError> {
            unimplemented!()
        }
        async fn remover_item(&self, _i: i64, _l: NovoLog) -> Result<(), DomainError> {
            unimplemented!()
        }
        async fn movimentar(
            &self,
            _m: &[Movimentacao],
            _f: i64,
            _l: NovoLog,
        ) -> Result<u64, DomainError> {
            unimplemented!()
        }
        async fn listar_movimentos(
            &self,
            _i: Option<i64>,
            _p: PageParams,
        ) -> Result<Page<MovimentoView>, DomainError> {
            unimplemented!()
        }
        async fn listar_ficha(&self, _p: i64) -> Result<Vec<FichaItemView>, DomainError> {
            unimplemented!()
        }
        async fn salvar_ficha_item(
            &self,
            _p: i64,
            _i: i64,
            _q: i32,
            _l: NovoLog,
        ) -> Result<FichaTecnica, DomainError> {
            unimplemented!()
        }
        async fn remover_ficha_item(&self, _f: i64, _l: NovoLog) -> Result<(), DomainError> {
            unimplemented!()
        }
        async fn listar_conversoes(&self, _i: i64) -> Result<Vec<ConversaoUnidade>, DomainError> {
            Ok(vec![])
        }
        async fn salvar_conversao(
            &self,
            _i: i64,
            _u: &str,
            _f: i32,
            _l: NovoLog,
        ) -> Result<ConversaoUnidade, DomainError> {
            unimplemented!()
        }
        async fn remover_conversao(&self, _i: i64, _l: NovoLog) -> Result<(), DomainError> {
            unimplemented!()
        }
        async fn alertas_minimo(&self) -> Result<Vec<EstoqueBaixoView>, DomainError> {
            unimplemented!()
        }
        async fn nfe_ja_importada(&self, _c: &str) -> Result<bool, DomainError> {
            Ok(self.ja_importada)
        }
        async fn registrar_nfe(
            &self,
            _n: &NfeRegistro,
            _i: &[NfeItemConfirmado],
            _f: i64,
            _l: NovoLog,
        ) -> Result<NfeImport, DomainError> {
            Ok(NfeImport {
                id: 1,
                chave: _n.chave.clone(),
                numero: _n.numero.clone(),
                emitente: _n.emitente.clone(),
                cnpj: _n.cnpj.clone(),
                emissao: _n.emissao,
                total: _n.total,
                idlancamento: Some(42),
                importado_por: Some(1),
                criado_em: chrono::Utc::now(),
            })
        }
    }

    fn service(ja_importada: bool) -> EstoqueService {
        EstoqueService::new(Arc::new(RepoStub { ja_importada }))
    }

    fn ator() -> Ator {
        Ator {
            id: 1,
            login: "t".into(),
            nome: "Teste".into(),
            nivel: NivelAcesso::Administrador,
        }
    }

    fn nfe_req() -> NfeImportRequest {
        NfeImportRequest {
            chave: "35240112345678000195550010000001001234567890".into(),
            numero: Some("100".into()),
            emitente: Some("Distribuidora X".into()),
            cnpj: None,
            emissao: Some("2024-01-10".into()),
            total: Decimal::new(120, 0),
            vencimento: Some("2024-02-10".into()),
            gerar_pagamento: true,
            itens: vec![crate::dto::NfeItemInput {
                iditem: Some(7),
                nome: "Fardo Skol 350ml".into(),
                unidade_compra: "FARDO".into(),
                fator: Some(12),
                quantidade: Decimal::new(2, 0),
                valor_total: Decimal::new(60, 0),
            }],
        }
    }

    // -- ficha tecnica ---------------------------------------------------------

    #[tokio::test]
    async fn ficha_exige_quantidade_positiva() {
        let e = service(false)
            .salvar_ficha_item(
                &ator(),
                1,
                FichaItemInput {
                    idinsumo: 2,
                    quantidade: 0,
                },
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("insumo"));
    }

    #[tokio::test]
    async fn ficha_nao_aceita_auto_referencia() {
        let e = service(false)
            .salvar_ficha_item(
                &ator(),
                5,
                FichaItemInput {
                    idinsumo: 5,
                    quantidade: 1,
                },
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("mesmo"));
    }

    // -- conversoes --------------------------------------------------------------

    #[tokio::test]
    async fn conversao_exige_fator_positivo() {
        let e = service(false)
            .salvar_conversao(
                &ator(),
                1,
                ConversaoInput {
                    unidade_compra: "FARDO".into(),
                    fator: 0,
                },
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("Fator"));
    }

    // -- NF-e ---------------------------------------------------------------------

    #[test]
    fn parse_nfe_extrai_cabecalho_e_itens() {
        let xml = r#"<?xml version="1.0"?>
<nfeProc><NFe><infNFe Id="NFe35240112345678000195550010000001001234567890" versao="4.00">
<ide><nNF>100</nNF><dhEmi>2024-01-10T12:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000195</CNPJ><xNome>Distribuidora X LTDA</xNome></emit>
<det nItem="1"><prod><xProd>FARDO SKOL 350ML</xProd><uCom>FDO</uCom>
<qCom>2.0000</qCom><vUnCom>30.0000</vUnCom><vProd>60.00</vProd></prod></det>
<det nItem="2"><prod><xProd>FARINHA DE TRIGO KG</xProd><uCom>KG</uCom>
<qCom>0.5000</qCom><vUnCom>10.0000</vUnCom><vProd>5.00</vProd></prod></det>
<total><ICMSTot><vNF>65.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>"#;
        let n = parse_nfe(xml).unwrap();
        assert_eq!(n.chave, "35240112345678000195550010000001001234567890");
        assert_eq!(n.numero.as_deref(), Some("100"));
        assert_eq!(n.emitente.as_deref(), Some("Distribuidora X LTDA"));
        assert_eq!(n.total, Decimal::new(65, 0));
        assert_eq!(n.itens.len(), 2);
        assert_eq!(n.itens[1].nome, "FARINHA DE TRIGO KG");
        assert_eq!(n.itens[1].quantidade, Decimal::new(5, 1));
    }

    #[test]
    fn parse_nfe_rejeita_xml_sem_chave() {
        let e = parse_nfe("<NFe><infNFe><det/></infNFe></NFe>").unwrap_err();
        assert!(e.to_string().contains("44"));
    }

    #[tokio::test]
    async fn importar_nfe_rejeita_chave_invalida() {
        let mut req = nfe_req();
        req.chave = "123".into();
        let e = service(false).importar_nfe(&ator(), req).await.unwrap_err();
        assert!(e.to_string().contains("44"));
    }

    #[tokio::test]
    async fn importar_nfe_rejeita_sem_itens() {
        let mut req = nfe_req();
        req.itens = vec![];
        let e = service(false).importar_nfe(&ator(), req).await.unwrap_err();
        assert!(e.to_string().contains("itens"));
    }

    #[tokio::test]
    async fn importar_nfe_rejeita_duplicada() {
        let e = service(true)
            .importar_nfe(&ator(), nfe_req())
            .await
            .unwrap_err();
        assert!(e.to_string().contains("importada"));
    }

    #[tokio::test]
    async fn importar_nfe_rejeita_fator_zero() {
        let mut req = nfe_req();
        req.itens[0].fator = Some(0);
        let e = service(false).importar_nfe(&ator(), req).await.unwrap_err();
        assert!(e.to_string().contains("Fator"));
    }

    #[tokio::test]
    async fn importar_nfe_converte_quantidade_e_registra() {
        // 2 FARDO x 12 = 24 unidades base
        let nfe = service(false)
            .importar_nfe(&ator(), nfe_req())
            .await
            .unwrap();
        assert_eq!(nfe.idlancamento, Some(42));
    }
}
