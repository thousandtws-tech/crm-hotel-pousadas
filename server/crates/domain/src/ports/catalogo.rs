//! Ports do catálogo: acomodações, tipos, quartos, estacionamento, frigobar,
//! formas de pagamento e estabelecimento.

use crate::entities::{
    Acomodacao, EnderecoEstabelecimento, Estabelecimento, FormaPagamento, Frigobar, ItemFrigobar,
    NovoLog, Quarto, TarifaHistorico, TarifaOcupacao, TipoAcomodacao, VagaEstacionamento,
};
use crate::error::DomainError;
use crate::queries::ItemFrigobarView;
use async_trait::async_trait;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

// ---------------------------------------------------------------------------
// Tipos de acomodação
// ---------------------------------------------------------------------------

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
    /// Remove em definitivo — falha (409) se houver acomodações vinculadas.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Acomodações
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovaAcomodacao {
    pub idtipo_acomodacao: Option<i64>,
    pub nome: String,
    pub numero: i32,
    /// Pavimento — 0 = térreo.
    pub andar: i32,
    pub valor: Decimal,
    pub capacidade: i32,
    pub descricao: Option<String>,
    pub cor: String,
    /// Quantos quartos físicos criar automaticamente (legado cria 1: `Q{numero}`).
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
    /// Concorrência otimista — divergência → 409.
    pub version: Option<i64>,
    pub andar: Option<i32>,
}

#[async_trait]
pub trait AcomodacaoRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<Acomodacao>, DomainError>;
    /// Acomodação ativa publicada sob o slug do CMS — link direto do site.
    async fn buscar_ativa_por_slug(&self, slug: &str) -> Result<Option<Acomodacao>, DomainError>;
    /// Primeira acomodação ativa por número — fallback do site quando o
    /// visitante não escolheu quarto.
    async fn primeira_ativa(&self) -> Result<Option<Acomodacao>, DomainError>;
    async fn listar(
        &self,
        apenas_ativas: bool,
        page: PageParams,
    ) -> Result<Page<Acomodacao>, DomainError>;
    async fn numero_em_uso(&self, numero: i32, exceto_id: i64) -> Result<bool, DomainError>;
    /// Cria acomodação (+ quarto físico `Q{numero}` quando `criar_quarto`).
    async fn criar(&self, nova: &NovaAcomodacao, log: NovoLog) -> Result<Acomodacao, DomainError>;
    /// Atualiza e registra `tarifa_historico` quando o valor muda.
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
    /// Ocupação por tipo de acomodação (gráfico do legado `cDadosGrafico`).
    async fn contar_por_tipo(&self) -> Result<Vec<(String, i64)>, DomainError>;
    /// Remove a acomodação e seus dependentes (quartos, frigobar+itens,
    /// tarifas, conteúdo CMS) numa transação; desvincula vagas de
    /// estacionamento. Falha (409) se houver reservas. Devolve as chaves
    /// de mídia (fotos/vídeos) para a camada de API apagar no object store.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<Vec<String>, DomainError>;

    /// Faixas de preço por ocupação de um tipo (ordenadas por nº de hóspedes).
    async fn tarifas_ocupacao(&self, idtipo: i64) -> Result<Vec<TarifaOcupacao>, DomainError>;
    /// Substitui o conjunto de faixas do tipo — transação de delete+insert.
    async fn salvar_tarifas_ocupacao(
        &self,
        idtipo: i64,
        faixas: &[(i32, Decimal)],
    ) -> Result<(), DomainError>;
    /// Diária para N hóspedes no tipo: maior faixa <= N, senão a menor faixa.
    /// `None` quando o tipo não tem faixas (cai no valor da acomodação).
    async fn diaria_para_ocupacao(
        &self,
        idtipo: i64,
        hospedes: i32,
    ) -> Result<Option<Decimal>, DomainError>;
}

// ---------------------------------------------------------------------------
// Quartos físicos
// ---------------------------------------------------------------------------

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
    /// Remove o quarto físico — falha (409) se houver reservas vinculadas.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Estacionamento
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Frigobar
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoFrigobar {
    pub idacomodacao: i64,
    pub modelo: Option<String>,
    pub patrimonio: Option<String>,
    /// Concorrência otimista — usada só no update.
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
    /// Repõe item no frigobar **e** debita do estoque central na mesma
    /// transação (movimento tipo 'saida' com motivo 'frigobar').
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
