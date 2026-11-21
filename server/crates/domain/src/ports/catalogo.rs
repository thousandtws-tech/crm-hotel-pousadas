use crate::entities::{
    Acomodacao, EnderecoEstabelecimento, Estabelecimento, FormaPagamento, Frigobar, ItemFrigobar,
    NovoLog, Quarto, TarifaHistorico, TarifaOcupacao, TarifaPeriodo, TipoAcomodacao,
    VagaEstacionamento,
};
use crate::error::DomainError;
use crate::queries::ItemFrigobarView;
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

#[async_trait]
pub trait TipoAcomodacaoRepository: Send + Sync {
    async fn listar(&self, apenas_ativos: bool) -> Result<Vec<TipoAcomodacao>, DomainError>;
    async fn criar(&self, nome: &str, log: NovoLog) -> Result<TipoAcomodacao, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        nome: &str,
        version: Option<i64>,
        log: NovoLog,
    ) -> Result<TipoAcomodacao, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<TipoAcomodacao, DomainError>;
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

#[derive(Debug, Clone)]
pub struct NovaAcomodacao {
    pub idtipo_acomodacao: Option<i64>,
    pub nome: String,
    pub numero: i32,
    pub andar: i32,
    pub valor: Decimal,
    pub capacidade: i32,
    pub descricao: Option<String>,
    pub cor: String,
    pub criar_quarto: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaAcomodacao {
    pub idtipo_acomodacao: Option<i64>,
    pub nome: Option<String>,
    pub numero: Option<i32>,
    pub valor: Option<Decimal>,
    pub capacidade: Option<i32>,
    pub descricao: Option<String>,
    pub cor: Option<String>,
    pub version: Option<i64>,
    pub andar: Option<i32>,
}

#[async_trait]
pub trait AcomodacaoRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<Acomodacao>, DomainError>;
    async fn buscar_ativa_por_slug(&self, slug: &str) -> Result<Option<Acomodacao>, DomainError>;
    async fn primeira_ativa(&self) -> Result<Option<Acomodacao>, DomainError>;
    async fn listar(
        &self,
        apenas_ativas: bool,
        page: PageParams,
    ) -> Result<Page<Acomodacao>, DomainError>;
    async fn numero_em_uso(&self, numero: i32, exceto_id: i64) -> Result<bool, DomainError>;
    async fn criar(&self, nova: &NovaAcomodacao, log: NovoLog) -> Result<Acomodacao, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &AtualizaAcomodacao,
        log: NovoLog,
    ) -> Result<Acomodacao, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Acomodacao, DomainError>;
    async fn historico_tarifas(&self, id: i64) -> Result<Vec<TarifaHistorico>, DomainError>;
    async fn contar_por_tipo(&self) -> Result<Vec<(String, i64)>, DomainError>;
    async fn remover(&self, id: i64, log: NovoLog) -> Result<Vec<String>, DomainError>;

    async fn tarifas_ocupacao(&self, idtipo: i64) -> Result<Vec<TarifaOcupacao>, DomainError>;
    async fn salvar_tarifas_ocupacao(
        &self,
        idtipo: i64,
        faixas: &[(i32, Decimal)],
    ) -> Result<(), DomainError>;
    async fn diaria_para_ocupacao(
        &self,
        idtipo: i64,
        hospedes: i32,
    ) -> Result<Option<Decimal>, DomainError>;

    /// Diárias diferenciadas por data — a precificação noite a noite
    /// resolve tarifa_periodo > tarifa_ocupacao > acomodacao.valor.
    async fn tarifas_periodo(&self, idacomodacao: i64) -> Result<Vec<TarifaPeriodo>, DomainError>;
    async fn criar_tarifa_periodo(
        &self,
        nova: &NovaTarifaPeriodo,
        log: NovoLog,
    ) -> Result<TarifaPeriodo, DomainError>;
    async fn remover_tarifa_periodo(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

/// Período com diária própria — `inicio`/`fim` são as NOITES cobertas
/// (a noite de `fim` está incluída, daterange da estadia segue `[inicio, saida)`).
#[derive(Debug, Clone)]
pub struct NovaTarifaPeriodo {
    pub idacomodacao: i64,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub valor: Decimal,
    pub rotulo: Option<String>,
    pub prioridade: i16,
    pub idfuncionario: Option<i64>,
}

#[async_trait]
pub trait QuartoRepository: Send + Sync {
    async fn listar_por_acomodacao(&self, idacomodacao: i64) -> Result<Vec<Quarto>, DomainError>;
    async fn criar(
        &self,
        idacomodacao: i64,
        numero: &str,
        log: NovoLog,
    ) -> Result<Quarto, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Quarto, DomainError>;
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

#[async_trait]
pub trait EstacionamentoRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<VagaEstacionamento>, DomainError>;
    async fn criar(&self, numero: &str, log: NovoLog) -> Result<VagaEstacionamento, DomainError>;
    async fn vincular_acomodacao(
        &self,
        id: i64,
        idacomodacao: Option<i64>,
        log: NovoLog,
    ) -> Result<VagaEstacionamento, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<VagaEstacionamento, DomainError>;
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

#[derive(Debug, Clone)]
pub struct NovoFrigobar {
    pub idacomodacao: i64,
    pub modelo: Option<String>,
    pub patrimonio: Option<String>,
    pub version: Option<i64>,
}

#[async_trait]
pub trait FrigobarRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<Frigobar>, DomainError>;
    async fn listar(&self) -> Result<Vec<Frigobar>, DomainError>;
    async fn listar_por_acomodacao(&self, idacomodacao: i64) -> Result<Vec<Frigobar>, DomainError>;
    async fn criar(&self, novo: &NovoFrigobar, log: NovoLog) -> Result<Frigobar, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &NovoFrigobar,
        log: NovoLog,
    ) -> Result<Frigobar, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Frigobar, DomainError>;

    async fn listar_itens(&self, idfrigobar: i64) -> Result<Vec<ItemFrigobarView>, DomainError>;

    async fn repor_item(
        &self,
        idfrigobar: i64,
        iditem: i64,
        quantidade: i32,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<ItemFrigobar, DomainError>;
    async fn atualizar_item(
        &self,
        id: i64,
        quantidade: i32,
        version: Option<i64>,
        log: NovoLog,
    ) -> Result<ItemFrigobar, DomainError>;
    async fn definir_item_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<(), DomainError>;
    async fn remover_item(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
    /// Remove o frigobar e todos os seus itens numa transação.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Formas de pagamento
// ---------------------------------------------------------------------------

#[async_trait]
pub trait FormaPagamentoRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<FormaPagamento>, DomainError>;
    async fn listar(&self, apenas_ativas: bool) -> Result<Vec<FormaPagamento>, DomainError>;
    async fn criar(&self, nome: &str, log: NovoLog) -> Result<FormaPagamento, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        nome: &str,
        version: Option<i64>,
        log: NovoLog,
    ) -> Result<FormaPagamento, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<FormaPagamento, DomainError>;
    /// Remove em definitivo — falha (409) se já usada em consumos.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Estabelecimento
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct DadosEstabelecimento {
    pub cnpj: Option<String>,
    pub razao_social: Option<String>,
    pub site: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub celular: Option<String>,
    pub impressora_ip: Option<String>,
    pub impressora_porta: i32,
    pub impressora_ativa: bool,
    /// Taxas early check-in / late checkout (R$) — entram no total do sinal.
    pub taxa_early: Decimal,
    pub taxa_late: Decimal,
    /// Dados factuais do concierge Inná (Wi-Fi, horários, serviços).
    pub wifi_nome: Option<String>,
    pub wifi_senha: Option<String>,
    pub horario_checkin: Option<String>,
    pub horario_checkout: Option<String>,
    pub horario_cafe: Option<String>,
    pub info_servicos: Option<String>,
    /// MTur/Cadastur, política CDC escalonada, retenção LGPD e DPO.
    pub cadastur: Option<String>,
    pub politica_cancelamento: Option<serde_json::Value>,
    pub retencao_dados_anos: Option<i32>,
    pub dpo_email: Option<String>,
    /// Link de avaliação do Google — convite ao hóspede promotor.
    pub google_review_url: Option<String>,
    /// MTur: assinatura desenhada obrigatória na pré-ficha pública.
    pub fnrh_assinatura: bool,
    /// Fechamento: PIN gerencial de autorização de no-show.
    pub pin_fechamento: Option<String>,
    /// Concorrência otimista — divergência → 409.
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct DadosEndereco {
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cidade: Option<String>,
    pub cep: Option<String>,
    /// Concorrência otimista — divergência → 409.
    pub version: Option<i64>,
}

#[async_trait]
pub trait EstabelecimentoRepository: Send + Sync {
    async fn obter(&self) -> Result<Option<Estabelecimento>, DomainError>;
    async fn obter_endereco(&self) -> Result<Option<EnderecoEstabelecimento>, DomainError>;
    async fn salvar_dados(
        &self,
        dados: &DadosEstabelecimento,
        log: NovoLog,
    ) -> Result<Estabelecimento, DomainError>;
    async fn salvar_endereco(
        &self,
        dados: &DadosEndereco,
        log: NovoLog,
    ) -> Result<EnderecoEstabelecimento, DomainError>;
    async fn definir_logo(
        &self,
        nome: &str,
        caminho: &str,
        log: NovoLog,
    ) -> Result<(), DomainError>;
    async fn logo_atual(&self) -> Result<Option<(String, String)>, DomainError>;
}
