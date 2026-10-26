//! Casos de uso do agregado Reserva — ciclo de vida completo:
//! criação, check-in, check-out, cancelamento, consumo e disponibilidade.
//!
//! O faturamento é **server-authoritative**: o cliente informa forma de
//! pagamento, desconto e adicionais; o servidor calcula `valor_final` a
//! partir dos dados persistidos — nunca confia em totais do cliente.

use crate::actor::Ator;
use crate::dto::{
    AcompanhanteInput, AdicionalInput, CancelamentoResponse, CancelarReservaRequest,
    CheckoutRequest, DisponibilidadeResponse, FnrhEmitRequest, ItemConsumidoRequest,
    ReservaInput,
};
use crate::error::AppResult;
use crate::services::AuthService;
use clarituz_domain::entities::{
    Acompanhante, AdicionalConsumo, Consumo, Fnrh, ItemConsumido, Reserva,
};
use clarituz_domain::enums::StatusReserva;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    AcomodacaoRepository, AcompanhanteRepository, ClienteRepository, ComandoCheckout,
    EstabelecimentoRepository, EventoPublisher, FiltroReserva, FnrhRepository,
    FormaPagamentoRepository, ImpressoraGateway, ImpressoraRepository, LinhaRecibo,
    NovaFnrh, NovaReserva, NovoAcompanhante, NovoAdicional, NovoItemConsumido,
    ReservaRepository,
};
use clarituz_domain::queries::{ComprovanteResumo, ReservaDetalhe, ReservaResumo};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{money, time, Page, PageParams};
use rust_decimal::Decimal;
use serde_json::json;
use std::sync::Arc;
use tracing::instrument;

/// Dependências do serviço de reservas — agrupadas para manter o
/// construtor enxuto conforme novos ports são adicionados.
pub struct ReservaDeps {
    pub reservas: Arc<dyn ReservaRepository>,
    pub acomodacoes: Arc<dyn AcomodacaoRepository>,
    pub clientes: Arc<dyn ClienteRepository>,
    pub pagamentos: Arc<dyn FormaPagamentoRepository>,
    pub estabelecimentos: Arc<dyn EstabelecimentoRepository>,
    pub impressoras: Arc<dyn ImpressoraRepository>,
    pub impressora: Arc<dyn ImpressoraGateway>,
    pub auth: Arc<AuthService>,
    /// Motor realtime — avisos semânticos (toast dos outros usuários).
    pub eventos: Arc<dyn EventoPublisher>,
    pub acompanhantes: Arc<dyn AcompanhanteRepository>,
    pub fnrh: Arc<dyn FnrhRepository>,
}

pub struct ReservaService {
    reservas: Arc<dyn ReservaRepository>,
    acomodacoes: Arc<dyn AcomodacaoRepository>,
    clientes: Arc<dyn ClienteRepository>,
    pagamentos: Arc<dyn FormaPagamentoRepository>,
    estabelecimentos: Arc<dyn EstabelecimentoRepository>,
    impressoras: Arc<dyn ImpressoraRepository>,
    impressora: Arc<dyn ImpressoraGateway>,
    auth: Arc<AuthService>,
    eventos: Arc<dyn EventoPublisher>,
    acompanhantes: Arc<dyn AcompanhanteRepository>,
    fnrh: Arc<dyn FnrhRepository>,
}

impl ReservaService {
    pub fn new(d: ReservaDeps) -> Self {
        Self {
            eventos: d.eventos,
            reservas: d.reservas,
            acomodacoes: d.acomodacoes,
            clientes: d.clientes,
            pagamentos: d.pagamentos,
            estabelecimentos: d.estabelecimentos,
            impressoras: d.impressoras,
            impressora: d.impressora,
            auth: d.auth,
            acompanhantes: d.acompanhantes,
            fnrh: d.fnrh,
        }
    }

    pub async fn buscar(&self, id: i64) -> AppResult<Reserva> {
        self.reservas
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada.").into())
    }

    pub async fn detalhe(&self, id: i64) -> AppResult<ReservaDetalhe> {
        self.reservas
            .buscar_detalhe(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada.").into())
    }

    /// Comprovantes de reservas finalizadas (página Pagamentos do legado).
    pub async fn comprovantes(&self) -> AppResult<Vec<ComprovanteResumo>> {
        self.reservas.comprovantes().await.map_err(Into::into)
    }

    /// Recibo em texto puro gerado a partir dos dados persistidos —
    /// substitui o PDF estático do legado (sempre consistente com a conta).
    /// Retorna `(nome_do_arquivo, conteúdo)`.
    pub async fn comprovante_texto(&self, id: i64) -> AppResult<(String, String)> {
        let det = self.detalhe(id).await?;
        let consumo = det
            .consumo
            .ok_or_else(|| DomainError::regra("Reserva sem conta de consumo."))?;
        let arquivo = consumo
            .comprovante
            .clone()
            .unwrap_or_else(|| format!("comprovante_{id}.txt"));

        let itens = self
            .reservas
            .listar_itens_consumidos(consumo.id)
            .await
            .unwrap_or_default();
        let adicionais = self
            .reservas
            .listar_adicionais(consumo.id)
            .await
            .unwrap_or_default();

        let mut s = String::new();
        let linha = |s: &mut String| s.push_str("----------------------------------------\n");
        linha(&mut s);
        s.push_str("          COMPROVANTE DE PAGAMENTO\n");
        linha(&mut s);
        s.push_str(&format!("Reserva Nº: {}\n", det.id));
        s.push_str(&format!("Cliente:    {}\n", det.cliente_nome));
        s.push_str(&format!(
            "Acomodação: {} (Nº {})\n",
            det.acomodacao_nome, det.acomodacao_numero
        ));
        s.push_str(&format!(
            "Período:    {} a {}\n",
            det.entradaprevista.format("%d/%m/%Y"),
            det.saidaprevista.format("%d/%m/%Y")
        ));
        linha(&mut s);
        s.push_str(&format!(
            "Estadia ({} diária(s) x R$ {}): R$ {}\n",
            time::diarias(det.entradaprevista, det.saidaprevista),
            det.valordiaria,
            consumo.valor_estadia
        ));
        for i in &itens {
            s.push_str(&format!(
                "  {} x{} ............ R$ {}\n",
                i.nome, i.quantidade, i.valor_total
            ));
        }
        if !itens.is_empty() {
            let total_itens = money::sum(itens.iter().map(|i| &i.valor_total));
            s.push_str(&format!("Itens: R$ {total_itens}\n"));
        }
        for a in &adicionais {
            s.push_str(&format!("  {} ............. R$ {}\n", a.motivo, a.valor));
        }
        if consumo.total_desconto > Decimal::ZERO {
            s.push_str(&format!("Desconto: -R$ {}\n", consumo.total_desconto));
        }
        linha(&mut s);
        s.push_str(&format!(
            "TOTAL PAGO: R$ {}\n",
            consumo.valor_final.unwrap_or_default()
        ));
        if let Some(fp) = &consumo.forma_pagamento {
            s.push_str(&format!("Forma de pagamento: {fp}\n"));
        }
        if let Some(f) = consumo.fechado_em {
            s.push_str(&format!("Fechado em: {}\n", f.format("%d/%m/%Y %H:%M")));
        }
        linha(&mut s);
        Ok((arquivo, s))
    }

    /// Imprime o comprovante na térmica ESC/POS.
    /// Resolução da impressora: `impressora_id` explícita → impressora
    /// `padrao` cadastrada → fallback nos campos legados do estabelecimento.
    pub async fn imprimir_comprovante(&self, id: i64, impressora_id: Option<i64>) -> AppResult<()> {
        let det = self.detalhe(id).await?;
        let consumo = det
            .consumo
            .ok_or_else(|| DomainError::regra("Reserva sem conta de consumo."))?;

        let est = self
            .estabelecimentos
            .obter()
            .await?
            .ok_or_else(|| DomainError::regra("Cadastre os dados do estabelecimento."))?;

        let (host, porta) = self.resolve_impressora(impressora_id, &est).await?;

        let itens = self
            .reservas
            .listar_itens_consumidos(consumo.id)
            .await
            .unwrap_or_default();
        let adicionais = self
            .reservas
            .listar_adicionais(consumo.id)
            .await
            .unwrap_or_default();

        let mut l = vec![
            LinhaRecibo::Titulo(est.razao_social.unwrap_or_else(|| "COMPROVANTE".into())),
            LinhaRecibo::Centro("COMPROVANTE DE PAGAMENTO".into()),
            LinhaRecibo::Separador,
            LinhaRecibo::Par {
                texto: "Reserva".into(),
                valor: format!("Nº {}", det.id),
            },
            LinhaRecibo::Texto(format!("Cliente: {}", det.cliente_nome)),
            LinhaRecibo::Texto(format!(
                "Acomod.: {} Nº {}",
                det.acomodacao_nome, det.acomodacao_numero
            )),
            LinhaRecibo::Texto(format!(
                "Período: {} a {}",
                det.entradaprevista.format("%d/%m/%y"),
                det.saidaprevista.format("%d/%m/%y")
            )),
            LinhaRecibo::Separador,
            LinhaRecibo::Par {
                texto: format!(
                    "Estadia ({}d x R$ {})",
                    time::diarias(det.entradaprevista, det.saidaprevista),
                    det.valordiaria
                ),
                valor: format!("R$ {}", consumo.valor_estadia),
            },
        ];
        for i in &itens {
            l.push(LinhaRecibo::Par {
                texto: format!("{} x{}", i.nome, i.quantidade),
                valor: format!("R$ {}", i.valor_total),
            });
        }
        for a in &adicionais {
            l.push(LinhaRecibo::Par {
                texto: a.motivo.clone(),
                valor: format!("R$ {}", a.valor),
            });
        }
        if consumo.total_desconto > Decimal::ZERO {
            l.push(LinhaRecibo::Par {
                texto: "Desconto".into(),
                valor: format!("-R$ {}", consumo.total_desconto),
            });
        }
        l.push(LinhaRecibo::Separador);
        l.push(LinhaRecibo::Titulo(format!(
            "TOTAL R$ {}",
            consumo.valor_final.unwrap_or_default()
        )));
        if let Some(fp) = &consumo.forma_pagamento {
            l.push(LinhaRecibo::Centro(format!("Pagamento: {fp}")));
        }
        if let Some(f) = consumo.fechado_em {
            l.push(LinhaRecibo::Centro(format!(
                "{}",
                f.format("%d/%m/%Y %H:%M")
            )));
        }
        l.push(LinhaRecibo::Separador);
        l.push(LinhaRecibo::Centro("Obrigado pela preferência!".into()));
        l.push(LinhaRecibo::Avanco(2));

        self.impressora.imprimir(&host, porta, &l).await?;
        Ok(())
    }

    /// Resolve o destino do comprovante: impressora explícita → padrão
    /// cadastrada → campos legados `impressora_*` do estabelecimento.
    async fn resolve_impressora(
        &self,
        impressora_id: Option<i64>,
        est: &clarituz_domain::entities::Estabelecimento,
    ) -> AppResult<(String, u16)> {
        if let Some(imp) = match impressora_id {
            Some(id) => self.impressoras.por_id(id).await?,
            None => self.impressoras.padrao().await?,
        } {
            if !imp.ativa {
                return Err(
                    DomainError::regra(format!("Impressora '{}' está inativa.", imp.nome)).into(),
                );
            }
            return Ok((imp.ip.trim().to_string(), imp.porta as u16));
        }
        if impressora_id.is_some() {
            return Err(DomainError::nao_encontrado("Impressora não encontrada.").into());
        }
        // fallback legado — campos impressora_* do estabelecimento
        if !est.impressora_ativa {
            return Err(DomainError::regra(
                "Nenhuma impressora padrão cadastrada. Configure em Pousada/Hotel.",
            )
            .into());
        }
        let ip = est
            .impressora_ip
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| DomainError::regra("IP da impressora não configurado."))?;
        Ok((ip.trim().to_string(), est.impressora_porta as u16))
    }

    /// Reimprime os tickets de produção (KOT) do consumo da reserva —
    /// agrupa os itens pela impressora do setor (categoria) e envia um
    /// ticket por impressora. Retorna quantos tickets foram enviados.
    pub async fn imprimir_producao(&self, idreserva: i64) -> AppResult<i32> {
        let det = self.detalhe(idreserva).await?;
        let consumo_id = det
            .consumo
            .as_ref()
            .ok_or_else(|| DomainError::regra("Reserva sem conta de consumo."))?
            .id;
        let itens = self.impressoras.itens_producao(consumo_id).await?;
        self.despachar_producao(&det, &itens).await
    }

    /// Agrupa itens por impressora e envia um ticket por setor.
    async fn despachar_producao(
        &self,
        det: &ReservaDetalhe,
        itens: &[clarituz_domain::ports::ItemProducao],
    ) -> AppResult<i32> {
        use std::collections::BTreeMap;
        // agrupa por impressora (itens sem destino não geram ticket)
        struct Destino {
            nome: String,
            ip: String,
            porta: u16,
            itens: Vec<(String, i32)>,
        }
        let mut grupos: BTreeMap<i64, Destino> = BTreeMap::new();
        for it in itens {
            if let Some(imp) = &it.impressora {
                let g = grupos.entry(imp.id).or_insert_with(|| Destino {
                    nome: imp.nome.clone(),
                    ip: imp.ip.trim().to_string(),
                    porta: imp.porta as u16,
                    itens: Vec::new(),
                });
                g.itens.push((it.nome.clone(), it.quantidade));
            }
        }
        if grupos.is_empty() {
            return Err(DomainError::regra(
                "Nenhum item desta conta tem setor de impressão configurado.",
            )
            .into());
        }
        let mut enviados = 0;
        let mut falhas = Vec::new();
        for (_id, d) in grupos {
            let Destino {
                nome,
                ip,
                porta,
                itens,
            } = d;
            let mut l = vec![
                LinhaRecibo::Titulo(format!("PEDIDO — {}", nome.to_uppercase())),
                LinhaRecibo::Separador,
                LinhaRecibo::Par {
                    texto: "Reserva".into(),
                    valor: format!("Nº {}", det.id),
                },
                LinhaRecibo::Texto(format!("Cliente: {}", det.cliente_nome)),
                LinhaRecibo::Texto(format!(
                    "Acomod.: {} Nº {}",
                    det.acomodacao_nome, det.acomodacao_numero
                )),
                LinhaRecibo::Separador,
            ];
            for (nome_item, qtd) in &itens {
                l.push(LinhaRecibo::Par {
                    texto: nome_item.clone(),
                    valor: format!("x{qtd}"),
                });
            }
            l.push(LinhaRecibo::Separador);
            l.push(LinhaRecibo::Centro(
                chrono::Utc::now().format("%d/%m/%Y %H:%M").to_string(),
            ));
            l.push(LinhaRecibo::Avanco(2));
            match self.impressora.imprimir(&ip, porta, &l).await {
                Ok(()) => enviados += 1,
                Err(e) => {
                    tracing::warn!(impressora = %nome, erro = %e, "falha no ticket de produção");
                    falhas.push(nome);
                }
            }
        }
        if enviados == 0 {
            return Err(
                DomainError::regra(format!("Falha ao imprimir em: {}", falhas.join(", "))).into(),
            );
        }
        Ok(enviados)
    }

    pub async fn listar(
        &self,
        filtro: FiltroReserva,
        page: PageParams,
    ) -> AppResult<Page<ReservaResumo>> {
        self.reservas
            .listar(&filtro, page)
            .await
            .map_err(Into::into)
    }

    pub async fn eventos(&self, periodo: Option<PeriodoEstadia>) -> AppResult<Vec<ReservaResumo>> {
        self.reservas
            .listar_eventos(periodo)
            .await
            .map_err(Into::into)
    }

    pub async fn contar_por_acomodacao(
        &self,
        periodo: Option<PeriodoEstadia>,
    ) -> AppResult<Vec<(String, i64)>> {
        self.reservas
            .contar_por_acomodacao(periodo)
            .await
            .map_err(Into::into)
    }

    /// Consulta de disponibilidade (legado: `api/disponibilidade.php`).
    pub async fn disponibilidade(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
        idacomodacao: Option<i64>,
        excluir_reserva: Option<i64>,
    ) -> AppResult<DisponibilidadeResponse> {
        let periodo = PeriodoEstadia::new(inicio, fim)?;
        let acomodacoes = self
            .reservas
            .disponibilidade(periodo, idacomodacao, excluir_reserva)
            .await?;

        Ok(DisponibilidadeResponse {
            disponivel: !acomodacoes.is_empty(),
            quantidade: acomodacoes.len(),
            diarias: time::diarias(inicio, fim),
            inicio,
            fim,
            acomodacoes,
        })
    }

    /// Cria reserva em status `pendente` com conta de consumo aberta.
    ///
    /// Concorrência: a exclusão `daterange` no Postgres garante que duas
    /// requisições simultâneas jamais produzam overbooking — o segundo
    /// INSERT falha com 23P01 → `Conflito` (o legado usava `GET_LOCK`).
    #[instrument(skip(self, ator, input), fields(ator = %ator.login))]
    pub async fn criar(&self, ator: &Ator, input: ReservaInput) -> AppResult<Reserva> {
        let periodo = PeriodoEstadia::new(input.entradaprevista, input.saidaprevista)?;

        if input.idacomodacao <= 0 || input.idcliente <= 0 {
            return Err(DomainError::validacao("Acomodação e cliente são obrigatórios.").into());
        }
        if input.quantidade_hospedes <= 0 {
            return Err(DomainError::validacao("Informe a quantidade de hóspedes.").into());
        }

        let acomodacao = self
            .acomodacoes
            .buscar(input.idacomodacao)
            .await?
            .filter(|a| a.ativo)
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada."))?;

        self.clientes
            .buscar(input.idcliente)
            .await?
            .filter(|c| c.ativo)
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;

        if input.quantidade_hospedes > acomodacao.capacidade {
            return Err(DomainError::regra(format!(
                "Acomodação comporta {} hóspede(s); informado {}.",
                acomodacao.capacidade, input.quantidade_hospedes
            ))
            .into());
        }

        // Diária: a informada ou a tarifa vigente da acomodação.
        let valordiaria = input
            .valordiaria
            .filter(|v| *v > Decimal::ZERO)
            .unwrap_or(acomodacao.valor);
        let diarias = Decimal::from(time::diarias(periodo.entrada, periodo.saida));
        let valor_total = money::round2(valordiaria * diarias);

        let nova = NovaReserva {
            idacomodacao: input.idacomodacao,
            idcliente: input.idcliente,
            quantidade_hospedes: input.quantidade_hospedes,
            periodo,
            obs: input
                .obs
                .map(|o| o.trim().to_string())
                .filter(|o| !o.is_empty()),
            valordiaria: money::round2(valordiaria),
            valor_total,
        };

        let log = ator.log(
            "cadastro",
            format!(
                "Reservou a acomodação Nº{} de {} até {}",
                nova.idacomodacao, nova.periodo.entrada, nova.periodo.saida
            ),
            "reserva",
            0,
            Some(serde_json::json!({
                "idacomodacao": nova.idacomodacao,
                "idcliente": nova.idcliente,
                "entrada": nova.periodo.entrada,
                "saida": nova.periodo.saida,
            })),
        );

        let reserva = self.reservas.criar(&nova, log).await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Info,
                "Nova reserva",
                format!(
                    "{} reservou a acomodação Nº{} ({} → {}).",
                    ator.nome, nova.idacomodacao, nova.periodo.entrada, nova.periodo.saida
                ),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": reserva.id})),
        );
        Ok(reserva)
    }

    #[instrument(skip(self, ator))]
    pub async fn checkin(
        &self,
        ator: &Ator,
        id: i64,
        em: chrono::DateTime<chrono::Utc>,
    ) -> AppResult<Reserva> {
        let log = ator.log(
            "checkin",
            format!("Realizou o check-in na reserva Nº{id}"),
            "reserva",
            id,
            Some(serde_json::json!({"idreserva": id, "acao": "check-in"})),
        );
        let reserva = self.reservas.checkin(id, em, log).await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Sucesso,
                "Check-in realizado",
                format!("Reserva Nº{id} em estadia — por {}.", ator.nome),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": id})),
        );
        Ok(reserva)
    }

    /// Fecha a conta: adicionais + desconto + forma de pagamento.
    /// `valor_final` é calculado aqui — o banco só persiste.
    #[instrument(skip(self, ator, req))]
    pub async fn checkout(
        &self,
        ator: &Ator,
        id: i64,
        req: CheckoutRequest,
    ) -> AppResult<(Reserva, Consumo)> {
        let reserva = self.buscar(id).await?;
        if !reserva.status.permite_checkout() {
            return match reserva.status {
                StatusReserva::Cancelada => Err(DomainError::conflito(
                    "Reserva cancelada. Não é possível fazer check-out.",
                )
                .into()),
                StatusReserva::Finalizada => {
                    Err(DomainError::conflito("Check-out já realizado.").into())
                }
                _ => Err(DomainError::regra(
                    "É necessário realizar o check-in antes do check-out.",
                )
                .into()),
            };
        }

        let consumo = self
            .reservas
            .consumo_da_reserva(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;
        if !consumo.status.aberto() {
            return Err(
                DomainError::conflito("Consumo da reserva já foi concluído ou cancelado.").into(),
            );
        }

        let pagamento = self
            .pagamentos
            .buscar(req.idforma_pagamento)
            .await?
            .filter(|p| p.ativo)
            .ok_or_else(|| DomainError::validacao("Forma de pagamento inválida."))?;

        let desconto = req.total_desconto.unwrap_or(Decimal::ZERO);
        if desconto < Decimal::ZERO {
            return Err(DomainError::validacao("Desconto não pode ser negativo.").into());
        }

        // adicionais válidos (motivo + valor positivo)
        let adicionais: Vec<NovoAdicional> = req
            .adicionais
            .into_iter()
            .filter_map(|a| {
                let motivo = a.motivo.trim().to_string();
                if motivo.is_empty() || a.valor <= Decimal::ZERO {
                    None
                } else {
                    Some(NovoAdicional {
                        motivo,
                        valor: money::round2(a.valor),
                    })
                }
            })
            .collect();
        let total_adicionais = money::sum(adicionais.iter().map(|a| &a.valor));

        let valor_final = money::round2(
            consumo.valor_estadia
                + consumo.valor_itens
                + consumo.valor_adicional
                + total_adicionais
                - desconto,
        );
        if valor_final < Decimal::ZERO {
            return Err(DomainError::validacao("Desconto maior que o total da conta.").into());
        }

        let comprovante = format!(
            "comprovante_{}_{:08x}.txt",
            id,
            uuid::Uuid::new_v4().as_u128() as u64
        );

        let cmd = ComandoCheckout {
            idreserva: id,
            idforma_pagamento: pagamento.id,
            valor_estadia: consumo.valor_estadia,
            total_desconto: money::round2(desconto),
            valor_final,
            adicionais,
            comprovante: Some(comprovante),
        };

        let log = ator.log(
            "checkout",
            format!("Realizou o check-out da reserva Nº{id} no valor de R$ {valor_final}"),
            "reserva",
            id,
            Some(serde_json::json!({
                "idreserva": id,
                "acao": "check-out",
                "valor_final": valor_final,
            })),
        );

        let out = self.reservas.checkout(&cmd, time::agora(), log).await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Sucesso,
                "Check-out realizado",
                format!(
                    "Reserva Nº{id} finalizada — R$ {valor_final} — por {}.",
                    ator.nome
                ),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": id, "valor_final": valor_final})),
        );
        Ok(out)
    }

    /// Cancelamento com compensação financeira.
    ///
    /// Reserva `iniciada` exige nível administrativo — direto ou via
    /// credenciais de admin no corpo (paridade com `aCancelarReservaAdm.php`).
    #[instrument(skip(self, ator, req))]
    pub async fn cancelar(
        &self,
        ator: &Ator,
        id: i64,
        req: CancelarReservaRequest,
    ) -> AppResult<CancelamentoResponse> {
        let reserva = self.buscar(id).await?;

        if reserva.status == StatusReserva::Iniciada && !ator.is_admin() {
            let (login, senha) = match (&req.login_admin, &req.senha_admin) {
                (Some(l), Some(s)) => (l.as_str(), s.as_str()),
                _ => {
                    return Err(DomainError::proibido(
                        "Cancelar reserva em estadia exige credenciais de administrador.",
                    )
                    .into())
                }
            };
            if !self.auth.autenticar_admin(login, senha).await? {
                return Err(
                    DomainError::proibido("Credenciais de administrador inválidas.").into(),
                );
            }
        }

        let motivo = req
            .motivo
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty());
        let log = ator.log(
            "cancelar",
            format!(
                "Cancelou a reserva Nº{id}{}",
                motivo
                    .map(|m| format!(" (motivo: {m})"))
                    .unwrap_or_default()
            ),
            "reserva",
            id,
            Some(serde_json::json!({"idreserva": id, "motivo": motivo})),
        );

        let out = self
            .reservas
            .cancelar(id, motivo, Some(ator.id), log)
            .await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Alerta,
                "Reserva cancelada",
                format!("Reserva Nº{id} cancelada por {}.", ator.nome),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"idreserva": id})),
        );
        Ok(CancelamentoResponse {
            reserva: out.reserva,
            reembolso: out.reembolso,
        })
    }

    /// Venda de item do frigobar para a conta da reserva.
    /// Preço calculado no servidor: `quantidade × valor_unitario` do estoque.
    pub async fn registrar_item_consumido(
        &self,
        ator: &Ator,
        idreserva: i64,
        req: ItemConsumidoRequest,
    ) -> AppResult<ItemConsumido> {
        let reserva = self.buscar(idreserva).await?;
        if reserva.status != StatusReserva::Iniciada {
            return Err(DomainError::regra(
                "Consumo só pode ser lançado com a reserva em estadia (check-in realizado).",
            )
            .into());
        }
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .filter(|c| c.status.aberto())
            .ok_or_else(|| DomainError::conflito("Conta de consumo não está aberta."))?;

        if req.quantidade <= 0 || req.iditem_frigobar <= 0 {
            return Err(DomainError::validacao("Item e quantidade são obrigatórios.").into());
        }

        let novo = NovoItemConsumido {
            idconsumo: consumo.id,
            iditem_frigobar: req.iditem_frigobar,
            quantidade: req.quantidade,
            // recalculado na infra com o preço real do item
            valor_total: Decimal::ZERO,
        };

        let log = ator.log(
            "consumo",
            format!(
                "Lançou {} item(ns) do frigobar no consumo Nº{}",
                req.quantidade, consumo.id
            ),
            "itensconsumidos",
            0,
            Some(serde_json::json!({"idconsumo": consumo.id, "quantidade": req.quantidade})),
        );

        let item = self
            .reservas
            .registrar_item_consumido(&novo, ator.id, log)
            .await?;

        // ticket de produção (KOT) — best-effort: falha de impressão não
        // derruba o lançamento; o ticket pode ser reimpresso depois.
        if let Ok(Some(imp)) = self.impressoras.por_item_estoque(item.iditem).await {
            let l = vec![
                LinhaRecibo::Titulo(format!("PEDIDO — {}", imp.nome.to_uppercase())),
                LinhaRecibo::Separador,
                LinhaRecibo::Par {
                    texto: "Reserva".into(),
                    valor: format!("Nº {idreserva}"),
                },
                LinhaRecibo::Separador,
                LinhaRecibo::Par {
                    texto: item.nome.clone(),
                    valor: format!("x{}", item.quantidade),
                },
                LinhaRecibo::Separador,
                LinhaRecibo::Avanco(2),
            ];
            if let Err(e) = self
                .impressora
                .imprimir(imp.ip.trim(), imp.porta as u16, &l)
                .await
            {
                tracing::warn!(impressora = %imp.nome, erro = %e, "auto-KOT falhou");
            }
        }
        Ok(item)
    }

    pub async fn itens_consumidos(&self, idreserva: i64) -> AppResult<Vec<ItemConsumido>> {
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;
        self.reservas
            .listar_itens_consumidos(consumo.id)
            .await
            .map_err(Into::into)
    }

    pub async fn adicionais(&self, idreserva: i64) -> AppResult<Vec<AdicionalConsumo>> {
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;
        self.reservas
            .listar_adicionais(consumo.id)
            .await
            .map_err(Into::into)
    }

    /// Lançamento avulso na conta durante a estadia (consumo adicional
    /// do legado) — exige reserva em estadia com conta aberta.
    pub async fn lancar_adicional(
        &self,
        ator: &Ator,
        idreserva: i64,
        req: AdicionalInput,
    ) -> AppResult<AdicionalConsumo> {
        let reserva = self.buscar(idreserva).await?;
        if reserva.status != StatusReserva::Iniciada {
            return Err(DomainError::regra(
                "Adicional só pode ser lançado com a reserva em estadia.",
            )
            .into());
        }
        if req.motivo.trim().is_empty() || req.valor <= Decimal::ZERO {
            return Err(DomainError::validacao("Descrição e valor são obrigatórios.").into());
        }
        let consumo = self
            .reservas
            .consumo_da_reserva(idreserva)
            .await?
            .filter(|c| c.status.aberto())
            .ok_or_else(|| DomainError::conflito("Conta de consumo não está aberta."))?;

        let novo = NovoAdicional {
            motivo: req.motivo.trim().to_string(),
            valor: req.valor,
        };
        let log = ator.log(
            "consumo",
            format!(
                "Lançou adicional de R$ {} no consumo Nº{}",
                novo.valor, consumo.id
            ),
            "adicionalconsumo",
            0,
            Some(serde_json::json!({"idconsumo": consumo.id})),
        );
        Ok(self
            .reservas
            .lancar_adicional(consumo.id, &novo, log)
            .await?)
    }

    // -----------------------------------------------------------------------
    // acompanhantes (demais ocupantes da reserva)
    // -----------------------------------------------------------------------

    pub async fn listar_acompanhantes(&self, idreserva: i64) -> AppResult<Vec<Acompanhante>> {
        self.buscar(idreserva).await?;
        Ok(self.acompanhantes.listar(idreserva).await?)
    }

    /// Registra acompanhante — permitido enquanto a reserva ocupa
    /// a acomodação (pendente ou em estadia).
    pub async fn adicionar_acompanhante(
        &self,
        ator: &Ator,
        idreserva: i64,
        input: AcompanhanteInput,
    ) -> AppResult<Acompanhante> {
        let reserva = self.buscar(idreserva).await?;
        if !reserva.status.ocupa() {
            return Err(DomainError::regra(
                "Acompanhantes só podem ser incluídos em reservas ativas.",
            )
            .into());
        }
        if input.nome.trim().is_empty() {
            return Err(DomainError::validacao("Nome do acompanhante é obrigatório.").into());
        }

        let novo = NovoAcompanhante {
            nome: input.nome.trim().to_string(),
            data_nascimento: input.data_nascimento,
            parentesco: opt_str(input.parentesco),
            doc_tipo: opt_str(input.doc_tipo).map(|t| t.to_lowercase()),
            doc_numero: opt_str(input.doc_numero),
        };
        let log = ator.log(
            "acompanhante",
            format!(
                "Incluiu o acompanhante {} na reserva Nº{idreserva}",
                novo.nome
            ),
            "reserva_acompanhante",
            idreserva,
            None,
        );
        Ok(self.acompanhantes.criar(idreserva, &novo, log).await?)
    }

    pub async fn remover_acompanhante(&self, ator: &Ator, id: i64) -> AppResult<()> {
        let log = ator.log(
            "acompanhante",
            format!("Removeu o acompanhante Nº{id}"),
            "reserva_acompanhante",
            id,
            None,
        );
        Ok(self.acompanhantes.remover(id, log).await?)
    }

    // -----------------------------------------------------------------------
    // FNRH — ficha de registro de hóspedes (arquivo digital imutável)
    // -----------------------------------------------------------------------

    /// Fichas emitidas para a reserva, mais recente primeiro.
    pub async fn listar_fnrh(&self, idreserva: i64) -> AppResult<Vec<Fnrh>> {
        self.buscar(idreserva).await?;
        Ok(self.fnrh.listar_por_reserva(idreserva).await?)
    }

    /// Arquivo digital do hóspede — fichas de todas as estadias.
    pub async fn listar_fnrh_cliente(&self, idcliente: i64) -> AppResult<Vec<Fnrh>> {
        self.clientes
            .buscar(idcliente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;
        Ok(self.fnrh.listar_por_cliente(idcliente).await?)
    }

    /// Emite a FNRH: monta o snapshot completo (cliente + reserva +
    /// acompanhantes + emissor) e o persiste de forma imutável.
    pub async fn emitir_fnrh(
        &self,
        ator: &Ator,
        idreserva: i64,
        input: FnrhEmitRequest,
    ) -> AppResult<Fnrh> {
        let reserva = self
            .reservas
            .buscar_detalhe(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        if reserva.status == StatusReserva::Cancelada {
            return Err(DomainError::regra(
                "Não é possível emitir FNRH de reserva cancelada.",
            )
            .into());
        }
        let cliente = self
            .clientes
            .buscar(reserva.idcliente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;
        let acompanhantes = self.acompanhantes.listar(idreserva).await?;

        let motivo_viagem = input
            .motivo_viagem
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty());
        let placa_veiculo = input
            .placa_veiculo
            .map(|p| p.trim().to_uppercase())
            .filter(|p| !p.is_empty());

        let dados = json!({
            "hospede": {
                "nome": cliente.nome,
                "cpf": cliente.cpf,
                "data_nascimento": cliente.data_nascimento,
                "nacionalidade": cliente.nacionalidade,
                "naturalidade": cliente.naturalidade,
                "profissao": cliente.profissao,
                "email": cliente.email,
                "telefone": cliente.telefone,
                "logradouro": cliente.logradouro,
                "numero": cliente.numero,
                "complemento": cliente.complemento,
                "bairro": cliente.bairro,
                "cidade": cliente.cidade,
                "estado": cliente.estado,
                "cep": cliente.cep,
                "pais": cliente.pais,
                "tem_foto": cliente.tem_foto,
            },
            "reserva": {
                "id": reserva.id,
                "acomodacao": reserva.acomodacao_nome,
                "acomodacao_numero": reserva.acomodacao_numero,
                "quarto": reserva.quarto_numero,
                "entradaprevista": reserva.entradaprevista,
                "saidaprevista": reserva.saidaprevista,
                "checkin_em": reserva.checkin_em,
                "quantidade_hospedes": reserva.quantidade_hospedes,
            },
            "acompanhantes": acompanhantes,
            "emitida_por": ator.nome,
        });

        let nova = NovaFnrh {
            idreserva,
            idcliente: reserva.idcliente,
            motivo_viagem: motivo_viagem.clone(),
            placa_veiculo,
            dados,
            emitida_por: Some(ator.id),
        };
        let log = ator.log(
            "fnrh",
            format!("Emitiu a FNRH da reserva Nº{idreserva}"),
            "fnrh",
            0,
            Some(json!({"idreserva": idreserva})),
        );
        Ok(self.fnrh.emitir(&nova, log).await?)
    }
}

/// `Some(t)` → `None` quando vazio após trim.
fn opt_str(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
