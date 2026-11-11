//! Composition root — montagem do grafo de dependências.
//!
//! Único ponto do sistema onde ports do domínio são casados com seus
//! adapters concretos. `clarituz-api serve` e os testes de integração
//! compartilham a mesma fiação.

pub mod compose;
