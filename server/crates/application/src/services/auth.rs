//! Casos de uso de autenticação: login, refresh rotation, logout, `me`
//! e verificação de credencial administrativa (cancelamento privilegiado).

use crate::actor::RequestCtx;
use crate::dto::{FuncionarioView, TokenResponse};
use crate::error::AppResult;
use chrono::{Duration, Utc};
use clarituz_domain::entities::{Funcionario, NovoLog};
use clarituz_domain::ports::{
    FuncionarioRepository, LogAcessoRepository, LogRepository, PasswordHasher, SessaoRepository,
    TokenIssuer,
};
use clarituz_domain::{DomainError, TokenClaims};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

pub struct AuthService {
    funcionarios: Arc<dyn FuncionarioRepository>,
    sessoes: Arc<dyn SessaoRepository>,
    acessos: Arc<dyn LogAcessoRepository>,
    logs: Arc<dyn LogRepository>,
    hasher: Arc<dyn PasswordHasher>,
    issuer: Arc<dyn TokenIssuer>,
    access_ttl_secs: i64,
    refresh_ttl_secs: i64,
}

impl AuthService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        funcionarios: Arc<dyn FuncionarioRepository>,
        sessoes: Arc<dyn SessaoRepository>,
        acessos: Arc<dyn LogAcessoRepository>,
        logs: Arc<dyn LogRepository>,
        hasher: Arc<dyn PasswordHasher>,
        issuer: Arc<dyn TokenIssuer>,
        access_ttl_secs: i64,
        refresh_ttl_secs: i64,
    ) -> Self {
        Self {
            funcionarios,
            sessoes,
            acessos,
            logs,
            hasher,
            issuer,
            access_ttl_secs,
            refresh_ttl_secs,
        }
    }

    /// `login + senha` → par access/refresh.
    ///
    /// A verificação de senha roda também quando o usuário não existe
    /// (argon2 contra hash fixo) para não vazar existência via timing.
    pub async fn login(
        &self,
        login: &str,
        senha: &str,
        ctx: &RequestCtx,
    ) -> AppResult<TokenResponse> {
        let funcionario = self.funcionarios.buscar_por_login(login).await?;

        // hash dummy: equaliza o tempo de resposta quando o login não existe
        const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$\
            c29tZXNhbHRmb3JkdW1teQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let hash = funcionario
            .as_ref()
            .map(|f| f.senha_hash.as_str())
            .unwrap_or(DUMMY_HASH);
        let ok = self.hasher.verify(senha, hash)?;

        let f = match (funcionario, ok) {
            (Some(f), true) if f.ativo => f,
            (Some(_), true) => {
                return Err(DomainError::proibido("Usuário desativado.").into());
            }
            _ => return Err(DomainError::nao_autenticado("Usuário ou senha inválidos.").into()),
        };

        self.acessos
            .registrar(f.id, ctx.ip.as_deref(), ctx.user_agent.as_deref())
            .await?;

        let _ = self
            .logs
            .inserir(NovoLog {
                idfuncionario: Some(f.id),
                acao: "login".into(),
                obs: format!("Funcionário {} realizou login.", f.login),
                tabela: "funcionario",
                idtabela: f.id,
                dados: None,
            })
            .await;

        self.emitir_tokens(&f, ctx).await
    }

    /// Troca um refresh token válido por um novo par — com **rotação**:
    /// o token usado é revogado atomicamente antes da emissão do novo.
    pub async fn refresh(&self, refresh_token: &str, ctx: &RequestCtx) -> AppResult<TokenResponse> {
        let hash = Self::hash_refresh(refresh_token);
        let sessao = self
            .sessoes
            .buscar_valida(&hash)
            .await?
            .ok_or_else(|| DomainError::nao_autenticado("Sessão expirada ou inválida."))?;

        let f = self
            .funcionarios
            .buscar(sessao.idfuncionario)
            .await?
            .filter(|f| f.ativo)
            .ok_or_else(|| DomainError::nao_autenticado("Usuário inválido."))?;

        self.sessoes.revogar(sessao.id).await?;
        self.emitir_tokens(&f, ctx).await
    }

    pub async fn logout(&self, refresh_token: &str) -> AppResult<()> {
        self.sessoes
            .revogar_por_hash(&Self::hash_refresh(refresh_token))
            .await?;
        Ok(())
    }

    pub async fn me(&self, idfuncionario: i64) -> AppResult<FuncionarioView> {
        let f = self
            .funcionarios
            .buscar(idfuncionario)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Funcionário não encontrado."))?;
        Ok(FuncionarioView::from(&f))
    }

    /// Verifica credencial de administrador — usado no cancelamento de
    /// reserva em estadia por operador sem privilégio (legado:
    /// `aCancelarReservaAdm.php`).
    pub async fn autenticar_admin(&self, login: &str, senha: &str) -> AppResult<bool> {
        let f = self.funcionarios.buscar_por_login(login).await?;
        match f {
            Some(f) if f.ativo && f.is_admin() => {
                self.hasher.verify(senha, &f.senha_hash).map_err(Into::into)
            }
            _ => Ok(false),
        }
    }

    // -- internos ------------------------------------------------------------

    async fn emitir_tokens(&self, f: &Funcionario, ctx: &RequestCtx) -> AppResult<TokenResponse> {
        let now = Utc::now();
        let claims = TokenClaims {
            sub: f.id.to_string(),
            login: f.login.clone(),
            nome: f.nome.clone(),
            nivel: f.nivel,
            iat: now.timestamp(),
            exp: (now + Duration::seconds(self.access_ttl_secs)).timestamp(),
            iss: "clarituz-api".into(),
        };
        let access_token = self.issuer.emitir(&claims)?;

        let refresh_token =
            Uuid::new_v4().simple().to_string() + &Uuid::new_v4().simple().to_string();
        let refresh_hash = Self::hash_refresh(&refresh_token);
        self.sessoes
            .criar(
                f.id,
                &refresh_hash,
                now + Duration::seconds(self.refresh_ttl_secs),
                ctx.ip.as_deref(),
                ctx.user_agent.as_deref(),
            )
            .await?;

        Ok(TokenResponse {
            access_token,
            refresh_token,
            token_type: "Bearer",
            expira_em: self.access_ttl_secs,
            funcionario: FuncionarioView::from(f),
        })
    }

    /// Refresh tokens são persistidos como SHA-256 — nunca em claro.
    pub fn hash_refresh(token: &str) -> String {
        hex::encode(Sha256::digest(token.as_bytes()))
    }
}
