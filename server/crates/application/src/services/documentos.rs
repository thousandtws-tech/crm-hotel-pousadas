//! Casos de uso dos documentos de identidade do hóspede — múltiplos
//! documentos por cliente, com scan digitalizado pela recepção.

use crate::actor::Ator;
use crate::dto::DocumentoInput;
use crate::error::AppResult;
use clarituz_domain::entities::ClienteDocumento;
use clarituz_domain::ports::{ClienteRepository, DocumentoRepository, NovoDocumento};
use clarituz_domain::DomainError;
use std::sync::Arc;

/// Tipos aceitos — espelha o CHECK da tabela `cliente_documento`.
const TIPOS_DOCUMENTO: &[&str] = &["rg", "cpf", "cnh", "passaporte", "rne", "outro"];

/// `Some(t)` → `None` quando vazio após trim.
fn opt_str(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub struct DocumentoService {
    repo: Arc<dyn DocumentoRepository>,
    clientes: Arc<dyn ClienteRepository>,
}

impl DocumentoService {
    pub fn new(repo: Arc<dyn DocumentoRepository>, clientes: Arc<dyn ClienteRepository>) -> Self {
        Self { repo, clientes }
    }

    pub async fn listar(&self, idcliente: i64) -> AppResult<Vec<ClienteDocumento>> {
        self.exigir_cliente(idcliente).await?;
        Ok(self.repo.listar(idcliente).await?)
    }

    pub async fn criar(
        &self,
        ator: &Ator,
        idcliente: i64,
        input: DocumentoInput,
    ) -> AppResult<ClienteDocumento> {
        self.exigir_cliente(idcliente).await?;
        let novo = Self::validar(input, idcliente)?;
        let log = ator.log(
            "cadastro",
            format!(
                "Anexou documento {} nº {} ao cliente Nº{idcliente}",
                novo.tipo, novo.numero
            ),
            "cliente_documento",
            0,
            Some(serde_json::json!({"idcliente": idcliente, "tipo": novo.tipo})),
        );
        Ok(self.repo.criar(&novo, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: DocumentoInput,
    ) -> AppResult<ClienteDocumento> {
        let atual = self.buscar(id).await?;
        let dados = Self::validar(input, atual.idcliente)?;
        let log = ator.log(
            "edição",
            format!("Editou o documento Nº{id} do cliente Nº{}", atual.idcliente),
            "cliente_documento",
            id,
            None,
        );
        Ok(self.repo.atualizar(id, &dados, log).await?)
    }

    /// Remove o documento e devolve o caminho do scan para a API apagar o arquivo.
    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<Option<String>> {
        let atual = self.buscar(id).await?;
        let log = ator.log(
            "exclusão",
            format!(
                "Removeu o documento {} nº {} do cliente Nº{}",
                atual.tipo, atual.numero, atual.idcliente
            ),
            "cliente_documento",
            id,
            None,
        );
        Ok(self.repo.remover(id, log).await?)
    }

    /// Registra o scan já gravado no storage pela camada de API.
    pub async fn definir_scan(&self, ator: &Ator, id: i64, caminho: &str) -> AppResult<()> {
        self.buscar(id).await?;
        let log = ator.log(
            "scan",
            format!("Digitalizou o documento Nº{id}"),
            "cliente_documento",
            id,
            None,
        );
        Ok(self.repo.definir_scan(id, Some(caminho), log).await?)
    }

    /// Remove o scan e devolve o caminho anterior para a API apagar o arquivo.
    pub async fn remover_scan(&self, ator: &Ator, id: i64) -> AppResult<String> {
        let anterior = self
            .repo
            .scan_caminho(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Documento não possui scan."))?;
        let log = ator.log(
            "scan",
            format!("Removeu o scan do documento Nº{id}"),
            "cliente_documento",
            id,
            None,
        );
        self.repo.definir_scan(id, None, log).await?;
        Ok(anterior)
    }

    /// Caminho do scan — `None` quando o documento não existe ou não tem scan.
    pub async fn scan_caminho(&self, id: i64) -> AppResult<Option<String>> {
        Ok(self.repo.scan_caminho(id).await?)
    }

    pub async fn buscar(&self, id: i64) -> AppResult<ClienteDocumento> {
        self.repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Documento não encontrado.").into())
    }

    async fn exigir_cliente(&self, idcliente: i64) -> AppResult<()> {
        self.clientes
            .buscar(idcliente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;
        Ok(())
    }

    fn validar(input: DocumentoInput, idcliente: i64) -> AppResult<NovoDocumento> {
        let tipo = input.tipo.trim().to_lowercase();
        if !TIPOS_DOCUMENTO.contains(&tipo.as_str()) {
            return Err(
                DomainError::validacao(format!("Tipo de documento inválido: '{tipo}'.")).into(),
            );
        }
        if input.numero.trim().is_empty() {
            return Err(DomainError::validacao("Número do documento é obrigatório.").into());
        }
        Ok(NovoDocumento {
            idcliente,
            tipo,
            numero: input.numero.trim().to_string(),
            orgao_emissor: opt_str(input.orgao_emissor),
            uf_emissor: input
                .uf_emissor
                .map(|u| u.trim().to_uppercase().chars().take(2).collect())
                .filter(|s: &String| !s.is_empty()),
            pais_emissor: opt_str(input.pais_emissor),
            validade: input.validade,
            version: input.version,
        })
    }
}
