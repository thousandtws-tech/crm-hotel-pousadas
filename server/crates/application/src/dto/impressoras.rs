use serde::Deserialize;

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
