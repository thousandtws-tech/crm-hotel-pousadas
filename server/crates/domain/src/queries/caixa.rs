use crate::enums::{StatusTurno, TipoMovimentoCaixa};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Turno enriquecido para listagens — operador, gaveta e totais de movimento.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TurnoView {
    pub id: i64,
    pub idconta_financeira: i64,
    pub conta_financeira: String,
    pub idoperador: i64,
    pub operador: String,
    pub saldo_inicial: Decimal,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub valor_contado: Option<Decimal>,
    pub valor_esperado: Option<Decimal>,
    /// contado − esperado (negativo = falta; só existe após o fechamento).
    pub quebra: Option<Decimal>,
    pub status: StatusTurno,
    pub observacao: Option<String>,
    /// Totais de movimentos avulsos já registrados no turno.
    pub total_suprimentos: Decimal,
    pub total_sangrias: Decimal,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Movimento avulso (sangria/suprimento) com o nome de quem registrou.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MovimentoCaixaView {
    pub id: i64,
    pub idturno: i64,
    pub tipo: TipoMovimentoCaixa,
    pub valor: Decimal,
    pub motivo: String,
    pub funcionario: String,
    pub criado_em: DateTime<Utc>,
}

/// Linha do detalhamento da conferência — cada evento que entra no esperado.
#[derive(Debug, Clone, Serialize)]
pub struct ConferenciaLinha {
    pub origem: String,
    pub descricao: String,
    pub valor: Decimal,
    /// +1 entra na gaveta, −1 sai.
    pub sinal: i32,
    pub criado_em: DateTime<Utc>,
}

/// Conferência automática do turno: o esperado é derivado do ledger
/// (fundo + suprimentos − sangrias + recebimentos − pagamentos + espécie).
#[derive(Debug, Clone, Serialize)]
pub struct ConferenciaCaixa {
    pub turno: TurnoView,
    pub fundo: Decimal,
    pub suprimentos: Decimal,
    pub sangrias: Decimal,
    /// Baixas a receber na conta do turno durante a janela.
    pub recebimentos: Decimal,
    /// Baixas a pagar na conta do turno durante a janela.
    pub pagamentos: Decimal,
    /// Consumos concluídos pagos em espécie (forma marcada `especie`).
    pub especie: Decimal,
    /// inicial + suprimentos − sangrias + recebimentos − pagamentos + espécie.
    pub esperado: Decimal,
    pub movimentos: Vec<MovimentoCaixaView>,
    /// Detalhe de cada lançamento que compõe o esperado.
    pub linhas: Vec<ConferenciaLinha>,
}
