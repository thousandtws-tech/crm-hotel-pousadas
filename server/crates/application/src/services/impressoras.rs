//! Casos de uso das impressoras de rede por setor (roteamento KOT).

use crate::actor::Ator;
use crate::dto::ImpressoraInput;
use crate::error::AppResult;
use clarituz_domain::entities::Impressora;
use clarituz_domain::ports::{
    DadosImpressora, ImpressoraGateway, ImpressoraRepository, LinhaRecibo,
};
use clarituz_domain::DomainError;
use std::sync::Arc;

pub struct ImpressoraService {
    repo: Arc<dyn ImpressoraRepository>,
    gateway: Arc<dyn ImpressoraGateway>,
}

impl ImpressoraService {
    pub fn new(repo: Arc<dyn ImpressoraRepository>, gateway: Arc<dyn ImpressoraGateway>) -> Self {
        Self { repo, gateway }
    }

    pub async fn listar(&self) -> AppResult<Vec<Impressora>> {
        self.repo.listar().await.map_err(Into::into)
    }

    pub async fn criar(&self, ator: &Ator, input: ImpressoraInput) -> AppResult<Impressora> {
        ator.exigir_admin()?;
        let dados = dados_validados(&input)?;
        let log = ator.log(
            "cadastro",
            format!("Cadastrou a impressora '{}' ({})", dados.nome, dados.setor),
            "impressora",
            0,
            None,
        );
        Ok(self.repo.criar(&dados, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: ImpressoraInput,
    ) -> AppResult<Impressora> {
        ator.exigir_admin()?;
        let dados = dados_validados(&input)?;
        let log = ator.log(
            "edição",
            format!("Atualizou a impressora Nº{id}"),
            "impressora",
            id,
            None,
        );
        Ok(self.repo.atualizar(id, &dados, log).await?)
    }

    pub async fn status(&self, ator: &Ator, id: i64, ativa: bool) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "edição",
            format!("Alterou status da impressora Nº{id}"),
            "impressora",
            id,
            None,
        );
        Ok(self.repo.definir_ativa(id, ativa, log).await?)
    }

    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "exclusão",
            format!("Removeu a impressora Nº{id}"),
            "impressora",
            id,
            None,
        );
        Ok(self.repo.remover(id, log).await?)
    }

    /// Imprime um ticket de teste na impressora — valida conectividade
    /// TCP e alimentação de papel sem lançar consumo real.
    pub async fn testar(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let imp = self
            .repo
            .por_id(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Impressora não encontrada."))?;
        let linhas = vec![
            LinhaRecibo::Titulo("TESTE DE IMPRESSAO".into()),
            LinhaRecibo::Centro(format!("{} — {}", imp.nome, imp.setor)),
            LinhaRecibo::Separador,
            LinhaRecibo::Centro(format!("{}:{}", imp.ip, imp.porta)),
            LinhaRecibo::Centro("Impressora configurada com sucesso.".into()),
            LinhaRecibo::Avanco(2),
        ];
        self.gateway
            .imprimir(imp.ip.trim(), imp.porta as u16, &linhas)
            .await?;
        Ok(())
    }
}

fn dados_validados(input: &ImpressoraInput) -> AppResult<DadosImpressora> {
    let nome = input.nome.trim().to_string();
    let setor = input.setor.trim().to_lowercase();
    let ip = input.ip.trim().to_string();
    if nome.is_empty() || setor.is_empty() {
        return Err(DomainError::validacao("Nome e setor são obrigatórios.").into());
    }
    // IP ou hostname — validação leve: o TCP connect é a prova real
    if ip.is_empty() {
        return Err(DomainError::validacao("Informe o IP da impressora.").into());
    }
    let porta = input.porta.unwrap_or(9100);
    if !(1..=65535).contains(&porta) {
        return Err(DomainError::validacao("Porta inválida (1–65535).").into());
    }
    Ok(DadosImpressora {
        nome,
        setor,
        ip,
        porta,
        ativa: input.ativa.unwrap_or(true),
        padrao: input.padrao.unwrap_or(false),
        version: input.version,
    })
}
