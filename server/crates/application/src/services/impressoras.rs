//! Casos de uso das impressoras de rede por setor (roteamento KOT).

use crate::actor::Ator;
use crate::dto::{DescobertasInput, ImpressoraInput, RegistraDescobertaInput};
use crate::error::AppResult;
use clarituz_domain::entities::{ImpressaoJob, Impressora, ImpressoraDescoberta};
use clarituz_domain::ports::{
    DadosImpressora, ImpressoraGateway, ImpressoraRepository, LinhaRecibo, NovaDescoberta,
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

    /// Push do agente local — qualquer funcionário autenticado pode
    /// reportar (o agente usa credenciais próprias). Upsert evita duplicatas.
    pub async fn registrar_descobertas(
        &self,
        _ator: &Ator,
        input: DescobertasInput,
    ) -> AppResult<usize> {
        if input.descobertas.len() > 500 {
            return Err(
                DomainError::validacao("Lote de descobertas grande demais (máx. 500).").into(),
            );
        }
        let origem = input.origem.unwrap_or_else(|| "agente".into());
        let mut itens = Vec::with_capacity(input.descobertas.len());
        for d in input.descobertas {
            let tipo = d.tipo.to_lowercase();
            if !matches!(tipo.as_str(), "rede" | "usb") {
                return Err(DomainError::validacao("tipo deve ser 'rede' ou 'usb'.").into());
            }
            let endereco = d.endereco.trim().to_string();
            if endereco.is_empty() || endereco.len() > 255 {
                return Err(DomainError::validacao("endereço da descoberta inválido.").into());
            }
            itens.push(NovaDescoberta {
                tipo,
                endereco,
                porta: d.porta,
                modelo: d.modelo,
                origem: origem.clone(),
            });
        }
        Ok(self.repo.registrar_descobertas(&itens).await?)
    }

    pub async fn listar_descobertas(&self) -> AppResult<Vec<ImpressoraDescoberta>> {
        Ok(self.repo.listar_descobertas().await?)
    }

    /// Confirma uma descoberta → cria a impressora de setor na mesma tx.
    pub async fn registrar_da_descoberta(
        &self,
        ator: &Ator,
        id: i64,
        input: RegistraDescobertaInput,
    ) -> AppResult<Impressora> {
        ator.exigir_admin()?;
        // valida só nome/setor — ip/porta vêm da linha da descoberta
        if input.nome.trim().is_empty() || input.setor.trim().is_empty() {
            return Err(DomainError::validacao("Nome e setor são obrigatórios.").into());
        }
        let dados = DadosImpressora {
            nome: input.nome.trim().to_string(),
            setor: input.setor.trim().to_lowercase(),
            ip: String::new(),
            porta: 0,
            ativa: true,
            padrao: input.padrao.unwrap_or(false),
            etiqueta: input.etiqueta.unwrap_or(false),
            version: None,
        };
        let log = ator.log(
            "cadastro",
            format!("Registrou impressora da descoberta Nº{id}"),
            "impressora",
            id,
            None,
        );
        Ok(self
            .repo
            .registrar_impressora_da_descoberta(id, &dados, log)
            .await?)
    }

    pub async fn ignorar_descoberta(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        Ok(self.repo.ignorar_descoberta(id).await?)
    }

    /// Fila do agente — jobs pendentes com ESC/POS pronto.
    pub async fn jobs_pendentes(&self) -> AppResult<Vec<ImpressaoJob>> {
        Ok(self.repo.jobs_pendentes().await?)
    }

    pub async fn resultado_job(
        &self,
        _ator: &Ator,
        id: i64,
        sucesso: bool,
        erro: Option<&str>,
    ) -> AppResult<()> {
        Ok(self.repo.resultado_job(id, sucesso, erro).await?)
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
    // usb:<fila> não usa porta TCP — aceita 0; rede exige 1–65535
    let porta = if ip.starts_with("usb:") {
        input.porta.unwrap_or(0)
    } else {
        input.porta.unwrap_or(9100)
    };
    if ip.starts_with("usb:") {
        if porta < 0 {
            return Err(DomainError::validacao("Porta inválida.").into());
        }
    } else if !(1..=65535).contains(&porta) {
        return Err(DomainError::validacao("Porta inválida (1–65535).").into());
    }
    Ok(DadosImpressora {
        nome,
        setor,
        ip,
        porta,
        ativa: input.ativa.unwrap_or(true),
        padrao: input.padrao.unwrap_or(false),
        etiqueta: input.etiqueta.unwrap_or(false),
        version: input.version,
    })
}
