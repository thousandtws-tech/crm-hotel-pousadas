//! Casos de uso do estabelecimento (dados da pousada, endereço, logo).

use crate::actor::Ator;
use crate::dto::{EnderecoInput, EstabelecimentoInput};
use crate::error::AppResult;
use clarituz_domain::entities::{EnderecoEstabelecimento, Estabelecimento};
use clarituz_domain::ports::{DadosEndereco, DadosEstabelecimento, EstabelecimentoRepository};
use std::sync::Arc;

pub struct EstabelecimentoService {
    repo: Arc<dyn EstabelecimentoRepository>,
}

impl EstabelecimentoService {
    pub fn new(repo: Arc<dyn EstabelecimentoRepository>) -> Self {
        Self { repo }
    }

    pub async fn obter(&self) -> AppResult<Option<Estabelecimento>> {
        self.repo.obter().await.map_err(Into::into)
    }

    pub async fn obter_endereco(&self) -> AppResult<Option<EnderecoEstabelecimento>> {
        self.repo.obter_endereco().await.map_err(Into::into)
    }

    pub async fn salvar_dados(
        &self,
        ator: &Ator,
        input: EstabelecimentoInput,
    ) -> AppResult<Estabelecimento> {
        ator.exigir_admin()?;
        let dados = DadosEstabelecimento {
            cnpj: input.cnpj,
            razao_social: input.razao_social,
            site: input.site,
            email: input.email,
            telefone: input.telefone,
            celular: input.celular,
            impressora_ip: input
                .impressora_ip
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            impressora_porta: input.impressora_porta.unwrap_or(9100),
            impressora_ativa: input.impressora_ativa.unwrap_or(false),
            taxa_early: input.taxa_early.unwrap_or_default(),
            taxa_late: input.taxa_late.unwrap_or_default(),
            wifi_nome: input.wifi_nome,
            wifi_senha: input.wifi_senha,
            horario_checkin: input.horario_checkin,
            horario_checkout: input.horario_checkout,
            horario_cafe: input.horario_cafe,
            info_servicos: input.info_servicos,
            cadastur: input
                .cadastur
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            politica_cancelamento: input.politica_cancelamento.map(|p| {
                // Sanitiza: só faixas {ate_dias, pct} em 0–100 — nada de
                // campos arbitrários vindos do cliente.
                let faixas: Vec<serde_json::Value> = p["faixas"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|f| {
                        let dias = f["ate_dias"].as_i64()?;
                        let pct = f["pct"].as_i64()?;
                        (0..=100)
                            .contains(&pct)
                            .then(|| serde_json::json!({"ate_dias": dias.max(0), "pct": pct}))
                    })
                    .collect();
                serde_json::json!({"faixas": faixas})
            }),
            retencao_dados_anos: input.retencao_dados_anos.map(|a| a.clamp(1, 30)),
            dpo_email: input
                .dpo_email
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            fnrh_assinatura: input.fnrh_assinatura.unwrap_or(false),
            pin_fechamento: input
                .pin_fechamento
                .map(|s| s.trim().to_string())
                .filter(|s| s.len() >= 4),
            version: input.version,
        };
        let log = ator.log(
            "edição",
            "Atualizou os dados do estabelecimento",
            "estabelecimento",
            0,
            None,
        );
        Ok(self.repo.salvar_dados(&dados, log).await?)
    }

    pub async fn salvar_endereco(
        &self,
        ator: &Ator,
        input: EnderecoInput,
    ) -> AppResult<EnderecoEstabelecimento> {
        ator.exigir_admin()?;
        let dados = DadosEndereco {
            logradouro: input.logradouro,
            numero: input.numero,
            complemento: input.complemento,
            bairro: input.bairro,
            cidade: input.cidade,
            cep: input.cep,
            version: input.version,
        };
        let log = ator.log(
            "edição",
            "Atualizou o endereço do estabelecimento",
            "enderecoestabelecimento",
            0,
            None,
        );
        Ok(self.repo.salvar_endereco(&dados, log).await?)
    }

    pub async fn definir_logo(&self, ator: &Ator, nome: &str, caminho: &str) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "edição",
            "Atualizou a logo do estabelecimento",
            "logo",
            0,
            None,
        );
        Ok(self.repo.definir_logo(nome, caminho, log).await?)
    }

    pub async fn logo_atual(&self) -> AppResult<Option<(String, String)>> {
        self.repo.logo_atual().await.map_err(Into::into)
    }
}
