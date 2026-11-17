use crate::http::state::AppState;

pub(crate) fn spawn(state: &AppState) {
    let gov = state.services.governanca.clone();
    let manut = state.services.manutencao.clone();
    let lgpd = state.services.lgpd.clone();
    let estab = state.services.estabelecimento.clone();
    let auth = state.services.auth.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(600));
        tick.tick().await;
        loop {
            tick.tick().await;
            let agora = chrono::Utc::now();
            if chrono::Timelike::hour(&agora) == 4 {
                let anos = estab
                    .obter()
                    .await
                    .ok()
                    .flatten()
                    .map_or(5, |e| e.retencao_dados_anos);
                if let Err(e) = lgpd.anonimizar_vencidos(anos).await {
                    tracing::warn!(erro = %e, "lgpd: retenção falhou");
                }
            }
            if chrono::Timelike::hour(&agora) == 5 {
                if let Err(e) = auth.purgar_registros_acesso().await {
                    tracing::warn!(erro = %e, "marco civil: purga de registros falhou");
                }
                if let Err(e) = lgpd.alertar_solicitacoes_vencidas().await {
                    tracing::warn!(erro = %e, "lgpd: alerta de SLA falhou");
                }
            }
            if chrono::Timelike::hour(&agora) == 22 {
                match gov.gerar_d1().await {
                    Ok(n) if n > 0 => {
                        tracing::info!(criadas = n, "governanca: tarefas D-1 geradas");
                    }
                    Err(e) => tracing::warn!(erro = %e, "governanca: geração D-1 falhou"),
                    _ => {}
                }
            }
            if chrono::Timelike::hour(&agora) == 8 {
                if let Err(e) = manut.alertar_pmoc_vencido().await {
                    tracing::warn!(erro = %e, "pmoc: alerta de vencimento falhou");
                }
            }
        }
    });
}
