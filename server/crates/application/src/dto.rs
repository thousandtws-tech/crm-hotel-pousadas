//! DTOs de entrada/saída — contratos JSON da API `/api/v1`.
//! Campos em `snake_case`, datas ISO-8601, dinheiro como `Decimal`
//! (aceita número ou string; sempre serializado com 2 casas).

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::America::Sao_Paulo;
use clarituz_domain::enums::{NivelAcesso, TipoMovimento};
use clarituz_shared::PageParams;
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
    /// Permissão granular de operações financeiras (reembolso).
    pub financeiro: bool,
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
            financeiro: f.financeiro,
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

#[derive(Debug, Deserialize)]
pub struct NoShowRequest {
    pub pin: String,
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
    /// Pavimento do mapa de ocupação (0 = térreo).
    pub andar: Option<i32>,
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
    /// Entrada antecipada — sujeita à disponibilidade, taxa somada ao total.
    pub early_checkin: Option<bool>,
    /// Saída estendida — idem.
    pub late_checkout: Option<bool>,
    /// Operadora B2B de origem — a recepção pode marcar a consolidação.
    pub idoperadora: Option<i64>,
    /// Contrato corporativo (desconto negociado) vinculado pela recepção.
    pub idcontrato: Option<i64>,
}

/// Reserva online vinda do site público — sem autenticação; o serviço
/// registra o cliente (find-or-create por e-mail/CPF) e cria reserva
/// pendente, ou registra consulta quando o período está ocupado.
#[derive(Debug, Deserialize)]
pub struct ReservaPublicaInput {
    pub slug: Option<String>,
    pub idacomodacao: Option<i64>,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub hospedes: i32,
    pub nome: String,
    pub email: String,
    pub telefone: String,
    pub cpf: Option<String>,
    pub observacoes: Option<String>,
    /// Early check-in / late checkout — mesma regra de cobrança da operação.
    pub early_checkin: Option<bool>,
    pub late_checkout: Option<bool>,
    /// CDC + LGPD — hóspede marcou que leu política de cancelamento e
    /// privacidade. Obrigatório: o aceite (data+IP) fica na reserva.
    #[serde(default)]
    pub aceito_termos: bool,
    /// Consentimento de marketing (opcional, checkbox separada — LGPD art. 8º).
    #[serde(default)]
    pub aceito_marketing: bool,
    /// Código de contrato corporativo — desconto negociado no motor.
    pub codigo_corporativo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReservaPublicaOutput {
    pub ok: bool,
    /// `"reserva_criada"` ou `"consulta_registrada"` (período ocupado).
    pub status: &'static str,
    pub idreserva: Option<i64>,
    pub idcliente: i64,
    /// Token público opaco — o site usa para criar o checkout e consultar
    /// o status sem expor o id sequencial (anti-enumeração).
    pub token_publico: Option<uuid::Uuid>,
    pub mensagem: String,
}

// ---------------------------------------------------------------------------
// pagamentos online (Stripe)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CheckoutPublicoInput {
    /// Token público retornado na criação da reserva.
    pub token: uuid::Uuid,
    /// 'integral' | 'sinal' | 'saldo' — o valor é recalculado no servidor.
    pub tipo: clarituz_domain::enums::TipoPagamento,
}

#[derive(Debug, Serialize)]
pub struct CheckoutPublicoOutput {
    /// URL hospedada Stripe para onde o hóspede é redirecionado.
    pub checkout_url: String,
    pub valor_centavos: i64,
    pub expira_em: chrono::DateTime<chrono::Utc>,
    pub idpagamento: i64,
}

#[derive(Debug, Serialize)]
pub struct PagamentoResumoPublico {
    pub tipo: clarituz_domain::enums::TipoPagamento,
    pub status: clarituz_domain::enums::StatusPagamento,
    pub valor_centavos: i64,
    pub metodo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatusPublicoOutput {
    pub status_reserva: clarituz_domain::enums::StatusReserva,
    /// True quando ao menos um pagamento está confirmado — leitura apenas;
    /// a confirmação de fato depende do webhook.
    pub confirmada: bool,
    pub pagamentos: Vec<PagamentoResumoPublico>,
}

#[derive(Debug, Deserialize)]
pub struct ReembolsarPagamentoInput {
    /// Centavos — igual ao pago = reembolso integral.
    pub valor_centavos: i64,
    pub motivo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReembolsoOutput {
    pub id: i64,
    pub refund_id: Option<String>,
    pub status: String,
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
    /// Reprecifica `valor` pela faixa de ocupação do tipo quando presente.
    pub hospedes: Option<i32>,
}

/// Faixa de tarifa por ocupação (1..20 hóspedes → diária), por tipo.
#[derive(Debug, Deserialize)]
pub struct TarifaOcupacaoInput {
    pub hospedes: i32,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
}

/// Grupo/evento — rooming list de unidades com bloqueio em massa opcional.
#[derive(Debug, Deserialize)]
pub struct GrupoInput {
    pub nome: String,
    pub contato: Option<String>,
    pub obs: Option<String>,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    /// ids das acomodações alocadas ao grupo.
    pub unidades: Vec<i64>,
    /// `true` (default) tira as unidades de venda no período via bloqueio.
    pub bloquear: Option<bool>,
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
    pub unidade: Option<String>,
    pub estoque_minimo: Option<i32>,
    #[serde(default)]
    pub eh_insumo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ItemEstoqueUpdate {
    pub nome: Option<String>,
    pub idcategoria: Option<i64>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unitario: Option<Decimal>,
    pub unidade: Option<String>,
    pub estoque_minimo: Option<i32>,
    pub eh_insumo: Option<bool>,
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
    /// Taxas early/late em R$ — entram no total usado no cálculo do sinal.
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub taxa_early: Option<Decimal>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub taxa_late: Option<Decimal>,
    /// Dados factuais do concierge Inná (Wi-Fi, horários, serviços).
    pub wifi_nome: Option<String>,
    pub wifi_senha: Option<String>,
    pub horario_checkin: Option<String>,
    pub horario_checkout: Option<String>,
    pub horario_cafe: Option<String>,
    pub info_servicos: Option<String>,
    /// MTur/Cadastur — exibido no site e nas comunicações.
    pub cadastur: Option<String>,
    /// CDC: faixas escalonadas `[{"ate_dias":15,"pct":100},…]` — ordenadas
    /// do prazo mais distante ao mais próximo do check-in.
    pub politica_cancelamento: Option<serde_json::Value>,
    /// LGPD: anos de guarda pós check-out antes de anonimizar.
    pub retencao_dados_anos: Option<i32>,
    /// LGPD: e-mail do encarregado (DPO) na política de privacidade.
    pub dpo_email: Option<String>,
    /// MTur: exige assinatura desenhada na pré-ficha pública.
    pub fnrh_assinatura: Option<bool>,
    /// Fechamento: PIN gerencial para autorizar no-show (vazio = mantém).
    pub pin_fechamento: Option<String>,
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
    /// Marca como impressora dedicada a etiquetas de produto.
    pub etiqueta: Option<bool>,
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

// ---------------------------------------------------------------------------
// tesouraria (contas a pagar/receber, conciliação, split IBS/CBS)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PlanoContaInput {
    pub codigo: String,
    pub nome: String,
    pub tipo: clarituz_domain::enums::TipoLancamento,
    pub grupo_dre: clarituz_domain::enums::GrupoDre,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ContaFinanceiraInput {
    pub nome: String,
    pub tipo: clarituz_domain::enums::TipoContaFinanceira,
    pub banco: Option<String>,
    pub agencia: Option<String>,
    pub conta: Option<String>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub saldo_inicial: Option<Decimal>,
    pub saldo_inicial_em: Option<NaiveDate>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct LancamentoInput {
    pub tipo: clarituz_domain::enums::TipoLancamento,
    pub descricao: String,
    pub idplano_conta: Option<i64>,
    pub idconta_financeira: Option<i64>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub idcliente: Option<i64>,
    pub idreserva: Option<i64>,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
    /// Parcelas mensais iguais a partir do vencimento (default 1).
    pub parcelas: Option<i32>,
    pub emissao: Option<NaiveDate>,
    pub vencimento: NaiveDate,
    pub competencia: Option<NaiveDate>,
    pub observacao: Option<String>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BaixaInput {
    pub idconta_financeira: i64,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
    pub data: Option<NaiveDate>,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportarExtratoInput {
    pub idconta_financeira: i64,
    /// Conteúdo bruto do arquivo (OFX ou CSV).
    pub conteudo: String,
}

#[derive(Debug, Serialize)]
pub struct ImportacaoExtratoResponse {
    pub importados: i64,
    pub duplicados: i64,
}

#[derive(Debug, Deserialize)]
pub struct ConciliarInput {
    pub idbaixa: i64,
}

#[derive(Debug, Deserialize)]
pub struct ClassificarExtratoInput {
    pub idplano_conta: i64,
    /// Sobrescreve a descrição do extrato (default: a do extrato).
    pub descricao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TributoConfigInput {
    /// Alíquota do IBS em % — ex.: 0.1 = 0,1%.
    #[serde(deserialize_with = "de_decimal")]
    pub aliq_ibs: Decimal,
    /// Alíquota da CBS em % — ex.: 0.9 = 0,9%.
    #[serde(deserialize_with = "de_decimal")]
    pub aliq_cbs: Decimal,
    pub regime: Option<String>,
    pub vigente_desde: Option<NaiveDate>,
}

// ---------------------------------------------------------------------------
// controle de caixa (turnos de gaveta)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AbrirCaixaInput {
    pub idconta_financeira: i64,
    #[serde(deserialize_with = "de_decimal")]
    pub saldo_inicial: Decimal,
    pub observacao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MovCaixaInput {
    pub tipo: clarituz_domain::enums::TipoMovimentoCaixa,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
    pub motivo: String,
}

#[derive(Debug, Deserialize)]
pub struct FecharCaixaInput {
    /// Dinheiro contado fisicamente na gaveta.
    #[serde(deserialize_with = "de_decimal")]
    pub valor_contado: Decimal,
    pub observacao: Option<String>,
}

// ---------------------------------------------------------------------------
// PDV & comandas
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct NovaMesaInput {
    pub numero: String,
    pub lugares: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct GarcomInput {
    pub idfuncionario: i64,
    #[serde(deserialize_with = "de_decimal")]
    pub percentual: Decimal,
    pub ativo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AbrirComandaInput {
    pub tipo: clarituz_domain::enums::PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub idquarto: Option<i64>,
    pub idcliente: Option<i64>,
    pub idgarcom: Option<i64>,
    /// Rótulo livre — obrigatório no tipo `balcao`.
    pub rotulo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ItemComandaInput {
    pub iditem: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct CancelarItemInput {
    pub motivo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FecharComandaInput {
    /// 'pagar' = à vista (baixa imediata) · 'faturar' = fica em aberto no quarto.
    pub modo: String,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub desconto: Option<Decimal>,
    pub idconta_financeira: Option<i64>,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PagarComissaoInput {
    pub idconta_financeira: i64,
    pub idforma_pagamento: Option<i64>,
}

// ---------------------------------------------------------------------------
// Café da manhã — presença por reserva/dia
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegistrarPresencaInput {
    pub idreserva: i64,
    /// Opcional — padrão hoje (retroativo dentro da estadia).
    pub data: Option<NaiveDate>,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct QuadroCafeQuery {
    /// Dia do quadro — padrão hoje.
    pub data: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct HistoricoCafeQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    #[serde(flatten)]
    pub page: PageParams,
}

// ---------------------------------------------------------------------------
// estoque & insumos — ficha tecnica, conversoes, NF-e
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FichaItemInput {
    pub idinsumo: i64,
    /// Quantidade do insumo (na unidade base dele) por unidade do produto.
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct ConversaoInput {
    /// Unidade de compra (ex.: "CX", "FARDO", "KG").
    pub unidade_compra: String,
    /// Quantas unidades base equivalem 1 unidade de compra.
    pub fator: i32,
}

#[derive(Debug, Deserialize)]
pub struct NfePreviewRequest {
    /// XML completo da NF-e.
    pub xml: String,
}

/// Item da NF-e confirmado pelo usuario.
#[derive(Debug, Deserialize)]
pub struct NfeItemInput {
    /// Mapeado para item existente; `None` cria insumo novo.
    pub iditem: Option<i64>,
    pub nome: String,
    pub unidade_compra: String,
    #[serde(default)]
    pub fator: Option<i32>,
    #[serde(deserialize_with = "de_decimal")]
    pub quantidade: Decimal,
    #[serde(deserialize_with = "de_decimal")]
    pub valor_total: Decimal,
}

#[derive(Debug, Deserialize)]
pub struct NfeImportRequest {
    pub chave: String,
    pub numero: Option<String>,
    pub emitente: Option<String>,
    pub cnpj: Option<String>,
    pub emissao: Option<String>,
    #[serde(deserialize_with = "de_decimal")]
    pub total: Decimal,
    /// Vencimento da fatura a pagar (obrigatorio quando gerar_pagamento).
    pub vencimento: Option<String>,
    #[serde(default = "default_true")]
    pub gerar_pagamento: bool,
    pub itens: Vec<NfeItemInput>,
}

fn default_true() -> bool {
    true
}

/// Retorno do preview: cabecalho + itens lidos do XML.
#[derive(Debug, Serialize)]
pub struct NfePreview {
    pub chave: String,
    pub numero: Option<String>,
    pub emitente: Option<String>,
    pub cnpj: Option<String>,
    pub emissao: Option<String>,
    pub total: Decimal,
    /// `true` quando a chave ja foi importada.
    pub ja_importada: bool,
    pub itens: Vec<NfeItemPreview>,
}

#[derive(Debug, Serialize)]
pub struct NfeItemPreview {
    pub nome: String,
    pub unidade_compra: String,
    pub quantidade: Decimal,
    pub valor_unit: Decimal,
    pub valor_total: Decimal,
    /// Item de estoque com o mesmo nome, quando encontrado (sugestao de mapeamento).
    pub iditem_sugerido: Option<i64>,
    /// Fator conhecido da unidade, quando ja ha conversao cadastrada.
    pub fator_sugerido: Option<i32>,
}

// ---------------------------------------------------------------------------
// compras — fornecedores e pedidos
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FornecedorInput {
    pub nome: String,
    pub cnpj: Option<String>,
    pub contato: Option<String>,
    pub telefone: Option<String>,
    pub lead_time_dias: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PedidoItemInput {
    pub iditem: i64,
    pub quantidade: i32,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unit: Option<Decimal>,
}

#[derive(Debug, Deserialize)]
pub struct PedidoCompraInput {
    pub idfornecedor: i64,
    /// "manual" | "maria" — aprovacao da sugestao da IA vem como 'maria'.
    pub origem: Option<String>,
    pub observacao: Option<String>,
    /// Vencimento da fatura; padrao = data_prevista (hoje + lead time).
    pub vencimento: Option<String>,
    #[serde(default)]
    pub gerar_pagamento: Option<bool>,
    pub itens: Vec<PedidoItemInput>,
}

#[derive(Debug, Deserialize)]
pub struct RecebimentoItemInput {
    pub iditem: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct RecebimentoRequest {
    pub itens: Vec<RecebimentoItemInput>,
}

#[derive(Debug, Deserialize)]
pub struct DescobertaItemInput {
    /// "rede" ou "usb".
    pub tipo: String,
    pub endereco: String,
    pub porta: Option<i32>,
    pub modelo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DescobertasInput {
    /// Hostname do agente que fez a varredura.
    pub origem: Option<String>,
    pub descobertas: Vec<DescobertaItemInput>,
}

#[derive(Debug, Deserialize)]
pub struct RegistraDescobertaInput {
    pub nome: String,
    pub setor: String,
    pub padrao: Option<bool>,
    /// Marca como impressora dedicada a etiquetas de produto.
    pub etiqueta: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ResultadoJobInput {
    pub sucesso: bool,
    pub erro: Option<String>,
}

// ---------------------------------------------------------------------------
// comunicação / reputação / fidelidade
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RespostaAvaliacaoInput {
    pub nota_geral: i16,
    pub nota_limpeza: Option<i16>,
    pub nota_atendimento: Option<i16>,
    pub nota_custo: Option<i16>,
    pub nota_localizacao: Option<i16>,
    pub nps: Option<i16>,
    pub comentario: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResponderAvaliacaoInput {
    pub resposta: String,
}

#[derive(Debug, Deserialize)]
pub struct MatrizRegraInput {
    pub evento: String,
    pub canal: clarituz_domain::enums::CanalEnvio,
    pub papel: i16,
    pub ativo: bool,
}

#[derive(Debug, Deserialize)]
pub struct PushSubscriptionInput {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NivelFidelidadeInput {
    pub nome: String,
    pub min_diarias: i32,
    pub desconto_pct: rust_decimal::Decimal,
    pub beneficios: Option<String>,
    pub ordem: i16,
    pub ativo: bool,
}

#[derive(Debug, Deserialize)]
pub struct CobrancaInput {
    /// Link de pagamento gerado pela recepção (Pix manual ou gateway).
    pub link_pagamento: String,
}

// -- operação: manutenção, governança, escalas -----------------------------------

#[derive(Debug, Deserialize)]
pub struct NovaOrdemInput {
    pub idquarto: Option<i64>,
    pub local: String,
    pub titulo: String,
    pub descricao: String,
    pub prioridade: Option<clarituz_domain::enums::PrioridadeManut>,
    #[serde(default)]
    pub materiais: serde_json::Value,
    pub responsavel: Option<String>,
    pub idfuncionario: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PmocItemInput {
    pub item: String,
    pub conforme: bool,
    #[serde(default)]
    pub obs: String,
}

#[derive(Debug, Deserialize)]
pub struct NovaPmocInput {
    pub referente_a: chrono::NaiveDate,
    pub itens: Vec<serde_json::Value>,
    pub responsavel_nome: String,
    pub responsavel_crea: String,
    pub responsavel_art: String,
    #[serde(default)]
    pub observacoes: String,
    pub proxima_data: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct NovaTarefaInput {
    pub idquarto: Option<i64>,
    pub data: Option<chrono::NaiveDate>,
    pub tipo: clarituz_domain::enums::TipoTarefaGov,
    pub estimado_min: Option<i16>,
    pub idfuncionario: Option<i64>,
    #[serde(default)]
    pub observacao: String,
}

#[derive(Debug, Deserialize)]
pub struct NovoLoteInput {
    pub fornecedor: String,
    pub competencia: Option<chrono::NaiveDate>,
    pub qtd_itens: i32,
    #[serde(default)]
    pub custo_centavos: i64,
    #[serde(default)]
    pub observacao: String,
}

#[derive(Debug, Deserialize)]
pub struct NovoMovEnxovalInput {
    pub tipo_item: String,
    pub quantidade: i32,
    pub origem: String,
    pub destino: String,
    pub idlote: Option<i64>,
    pub idquarto: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct JornadaInput {
    pub idfuncionario: i64,
    pub regime: clarituz_domain::enums::RegimeEscala,
    pub entrada: chrono::NaiveTime,
    pub saida: chrono::NaiveTime,
    pub almoco_min: Option<i16>,
    pub ancora: chrono::NaiveDate,
    pub ativo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct StatusManutInput {
    pub status: clarituz_domain::enums::StatusManut,
    pub custo_centavos: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StatusTarefaInput {
    pub status: clarituz_domain::enums::StatusTarefaGov,
}

#[derive(Debug, Deserialize)]
pub struct DevolverLoteInput {
    pub qtd_devolvida: i32,
    pub custo_centavos: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AtribuirTarefaInput {
    pub idfuncionario: i64,
}
