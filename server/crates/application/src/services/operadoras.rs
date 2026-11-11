//! Operadoras & consolidadoras B2B.
//!
//! CRUD admin + credencial de extranet (`token_extranet` opaco) + tarifa
//! net (`comissao_pct` sobre a diária balcão) + reserva vinculada
//! (`reserva.idoperadora`) + faturamento segregado por parceiro.

use std::sync::Arc;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;

use clarituz_domain::entities::{NovoLog, Operadora, Reserva};
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    AcomodacaoRepository, ClienteRepository, EventoPublisher, FaturamentoLinha, NovaOperadora,
    NovaReserva, NovoClienteSite, OperadoraRepository, ReservaRepository,
};
use clarituz_domain::queries::AcomodacaoDisponivel;
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{ids, money, time};

use crate::actor::Ator;
use crate::dto::DisponibilidadeResponse;
use crate::error::AppResult;
use crate::services::ReservaService;

#[derive(Debug, Deserialize)]
pub struct OperadoraInput {
    pub nome: String,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    #[serde(default)]
    pub comissao_pct: Decimal,
    pub notas: Option<String>,
}

/// Reserva vinda da extranet — o parceiro informa o hóspede final.
#[derive(Debug, Deserialize)]
pub struct ReservaOperadoraInput {
    pub idacomodacao: i64,
    pub hospede_nome: String,
    pub hospede_email: String,
    pub hospede_telefone: String,
    pub hospedes: i32,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub obs: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct DisponibilidadeOperadora {
    pub disponivel: bool,
    pub diarias: u32,
    pub comissao_pct: Decimal,
    pub acomodacoes: Vec<AcomodacaoDisponivel>,
}

#[derive(Debug, serde::Serialize)]
pub struct FaturamentoOperadora {
    pub operadora: Operadora,
    pub de: NaiveDate,
    pub ate: NaiveDate,
    pub reservas: usize,
    pub valor_total: Decimal,
    pub linhas: Vec<FaturamentoLinha>,
}

pub struct OperadoraService {
    operadoras: Arc<dyn OperadoraRepository>,
    reservas_repo: Arc<dyn ReservaRepository>,
    reservas: Arc<ReservaService>,
    clientes: Arc<dyn ClienteRepository>,
    acomodacoes: Arc<dyn AcomodacaoRepository>,
    eventos: Arc<dyn EventoPublisher>,
}

impl OperadoraService {
    pub fn new(
        operadoras: Arc<dyn OperadoraRepository>,
        reservas_repo: Arc<dyn ReservaRepository>,
        reservas: Arc<ReservaService>,
        clientes: Arc<dyn ClienteRepository>,
        acomodacoes: Arc<dyn AcomodacaoRepository>,
        eventos: Arc<dyn EventoPublisher>,
    ) -> Self {
        Self {
            operadoras,
            reservas_repo,
            reservas,
            clientes,
            acomodacoes,
            eventos,
        }
    }

    fn validar(input: &OperadoraInput) -> Result<NovaOperadora, DomainError> {
        let nome = input.nome.trim().to_string();
        if nome.len() < 3 {
            return Err(DomainError::validacao("Nome da operadora muito curto."));
        }
        if input.comissao_pct < Decimal::ZERO || input.comissao_pct > Decimal::from(100) {
            return Err(DomainError::validacao(
                "Comissão deve estar entre 0 e 100%.",
            ));
        }
        Ok(NovaOperadora {
            nome,
            contato: input.contato.clone(),
            email: input.email.clone(),
            telefone: input.telefone.clone(),
            comissao_pct: input.comissao_pct,
            notas: input.notas.clone(),
        })
    }

    // ------------------------------------------------------------------ admin

    pub async fn listar(&self, _ator: &Ator) -> AppResult<Vec<Operadora>> {
        Ok(self.operadoras.listar().await?)
    }

    pub async fn criar(&self, ator: &Ator, input: OperadoraInput) -> AppResult<Operadora> {
        let nova = Self::validar(&input)?;
        let token = format!("op_{}", ids::simples());
        let log = ator.log(
            "cadastro",
            format!("Cadastrou a operadora '{}'", nova.nome),
            "operadora",
            0,
            None,
        );
        Ok(self.operadoras.criar(&nova, &token, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: OperadoraInput,
    ) -> AppResult<Operadora> {
        let dados = Self::validar(&input)?;
        let log = ator.log(
            "edição",
            format!("Editou a operadora #{id}"),
            "operadora",
            id,
            None,
        );
        self.operadoras
            .atualizar(id, &dados, log)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Operadora não encontrada.").into())
    }

    pub async fn definir_ativa(&self, ator: &Ator, id: i64, ativa: bool) -> AppResult<Operadora> {
        let log = ator.log(
            "edição",
            format!(
                "{} a operadora #{id}",
                if ativa { "Reativou" } else { "Desativou" }
            ),
            "operadora",
            id,
            None,
        );
        self.operadoras
            .definir_ativa(id, ativa, log)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Operadora não encontrada.").into())
    }

    /// Rotação de credencial — devolve `{ token }` uma única vez (o token
    /// não é serializado na entidade por segurança).
    pub async fn rotacionar_token(&self, ator: &Ator, id: i64) -> AppResult<String> {
        let token = format!("op_{}", ids::simples());
        let log = ator.log(
            "edição",
            format!("Rotacionou o token da operadora #{id}"),
            "operadora",
            id,
            None,
        );
        self.operadoras
            .rotacionar_token(id, &token, log)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Operadora não encontrada."))?;
        Ok(token)
    }

    /// Credencial da extranet — devolve o token para o parceiro integrar.
    /// O admin consulta uma vez; depois só com rotação.
    pub async fn token(&self, ator: &Ator, id: i64) -> AppResult<String> {
        let log = ator.log(
            "leitura",
            format!("Consultou o token da operadora #{id}"),
            "operadora",
            id,
            None,
        );
        let _ = log; // leitura sem trilha — token já vem do banco
        let op = self
            .operadoras
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Operadora não encontrada."))?;
        Ok(op.token_extranet)
    }

    pub async fn faturamento(
        &self,
        _ator: &Ator,
        id: i64,
        de: NaiveDate,
        ate: NaiveDate,
    ) -> AppResult<FaturamentoOperadora> {
        let operadora = self
            .operadoras
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Operadora não encontrada."))?;
        let linhas = self.operadoras.faturamento(id, de, ate).await?;
        let valor_total = linhas
            .iter()
            .fold(Decimal::ZERO, |acc, l| acc + l.valor_total);
        Ok(FaturamentoOperadora {
            reservas: linhas.len(),
            valor_total: money::round2(valor_total),
            linhas,
            operadora,
            de,
            ate,
        })
    }

    // --------------------------------------------------------------- extranet

    /// Auth da extranet — token opaco no header `X-Extranet-Token`.
    pub async fn autenticar(&self, token: &str) -> AppResult<Operadora> {
        self.operadoras
            .por_token(token.trim())
            .await?
            .ok_or_else(|| DomainError::nao_autenticado("Token de extranet inválido.").into())
    }

    /// Diária net do parceiro — tarifa balcão menos a comissão.
    fn net(op: &Operadora, valor: Decimal) -> Decimal {
        let fator = Decimal::ONE - (op.comissao_pct / Decimal::from(100));
        money::round2(valor * fator)
    }

    /// Disponibilidade com preço já em tarifa net.
    pub async fn disponibilidade(
        &self,
        op: &Operadora,
        inicio: NaiveDate,
        fim: NaiveDate,
        hospedes: Option<i32>,
    ) -> AppResult<DisponibilidadeOperadora> {
        let resp: DisponibilidadeResponse = self
            .reservas
            .disponibilidade(inicio, fim, None, None, hospedes)
            .await?;
        let acomodacoes = resp
            .acomodacoes
            .into_iter()
            .map(|a| AcomodacaoDisponivel {
                valor: Self::net(op, a.valor),
                ..a
            })
            .collect();
        Ok(DisponibilidadeOperadora {
            disponivel: resp.disponivel,
            diarias: resp.diarias,
            comissao_pct: op.comissao_pct,
            acomodacoes,
        })
    }

    /// Cria reserva vinculada à operadora — pendente, sem expiração de
    /// hold (o pagamento é faturado ao parceiro, não cobrado online).
    /// Diária travada na tarifa net.
    pub async fn reservar(
        &self,
        op: &Operadora,
        input: ReservaOperadoraInput,
    ) -> AppResult<Reserva> {
        let nome = input.hospede_nome.trim().to_string();
        let email = input.hospede_email.trim().to_lowercase();
        let telefone = input.hospede_telefone.trim().to_string();
        if nome.is_empty() || email.is_empty() || telefone.is_empty() {
            return Err(
                DomainError::validacao("Informe nome, e-mail e telefone do hóspede.").into(),
            );
        }

        let acomodacao = self
            .acomodacoes
            .buscar(input.idacomodacao)
            .await?
            .filter(|a| a.ativo)
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada ou inativa."))?;
        let hospedes = input.hospedes.clamp(1, acomodacao.capacidade.max(1));

        let cpf = {
            let digitos: String = telefone.chars().filter(char::is_ascii_digit).collect();
            format!("OP-{}-{digitos}-{}", op.id, &ids::simples()[..6])
        };
        let idcliente = self
            .clientes
            .site_upsert(&NovoClienteSite {
                nome: nome.clone(),
                cpf,
                cpf_busca: None,
                email: email.clone(),
                telefone: telefone.clone(),
            })
            .await?;

        let periodo = PeriodoEstadia::new(input.check_in, input.check_out)?;
        let diarias = Decimal::from(time::diarias(periodo.entrada, periodo.saida));
        let diaria_pub = self.reservas.diaria_para(&acomodacao, hospedes).await?;
        let diaria_net = Self::net(op, diaria_pub);

        let obs = match input
            .obs
            .as_deref()
            .map(str::trim)
            .filter(|o| !o.is_empty())
        {
            Some(o) => format!(
                "[Extranet {}] Tel: {telefone} | E-mail: {email} | Obs: {o}",
                op.nome
            ),
            None => format!("[Extranet {}] Tel: {telefone} | E-mail: {email}", op.nome),
        };

        let nova = NovaReserva {
            idacomodacao: acomodacao.id,
            idcliente,
            quantidade_hospedes: hospedes,
            periodo,
            obs: Some(obs),
            valordiaria: diaria_net,
            valor_total: money::round2(diaria_net * diarias),
            early_checkin: false,
            late_checkout: false,
            // Faturado ao parceiro — não expira aguardando pagamento online.
            expira_em: None,
            idoperadora: Some(op.id),
            idcontrato: None,
        };
        let log = NovoLog {
            idfuncionario: None,
            acao: "cadastro".into(),
            obs: format!("Reserva via extranet — {} / {nome}", op.nome),
            tabela: "reserva",
            idtabela: 0,
            dados: Some(json!({
                "idcliente": idcliente,
                "idacomodacao": acomodacao.id,
                "idoperadora": op.id,
                "origem": "extranet",
            })),
        };

        let reserva = self
            .reservas_repo
            .criar(&nova, log)
            .await
            .map_err(|e| match e {
                // Conflito de overbooking → mensagem amigável ao parceiro.
                DomainError::Conflito(_) => crate::error::AppError::from(DomainError::conflito(
                    "Acomodação indisponível no período — consulte a disponibilidade.",
                )),
                other => crate::error::AppError::from(other),
            })?;

        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Info,
                format!("Reserva via extranet — {}", op.nome),
                format!(
                    "{nome} reservou a acomodação Nº{} de {} a {} ({} hóspede/s).",
                    acomodacao.numero,
                    periodo.entrada.format("%d/%m/%Y"),
                    periodo.saida.format("%d/%m/%Y"),
                    hospedes,
                ),
            )
            .dados(json!({ "idreserva": reserva.id, "idoperadora": op.id })),
        );

        Ok(reserva)
    }
}
