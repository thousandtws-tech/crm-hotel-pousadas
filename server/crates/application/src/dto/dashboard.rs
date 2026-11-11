use serde::Serialize;

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
