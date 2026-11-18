//! Relatório LGPD legível (art. 18, §5º — formato acessível) do export
//! do titular. PDF mínimo gerado à mão — Helvetica/WinAnsi (latin-1
//! cobre pt-BR), zero dependência de fonte embutida ou de sistema.
//! Só campos amigáveis entram no PDF: chaves internas nunca aparecem.

use serde_json::Value;

use crate::error::AppResult;
use clarituz_domain::error::DomainError;

/// Campos do titular exibidos — ordem é a ordem do relatório.
const CAMPOS_CLIENTE: &[(&str, &str)] = &[
    ("nome", "Nome completo"),
    ("email", "E-mail"),
    ("telefone", "Telefone"),
    ("cpf", "CPF"),
    ("data_nascimento", "Data de nascimento"),
    ("nacionalidade", "Nacionalidade"),
    ("naturalidade", "Naturalidade"),
    ("profissao", "Profissão"),
    ("logradouro", "Logradouro"),
    ("numero", "Número"),
    ("complemento", "Complemento"),
    ("bairro", "Bairro"),
    ("cidade", "Cidade"),
    ("estado", "Estado"),
    ("cep", "CEP"),
    ("pais", "País"),
];

const CONSENTIMENTOS: &[(&str, &str)] = &[
    ("whatsapp_optin", "Receber avisos da estadia no WhatsApp"),
    ("consent_marketing", "Receber ofertas e novidades"),
    ("lgpd_opt_out", "Descadastro de marketing"),
];

const CAMPOS_RESERVA: &[(&str, &str)] = &[
    ("entradaprevista", "Check-in"),
    ("saidaprevista", "Check-out"),
    ("status", "Situação"),
    ("valortotal", "Valor total"),
    ("valor_total", "Valor total"),
];

const CAMPOS_AVALIACAO: &[(&str, &str)] = &[
    ("nota_geral", "Nota"),
    ("comentario", "Comentário"),
    ("resposta", "Resposta da pousada"),
];

const CAMPOS_SOLICITACAO: &[(&str, &str)] = &[
    ("tipo", "Tipo"),
    ("status", "Situação"),
    ("criado_em", "Aberta em"),
    ("respondida_em", "Respondida em"),
];

fn valor_str(v: &Value, chave: &str) -> Option<String> {
    match &v[chave] {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(if *b { "Sim" } else { "Não" }.into()),
        _ => None,
    }
}

/// Uma linha de texto a ser impressa: tamanho da fonte + negrito + texto.
enum Linha {
    Titulo(String),
    Secao(String),
    Corpo(String),
    Espaco,
}

/// Linha impressa com posição absoluta: fonte negrito?, tamanho, y, texto.
type Pos = (bool, u16, i32, String);

/// Acumula as linhas do relatório e pagina em A4 — posições absolutas
/// (y decrescente a partir do topo), `Td` nunca relativo.
struct Paginas {
    paginas: Vec<Vec<Pos>>,
    corrente: Vec<Pos>,
    y: i32,
}

const MARGEM_X: i32 = 56;
const TOPO_Y: i32 = 796;
const RODAPE_Y: i32 = 60;
const CORPO_FONTE: u16 = 9;

impl Paginas {
    fn novo() -> Self {
        Self {
            paginas: Vec::new(),
            corrente: Vec::new(),
            y: TOPO_Y,
        }
    }

    fn quebrar(&mut self) {
        if !self.corrente.is_empty() {
            self.paginas.push(std::mem::take(&mut self.corrente));
        }
        self.y = TOPO_Y;
    }

    fn push(&mut self, l: Linha) {
        let (bold, size, passo, gap) = match &l {
            Linha::Titulo(_) => (true, 16, 26, 0),
            Linha::Secao(_) => (true, 11, 16, 10),
            Linha::Corpo(_) => (false, CORPO_FONTE, 14, 0),
            Linha::Espaco => (false, CORPO_FONTE, 8, 0),
        };
        if self.y - gap - passo < RODAPE_Y {
            self.quebrar();
        }
        self.y -= gap + passo;
        match l {
            Linha::Espaco => {}
            Linha::Titulo(t) | Linha::Secao(t) | Linha::Corpo(t) => {
                self.corrente.push((bold, size, self.y, esc(&t)));
            }
        }
    }

    fn terminar(mut self) -> Vec<Vec<Pos>> {
        self.quebrar();
        self.paginas
    }
}

/// Escapa caracteres do literal PDF e mapeia pra WinAnsi (latin-1).
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '(' | ')' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            // WinAnsi cobre Latin-1; o resto vira '?' (nunca silencia dados).
            c if (c as u32) <= 0xFF => out.push(c),
            _ => out.push('?'),
        }
    }
    out
}

/// Serializa as páginas num PDF válido — xref + trailer corretos.
fn montar(paginas: &[Vec<Pos>]) -> Vec<u8> {
    // Objetos: 1=Catalog, 2=Pages, 3..=2+N*2 alternam Page/Contents,
    // últimos dois são as fontes /F1 (Helvetica) e /F2 (Helvetica-Bold).
    let n_pag = paginas.len().max(1);
    let id_fonte1 = 3 + n_pag * 2;
    let id_fonte2 = id_fonte1 + 1;

    let mut out: Vec<u8> = b"%PDF-1.4\n".to_vec();
    let mut offsets: Vec<usize> = Vec::with_capacity(id_fonte2 + 1);
    let mut obj = |buf: &mut Vec<u8>, id: usize, corpo: &[u8]| {
        while offsets.len() <= id {
            offsets.push(0);
        }
        offsets[id] = buf.len();
        buf.extend(format!("{id} 0 obj\n").as_bytes());
        buf.extend(corpo);
        buf.extend(b"\nendobj\n");
    };

    obj(&mut out, 1, b"<< /Type /Catalog /Pages 2 0 R >>");

    let kids: String = (0..n_pag).map(|i| format!("{} 0 R ", 3 + i * 2)).collect();
    obj(
        &mut out,
        2,
        format!("<< /Type /Pages /Kids [ {kids}] /Count {n_pag} >>").as_bytes(),
    );

    for (i, linhas) in paginas.iter().enumerate().take(n_pag) {
        let id_page = 3 + i * 2;
        let id_contents = id_page + 1;
        obj(
            &mut out,
            id_page,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] \
                 /Resources << /Font << /F1 {id_fonte1} 0 R /F2 {id_fonte2} 0 R >> >> \
                 /Contents {id_contents} 0 R >>"
            )
            .as_bytes(),
        );
        // Cada linha é um BT/ET próprio com posição absoluta (x, y).
        let stream = linhas
            .iter()
            .map(|(bold, size, y, t)| {
                let f = if *bold { "F2" } else { "F1" };
                format!("BT /{f} {size} Tf {MARGEM_X} {y} Td ({t}) Tj ET")
            })
            .collect::<Vec<_>>()
            .join("\n");
        obj(
            &mut out,
            id_contents,
            format!(
                "<< /Length {} >>\nstream\n{stream}\nendstream",
                stream.len()
            )
            .as_bytes(),
        );
    }
    if paginas.is_empty() {
        obj(
            &mut out,
            3,
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>",
        );
        obj(&mut out, 4, b"<< /Length 0 >>\nstream\n\nendstream");
    }

    for (id, nome) in [(id_fonte1, "Helvetica"), (id_fonte2, "Helvetica-Bold")] {
        obj(
            &mut out,
            id,
            format!(
                "<< /Type /Font /Subtype /Type1 /BaseFont /{nome} \
                 /Encoding /WinAnsiEncoding >>"
            )
            .as_bytes(),
        );
    }

    let xref = out.len();
    out.extend(format!("xref\n0 {}\n", id_fonte2 + 1).as_bytes());
    out.extend(b"0000000000 65535 f \n");
    for i in 1..=id_fonte2 {
        out.extend(format!("{:010} 00000 n \n", offsets[i]).as_bytes());
    }
    out.extend(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            id_fonte2 + 1
        )
        .as_bytes(),
    );
    out
}

fn secoes(export: &Value, pousada: &str) -> Vec<Linha> {
    let mut linhas = vec![
        Linha::Titulo(format!("Meus dados — {pousada}")),
        Linha::Corpo(format!(
            "Documento gerado em {} (art. 18, LGPD).",
            valor_str(export, "exportado_em").unwrap_or_else(|| "—".into())
        )),
        Linha::Secao("Dados pessoais".into()),
    ];

    let cli = &export["cliente"];
    let mut algum = false;
    for (chave, rotulo) in CAMPOS_CLIENTE {
        if let Some(v) = valor_str(cli, chave) {
            linhas.push(Linha::Corpo(format!("{rotulo}: {v}")));
            algum = true;
        }
    }
    if !algum {
        linhas.push(Linha::Corpo("Registros: nenhum".into()));
    }

    linhas.push(Linha::Secao("Consentimentos".into()));
    for (chave, rotulo) in CONSENTIMENTOS {
        let v = valor_str(cli, chave).unwrap_or_else(|| "Não".into());
        linhas.push(Linha::Corpo(format!("{rotulo}: {v}")));
    }

    let blocos: [(&str, &str, &[(&str, &str)]); 3] = [
        ("Reservas", "reservas", CAMPOS_RESERVA),
        ("Avaliações", "avaliacoes", CAMPOS_AVALIACAO),
        ("Solicitações de dados", "solicitacoes", CAMPOS_SOLICITACAO),
    ];
    for (titulo, lista, campos) in blocos {
        linhas.push(Linha::Secao(titulo.into()));
        let itens = export[lista].as_array();
        if itens.is_none_or(|a| a.is_empty()) {
            linhas.push(Linha::Corpo("Registros: nenhum".into()));
            continue;
        }
        for (i, item) in itens.unwrap().iter().enumerate() {
            linhas.push(Linha::Corpo(format!("{}.ª ocorrência", i + 1)));
            let mut algum = false;
            for (chave, rotulo) in campos {
                if let Some(v) = valor_str(item, chave) {
                    linhas.push(Linha::Corpo(format!("  {rotulo}: {v}")));
                    algum = true;
                }
            }
            if !algum {
                linhas.push(Linha::Corpo("  (sem dados exibíveis)".into()));
            }
            linhas.push(Linha::Espaco);
        }
    }

    linhas.push(Linha::Secao("Seus direitos".into()));
    linhas.push(Linha::Corpo(
        "Dúvidas ou correções? Fale com a recepção da pousada — seus".into(),
    ));
    linhas.push(Linha::Corpo(
        "direitos de titular estão garantidos pela LGPD (Lei 13.709/2018).".into(),
    ));
    linhas
}

/// Renderiza o export do titular (`exportar_cliente`) em PDF.
pub fn render_export(export: &Value, pousada: &str) -> AppResult<Vec<u8>> {
    let mut pag = Paginas::novo();
    for linha in secoes(export, pousada) {
        pag.push(linha);
    }
    let paginas = pag.terminar();
    if paginas.is_empty() {
        tracing::error!("lgpd pdf: export sem conteúdo");
        return Err(DomainError::Infra.into());
    }
    Ok(montar(&paginas))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn export_fake() -> Value {
        json!({
            "cliente": {
                "nome": "Maria da Glória (Silva)",
                "email": "maria@teste.com",
                "cpf": "123.456.789-00",
                "whatsapp_optin": true,
                "consent_marketing": false,
                "lgpd_opt_out": false
            },
            "reservas": [
                {"entradaprevista": "2025-12-01", "saidaprevista": "2025-12-05",
                 "status": "confirmada", "valortotal": 1200.50}
            ],
            "avaliacoes": [],
            "solicitacoes": [],
            "exportado_em": "2025-11-18T19:00:00Z"
        })
    }

    #[test]
    fn pdf_valido_e_legivel() {
        let pdf = render_export(&export_fake(), "Pousada Teste").unwrap();
        let s = String::from_utf8_lossy(&pdf);
        assert!(s.starts_with("%PDF-1.4"), "cabeçalho PDF");
        assert!(s.contains("trailer"), "trailer presente");
        assert!(s.contains("startxref"), "xref presente");
        assert!(
            s.contains("Maria da Glória \\(Silva\\)"),
            "parênteses escapados"
        );
        assert!(
            s.contains("Receber ofertas e novidades: Não"),
            "consentimento"
        );
        assert!(s.contains("Check-in: 2025-12-01"), "reserva");
        assert!(!s.contains("idcliente"), "sem campos internos");
    }

    #[test]
    fn pagina_quando_conteudo_excede() {
        let mut e = export_fake();
        let reservas: Vec<Value> = (0..60)
            .map(|_| json!({"entradaprevista": "2025-12-01"}))
            .collect();
        e["reservas"] = json!(reservas);
        let pdf = render_export(&e, "Pousada").unwrap();
        let s = String::from_utf8_lossy(&pdf);
        assert!(s.matches("/Type /Page ").count() >= 2, "mais de uma página");
    }
}
