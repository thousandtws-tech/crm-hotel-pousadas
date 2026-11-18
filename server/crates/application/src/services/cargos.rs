//! Casos de uso de cargos — título + nível de acesso dos funcionários.
//!
//! `cargo.nivel` é a fonte do acesso: ao criar/editar funcionário o serviço
//! copia `cargo.nivel` para `funcionario.nivel` (autoridade do RBAC, que
//! permanece inalterada). Cargos `sistema` (Administrador/Gerente/Recepção)
//! não podem ser removidos nem ter o nível alterado.

use crate::actor::Ator;
use crate::error::AppResult;
use clarituz_domain::entities::Cargo;
use clarituz_domain::ports::{AtualizaCargo, CargoRepository, NovoCargo};
use clarituz_domain::DomainError;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct CargoInput {
    pub nome: String,
    pub descricao: Option<String>,
    pub nivel: i16,
}

#[derive(Debug, Deserialize)]
pub struct CargoUpdate {
    pub nome: Option<String>,
    pub descricao: Option<String>,
    pub nivel: Option<i16>,
    pub ativo: Option<bool>,
}

pub struct CargosService {
    repo: Arc<dyn CargoRepository>,
}

impl CargosService {
    pub fn new(repo: Arc<dyn CargoRepository>) -> Self {
        Self { repo }
    }

    /// Resolve o par (cargo_id, nivel) efetivo para gravação de funcionário:
    /// `cargo_id` vence; `nivel` legado cai no cargo-base correspondente.
    pub async fn resolver(&self, cargo_id: Option<i64>, nivel: i16) -> AppResult<(i64, i16)> {
        match cargo_id {
            Some(id) => {
                let c = self
                    .repo
                    .buscar(id)
                    .await?
                    .ok_or_else(|| DomainError::validacao("Cargo informado não existe."))?;
                if !c.ativo {
                    return Err(DomainError::validacao("Cargo informado está inativo.").into());
                }
                Ok((c.id, c.nivel))
            }
            None => {
                let c = self.repo.buscar_por_nivel(nivel).await?.ok_or_else(|| {
                    DomainError::validacao("Nenhum cargo ativo para o nível informado.")
                })?;
                Ok((c.id, c.nivel))
            }
        }
    }

    pub async fn listar(&self, apenas_ativos: bool) -> AppResult<Vec<Cargo>> {
        self.repo.listar(apenas_ativos).await.map_err(Into::into)
    }

    /// Cadastro — restrito a administradores.
    pub async fn criar(&self, ator: &Ator, input: CargoInput) -> AppResult<Cargo> {
        ator.exigir_admin()?;
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome do cargo é obrigatório.").into());
        }
        if !(1..=3).contains(&input.nivel) {
            return Err(DomainError::validacao("Nível de acesso deve ser 1, 2 ou 3.").into());
        }
        if self.repo.nome_em_uso(nome, 0).await? {
            return Err(DomainError::conflito(format!("Cargo '{nome}' já existe.")).into());
        }
        let novo = NovoCargo {
            nome: nome.to_string(),
            descricao: input
                .descricao
                .map(|d| d.trim().to_string())
                .filter(|d| !d.is_empty()),
            nivel: input.nivel,
        };
        self.repo.criar(&novo).await.map_err(Into::into)
    }

    pub async fn atualizar(&self, ator: &Ator, id: i64, input: CargoUpdate) -> AppResult<Cargo> {
        ator.exigir_admin()?;
        let atual = self
            .repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cargo não encontrado."))?;

        // Cargos-base: nível travado — o RBAC assume 1/2/3 fixos neles.
        if atual.sistema && input.nivel.is_some_and(|n| n != atual.nivel) {
            return Err(
                DomainError::regra("O nível de um cargo-base não pode ser alterado.").into(),
            );
        }
        if let Some(n) = input.nivel {
            if !(1..=3).contains(&n) {
                return Err(DomainError::validacao("Nível de acesso deve ser 1, 2 ou 3.").into());
            }
        }
        if let Some(nome) = input.nome.as_deref().map(str::trim) {
            if nome.is_empty() {
                return Err(DomainError::validacao("Nome do cargo é obrigatório.").into());
            }
            if self.repo.nome_em_uso(nome, id).await? {
                return Err(DomainError::conflito(format!("Cargo '{nome}' já existe.")).into());
            }
        }
        let dados = AtualizaCargo {
            nome: input
                .nome
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty()),
            descricao: input
                .descricao
                .map(|d| d.trim().to_string())
                .filter(|d| !d.is_empty()),
            nivel: input.nivel,
            ativo: input.ativo,
        };
        self.repo.atualizar(id, &dados).await.map_err(Into::into)
    }

    /// Remove em definitivo — vedado para cargos-base e cargos em uso.
    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let c = self
            .repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cargo não encontrado."))?;
        if c.sistema {
            return Err(DomainError::regra("Cargo-base do sistema não pode ser removido.").into());
        }
        self.repo.remover(id).await.map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    //! Regras do `CargosService` — repo stub em memória.
    use super::*;
    use clarituz_domain::enums::NivelAcesso;
    use std::sync::Mutex;

    fn cargo_fake(id: i64, nome: &str, nivel: i16, sistema: bool) -> Cargo {
        Cargo {
            id,
            nome: nome.into(),
            descricao: None,
            nivel,
            ativo: true,
            sistema,
            total_funcionarios: 0,
            criado_em: chrono::Utc::now(),
            atualizado_em: chrono::Utc::now(),
        }
    }

    struct RepoStub {
        cargos: Mutex<Vec<Cargo>>,
        nomes_em_uso: Vec<String>,
    }

    impl RepoStub {
        fn base() -> Self {
            Self {
                cargos: Mutex::new(vec![
                    cargo_fake(1, "Administrador", 1, true),
                    cargo_fake(2, "Gerente", 2, true),
                    cargo_fake(3, "Recepção", 3, true),
                ]),
                nomes_em_uso: vec![],
            }
        }
        fn svc(self) -> CargosService {
            CargosService::new(Arc::new(self))
        }
        fn desativar(&self, id: i64) {
            self.cargos
                .lock()
                .unwrap()
                .iter_mut()
                .find(|c| c.id == id)
                .unwrap()
                .ativo = false;
        }
    }

    #[async_trait::async_trait]
    impl CargoRepository for RepoStub {
        async fn buscar(&self, id: i64) -> Result<Option<Cargo>, DomainError> {
            Ok(self
                .cargos
                .lock()
                .unwrap()
                .iter()
                .find(|c| c.id == id)
                .cloned())
        }
        async fn buscar_por_nivel(&self, nivel: i16) -> Result<Option<Cargo>, DomainError> {
            Ok(self
                .cargos
                .lock()
                .unwrap()
                .iter()
                .find(|c| c.ativo && c.nivel == nivel)
                .cloned())
        }
        async fn listar(&self, _a: bool) -> Result<Vec<Cargo>, DomainError> {
            Ok(self.cargos.lock().unwrap().clone())
        }
        async fn nome_em_uso(&self, nome: &str, _e: i64) -> Result<bool, DomainError> {
            Ok(self.nomes_em_uso.iter().any(|n| n == nome))
        }
        async fn criar(&self, novo: &NovoCargo) -> Result<Cargo, DomainError> {
            let mut c = cargo_fake(9, &novo.nome, novo.nivel, false);
            c.descricao = novo.descricao.clone();
            self.cargos.lock().unwrap().push(c.clone());
            Ok(c)
        }
        async fn atualizar(&self, id: i64, d: &AtualizaCargo) -> Result<Cargo, DomainError> {
            let mut cs = self.cargos.lock().unwrap();
            let c = cs.iter_mut().find(|c| c.id == id).unwrap();
            if let Some(n) = &d.nome {
                c.nome = n.clone();
            }
            if let Some(n) = d.nivel {
                c.nivel = n;
            }
            Ok(c.clone())
        }
        async fn remover(&self, id: i64) -> Result<(), DomainError> {
            let mut cs = self.cargos.lock().unwrap();
            cs.retain(|c| c.id != id);
            Ok(())
        }
    }

    fn admin() -> Ator {
        Ator {
            id: 1,
            login: "t".into(),
            nome: "Teste".into(),
            nivel: NivelAcesso::Administrador,
            financeiro: false,
        }
    }
    fn recepcao() -> Ator {
        Ator {
            nivel: NivelAcesso::Recepcao,
            ..admin()
        }
    }

    #[tokio::test]
    async fn resolver_prefere_cargo_e_deriva_nivel() {
        let s = RepoStub::base().svc();
        let (id, nivel) = s.resolver(Some(2), 3).await.unwrap();
        assert_eq!((id, nivel), (2, 2));
    }

    #[tokio::test]
    async fn resolver_sem_cargo_cai_no_cargo_base_do_nivel() {
        let s = RepoStub::base().svc();
        let (id, nivel) = s.resolver(None, 1).await.unwrap();
        assert_eq!((id, nivel), (1, 1));
    }

    #[tokio::test]
    async fn resolver_rejeita_cargo_inexistente_e_inativo() {
        let repo = Arc::new(RepoStub::base());
        let s = CargosService::new(repo.clone());
        assert!(matches!(
            s.resolver(Some(99), 1).await.unwrap_err().domain(),
            DomainError::Validacao(_)
        ));
        repo.desativar(3);
        assert!(matches!(
            s.resolver(Some(3), 1).await.unwrap_err().domain(),
            DomainError::Validacao(_)
        ));
    }

    #[tokio::test]
    async fn criar_exige_admin_e_valida() {
        let s = RepoStub::base().svc();
        let input = CargoInput {
            nome: "Camareira".into(),
            descricao: None,
            nivel: 3,
        };
        assert!(matches!(
            s.criar(&recepcao(), input).await.unwrap_err().domain(),
            DomainError::Proibido(_)
        ));
        let ruim = CargoInput {
            nome: "X".into(),
            descricao: None,
            nivel: 9,
        };
        assert!(matches!(
            s.criar(&admin(), ruim).await.unwrap_err().domain(),
            DomainError::Validacao(_)
        ));
    }

    #[tokio::test]
    async fn criar_nome_duplicado_conflita() {
        let mut repo = RepoStub::base();
        repo.nomes_em_uso.push("Camareira".into());
        let s = repo.svc();
        let input = CargoInput {
            nome: "Camareira".into(),
            descricao: None,
            nivel: 3,
        };
        assert!(matches!(
            s.criar(&admin(), input).await.unwrap_err().domain(),
            DomainError::Conflito(_)
        ));
    }

    #[tokio::test]
    async fn atualizar_trava_nivel_do_cargo_base() {
        let s = RepoStub::base().svc();
        let up = CargoUpdate {
            nome: None,
            descricao: None,
            nivel: Some(2),
            ativo: None,
        };
        assert!(matches!(
            s.atualizar(&admin(), 3, up).await.unwrap_err().domain(),
            DomainError::RegraNegocio(_)
        ));
        // Renomear o cargo-base é permitido — só o nível é travado.
        let ok = CargoUpdate {
            nome: Some("Recepção Noturna".into()),
            descricao: None,
            nivel: None,
            ativo: None,
        };
        assert_eq!(
            s.atualizar(&admin(), 3, ok).await.unwrap().nome,
            "Recepção Noturna"
        );
    }

    #[tokio::test]
    async fn remover_rejeita_cargo_base_e_aceita_comum() {
        let s = RepoStub::base().svc();
        assert!(matches!(
            s.remover(&admin(), 1).await.unwrap_err().domain(),
            DomainError::RegraNegocio(_)
        ));
        s.criar(
            &admin(),
            CargoInput {
                nome: "Extra".into(),
                descricao: None,
                nivel: 3,
            },
        )
        .await
        .unwrap();
        s.remover(&admin(), 9).await.unwrap();
    }
}
