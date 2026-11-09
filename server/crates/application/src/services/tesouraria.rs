//! Casos de uso da tesouraria: contas a pagar/receber, fluxo de caixa, DRE,
//! conciliação bancária e split payment IBS/CBS.

use crate::actor::Ator;
use crate::dto::{
    BaixaInput, ClassificarExtratoInput, ContaFinanceiraInput, LancamentoInput, PlanoContaInput,
    TributoConfigInput,
};
use crate::error::AppResult;
use chrono::{Datelike, NaiveDate};
use clarituz_domain::entities::{
    Conciliacao, ContaFinanceira, Lancamento, PlanoConta, TributoApuracao, TributoConfig,
};
use clarituz_domain::enums::TipoLancamento;
use clarituz_domain::ports::{
    AtualizaContaFinanceira, AtualizaLancamento, AtualizaPlanoConta, FiltroExtrato,
    FiltroLancamento, ImportacaoExtrato, NovaBaixa, NovaContaFinanceira, NovaTributoConfig,
    NovoExtratoItem, NovoLancamento, NovoPlanoConta, TesourariaRepository,
};
use clarituz_domain::queries::{
    BaixaView, ConciliacaoResumo, Dre, ExtratoView, FluxoCaixa, LancamentoView, SplitEventoView,
    SplitResumo, SugestaoConciliacao,
};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{money, time, Page, PageParams};
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct TesourariaService {
    repo: Arc<dyn TesourariaRepository>,
}

fn periodo_ou_mes(inicio: Option<NaiveDate>, fim: Option<NaiveDate>) -> AppResult<PeriodoEstadia> {
    let (i, f) = if let (Some(i), Some(f)) = (inicio, fim) {
        (i, f)
    } else {
        let h = time::hoje();
        let ini = h.with_day(1).unwrap_or(h);
        let fim = if h.month() == 12 {
            NaiveDate::from_ymd_opt(h.year(), 12, 31).unwrap_or(h)
        } else {
            NaiveDate::from_ymd_opt(h.year(), h.month() + 1, 1)
                .and_then(|d| d.pred_opt())
                .unwrap_or(h)
        };
        (ini, fim)
    };
    Ok(PeriodoEstadia::new(i, f)?)
}

impl TesourariaService {
    pub fn new(repo: Arc<dyn TesourariaRepository>) -> Self {
        Self { repo }
    }

    // -- plano de contas ------------------------------------------------------

    pub async fn listar_plano_contas(
        &self,
        apenas_ativas: bool,
        tipo: Option<TipoLancamento>,
    ) -> AppResult<Vec<PlanoConta>> {
        Ok(self.repo.listar_plano_contas(apenas_ativas, tipo).await?)
    }

    pub async fn criar_plano_conta(
        &self,
        ator: &Ator,
        input: PlanoContaInput,
    ) -> AppResult<PlanoConta> {
        ator.exigir_gerencial()?;
        let (codigo, nome) = (input.codigo.trim(), input.nome.trim());
        if codigo.is_empty() || nome.is_empty() {
            return Err(DomainError::validacao("Código e nome são obrigatórios.").into());
        }
        let novo = NovoPlanoConta {
            codigo: codigo.into(),
            nome: nome.into(),
            tipo: input.tipo,
            grupo_dre: input.grupo_dre,
        };
        let log = ator.log(
            "cadastro",
            format!("Criou a conta '{nome}' ({codigo})"),
            "plano_conta",
            0,
            None,
        );
        Ok(self.repo.criar_plano_conta(&novo, log).await?)
    }

    pub async fn atualizar_plano_conta(
        &self,
        ator: &Ator,
        id: i64,
        input: PlanoContaInput,
    ) -> AppResult<PlanoConta> {
        ator.exigir_gerencial()?;
        let dados = AtualizaPlanoConta {
            codigo: Some(input.codigo.trim().to_string()).filter(|c| !c.is_empty()),
            nome: Some(input.nome.trim().to_string()).filter(|n| !n.is_empty()),
            tipo: Some(input.tipo),
            grupo_dre: Some(input.grupo_dre),
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou a conta do plano Nº{id}"),
            "plano_conta",
            id,
            None,
        );
        Ok(self.repo.atualizar_plano_conta(id, &dados, log).await?)
    }

    pub async fn status_plano_conta(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<PlanoConta> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "status",
            format!("Alterou status da conta Nº{id}"),
            "plano_conta",
            id,
            None,
        );
        Ok(self.repo.definir_plano_conta_ativa(id, ativo, log).await?)
    }

    pub async fn remover_plano_conta(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "remoção",
            format!("Removeu a conta do plano Nº{id}"),
            "plano_conta",
            id,
            None,
        );
        Ok(self.repo.remover_plano_conta(id, log).await?)
    }

    // -- contas financeiras ---------------------------------------------------

    pub async fn listar_contas(&self, apenas_ativas: bool) -> AppResult<Vec<ContaFinanceira>> {
        Ok(self.repo.listar_contas(apenas_ativas).await?)
    }

    pub async fn criar_conta(
        &self,
        ator: &Ator,
        input: ContaFinanceiraInput,
    ) -> AppResult<ContaFinanceira> {
        ator.exigir_gerencial()?;
        if input.nome.trim().is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let nova = NovaContaFinanceira {
            nome: input.nome.trim().to_string(),
            tipo: input.tipo,
            banco: input.banco,
            agencia: input.agencia,
            conta: input.conta,
            saldo_inicial: money::round2(input.saldo_inicial.unwrap_or(Decimal::ZERO)),
            saldo_inicial_em: input.saldo_inicial_em,
        };
        let log = ator.log(
            "cadastro",
            format!("Criou a conta '{}'", nova.nome),
            "conta_financeira",
            0,
            None,
        );
        Ok(self.repo.criar_conta(&nova, log).await?)
    }

    pub async fn atualizar_conta(
        &self,
        ator: &Ator,
        id: i64,
        input: ContaFinanceiraInput,
    ) -> AppResult<ContaFinanceira> {
        ator.exigir_gerencial()?;
        let dados = AtualizaContaFinanceira {
            nome: Some(input.nome.trim().to_string()).filter(|n| !n.is_empty()),
            tipo: Some(input.tipo),
            banco: input.banco,
            agencia: input.agencia,
            conta: input.conta,
            saldo_inicial: input.saldo_inicial.map(money::round2),
            saldo_inicial_em: input.saldo_inicial_em,
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou a conta financeira Nº{id}"),
            "conta_financeira",
            id,
            None,
        );
        Ok(self.repo.atualizar_conta(id, &dados, log).await?)
    }

    pub async fn status_conta(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<ContaFinanceira> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "status",
            format!("Alterou status da conta financeira Nº{id}"),
            "conta_financeira",
            id,
            None,
        );
        Ok(self.repo.definir_conta_ativa(id, ativo, log).await?)
    }

    pub async fn saldo_conta(&self, id: i64) -> AppResult<Decimal> {
        Ok(self.repo.saldo_conta(id, None).await?)
    }

    // -- lançamentos -----------------------------------------------------------

    pub async fn criar_lancamento(
        &self,
        ator: &Ator,
        input: LancamentoInput,
    ) -> AppResult<Vec<Lancamento>> {
        ator.exigir_gerencial()?;
        if input.descricao.trim().is_empty() {
            return Err(DomainError::validacao("Descrição é obrigatória.").into());
        }
        if input.valor <= Decimal::ZERO {
            return Err(DomainError::validacao("Valor deve ser maior que zero.").into());
        }
        let parcelas = input.parcelas.unwrap_or(1).clamp(1, 60);
        let novos: Vec<NovoLancamento> = (0..parcelas)
            .map(|p| {
                let venc = if p == 0 {
                    input.vencimento
                } else {
                    // parcelas mensais a partir do primeiro vencimento
                    let m = input.vencimento.month0() + p as u32;
                    let ano = input.vencimento.year() + (m / 12) as i32;
                    let mes = (m % 12) + 1;
                    let dia = input.vencimento.day().min(
                        NaiveDate::from_ymd_opt(ano, mes, 1)
                            .and_then(|_| {
                                if mes == 12 {
                                    NaiveDate::from_ymd_opt(ano, 12, 31)
                                } else {
                                    NaiveDate::from_ymd_opt(ano, mes + 1, 1)
                                        .and_then(|n| n.pred_opt())
                                }
                            })
                            .map_or(28, |f| f.day()),
                    );
                    NaiveDate::from_ymd_opt(ano, mes, dia).unwrap_or(input.vencimento)
                };
                let sufixo = if parcelas > 1 {
                    format!(" ({}/{})", p + 1, parcelas)
                } else {
                    String::new()
                };
                NovoLancamento {
                    tipo: input.tipo,
                    descricao: format!("{}{sufixo}", input.descricao.trim()),
                    idplano_conta: input.idplano_conta,
                    idconta_financeira: input.idconta_financeira,
                    favorecido: input.favorecido.clone(),
                    documento: input.documento.clone(),
                    idcliente: input.idcliente,
                    idreserva: input.idreserva,
                    valor: money::round2(input.valor),
                    emissao: input.emissao,
                    vencimento: venc,
                    competencia: input.competencia.map(|c| if p == 0 { c } else { venc }),
                    observacao: input.observacao.clone(),
                }
            })
            .collect();
        let log = ator.log(
            "cadastro",
            format!(
                "Criou {} lançamento(s) '{}'",
                novos.len(),
                input.descricao.trim()
            ),
            "lancamento",
            0,
            None,
        );
        Ok(self.repo.criar_lancamentos(&novos, log).await?)
    }

    pub async fn buscar_lancamento(&self, id: i64) -> AppResult<Lancamento> {
        self.repo
            .buscar_lancamento(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Lançamento não encontrado.").into())
    }

    pub async fn listar_lancamentos(
        &self,
        filtro: FiltroLancamento,
        page: PageParams,
    ) -> AppResult<Page<LancamentoView>> {
        Ok(self.repo.listar_lancamentos(&filtro, page).await?)
    }

    pub async fn atualizar_lancamento(
        &self,
        ator: &Ator,
        id: i64,
        input: LancamentoInput,
    ) -> AppResult<Lancamento> {
        ator.exigir_gerencial()?;
        self.buscar_lancamento(id).await?;
        if let Some(v) = Some(input.valor) {
            if v <= Decimal::ZERO {
                return Err(DomainError::validacao("Valor deve ser maior que zero.").into());
            }
        }
        let dados = AtualizaLancamento {
            descricao: Some(input.descricao.trim().to_string()).filter(|d| !d.is_empty()),
            idplano_conta: input.idplano_conta,
            idconta_financeira: input.idconta_financeira,
            favorecido: input.favorecido,
            documento: input.documento,
            vencimento: Some(input.vencimento),
            competencia: input.competencia,
            observacao: input.observacao,
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou o lançamento Nº{id}"),
            "lancamento",
            id,
            None,
        );
        Ok(self.repo.atualizar_lancamento(id, &dados, log).await?)
    }

    pub async fn cancelar_lancamento(&self, ator: &Ator, id: i64) -> AppResult<Lancamento> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "cancelamento",
            format!("Cancelou o lançamento Nº{id}"),
            "lancamento",
            id,
            None,
        );
        Ok(self.repo.cancelar_lancamento(id, log).await?)
    }

    pub async fn remover_lancamento(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o lançamento Nº{id}"),
            "lancamento",
            id,
            None,
        );
        Ok(self.repo.remover_lancamento(id, log).await?)
    }

    // -- baixas -----------------------------------------------------------------

    pub async fn baixar(
        &self,
        ator: &Ator,
        idlancamento: i64,
        input: BaixaInput,
    ) -> AppResult<(clarituz_domain::entities::BaixaLancamento, Lancamento)> {
        ator.exigir_gerencial()?;
        if input.valor <= Decimal::ZERO {
            return Err(DomainError::validacao("Valor da baixa deve ser maior que zero.").into());
        }
        let nova = NovaBaixa {
            idlancamento,
            idconta_financeira: input.idconta_financeira,
            valor: money::round2(input.valor),
            data: input.data,
            idforma_pagamento: input.idforma_pagamento,
            observacao: input.observacao,
        };
        let log = ator.log(
            "baixa",
            format!(
                "Registrou baixa de {} no lançamento Nº{idlancamento}",
                money::round2(input.valor)
            ),
            "lancamento",
            idlancamento,
            None,
        );
        Ok(self.repo.baixar(&nova, ator.id, log).await?)
    }

    pub async fn listar_baixas(&self, idlancamento: i64) -> AppResult<Vec<BaixaView>> {
        Ok(self.repo.listar_baixas(idlancamento).await?)
    }

    // -- fluxo de caixa / DRE ----------------------------------------------------

    pub async fn fluxo_caixa(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<FluxoCaixa> {
        Ok(self.repo.fluxo_caixa(periodo_ou_mes(inicio, fim)?).await?)
    }

    pub async fn dre(&self, inicio: Option<NaiveDate>, fim: Option<NaiveDate>) -> AppResult<Dre> {
        let p = periodo_ou_mes(inicio, fim)?;
        // provisiona antes de apurar — o DRE inclui IBS/CBS nas deduções
        self.repo.provisionar_splits().await?;
        Ok(self.repo.dre(p).await?)
    }

    // -- extrato / conciliação ----------------------------------------------------

    /// Recebe itens já parseados (OFX/CSV é resolvido na camada API, que
    /// enxerga a infraestrutura) e persiste com deduplicação.
    pub async fn importar_extrato(
        &self,
        ator: &Ator,
        itens: Vec<NovoExtratoItem>,
    ) -> AppResult<ImportacaoExtrato> {
        ator.exigir_gerencial()?;
        if itens.is_empty() {
            return Err(DomainError::validacao("Nenhuma transação no arquivo.").into());
        }
        Ok(self.repo.importar_extrato(&itens).await?)
    }

    pub async fn listar_extrato(
        &self,
        filtro: FiltroExtrato,
        page: PageParams,
    ) -> AppResult<Page<ExtratoView>> {
        Ok(self.repo.listar_extrato(&filtro, page).await?)
    }

    pub async fn resumo_extrato(&self, idconta: Option<i64>) -> AppResult<ConciliacaoResumo> {
        Ok(self.repo.resumo_extrato(idconta).await?)
    }

    pub async fn ignorar_extrato(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "conciliação",
            format!("Ignorou o item de extrato Nº{id}"),
            "extrato_item",
            id,
            None,
        );
        Ok(self.repo.ignorar_extrato(id, log).await?)
    }

    pub async fn sugestoes_extrato(&self, id: i64) -> AppResult<Vec<SugestaoConciliacao>> {
        Ok(self.repo.sugestoes_extrato(id, 7).await?)
    }

    pub async fn conciliar(
        &self,
        ator: &Ator,
        idextrato: i64,
        idbaixa: i64,
    ) -> AppResult<Conciliacao> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "conciliação",
            format!("Conciliou extrato Nº{idextrato} com baixa Nº{idbaixa}"),
            "extrato_item",
            idextrato,
            None,
        );
        Ok(self
            .repo
            .conciliar(idextrato, idbaixa, "manual", Decimal::from(100), log)
            .await?)
    }

    pub async fn desconciliar(&self, ator: &Ator, idconciliacao: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "conciliação",
            format!("Desfez a conciliação Nº{idconciliacao}"),
            "conciliacao",
            idconciliacao,
            None,
        );
        Ok(self.repo.desconciliar(idconciliacao, log).await?)
    }

    pub async fn auto_conciliar(&self, ator: &Ator, idconta: i64) -> AppResult<u64> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "conciliação",
            format!("Rodou conciliação automática na conta Nº{idconta}"),
            "extrato_item",
            0,
            None,
        );
        Ok(self.repo.auto_conciliar(idconta, ator.id, log).await?)
    }

    pub async fn classificar_extrato(
        &self,
        ator: &Ator,
        idextrato: i64,
        input: ClassificarExtratoInput,
    ) -> AppResult<Lancamento> {
        ator.exigir_gerencial()?;
        let log = ator.log(
            "conciliação",
            format!("Classificou o item de extrato Nº{idextrato}"),
            "extrato_item",
            idextrato,
            None,
        );
        Ok(self
            .repo
            .classificar_extrato(
                idextrato,
                input.idplano_conta,
                input.descricao,
                ator.id,
                log,
            )
            .await?)
    }

    // -- tributos / split --------------------------------------------------------

    pub async fn tributo_config(&self) -> AppResult<Option<TributoConfig>> {
        Ok(self.repo.tributo_config_vigente(time::hoje()).await?)
    }

    pub async fn listar_tributo_configs(&self) -> AppResult<Vec<TributoConfig>> {
        Ok(self.repo.listar_tributo_configs().await?)
    }

    pub async fn criar_tributo_config(
        &self,
        ator: &Ator,
        input: TributoConfigInput,
    ) -> AppResult<TributoConfig> {
        ator.exigir_admin()?;
        if input.aliq_ibs < Decimal::ZERO || input.aliq_cbs < Decimal::ZERO {
            return Err(DomainError::validacao("Alíquotas não podem ser negativas.").into());
        }
        if input.aliq_ibs + input.aliq_cbs >= Decimal::from(100) {
            return Err(DomainError::validacao("Soma das alíquotas deve ser < 100%.").into());
        }
        let regime = input.regime.unwrap_or_else(|| "split".into());
        if !matches!(regime.as_str(), "split" | "destaque") {
            return Err(DomainError::validacao("Regime deve ser 'split' ou 'destaque'.").into());
        }
        let nova = NovaTributoConfig {
            aliq_ibs: input.aliq_ibs,
            aliq_cbs: input.aliq_cbs,
            regime,
            vigente_desde: input.vigente_desde,
        };
        let log = ator.log(
            "configuração",
            format!(
                "Definiu alíquotas IBS {}% / CBS {}%",
                input.aliq_ibs, input.aliq_cbs
            ),
            "tributo_config",
            0,
            None,
        );
        Ok(self.repo.criar_tributo_config(&nova, log).await?)
    }

    pub async fn split_resumo(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<SplitResumo> {
        let p = periodo_ou_mes(inicio, fim)?;
        self.repo.provisionar_splits().await?;
        Ok(self.repo.split_resumo(p).await?)
    }

    pub async fn split_eventos(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
        page: PageParams,
    ) -> AppResult<Page<SplitEventoView>> {
        let p = periodo_ou_mes(inicio, fim)?;
        self.repo.provisionar_splits().await?;
        Ok(self.repo.split_eventos(p, page).await?)
    }

    pub async fn listar_apuracoes(&self) -> AppResult<Vec<TributoApuracao>> {
        Ok(self.repo.listar_apuracoes().await?)
    }

    pub async fn recolher_apuracao(
        &self,
        ator: &Ator,
        competencia: NaiveDate,
    ) -> AppResult<TributoApuracao> {
        ator.exigir_admin()?;
        // normaliza para o dia 1 — competência é mensal
        let comp = competencia.with_day(1).unwrap_or(competencia);
        self.repo.provisionar_splits().await?;
        let log = ator.log(
            "apuração",
            format!("Fechou a apuração IBS/CBS de {}", comp.format("%m/%Y")),
            "tributo_apuracao",
            0,
            None,
        );
        Ok(self.repo.recolher_apuracao(comp, ator.id, log).await?)
    }
}
