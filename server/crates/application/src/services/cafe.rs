//! Café da manhã — orquestra presença por reserva/dia.
//!
//! Regras aqui (fail-fast antes do repo): a reserva existe e não está
//! cancelada, a data cai dentro da estadia e a quantidade respeita o nº
//! de hóspedes. O repo faz o upsert atômico + auditoria.

use std::sync::Arc;

use chrono::{NaiveDate, Utc};
use clarituz_domain::entities::CafePresenca;
use clarituz_domain::ports::{CafeRepository, NovaPresenca};
use clarituz_domain::queries::{CafeQuadroItem, PresencaView};
use clarituz_domain::DomainError;
use clarituz_shared::Page;

use crate::actor::Ator;
use crate::dto::{HistoricoCafeQuery, RegistrarPresencaInput};
use crate::error::AppResult;

pub struct CafeService {
    repo: Arc<dyn CafeRepository>,
}

impl CafeService {
    pub fn new(repo: Arc<dyn CafeRepository>) -> Self {
        Self { repo }
    }

    /// Quadro do dia — reservas cuja estadia cobre `data` (hoje por padrão).
    pub async fn quadro(&self, data: Option<NaiveDate>) -> AppResult<Vec<CafeQuadroItem>> {
        let data = data.unwrap_or_else(|| Utc::now().date_naive());
        Ok(self.repo.quadro(data).await?)
    }

    /// Marca/ajusta presença — upsert por reserva+dia.
    pub async fn registrar_presenca(
        &self,
        ator: &Ator,
        input: RegistrarPresencaInput,
    ) -> AppResult<CafePresenca> {
        let r = self
            .repo
            .reserva(input.idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        if r.cancelada {
            return Err(DomainError::regra("A reserva está cancelada.").into());
        }
        let data = input.data.unwrap_or_else(|| Utc::now().date_naive());
        if data < r.entradaprevista || data > r.saidaprevista {
            return Err(DomainError::regra(format!(
                "Data {data} fora da estadia ({} a {}).",
                r.entradaprevista, r.saidaprevista
            ))
            .into());
        }
        if input.quantidade < 1 || input.quantidade > r.quantidade_hospedes {
            return Err(DomainError::validacao(format!(
                "Quantidade deve ser entre 1 e {} hóspedes.",
                r.quantidade_hospedes
            ))
            .into());
        }

        let nova = NovaPresenca {
            idreserva: input.idreserva,
            data,
            quantidade: input.quantidade,
        };
        let log = ator.log(
            "presenca",
            format!(
                "Café: {} pessoa(s) da reserva Nº{} em {data}",
                nova.quantidade, nova.idreserva
            ),
            "cafe_presenca",
            nova.idreserva,
            None,
        );
        Ok(self.repo.registrar_presenca(&nova, ator.id, log).await?)
    }

    /// Desmarca presença do dia.
    pub async fn remover_presenca(&self, ator: &Ator, id: i64) -> AppResult<()> {
        let log = ator.log(
            "remocao",
            format!("Removeu presença de café Nº{id}"),
            "cafe_presenca",
            id,
            None,
        );
        Ok(self.repo.remover_presenca(id, log).await?)
    }

    /// Extrato de consumo por período.
    pub async fn historico(&self, q: HistoricoCafeQuery) -> AppResult<Page<PresencaView>> {
        Ok(self.repo.historico(q.inicio, q.fim, q.page).await?)
    }
}

#[cfg(test)]
mod tests {
    //! Validações do `CafeService` — nada deve chegar ao repo em erro.
    use super::*;
    use async_trait::async_trait;
    use chrono::NaiveDate;
    use clarituz_domain::entities::NovoLog;
    use clarituz_domain::enums::NivelAcesso;
    use clarituz_domain::ports::{CafeRepository, ReservaDoCafe};

    struct Stub;

    #[async_trait]
    impl CafeRepository for Stub {
        async fn quadro(&self, _d: NaiveDate) -> Result<Vec<CafeQuadroItem>, DomainError> {
            unimplemented!()
        }
        async fn reserva(&self, id: i64) -> Result<Option<ReservaDoCafe>, DomainError> {
            Ok((id != 999).then(|| ReservaDoCafe {
                id,
                quantidade_hospedes: 3,
                entradaprevista: NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(),
                saidaprevista: NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
                cancelada: id == 7,
            }))
        }
        async fn registrar_presenca(
            &self,
            n: &NovaPresenca,
            _f: i64,
            _l: NovoLog,
        ) -> Result<CafePresenca, DomainError> {
            Ok(CafePresenca {
                id: 1,
                idreserva: n.idreserva,
                data: n.data,
                quantidade: n.quantidade,
                registrado_por: Some(1),
                criado_em: Utc::now(),
                atualizado_em: Utc::now(),
                version: 0,
            })
        }
        async fn remover_presenca(&self, _i: i64, _l: NovoLog) -> Result<(), DomainError> {
            unimplemented!()
        }
        async fn historico(
            &self,
            _i: Option<NaiveDate>,
            _f: Option<NaiveDate>,
            _p: clarituz_shared::PageParams,
        ) -> Result<Page<PresencaView>, DomainError> {
            unimplemented!()
        }
    }

    fn svc() -> CafeService {
        CafeService::new(Arc::new(Stub))
    }
    fn ator() -> Ator {
        Ator {
            id: 1,
            login: "t".into(),
            nome: "T".into(),
            nivel: NivelAcesso::Recepcao,
            financeiro: false,
        }
    }
    fn input(id: i64, data: &str, qtd: i32) -> RegistrarPresencaInput {
        RegistrarPresencaInput {
            idreserva: id,
            data: NaiveDate::parse_from_str(data, "%Y-%m-%d").ok(),
            quantidade: qtd,
        }
    }

    #[tokio::test]
    async fn rejeita_quantidade_acima_dos_hospedes() {
        let e = svc()
            .registrar_presenca(&ator(), input(1, "2026-01-12", 4))
            .await;
        assert!(e.is_err());
    }

    #[tokio::test]
    async fn rejeita_quantidade_zero() {
        let e = svc()
            .registrar_presenca(&ator(), input(1, "2026-01-12", 0))
            .await;
        assert!(e.is_err());
    }

    #[tokio::test]
    async fn rejeita_data_fora_da_estadia() {
        let e = svc()
            .registrar_presenca(&ator(), input(1, "2026-01-16", 2))
            .await;
        assert!(e.is_err());
        let e = svc()
            .registrar_presenca(&ator(), input(1, "2026-01-09", 2))
            .await;
        assert!(e.is_err());
    }

    #[tokio::test]
    async fn rejeita_reserva_cancelada_e_inexistente() {
        assert!(svc()
            .registrar_presenca(&ator(), input(7, "2026-01-12", 1))
            .await
            .is_err());
        assert!(svc()
            .registrar_presenca(&ator(), input(999, "2026-01-12", 1))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn aceita_presenca_parcial_no_checkout() {
        // dia do checkout + presença parcial (2 de 3) é válido
        let r = svc()
            .registrar_presenca(&ator(), input(1, "2026-01-15", 2))
            .await;
        assert!(r.is_ok());
        assert_eq!(r.unwrap().quantidade, 2);
    }
}
