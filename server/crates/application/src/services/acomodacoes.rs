use crate::actor::Ator;
use crate::dto::{AcomodacaoInput, NomeInput, QuartoInput, TarifaOcupacaoInput};
use crate::error::AppResult;
use clarituz_domain::entities::{
    Acomodacao, Quarto, TarifaHistorico, TarifaOcupacao, TipoAcomodacao,
};
use clarituz_domain::ports::{
    AcomodacaoRepository, AtualizaAcomodacao, NovaAcomodacao, QuartoRepository,
    TipoAcomodacaoRepository,
};
use clarituz_domain::DomainError;
use clarituz_shared::{money, Page, PageParams};
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct AcomodacaoService {
    acomodacoes: Arc<dyn AcomodacaoRepository>,
    tipos: Arc<dyn TipoAcomodacaoRepository>,
    quartos: Arc<dyn QuartoRepository>,
}

impl AcomodacaoService {
    pub fn new(
        acomodacoes: Arc<dyn AcomodacaoRepository>,
        tipos: Arc<dyn TipoAcomodacaoRepository>,
        quartos: Arc<dyn QuartoRepository>,
    ) -> Self {
        Self {
            acomodacoes,
            tipos,
            quartos,
        }
    }

    pub async fn listar_tipos(&self, apenas_ativos: bool) -> AppResult<Vec<TipoAcomodacao>> {
        self.tipos.listar(apenas_ativos).await.map_err(Into::into)
    }

    pub async fn criar_tipo(&self, ator: &Ator, input: NomeInput) -> AppResult<TipoAcomodacao> {
        let nome = validar_nome(&input.nome)?;
        let log = ator.log(
            "cadastro",
            format!("Cadastrou o tipo de acomodação '{nome}'"),
            "tipoacomodacao",
            0,
            None,
        );
        Ok(self.tipos.criar(&nome, log).await?)
    }

    pub async fn atualizar_tipo(
        &self,
        ator: &Ator,
        id: i64,
        input: NomeInput,
    ) -> AppResult<TipoAcomodacao> {
        ator.exigir_admin()?;
        let nome = validar_nome(&input.nome)?;
        let log = ator.log(
            "edição",
            format!("Editou o tipo de acomodação Nº{id}: '{nome}'"),
            "tipoacomodacao",
            id,
            None,
        );
        Ok(self.tipos.atualizar(id, &nome, input.version, log).await?)
    }

    pub async fn tarifas_ocupacao(&self, idtipo: i64) -> AppResult<Vec<TarifaOcupacao>> {
        Ok(self.acomodacoes.tarifas_ocupacao(idtipo).await?)
    }

    pub async fn salvar_tarifas_ocupacao(
        &self,
        ator: &Ator,
        idtipo: i64,
        input: Vec<TarifaOcupacaoInput>,
    ) -> AppResult<Vec<TarifaOcupacao>> {
        ator.exigir_admin()?;
        if input.len() > 20 {
            return Err(DomainError::Validacao("Máximo de 20 faixas por tipo.".into()).into());
        }
        let mut vistos = std::collections::HashSet::new();
        let mut faixas = Vec::with_capacity(input.len());
        for f in input {
            if !(1..=20).contains(&f.hospedes) {
                return Err(DomainError::Validacao(format!(
                    "Faixa de {} hóspedes inválida (1–20).",
                    f.hospedes
                ))
                .into());
            }
            if f.valor <= Decimal::ZERO {
                return Err(DomainError::Validacao(format!(
                    "Valor da faixa de {} hóspedes deve ser positivo.",
                    f.hospedes
                ))
                .into());
            }
            if !vistos.insert(f.hospedes) {
                return Err(DomainError::Validacao(format!(
                    "Faixa de {} hóspedes duplicada.",
                    f.hospedes
                ))
                .into());
            }
            faixas.push((f.hospedes, f.valor));
        }
        self.acomodacoes
            .salvar_tarifas_ocupacao(idtipo, &faixas)
            .await?;
        Ok(self.acomodacoes.tarifas_ocupacao(idtipo).await?)
    }

    pub async fn status_tipo(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<TipoAcomodacao> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status do tipo Nº{id}"),
            "tipoacomodacao",
            id,
            None,
        );
        Ok(self.tipos.definir_ativo(id, ativo, log).await?)
    }

    pub async fn buscar(&self, id: i64) -> AppResult<Acomodacao> {
        self.acomodacoes
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada.").into())
    }

    pub async fn listar(
        &self,
        apenas_ativas: bool,
        page: PageParams,
    ) -> AppResult<Page<Acomodacao>> {
        self.acomodacoes
            .listar(apenas_ativas, page)
            .await
            .map_err(Into::into)
    }

    pub async fn criar(&self, ator: &Ator, input: AcomodacaoInput) -> AppResult<Acomodacao> {
        let nova = Self::validar(input)?;
        if self.acomodacoes.numero_em_uso(nova.numero, 0).await? {
            return Err(DomainError::conflito("Número já cadastrado anteriormente.").into());
        }

        let log = ator.log(
            "cadastro",
            format!("Cadastrou a acomodação '{}' Nº{}", nova.nome, nova.numero),
            "acomodacao",
            0,
            None,
        );
        Ok(self.acomodacoes.criar(&nova, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: AcomodacaoInput,
    ) -> AppResult<Acomodacao> {
        let atual = self.buscar(id).await?;
        let version = input.version;
        let nova = Self::validar(input)?;
        if self.acomodacoes.numero_em_uso(nova.numero, id).await? {
            return Err(DomainError::conflito("Número já cadastrado anteriormente.").into());
        }

        let dados = AtualizaAcomodacao {
            idtipo_acomodacao: nova.idtipo_acomodacao.or(atual.idtipo_acomodacao),
            nome: Some(nova.nome.clone()),
            numero: Some(nova.numero),
            valor: Some(nova.valor),
            capacidade: Some(nova.capacidade),
            descricao: nova.descricao.clone(),
            cor: Some(nova.cor.clone()),
            version,
            andar: Some(nova.andar),
        };

        let log = ator.log(
            "edição",
            format!("Editou a acomodação '{}' Nº{}", nova.nome, nova.numero),
            "acomodacao",
            id,
            Some(serde_json::json!({
                "idacomodacao": id, "nome": nova.nome, "numero": nova.numero, "valor": nova.valor,
            })),
        );
        Ok(self.acomodacoes.atualizar(id, &dados, log).await?)
    }

    pub async fn definir_ativo(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<Acomodacao> {
        ator.exigir_admin()?;
        self.buscar(id).await?;
        let acao = if ativo { "ativação" } else { "desativação" };
        let log = ator.log(
            acao,
            format!("{acao} da acomodação Nº{id}"),
            "acomodacao",
            id,
            None,
        );
        Ok(self.acomodacoes.definir_ativo(id, ativo, log).await?)
    }

    pub async fn historico_tarifas(&self, id: i64) -> AppResult<Vec<TarifaHistorico>> {
        self.buscar(id).await?;
        self.acomodacoes
            .historico_tarifas(id)
            .await
            .map_err(Into::into)
    }

    pub async fn listar_quartos(&self, idacomodacao: i64) -> AppResult<Vec<Quarto>> {
        self.buscar(idacomodacao).await?;
        self.quartos
            .listar_por_acomodacao(idacomodacao)
            .await
            .map_err(Into::into)
    }

    pub async fn criar_quarto(
        &self,
        ator: &Ator,
        idacomodacao: i64,
        input: QuartoInput,
    ) -> AppResult<Quarto> {
        ator.exigir_admin()?;
        self.buscar(idacomodacao).await?;
        if input.numero.trim().is_empty() {
            return Err(DomainError::validacao("Número do quarto é obrigatório.").into());
        }
        let log = ator.log(
            "cadastro",
            format!(
                "Cadastrou o quarto '{}' na acomodação Nº{idacomodacao}",
                input.numero
            ),
            "quarto",
            0,
            None,
        );
        Ok(self
            .quartos
            .criar(idacomodacao, input.numero.trim(), log)
            .await?)
    }

    pub async fn status_quarto(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<Quarto> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status do quarto Nº{id}"),
            "quarto",
            id,
            None,
        );
        Ok(self.quartos.definir_ativo(id, ativo, log).await?)
    }

    pub async fn remover_tipo(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o tipo de acomodação Nº{id}"),
            "tipo_acomodacao",
            id,
            None,
        );
        Ok(self.tipos.remover(id, log).await?)
    }

    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<Vec<String>> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu a acomodação Nº{id}"),
            "acomodacao",
            id,
            None,
        );
        Ok(self.acomodacoes.remover(id, log).await?)
    }

    pub async fn remover_quarto(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o quarto físico Nº{id}"),
            "quarto",
            id,
            None,
        );
        Ok(self.quartos.remover(id, log).await?)
    }

    fn validar(input: AcomodacaoInput) -> AppResult<NovaAcomodacao> {
        let nome = validar_nome(&input.nome)?;
        if input.numero <= 0 {
            return Err(DomainError::validacao("Número inválido.").into());
        }
        if input.capacidade <= 0 {
            return Err(DomainError::validacao("Capacidade deve ser maior que zero.").into());
        }
        let valor = input.valor.unwrap_or(Decimal::ZERO);
        if valor < Decimal::ZERO {
            return Err(DomainError::validacao("Valor não pode ser negativo.").into());
        }
        let cor = input
            .cor
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| "#000000".into());
        let descricao = input
            .descricao
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty())
            .or_else(|| Some("Sem descrição".into()));

        Ok(NovaAcomodacao {
            idtipo_acomodacao: input.idtipo_acomodacao,
            nome,
            numero: input.numero,
            andar: input.andar.unwrap_or(0),
            valor: money::round2(valor),
            capacidade: input.capacidade,
            descricao,
            cor,
            criar_quarto: true,
        })
    }
}

fn validar_nome(nome: &str) -> AppResult<String> {
    let n = nome.trim();
    if n.is_empty() {
        return Err(DomainError::validacao("Nome é obrigatório.").into());
    }
    Ok(n.to_string())
}
