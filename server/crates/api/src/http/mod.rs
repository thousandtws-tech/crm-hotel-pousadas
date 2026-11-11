//! Camada de entrega HTTP (adapter primário) — axum.
//!
//! `routes` traduz `application::dto` + `application::Services` em
//! endpoints `/api/v1`; `middleware` e `extractors` cobrem as
//! preocupações transversais (rate limit, autenticação, headers de
//! segurança); `error` mapeia os erros tipados para o envelope JSON;
//! `state` é o contêiner compartilhado entre handlers.

pub mod error;
pub mod extractors;
pub mod middleware;
pub mod router;
pub mod routes;
pub mod state;
