# -*- coding: utf-8 -*-
"""Carimba rodapé (título + número de página) em todas as páginas exceto a capa."""
import pymupdf

PDF = 'D:/clientes/projeto-clarituz-crm-hotel-pousadas/Manual/manual_sistema.pdf'
TITULO = 'Manual do Sistema — Pousada Espírito do Mar'

doc = pymupdf.open(PDF)
total = len(doc)
cinza = (0.42, 0.48, 0.55)
borda = (0.86, 0.89, 0.92)

for i in range(1, total):
    p = doc[i]
    w, h = p.rect.width, p.rect.height
    y = h - 32          # ~11mm da borda inferior
    x0, x1 = 45, w - 45
    # linha fina acima do rodapé
    p.draw_line(pymupdf.Point(x0, y - 6), pymupdf.Point(x1, y - 6), color=borda, width=0.5)
    # título à esquerda
    p.insert_text(pymupdf.Point(x0, y), TITULO, fontsize=7.5, color=cinza, fontname='helv')
    # número à direita
    num = f'{i + 1:02d} / {total}'
    tw = pymupdf.get_text_length(num, fontname='helv', fontsize=7.5)
    p.insert_text(pymupdf.Point(x1 - tw, y), num, fontsize=7.5, color=cinza, fontname='helv')

doc.save(PDF, incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
doc.close()
print(f'rodapé ok — {total - 1} páginas')
