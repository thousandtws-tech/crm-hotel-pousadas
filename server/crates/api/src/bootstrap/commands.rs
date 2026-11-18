use clarituz_domain::entities::NovoLog;
use clarituz_domain::ports::{
    CargoRepository, FuncionarioRepository, NovoFuncionario, PasswordHasher,
};
use clarituz_infrastructure::{repositories, Argon2Hasher};

pub async fn create_admin(
    pool: &sqlx::PgPool,
    login: &str,
    nome: &str,
    senha: &str,
    nivel: i16,
) -> Result<(), Box<dyn std::error::Error>> {
    if senha.len() < 8 {
        return Err("senha deve ter ao menos 8 caracteres".into());
    }
    let hasher = Argon2Hasher::new();
    let repo = repositories::PgFuncionarioRepository::new(pool.clone());
    let cargos = repositories::PgCargoRepository::new(pool.clone());
    if repo.login_em_uso(login, 0).await? {
        return Err(format!("login '{login}' já existe").into());
    }
    let cargo = cargos
        .buscar_por_nivel(nivel)
        .await?
        .ok_or("nenhum cargo ativo para o nível informado — rode as migrations")?;
    let f = repo
        .criar(
            &NovoFuncionario {
                nome: nome.to_string(),
                login: login.to_lowercase(),
                senha_hash: hasher.hash(senha)?,
                cpf: None,
                data_nascimento: None,
                nivel,
                cargo_id: cargo.id,
                ativo: true,
            },
            NovoLog {
                idfuncionario: None,
                acao: "seed".into(),
                obs: format!("Criação inicial do administrador '{login}'"),
                tabela: "funcionario",
                idtabela: 0,
                dados: None,
            },
        )
        .await?;
    tracing::info!(id = f.id, login = %f.login, "administrador criado");
    Ok(())
}
