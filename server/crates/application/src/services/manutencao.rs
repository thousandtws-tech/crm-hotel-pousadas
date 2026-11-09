//! Manutenção & PMOC — ordens de serviço, checklist Lei 13.589/2018 e
//! alertas de competência vencida. Alertas externos passam pela fila de
//! comunicação (mesma outbox dos lembretes de hóspede).

use std::sync::Arc;

use chrono::Utc;
use clarituz_domain::entities::NovoEnvio;
use clarituz_domain::entities::{ManutencaoOrdem, PmocRegistro};
use clarituz_domain::enums::{CanalEnvio, PrioridadeManut, StatusManut};
use clarituz_domain::error::DomainError;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    EventoPublisher, FilaEnvioRepository, ManutencaoRepository, NovaOrdem, NovoPmoc,
};

use crate::actor::Ator;
use crate::dto::{NovaOrdemInput, NovaPmocInput};
use crate::error::AppResult;

/// Checklist PMOC oficial — Lei 13.589/2018 (climatização).
pub const PMOC_ITENS: [&str; 10] = [
    "Limpeza/substituição de filtros de ar",
    "Limpeza de serpentinas e bandejas de condensado",
    "Verificação de drenos e eliminação de água parada",
    "Inspeção de corrosão em componentes",
    "Verificação de vazamento de fluido refrigerante",
    "Teste de ruído e vibração anormais",
    "Verificação elétrica (conexões e isolamento)",
    "Medição de temperatura de insuflamento",
    "Higienização de unidades evaporadoras/condensadoras",
    "Registro fotográfico e ordem de serviço vinculada",
];

pub struct ManutencaoService {
    repo: Arc<dyn ManutencaoRepository>,
    fila: Arc<dyn FilaEnvioRepository>,
    eventos: Arc<dyn EventoPublisher>,
}

impl ManutencaoService {
    pub fn new(
        repo: Arc<dyn ManutencaoRepository>,
        fila: Arc<dyn FilaEnvioRepository>,
        eventos: Arc<dyn EventoPublisher>,
    ) -> Self {
        Self {
            repo,
            fila,
            eventos,
        }
    }

    pub async fn ordens(&self, status: Option<StatusManut>) -> AppResult<Vec<ManutencaoOrdem>> {
        Ok(self.repo.ordens(status).await?)
    }

    pub async fn criar_ordem(
        &self,
        ator: &Ator,
        input: NovaOrdemInput,
    ) -> AppResult<ManutencaoOrdem> {
        if input.titulo.trim().is_empty() {
            return Err(DomainError::validacao("título obrigatório").into());
        }
        let ordem = self
            .repo
            .criar_ordem(&NovaOrdem {
                idquarto: input.idquarto,
                local: input.local,
                titulo: input.titulo,
                descricao: input.descricao,
                prioridade: input.prioridade.unwrap_or(PrioridadeManut::Media),
                materiais: input.materiais,
                responsavel: input.responsavel,
                idfuncionario: input.idfuncionario,
                criado_por: Some(ator.id),
            })
            .await?;
        if ordem.prioridade == PrioridadeManut::Urgente {
            self.avisar(
                "manutencao.urgente",
                "OS urgente aberta",
                &format!("{} — {}", ordem.titulo, ordem.local),
            )
            .await;
        }
        Ok(ordem)
    }

    pub async fn mudar_status(
        &self,
        ator: &Ator,
        id: i64,
        status: StatusManut,
        custo_centavos: Option<i64>,
    ) -> AppResult<()> {
        // Status operacional é tarefa de campo — recepção também executa.
        let _ = ator;
        if let Some(c) = custo_centavos {
            if c < 0 {
                return Err(DomainError::validacao("custo não pode ser negativo").into());
            }
        }
        Ok(self.repo.mudar_status(id, status, custo_centavos).await?)
    }

    pub async fn pmoc_listar(&self, ator: &Ator) -> AppResult<Vec<PmocRegistro>> {
        ator.exigir_gerencial()?;
        Ok(self.repo.pmoc_listar().await?)
    }

    /// Registra a auditoria PMOC — única por competência, imutável.
    pub async fn pmoc_registrar(
        &self,
        ator: &Ator,
        input: NovaPmocInput,
    ) -> AppResult<PmocRegistro> {
        ator.exigir_gerencial()?;
        if input.itens.len() != PMOC_ITENS.len() {
            return Err(DomainError::validacao(format!(
                "checklist PMOC exige {} itens",
                PMOC_ITENS.len()
            ))
            .into());
        }
        if input.responsavel_crea.trim().is_empty() || input.responsavel_art.trim().is_empty() {
            return Err(
                DomainError::validacao("CREA e ART do responsável são obrigatórios").into(),
            );
        }
        let conformes = input
            .itens
            .iter()
            .filter(|i| i["conforme"].as_bool().unwrap_or(false))
            .count() as i16;
        let reg = self
            .repo
            .pmoc_registrar(&NovoPmoc {
                referente_a: input.referente_a,
                itens: serde_json::Value::Array(input.itens),
                conformes,
                responsavel_nome: input.responsavel_nome,
                responsavel_crea: input.responsavel_crea,
                responsavel_art: input.responsavel_art,
                observacoes: input.observacoes,
                proxima_data: input.proxima_data,
                criado_por: Some(ator.id),
            })
            .await?;
        if conformes < PMOC_ITENS.len() as i16 {
            self.avisar(
                "pmoc.nao_conforme",
                "PMOC com não-conformidades",
                &format!(
                    "{}/{} itens conformes em {} — responsável {}",
                    conformes,
                    PMOC_ITENS.len(),
                    reg.referente_a,
                    reg.responsavel_nome
                ),
            )
            .await;
        }
        Ok(reg)
    }

    /// Chamado pelo cron diário — alerta quando a próxima auditoria venceu.
    pub async fn alertar_pmoc_vencido(&self) -> AppResult<()> {
        if let Some(reg) = self.repo.pmoc_atraso(Utc::now().date_naive()).await? {
            self.avisar(
                "pmoc.vencido",
                "PMOC vencido",
                &format!(
                    "Auditoria PMOC prevista para {} não foi registrada (responsável {}).",
                    reg.proxima_data.unwrap_or(reg.referente_a),
                    reg.responsavel_nome
                ),
            )
            .await;
        }
        Ok(())
    }

    /// Avisa a equipe pelos canais que a matriz marcar para o evento.
    async fn avisar(&self, evento: &str, titulo: &str, mensagem: &str) {
        let mut aviso = Aviso::novo(TipoAviso::Alerta, titulo, mensagem);
        aviso.ate_nivel = 2;
        self.eventos.avisar(aviso);
        for regra in self.fila.regras_do_evento(evento).await.unwrap_or_default() {
            if matches!(regra.canal, CanalEnvio::Email | CanalEnvio::Whatsapp) {
                let _ = self
                    .fila
                    .enfileirar(NovoEnvio {
                        canal: regra.canal,
                        destino: format!("papel:{}", regra.papel),
                        template: evento.into(),
                        payload: serde_json::json!({
                            "assunto": titulo,
                            "html": format!("<h3>{titulo}</h3><p>{mensagem}</p>"),
                            "tipo": "texto", "texto": mensagem,
                        }),
                        idreserva: None,
                        idcliente: None,
                        idfuncionario: None,
                        agendado_para: Utc::now(),
                    })
                    .await;
            }
        }
    }
}
