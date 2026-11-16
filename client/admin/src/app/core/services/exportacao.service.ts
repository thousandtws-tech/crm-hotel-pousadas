import { Injectable } from '@angular/core';

export interface LinhaResumo {
  rotulo: string;
  valor: string;
}

export interface RelatorioCfg {
  /** Título grande no documento, ex.: "Relatório de Hóspedes". */
  titulo: string;
  /** Linha menor abaixo do título, ex.: período ou filtro aplicado. */
  subtitulo?: string;
  /** Nome do arquivo sem extensão. */
  nomeArquivo: string;
  /** Cabeçalho das colunas. */
  colunas: string[];
  /** Linhas já formatadas para exibição (strings/números). */
  linhas: (string | number | null)[][];
  /** Números de resumo exibidos antes da tabela (KPIs). */
  resumo?: LinhaResumo[];
}

const NAVY = '#20242c';
const TEAL = '#2457a7';
const GOLD = '#b45309';

const agora = (): string =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());

function baixar(nome: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Texto puro do relatório — usado por e-mail e WhatsApp. */
function textoRelatorio(cfg: RelatorioCfg): string {
  const partes: string[] = [`*${cfg.titulo}*`];
  if (cfg.subtitulo) partes.push(cfg.subtitulo);
  for (const r of cfg.resumo ?? []) partes.push(`${r.rotulo}: *${r.valor}*`);
  partes.push(`Gerado em ${agora()}`);
  partes.push('');
  partes.push(cfg.colunas.join(' | '));
  partes.push(cfg.colunas.map(() => '---').join(' | '));
  for (const l of cfg.linhas.slice(0, 40)) {
    partes.push(l.map((c) => c ?? '—').join(' | '));
  }
  if (cfg.linhas.length > 40) {
    partes.push(`… e mais ${cfg.linhas.length - 40} registro(s) no arquivo completo.`);
  }
  return partes.join('\n');
}

/** HTML estilizado — base do .doc do Word. */
function htmlRelatorio(cfg: RelatorioCfg): string {
  const resumo = (cfg.resumo ?? [])
    .map(
      (r) =>
        `<td style="padding:8px 14px;border:1px solid #dde2e8;">
           <div style="font-size:9px;color:#66707e;text-transform:uppercase;letter-spacing:.05em;">${r.rotulo}</div>
           <div style="font-size:14px;font-weight:bold;color:${NAVY};">${r.valor}</div>
         </td>`,
    )
    .join('');

  const cab = cfg.colunas
    .map(
      (c) =>
        `<th style="background:${NAVY};color:#fff;padding:7px 10px;font-size:10px;
          text-transform:uppercase;letter-spacing:.04em;text-align:left;
          border:1px solid ${NAVY};">${c}</th>`,
    )
    .join('');

  const linhas = cfg.linhas
    .map(
      (l, i) =>
        `<tr style="background:${i % 2 ? '#f5f7fa' : '#fff'};">` +
        l
          .map(
            (c) =>
              `<td style="padding:6px 10px;font-size:11px;color:#3d4552;
                border:1px solid #dde2e8;">${c ?? '—'}</td>`,
          )
          .join('') +
        '</tr>',
    )
    .join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office">
  <head><meta charset="utf-8"><title>${cfg.titulo}</title></head>
  <body style="font-family:Calibri,Arial,sans-serif;">
    <table style="border-collapse:collapse;width:100%;margin-bottom:10px;">
      <tr>
        <td style="background:${NAVY};padding:14px 18px;">
          <div style="color:#fff;font-size:18px;font-weight:bold;">${cfg.titulo}</div>
          <div style="color:#a5b6bf;font-size:11px;margin-top:2px;">
            ${cfg.subtitulo ?? ''} · Gerado em ${agora()}
          </div>
        </td>
        <td style="background:${GOLD};width:6px;"></td>
      </tr>
    </table>
    ${
      cfg.resumo?.length
        ? `<table style="border-collapse:collapse;margin-bottom:12px;"><tr>${resumo}</tr></table>`
        : ''
    }
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr>${cab}</tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <p style="font-size:9px;color:#66707e;margin-top:10px;">
      Documento gerado pelo sistema da pousada em ${agora()}.
    </p>
  </body></html>`;
}

@Injectable({ providedIn: 'root' })
export class ExportacaoService {
  /** PDF real com cabeçalho na identidade visual + tabela formatada. */
  async pdf(cfg: RelatorioCfg): Promise<void> {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: cfg.colunas.length > 6 ? 'landscape' : 'portrait' });
    const largura = doc.internal.pageSize.getWidth();
    const altura = doc.internal.pageSize.getHeight();

    // Cabeçalho navy + filete dourado
    doc.setFillColor(NAVY);
    doc.rect(0, 0, largura, 26, 'F');
    doc.setFillColor(GOLD);
    doc.rect(0, 26, largura, 1.4, 'F');
    doc.setTextColor('#ffffff');
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text(cfg.titulo, 12, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor('#a5b6bf');
    doc.text(`${cfg.subtitulo ?? ''} · Gerado em ${agora()}`, 12, 19);
    doc.setTextColor('#ffffff');
    doc.setFontSize(8);
    doc.text('Pousada — Sistema de gestão', largura - 12, 12, { align: 'right' });

    let y = 34;

    // Faixa de resumo (KPIs)
    if (cfg.resumo?.length) {
      const n = cfg.resumo.length;
      const w = (largura - 24 - (n - 1) * 4) / n;
      cfg.resumo.forEach((r, i) => {
        const x = 12 + i * (w + 4);
        doc.setFillColor('#f5f7fa');
        doc.setDrawColor('#dde2e8');
        doc.roundedRect(x, y, w, 16, 1.5, 1.5, 'FD');
        doc.setFontSize(6.5);
        doc.setTextColor('#66707e');
        doc.text(r.rotulo.toUpperCase(), x + 4, y + 5.5);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(NAVY);
        doc.text(r.valor, x + 4, y + 12.5);
        doc.setFont('helvetica', 'normal');
      });
      y += 22;
    }

    autoTable(doc, {
      startY: y,
      head: [cfg.colunas],
      body: cfg.linhas.map((l) => l.map((c) => c ?? '—')),
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2.4,
        textColor: '#3d4552',
        lineColor: '#dde2e8',
        lineWidth: 0.15,
      },
      headStyles: {
        fillColor: NAVY,
        textColor: '#ffffff',
        fontSize: 7.5,
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: '#f5f7fa' },
      didDrawPage: (data) => {
        const pagina = doc.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor('#66707e');
        doc.text(
          `Página ${data.pageNumber} de ${pagina} — ${cfg.titulo}`,
          largura / 2,
          altura - 6,
          { align: 'center' },
        );
      },
    });

    doc.save(`${cfg.nomeArquivo}.pdf`);
  }

  /** Excel .xlsx real com cabeçalho formatado e colunas auto-ajustadas. */
  async excel(cfg: RelatorioCfg): Promise<void> {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    const ws = wb.addWorksheet(cfg.titulo.slice(0, 28));

    // Título
    ws.mergeCells(1, 1, 1, cfg.colunas.length);
    const titulo = ws.getCell(1, 1);
    titulo.value = cfg.titulo;
    titulo.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titulo.alignment = { vertical: 'middle' };
    for (let c = 1; c <= cfg.colunas.length; c++) {
      ws.getCell(1, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF054054' },
      };
    }
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, cfg.colunas.length);
    ws.getCell(2, 1).value = `${cfg.subtitulo ?? ''} · Gerado em ${agora()}`;
    ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF7D97A1' } };

    // Cabeçalho
    const cab = ws.addRow(cfg.colunas);
    cab.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1A6F8A' },
      };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF054054' } } };
    });
    cab.height = 18;

    // Linhas
    cfg.linhas.forEach((l, i) => {
      const row = ws.addRow(l.map((c) => c ?? '—'));
      row.eachCell((cell) => {
        cell.font = { size: 10, color: { argb: 'FF33424C' } };
        if (i % 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF4F8FA' },
          };
        }
      });
    });

    // Largura automática aproximada
    cfg.colunas.forEach((col, i) => {
      const maior = Math.max(
        col.length,
        ...cfg.linhas.slice(0, 300).map((l) => String(l[i] ?? '').length),
      );
      ws.getColumn(i + 1).width = Math.min(maior + 4, 42);
    });

    const buf = await wb.xlsx.writeBuffer();
    baixar(
      `${cfg.nomeArquivo}.xlsx`,
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
  }

  /** Word .doc — HTML formatado que o Word abre nativamente. */
  word(cfg: RelatorioCfg): void {
    baixar(
      `${cfg.nomeArquivo}.doc`,
      new Blob(['\ufeff' + htmlRelatorio(cfg)], {
        type: 'application/msword;charset=utf-8',
      }),
    );
  }

  /** Abre o cliente de e-mail com o resumo pronto para enviar. */
  email(cfg: RelatorioCfg): void {
    const assunto = encodeURIComponent(cfg.titulo);
    const corpo = encodeURIComponent(textoRelatorio(cfg).replaceAll('*', ''));
    window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
  }

  /** Abre o WhatsApp Web/app com o resumo formatado. */
  whatsapp(cfg: RelatorioCfg): void {
    const txt = encodeURIComponent(textoRelatorio(cfg));
    window.open(`https://wa.me/?text=${txt}`, '_blank', 'noopener');
  }
}
