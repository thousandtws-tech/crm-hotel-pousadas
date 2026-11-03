//! Casos de uso do PDV & Comandas — vendas de salão, quarto e balcão.
//!
//! Baixa automática de estoque no lançamento do item, estorno no
//! cancelamento, espelho financeiro (lancamento/baixa) no fechamento e
//! comissão provisionada por garçom — tudo transacional no repositório.

use crate::actor::Ator;
use crate::dto::{
    AbrirComandaInput, FecharComandaInput, GarcomInput, ItemComandaInput, NovaMesaInput,
    PagarComissaoInput,
};
use crate::error::AppResult;
use clarituz_domain::entities::{PdvComanda, PdvComandaItem, PdvComissao, PdvGarcom, PdvMesa};
use clarituz_domain::enums::PdvComandaTipo;
use clarituz_domain::ports::{
    FechamentoComanda, FiltroComanda, FiltroComissao, ModoFechamento, NovaComanda, NovoItemComanda,
    PdvRepository,
};
use clarituz_domain::queries::{
    ComandaItemView, ComandaView, ComissaoResumo, ComissaoView, FilaItemView, GarcomView,
    ItemVendaView, MesaView,
};
use clarituz_domain::DomainError;
use clarituz_shared::{money, Page, PageParams};
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct PdvService {
    repo: Arc<dyn PdvRepository>,
}

impl PdvService {
    pub fn new(repo: Arc<dyn PdvRepository>) -> Self {
        Self { repo }
    }

    // ------------------------------------------------------------------ mesas

    pub async fn listar_mesas(&self) -> AppResult<Vec<MesaView>> {
        Ok(self.repo.listar_mesas().await?)
    }

    pub async fn criar_mesa(&self, ator: &Ator, input: NovaMesaInput) -> AppResult<PdvMesa> {
        ator.exigir_gerencial()?;
        let numero = input.numero.trim();
        if numero.is_empty() {
            return Err(DomainError::validacao("Número da mesa é obrigatório.").into());
        }
        let lugares = input.lugares.unwrap_or(4);
        if lugares <= 0 {
            return Err(DomainError::validacao("Lugares deve ser maior que zero.").into());
        }
        let log = ator.log(
            "cadastro",
            format!("Criou a mesa {numero} ({lugares} lugares)"),
            "pdv_mesa",
            0,
            None,
        );
        Ok(self.repo.criar_mesa(numero, lugares, log).await?)
    }

    pub async fn status_mesa(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<PdvMesa> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "status",
            format!(
                "{} a mesa Nº{id}",
                if ativo { "Ativou" } else { "Desativou" }
            ),
            "pdv_mesa",
            id,
            None,
        );
        Ok(self.repo.status_mesa(id, ativo, log).await?)
    }

    // ----------------------------------------------------------------- garçons

    pub async fn listar_garcons(&self) -> AppResult<Vec<GarcomView>> {
        Ok(self.repo.listar_garcons().await?)
    }

    /// Cadastra/atualiza garçom — percentual de comissão é snapshot no
    /// fechamento da comanda.
    pub async fn salvar_garcom(&self, ator: &Ator, input: GarcomInput) -> AppResult<PdvGarcom> {
        ator.exigir_gerencial()?;
        if input.percentual < Decimal::ZERO || input.percentual > Decimal::from(100) {
            return Err(
                DomainError::validacao("Percentual de comissão deve ficar entre 0 e 100.").into(),
            );
        }
        let ativo = input.ativo.unwrap_or(true);
        let log = ator.log(
            "cadastro",
            format!(
                "Configurou garçom func. Nº{} ({}%)",
                input.idfuncionario, input.percentual
            ),
            "pdv_garcom",
            input.idfuncionario,
            None,
        );
        Ok(self
            .repo
            .salvar_garcom(
                input.idfuncionario,
                money::round2(input.percentual),
                ativo,
                log,
            )
            .await?)
    }

    // ---------------------------------------------------------------- comandas

    pub async fn listar_comandas(
        &self,
        filtro: FiltroComanda,
        page: PageParams,
    ) -> AppResult<Page<ComandaView>> {
        Ok(self.repo.listar_comandas(&filtro, page).await?)
    }

    pub async fn buscar_comanda(&self, id: i64) -> AppResult<ComandaView> {
        self.repo
            .buscar_comanda(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada.").into())
    }

    pub async fn listar_itens(&self, idcomanda: i64) -> AppResult<Vec<ComandaItemView>> {
        Ok(self.repo.listar_itens(idcomanda).await?)
    }

    /// Abertura — valida o tipo antes de chegar no banco.
    pub async fn abrir_comanda(
        &self,
        ator: &Ator,
        input: AbrirComandaInput,
    ) -> AppResult<PdvComanda> {
        match input.tipo {
            PdvComandaTipo::Mesa if input.idmesa.is_none() => {
                return Err(DomainError::validacao("Comanda de mesa exige uma mesa.").into())
            }
            PdvComandaTipo::Quarto if input.idquarto.is_none() => {
                return Err(DomainError::validacao("Comanda de quarto exige um quarto.").into())
            }
            PdvComandaTipo::Balcao
                if input
                    .rotulo
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty() =>
            {
                return Err(DomainError::validacao(
                    "Comanda de balcão exige um rótulo (ex.: nome do cliente).",
                )
                .into())
            }
            _ => {}
        }
        let nova = NovaComanda {
            tipo: input.tipo,
            idmesa: input.idmesa,
            idquarto: input.idquarto,
            idcliente: input.idcliente,
            idgarcom: input.idgarcom,
            rotulo: input.rotulo,
        };
        let log = ator.log(
            "abertura",
            format!("Abriu comanda {:?}", nova.tipo),
            "pdv_comanda",
            0,
            None,
        );
        Ok(self.repo.abrir_comanda(&nova, ator.id, log).await?)
    }

    /// Lançamento de item — baixa automática no estoque dentro da tx.
    pub async fn adicionar_item(
        &self,
        ator: &Ator,
        idcomanda: i64,
        input: ItemComandaInput,
    ) -> AppResult<PdvComandaItem> {
        if input.quantidade <= 0 {
            return Err(DomainError::validacao("Quantidade deve ser maior que zero.").into());
        }
        let item = NovoItemComanda {
            iditem: input.iditem,
            quantidade: input.quantidade,
        };
        let log = ator.log(
            "lancamento",
            format!(
                "Lançou {} item(ns) na comanda Nº{idcomanda}",
                input.quantidade
            ),
            "pdv_comanda",
            idcomanda,
            None,
        );
        Ok(self
            .repo
            .adicionar_item(idcomanda, &item, ator.id, log)
            .await?)
    }

    /// Item entregue — fluxo de produção/balcão.
    pub async fn entregar_item(
        &self,
        ator: &Ator,
        idcomanda: i64,
        iditem: i64,
    ) -> AppResult<PdvComandaItem> {
        let log = ator.log(
            "entrega",
            format!("Marcou item Nº{iditem} da comanda Nº{idcomanda} como entregue"),
            "pdv_comanda_item",
            iditem,
            None,
        );
        Ok(self.repo.entregar_item(idcomanda, iditem, log).await?)
    }

    /// Cancela item — devolve a quantidade ao estoque com motivo.
    pub async fn cancelar_item(
        &self,
        ator: &Ator,
        idcomanda: i64,
        iditem: i64,
        motivo: Option<String>,
    ) -> AppResult<PdvComandaItem> {
        let log = ator.log(
            "cancelamento",
            format!("Cancelou item Nº{iditem} da comanda Nº{idcomanda}"),
            "pdv_comanda_item",
            iditem,
            None,
        );
        Ok(self
            .repo
            .cancelar_item(idcomanda, iditem, motivo.as_deref(), ator.id, log)
            .await?)
    }

    /// Cancela a comanda — estorna todos os itens ao estoque.
    pub async fn cancelar_comanda(
        &self,
        ator: &Ator,
        idcomanda: i64,
        motivo: Option<String>,
    ) -> AppResult<PdvComanda> {
        let log = ator.log(
            "cancelamento",
            format!("Cancelou a comanda Nº{idcomanda}"),
            "pdv_comanda",
            idcomanda,
            None,
        );
        Ok(self
            .repo
            .cancelar_comanda(idcomanda, motivo.as_deref(), ator.id, log)
            .await?)
    }

    /// Fechamento — gera o espelho financeiro e a comissão na mesma tx.
    pub async fn fechar_comanda(
        &self,
        ator: &Ator,
        idcomanda: i64,
        input: FecharComandaInput,
    ) -> AppResult<PdvComanda> {
        let modo = match input.modo.trim().to_lowercase().as_str() {
            "pagar" => ModoFechamento::Pagar,
            "faturar" => ModoFechamento::Faturar,
            _ => return Err(DomainError::validacao("Modo deve ser 'pagar' ou 'faturar'.").into()),
        };
        let desconto = money::round2(input.desconto.unwrap_or(Decimal::ZERO));
        if desconto < Decimal::ZERO {
            return Err(DomainError::validacao("Desconto não pode ser negativo.").into());
        }
        let f = FechamentoComanda {
            modo,
            desconto,
            idconta_financeira: input.idconta_financeira,
            idforma_pagamento: input.idforma_pagamento,
            observacao: input.observacao,
        };
        let rotulo = if modo == ModoFechamento::Pagar {
            "pagou"
        } else {
            "faturou"
        };
        let log = ator.log(
            "fechamento",
            format!("Fechou e {rotulo} a comanda Nº{idcomanda}"),
            "pdv_comanda",
            idcomanda,
            None,
        );
        Ok(self
            .repo
            .fechar_comanda(idcomanda, &f, ator.id, log)
            .await?)
    }

    // ------------------------------------------------- itens vendáveis + comissões

    /// Itens de estoque ativos com saldo — picker do PDV.
    pub async fn listar_itens_venda(&self, busca: Option<String>) -> AppResult<Vec<ItemVendaView>> {
        Ok(self.repo.listar_itens_venda(busca.as_deref()).await?)
    }

    pub async fn listar_comissoes(
        &self,
        filtro: FiltroComissao,
        page: PageParams,
    ) -> AppResult<Page<ComissaoView>> {
        Ok(self.repo.listar_comissoes(&filtro, page).await?)
    }

    pub async fn resumo_comissoes(
        &self,
        inicio: Option<chrono::NaiveDate>,
        fim: Option<chrono::NaiveDate>,
    ) -> AppResult<Vec<ComissaoResumo>> {
        Ok(self.repo.resumo_comissoes(inicio, fim).await?)
    }

    /// Quita a comissão — gera lançamento a pagar + baixa na mesma tx.
    /// Gerencial: dinheiro saindo da empresa.
    pub async fn pagar_comissao(
        &self,
        ator: &Ator,
        idcomissao: i64,
        input: PagarComissaoInput,
    ) -> AppResult<PdvComissao> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "pagamento",
            format!("Pagou a comissão Nº{idcomissao}"),
            "pdv_comissao",
            idcomissao,
            None,
        );
        Ok(self
            .repo
            .pagar_comissao(
                idcomissao,
                input.idconta_financeira,
                input.idforma_pagamento,
                ator.id,
                log,
            )
            .await?)
    }

    // ------------------------------------------------------------------ KDS
    /// Fila da cozinha — itens de comandas abertas aguardando/em preparo.
    pub async fn fila_cozinha(&self) -> AppResult<Vec<FilaItemView>> {
        Ok(self.repo.listar_fila_cozinha().await?)
    }

    /// pendente → em_preparo.
    pub async fn iniciar_preparo(
        &self,
        ator: &Ator,
        idcomanda: i64,
        iditem: i64,
    ) -> AppResult<PdvComandaItem> {
        let log = ator.log(
            "preparo",
            format!("Iniciou preparo do item Nº{iditem} da comanda Nº{idcomanda}"),
            "pdv_comanda_item",
            iditem,
            None,
        );
        Ok(self.repo.iniciar_preparo(idcomanda, iditem, log).await?)
    }

    /// em_preparo → pronto.
    pub async fn marcar_pronto(
        &self,
        ator: &Ator,
        idcomanda: i64,
        iditem: i64,
    ) -> AppResult<PdvComandaItem> {
        let log = ator.log(
            "pronto",
            format!("Marcou item Nº{iditem} da comanda Nº{idcomanda} como pronto"),
            "pdv_comanda_item",
            iditem,
            None,
        );
        Ok(self.repo.marcar_pronto(idcomanda, iditem, log).await?)
    }

    /// em_preparo/pronto → pendente — devolve à fila.
    pub async fn retornar_fila(
        &self,
        ator: &Ator,
        idcomanda: i64,
        iditem: i64,
    ) -> AppResult<PdvComandaItem> {
        let log = ator.log(
            "retorno",
            format!("Devolveu item Nº{iditem} da comanda Nº{idcomanda} à fila"),
            "pdv_comanda_item",
            iditem,
            None,
        );
        Ok(self.repo.retornar_fila(idcomanda, iditem, log).await?)
    }
}

#[cfg(test)]
mod tests {
    //! Validações de entrada do `PdvService` — nenhuma deve chegar ao repo.
    use super::*;
    use async_trait::async_trait;
    use chrono::NaiveDate;
    use clarituz_domain::entities::NovoLog;
    use clarituz_domain::enums::NivelAcesso;

    struct RepoStub;

    #[async_trait]
    impl PdvRepository for RepoStub {
        async fn listar_mesas(&self) -> Result<Vec<MesaView>, DomainError> {
            unimplemented!()
        }
        async fn criar_mesa(
            &self,
            _numero: &str,
            _lugares: i32,
            _log: NovoLog,
        ) -> Result<PdvMesa, DomainError> {
            unimplemented!()
        }
        async fn status_mesa(
            &self,
            _id: i64,
            _ativo: bool,
            _log: NovoLog,
        ) -> Result<PdvMesa, DomainError> {
            unimplemented!()
        }
        async fn listar_garcons(&self) -> Result<Vec<GarcomView>, DomainError> {
            unimplemented!()
        }
        async fn salvar_garcom(
            &self,
            _idfuncionario: i64,
            _percentual: Decimal,
            _ativo: bool,
            _log: NovoLog,
        ) -> Result<PdvGarcom, DomainError> {
            unimplemented!()
        }
        async fn listar_comandas(
            &self,
            _filtro: &FiltroComanda,
            _page: PageParams,
        ) -> Result<Page<ComandaView>, DomainError> {
            unimplemented!()
        }
        async fn buscar_comanda(&self, _id: i64) -> Result<Option<ComandaView>, DomainError> {
            unimplemented!()
        }
        async fn listar_itens(&self, _idcomanda: i64) -> Result<Vec<ComandaItemView>, DomainError> {
            unimplemented!()
        }
        async fn abrir_comanda(
            &self,
            _nova: &NovaComanda,
            _idfuncionario: i64,
            _log: NovoLog,
        ) -> Result<PdvComanda, DomainError> {
            unimplemented!()
        }
        async fn adicionar_item(
            &self,
            _idcomanda: i64,
            _item: &NovoItemComanda,
            _idfuncionario: i64,
            _log: NovoLog,
        ) -> Result<PdvComandaItem, DomainError> {
            unimplemented!()
        }
        async fn entregar_item(
            &self,
            _idcomanda: i64,
            _iditem_comanda: i64,
            _log: NovoLog,
        ) -> Result<PdvComandaItem, DomainError> {
            unimplemented!()
        }
        async fn listar_fila_cozinha(&self) -> Result<Vec<FilaItemView>, DomainError> {
            unimplemented!()
        }
        async fn iniciar_preparo(
            &self,
            _idcomanda: i64,
            _iditem_comanda: i64,
            _log: NovoLog,
        ) -> Result<PdvComandaItem, DomainError> {
            unimplemented!()
        }
        async fn marcar_pronto(
            &self,
            _idcomanda: i64,
            _iditem_comanda: i64,
            _log: NovoLog,
        ) -> Result<PdvComandaItem, DomainError> {
            unimplemented!()
        }
        async fn retornar_fila(
            &self,
            _idcomanda: i64,
            _iditem_comanda: i64,
            _log: NovoLog,
        ) -> Result<PdvComandaItem, DomainError> {
            unimplemented!()
        }
        async fn cancelar_item(
            &self,
            _idcomanda: i64,
            _iditem_comanda: i64,
            _motivo: Option<&str>,
            _idfuncionario: i64,
            _log: NovoLog,
        ) -> Result<PdvComandaItem, DomainError> {
            unimplemented!()
        }
        async fn cancelar_comanda(
            &self,
            _idcomanda: i64,
            _motivo: Option<&str>,
            _idfuncionario: i64,
            _log: NovoLog,
        ) -> Result<PdvComanda, DomainError> {
            unimplemented!()
        }
        async fn fechar_comanda(
            &self,
            _idcomanda: i64,
            _fechamento: &FechamentoComanda,
            _idfuncionario: i64,
            _log: NovoLog,
        ) -> Result<PdvComanda, DomainError> {
            unimplemented!()
        }
        async fn listar_itens_venda(
            &self,
            _busca: Option<&str>,
        ) -> Result<Vec<ItemVendaView>, DomainError> {
            unimplemented!()
        }
        async fn listar_comissoes(
            &self,
            _filtro: &FiltroComissao,
            _page: PageParams,
        ) -> Result<Page<ComissaoView>, DomainError> {
            unimplemented!()
        }
        async fn resumo_comissoes(
            &self,
            _inicio: Option<NaiveDate>,
            _fim: Option<NaiveDate>,
        ) -> Result<Vec<ComissaoResumo>, DomainError> {
            unimplemented!()
        }
        async fn pagar_comissao(
            &self,
            _idcomissao: i64,
            _idconta_financeira: i64,
            _idforma_pagamento: Option<i64>,
            _idfuncionario: i64,
            _log: NovoLog,
        ) -> Result<PdvComissao, DomainError> {
            unimplemented!()
        }
    }

    fn service() -> PdvService {
        PdvService::new(Arc::new(RepoStub))
    }

    fn ator(nivel: NivelAcesso) -> Ator {
        Ator {
            id: 1,
            login: "teste".into(),
            nome: "Teste".into(),
            nivel,
        }
    }

    fn abrir(tipo: PdvComandaTipo) -> AbrirComandaInput {
        AbrirComandaInput {
            tipo,
            idmesa: None,
            idquarto: None,
            idcliente: None,
            idgarcom: None,
            rotulo: None,
        }
    }

    #[tokio::test]
    async fn comanda_de_mesa_exige_mesa() {
        let e = service()
            .abrir_comanda(&ator(NivelAcesso::Recepcao), abrir(PdvComandaTipo::Mesa))
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Validacao(_)));
    }

    #[tokio::test]
    async fn comanda_de_quarto_exige_quarto() {
        let e = service()
            .abrir_comanda(&ator(NivelAcesso::Recepcao), abrir(PdvComandaTipo::Quarto))
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Validacao(_)));
    }

    #[tokio::test]
    async fn comanda_de_balcao_exige_rotulo() {
        let e = service()
            .abrir_comanda(
                &ator(NivelAcesso::Recepcao),
                AbrirComandaInput {
                    rotulo: Some("   ".into()),
                    ..abrir(PdvComandaTipo::Balcao)
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Validacao(_)));
    }

    #[tokio::test]
    async fn item_com_quantidade_invalida_e_rejeitado() {
        for quantidade in [0, -2] {
            let e = service()
                .adicionar_item(
                    &ator(NivelAcesso::Recepcao),
                    10,
                    ItemComandaInput {
                        iditem: 5,
                        quantidade,
                    },
                )
                .await
                .unwrap_err();
            assert!(matches!(e.domain(), DomainError::Validacao(_)));
        }
    }

    #[tokio::test]
    async fn fechamento_exige_modo_conhecido() {
        let e = service()
            .fechar_comanda(
                &ator(NivelAcesso::Recepcao),
                10,
                FecharComandaInput {
                    modo: "credito".into(),
                    desconto: None,
                    idconta_financeira: None,
                    idforma_pagamento: None,
                    observacao: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Validacao(_)));
    }

    #[tokio::test]
    async fn fechamento_rejeita_desconto_negativo() {
        let e = service()
            .fechar_comanda(
                &ator(NivelAcesso::Recepcao),
                10,
                FecharComandaInput {
                    modo: "pagar".into(),
                    desconto: Some(Decimal::new(-150, 2)),
                    idconta_financeira: Some(1),
                    idforma_pagamento: Some(1),
                    observacao: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Validacao(_)));
    }

    #[tokio::test]
    async fn comissao_de_garcom_respeita_faixa() {
        for percentual in [Decimal::new(-1, 0), Decimal::new(101, 0)] {
            let e = service()
                .salvar_garcom(
                    &ator(NivelAcesso::Administrador),
                    GarcomInput {
                        idfuncionario: 2,
                        percentual,
                        ativo: None,
                    },
                )
                .await
                .unwrap_err();
            assert!(matches!(e.domain(), DomainError::Validacao(_)));
        }
    }

    #[tokio::test]
    async fn mesa_exige_numero_e_lugares_positivos() {
        let admin = ator(NivelAcesso::Administrador);
        for input in [
            NovaMesaInput {
                numero: "  ".into(),
                lugares: Some(4),
            },
            NovaMesaInput {
                numero: "10".into(),
                lugares: Some(0),
            },
        ] {
            let e = service().criar_mesa(&admin, input).await.unwrap_err();
            assert!(matches!(e.domain(), DomainError::Validacao(_)));
        }
    }

    #[tokio::test]
    async fn acoes_gerenciais_exigem_privilegio() {
        let recep = ator(NivelAcesso::Recepcao);
        let e = service()
            .criar_mesa(
                &recep,
                NovaMesaInput {
                    numero: "10".into(),
                    lugares: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Proibido(_)));
        let e = service()
            .pagar_comissao(
                &recep,
                7,
                PagarComissaoInput {
                    idconta_financeira: 1,
                    idforma_pagamento: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(e.domain(), DomainError::Proibido(_)));
    }
}
