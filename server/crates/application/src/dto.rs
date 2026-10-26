//! DTOs de entrada/saída — contratos JSON da API `/api/v1`.
//! Campos em `snake_case`, datas ISO-8601, dinheiro como `Decimal`
//! (aceita número ou string; sempre serializado com 2 casas).

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::America::Sao_Paulo;
use clarituz_domain::enums::{NivelAcesso, TipoMovimento};
use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer, Serialize};

// ---------------------------------------------------------------------------
// helpers de desserialização
// ---------------------------------------------------------------------------

/// Aceita `"123.45"`, `123.45` ou o formato brasileiro `"1.234,56"`.
fn parse_decimal(v: &serde_json::Value) -> Result<Decimal, String> {
    match v {
        serde_json::Value::String(s) => {
            let s = s.trim().replace("R$", "").trim().to_string();
            let canon = if s.contains(',') {
                // formato BR: ponto = milhar, vírgula = decimal
                s.replace('.', "").replace(',', ".")
            } else {
                s
            };
            canon
                .parse::<Decimal>()
                .map_err(|_| "valor monetário inválido".to_string())
        }
        serde_json::Value::Number(n) => n
            .to_string()
            .parse::<Decimal>()
            .map_err(|_| "valor monetário inválido".to_string()),
        _ => Err("valor monetário inválido".to_string()),
    }
}

pub fn de_decimal<'de, D: Deserializer<'de>>(d: D) -> Result<Decimal, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    parse_decimal(&v).map_err(serde::de::Error::custom)
}

pub fn de_decimal_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Decimal>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => parse_decimal(&v)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

/// `Option<i64>` tolerante a string — necessário em structs achatadas via
/// `#[serde(flatten)]` dentro de query strings (`serde_urlencoded` entrega
/// `Content::String` aos campos internos do flatten).
pub fn de_i64_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom("inteiro inválido")),
        Some(serde_json::Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(serde_json::Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map(Some)
            .map_err(|_| serde::de::Error::custom("inteiro inválido")),
        _ => Err(serde::de::Error::custom("inteiro inválido")),
    }
}
// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub login: String,
    pub senha: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expira_em: i64,
    pub funcionario: FuncionarioView,
}

#[derive(Debug, Serialize)]
pub struct FuncionarioView {
    pub id: i64,
    pub nome: String,
    pub login: String,
    pub nivel: i16,
    pub nivel_nome: &'static str,
    pub ativo: bool,
}

impl From<&clarituz_domain::entities::Funcionario> for FuncionarioView {
    fn from(f: &clarituz_domain::entities::Funcionario) -> Self {
        Self {
            id: f.id,
            nome: f.nome.clone(),
            login: f.login.clone(),
            nivel: f.nivel,
            nivel_nome: match NivelAcesso::from_i16(f.nivel) {
                NivelAcesso::Administrador => "Administrador",
                NivelAcesso::Gerente => "Gerente",
                NivelAcesso::Recepcao => "Recepção",
            },
            ativo: f.ativo,
        }
    }
}

// ---------------------------------------------------------------------------
// clientes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ClienteInput {
    pub nome: String,
    pub cpf: String,
    pub data_nascimento: NaiveDate,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub estado: Option<String>,
    pub cidade: Option<String>,
    // -- dados complementares da FNRH (opcionais no cadastro) ----------------
    pub nacionalidade: Option<String>,
    pub naturalidade: Option<String>,
    pub profissao: Option<String>,
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cep: Option<String>,
    pub pais: Option<String>,
    /// Concorrência otimista — só em PUT (ignorada no POST).
    pub version: Option<i64>,
}

/// Documento de identidade do hóspede (RG, CPF, CNH, passaporte, RNE).
#[derive(Debug, Deserialize)]
pub struct DocumentoInput {
    pub tipo: String,
    pub numero: String,
    pub orgao_emissor: Option<String>,
    pub uf_emissor: Option<String>,
    pub pais_emissor: Option<String>,
    pub validade: Option<NaiveDate>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

/// Acompanhante da reserva (cônjuge, filhos menores etc.).
#[derive(Debug, Deserialize)]
pub struct AcompanhanteInput {
    pub nome: String,
    pub data_nascimento: Option<NaiveDate>,
    pub parentesco: Option<String>,
    pub doc_tipo: Option<String>,
    pub doc_numero: Option<String>,
}

/// Emissão da FNRH — dados que variam por estadia (motivo, veículo).
/// O restante da ficha é montado no servidor a partir do cadastro/reserva.
#[derive(Debug, Deserialize)]
pub struct FnrhEmitRequest {
    pub motivo_viagem: Option<String>,
    pub placa_veiculo: Option<String>,
}

// ---------------------------------------------------------------------------
// acomodações
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct NomeInput {
    pub nome: String,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AtivoInput {
    pub ativo: bool,
}

#[derive(Debug, Deserialize)]
pub struct AcomodacaoInput {
    pub idtipo_acomodacao: Option<i64>,
    pub nome: String,
    pub numero: i32,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor: Option<Decimal>,
    pub capacidade: i32,
    pub descricao: Option<String>,
    pub cor: Option<String>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct QuartoInput {
    pub numero: String,
}

// ---------------------------------------------------------------------------
// cms (site público)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CmsInput {
    pub slug: Option<String>,
    pub subtitulo: Option<String>,
    pub descricao_curta: Option<String>,
    pub descricao_longa: Option<String>,
    pub destaque_editorial: Option<String>,
    pub camas: Option<String>,
    pub banheiros: Option<i32>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub metragem: Option<Decimal>,
    pub vista: Option<String>,
    pub andar: Option<String>,
    pub comodidades: Option<serde_json::Value>,
    pub destaque: Option<bool>,
    pub ordem: Option<i32>,
    /// Concorrência otimista — só em update de CMS já existente.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StatusCmsInput {
    pub publicar: bool,
}

#[derive(Debug, Deserialize)]
pub struct OrdenarMidiaInput {
    /// IDs das mídias na ordem desejada.
    pub ordem: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct VinculoAcomodacaoInput {
    pub idacomodacao: Option<i64>,
}

// ---------------------------------------------------------------------------
// reservas
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ReservaInput {
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub obs: Option<String>,
    /// Opcional: quando ausente usa a tarifa vigente da acomodação.
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valordiaria: Option<Decimal>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CheckinRequest {
    /// Data do check-in — default: hoje (fuso da pousada).
    pub data: Option<NaiveDate>,
    /// Hora do check-in — default: agora.
    pub hora: Option<NaiveTime>,
}

impl CheckinRequest {
    /// Combina data/hora no fuso do negócio e converte para UTC.
    pub fn instante(&self) -> DateTime<Utc> {
        let hoje = clarituz_shared::time::hoje();
        let data = self.data.unwrap_or(hoje);
        let hora = self.hora.unwrap_or_else(|| Utc::now().time());
        match data.and_time(hora).and_local_timezone(Sao_Paulo).single() {
            Some(dt) => dt.with_timezone(&Utc),
            None => Utc::now(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AdicionalInput {
    pub motivo: String,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
}

#[derive(Debug, Deserialize)]
pub struct CheckoutRequest {
    pub idforma_pagamento: i64,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub total_desconto: Option<Decimal>,
    #[serde(default)]
    pub adicionais: Vec<AdicionalInput>,
}

#[derive(Debug, Deserialize)]
pub struct CancelarReservaRequest {
    pub motivo: Option<String>,
    /// Credenciais de administrador — exigidas para cancelar reserva
    /// já em estadia (`iniciada`) por um operador não-admin.
    pub login_admin: Option<String>,
    pub senha_admin: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ItemConsumidoRequest {
    pub iditem_frigobar: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct DisponibilidadeQuery {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub idacomodacao: Option<i64>,
    pub excluir_reserva: Option<i64>,
}

/// Filtros de listagem de reservas — **achatado** (`#[serde(flatten)]`)
/// dentro da query do handler, portanto inteiros chegam como string.
#[derive(Debug, Deserialize)]
pub struct ReservaFiltroQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "de_i64_opt")]
    pub idacomodacao: Option<i64>,
    #[serde(default, deserialize_with = "de_i64_opt")]
    pub idcliente: Option<i64>,
    /// Busca livre (cliente, acomodação ou nº da reserva).
    pub busca: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DisponibilidadeResponse {
    pub disponivel: bool,
    pub quantidade: usize,
    pub diarias: u32,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub acomodacoes: Vec<clarituz_domain::queries::AcomodacaoDisponivel>,
}

#[derive(Debug, Serialize)]
pub struct CancelamentoResponse {
    pub reserva: clarituz_domain::entities::Reserva,
    pub reembolso: Option<clarituz_domain::entities::Reembolso>,
}

// ---------------------------------------------------------------------------
// estoque
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ItemEstoqueInput {
    pub nome: String,
    pub idcategoria: Option<i64>,
    #[serde(default)]
    pub quantidade_inicial: Option<i32>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unitario: Option<Decimal>,
}

#[derive(Debug, Deserialize)]
pub struct ItemEstoqueUpdate {
    pub nome: Option<String>,
    pub idcategoria: Option<i64>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unitario: Option<Decimal>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct MovimentacaoInput {
    pub iditem: i64,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub motivo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MovimentacoesRequest {
    pub movimentos: Vec<MovimentacaoInput>,
}

// ---------------------------------------------------------------------------
// frigobar
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FrigobarInput {
    pub idacomodacao: i64,
    pub modelo: Option<String>,
    pub patrimonio: Option<String>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ItemFrigobarInput {
    pub iditem: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct QuantidadeInput {
    pub quantidade: i32,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

// ---------------------------------------------------------------------------
// funcionários
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FuncionarioInput {
    pub nome: String,
    pub login: String,
    pub senha: String,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    pub nivel: i16,
}

/// Auto-cadastro pela tela de login — cria conta de administrador; os demais
/// níveis (Recepção, Gerente) são criados no painel.
#[derive(Debug, Deserialize)]
pub struct RegistroInput {
    pub nome: String,
    pub login: String,
    pub senha: String,
}

#[derive(Debug, Deserialize)]
pub struct FuncionarioUpdate {
    pub nome: Option<String>,
    pub login: Option<String>,
    /// Quando presente, redefine a senha.
    pub senha: Option<String>,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    pub nivel: Option<i16>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}

// ---------------------------------------------------------------------------
// estabelecimento / vagas
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct EstabelecimentoInput {
    pub cnpj: Option<String>,
    pub razao_social: Option<String>,
    pub site: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub celular: Option<String>,
    pub impressora_ip: Option<String>,
    pub impressora_porta: Option<i32>,
    pub impressora_ativa: Option<bool>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct EnderecoInput {
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cidade: Option<String>,
    pub cep: Option<String>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct VagaInput {
    pub numero: String,
}

#[derive(Debug, Deserialize)]
pub struct ImpressoraInput {
    pub nome: String,
    pub setor: String,
    pub ip: String,
    pub porta: Option<i32>,
    pub ativa: Option<bool>,
    /// Marca como impressora padrão de comprovantes.
    pub padrao: Option<bool>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

/// Vínculo categoria → impressora do setor (roteamento KOT).
#[derive(Debug, Deserialize)]
pub struct ImpressoraCategoriaInput {
    pub impressora_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// financeiro / dashboard
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PeriodoQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

#[derive(Debug, Serialize)]
pub struct AcomodacaoBasica {
    pub id: i64,
    pub nome: String,
    pub numero: i32,
}

#[derive(Debug, Serialize)]
pub struct DashboardResponse {
    pub cards: clarituz_domain::queries::DashboardCards,
    pub ultimas_reservas: Vec<clarituz_domain::queries::ReservaResumo>,
    pub checkins_pendentes: Vec<clarituz_domain::queries::PendenciaDia>,
    pub checkouts_pendentes: Vec<clarituz_domain::queries::PendenciaDia>,
    pub acomodacoes_disponiveis: Vec<AcomodacaoBasica>,
    pub acomodacoes_ocupadas: Vec<AcomodacaoBasica>,
}

/// Resposta padronizada para operações simples.
#[derive(Debug, Serialize)]
pub struct Mensagem {
    pub mensagem: String,
}

impl Mensagem {
    pub fn ok(m: impl Into<String>) -> Self {
        Self { mensagem: m.into() }
    }
}
