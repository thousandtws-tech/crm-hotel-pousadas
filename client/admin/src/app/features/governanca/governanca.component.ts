// UI de governanca — template, estilos e bindings. A lógica vive em governanca.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GovernancaStore } from './governanca.store';

@Component({
  selector: 'app-governanca',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <h2 class="pg-titulo">Governança</h2>
          <p class="pg-sub">Limpeza, enxoval e lavanderia — D-1 automático às 22h UTC</p>
        </div>
        <div class="filtros">
          <input
            type="date"
            [(ngModel)]="dataQuadro"
            (change)="carregarQuadro()"
            aria-label="Data"
          />
          <button class="btn-mini" (click)="gerarD1()">Gerar tarefas de amanhã</button>
        </div>
      </header>

      <nav class="abas">
        <button class="aba" [class.ativa]="aba() === 'quadro'" (click)="aba.set('quadro')">
          Quadro do dia
        </button>
        <button class="aba" [class.ativa]="aba() === 'previsao'" (click)="aba.set('previsao')">
          Previsão 14 dias
        </button>
        <button class="aba" [class.ativa]="aba() === 'lavanderia'" (click)="aba.set('lavanderia')">
          Lavanderia & Enxoval
        </button>
      </nav>

      @if (aba() === 'quadro') {
        <div class="bloco">
          <h3>{{ tarefas().length }} tarefas em {{ dataQuadro | date: 'dd/MM/yyyy' }}</h3>
          <table>
            <thead>
              <tr>
                <th>Quarto/Local</th>
                <th>Tipo</th>
                <th>Est.</th>
                <th>Responsável</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (t of tarefas(); track t.id) {
                <tr>
                  <td>{{ t.idquarto ? 'Quarto ' + t.idquarto : 'Área comum' }}</td>
                  <td>{{ tipoRotulo[t.tipo] ?? t.tipo }}</td>
                  <td>{{ t.estimado_min }}min</td>
                  <td>
                    <select
                      [ngModel]="t.idfuncionario"
                      (ngModelChange)="atribuir(t.id, $event)"
                      aria-label="Responsável"
                    >
                      <option [ngValue]="null">—</option>
                      @for (f of funcionarios(); track f.id) {
                        <option [ngValue]="f.id">{{ f.nome }}</option>
                      }
                    </select>
                  </td>
                  <td>
                    <span class="st st-{{ t.status }}">{{ t.status.replace('_', ' ') }}</span>
                  </td>
                  <td class="acoes-td">
                    @if (t.status === 'pendente') {
                      <button class="btn-mini" (click)="status(t, 'em_andamento')">Iniciar</button>
                    }
                    @if (t.status === 'em_andamento') {
                      <button class="btn-mini" (click)="status(t, 'concluida')">Concluir</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="vazio">
                    Nenhuma tarefa — o cron gera às 22h UTC ou use o botão acima.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba() === 'previsao') {
        <div class="bloco">
          <h3>Demanda × capacidade da equipe (14 dias)</h3>
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Checkouts</th>
                <th>Stayovers</th>
                <th>Demanda</th>
                <th>Capacidade</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              @for (d of previsao(); track d.data) {
                <tr [class.critica]="d.situacao !== 'ok'">
                  <td>{{ d.data | date: 'EEE dd/MM' }}</td>
                  <td>{{ d.checkouts }}</td>
                  <td>{{ d.stayovers }}</td>
                  <td>{{ horas(d.demanda_min) }}</td>
                  <td>{{ d.capacidade_min ? horas(d.capacidade_min) : '—' }}</td>
                  <td>
                    <span class="st" [class]="d.situacao === 'ok' ? 'st-concluida' : 'st-pendente'">
                      {{
                        d.situacao === 'ok'
                          ? 'OK'
                          : d.situacao === 'sobrecarga'
                            ? 'Sobrecarga'
                            : 'Sem equipe'
                      }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <p class="vazio">
            Checkout=60min · stayover=30min · capacidade = turnos do setor governança em Escalas.
          </p>
        </div>
      }

      @if (aba() === 'lavanderia') {
        <div class="cards">
          @for (s of saldoEnxoval(); track s[0]) {
            <div class="card">
              <span>{{ s[0] }}</span><strong>{{ s[1] }}</strong
              ><small>em estoque</small>
            </div>
          } @empty {
            <p class="vazio">Enxoval sem movimentações — registre a primeira abaixo.</p>
          }
        </div>

        <div class="bloco">
          <h3>
            Lotes de lavanderia
            <button class="btn-mini" (click)="modalLote.set(true)">Novo lote</button>
            <button class="btn-mini" (click)="fecharMes()">Fechar mês (conta a pagar)</button>
          </h3>
          <table>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Competência</th>
                <th>Enviado</th>
                <th>Itens</th>
                <th>Devolvidos</th>
                <th>Custo</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (l of lotes(); track l.id) {
                <tr>
                  <td>{{ l.fornecedor }}</td>
                  <td>{{ l.competencia | date: 'MM/yyyy' }}</td>
                  <td>{{ l.enviado_em | date: 'dd/MM' }}</td>
                  <td>{{ l.qtd_itens }}</td>
                  <td>{{ l.qtd_devolvida }}</td>
                  <td>{{ brl(l.custo_centavos) }}</td>
                  <td>
                    <span class="st st-{{ l.status }}">{{ l.status.replace('_', ' ') }}</span>
                  </td>
                  <td>
                    @if (l.status !== 'fechado' && l.qtd_devolvida < l.qtd_itens) {
                      <button class="btn-mini" (click)="devolver(l)">Devolução</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="vazio">Nenhum lote registrado.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="bloco">
          <h3>
            Movimentações de enxoval
            <button class="btn-mini" (click)="modalMov.set(true)">Registrar</button>
          </h3>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Peça</th>
                <th>Qtd</th>
                <th>Origem → Destino</th>
              </tr>
            </thead>
            <tbody>
              @for (m of movs(); track m.id) {
                <tr>
                  <td>{{ m.data | date: 'dd/MM HH:mm' }}</td>
                  <td>{{ m.tipo_item }}</td>
                  <td>{{ m.quantidade }}</td>
                  <td>{{ m.origem }} → {{ m.destino }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="vazio">Sem movimentações.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (modalLote()) {
        <div class="overlay" (click)="modalLote.set(false)" (keydown.escape)="modalLote.set(false)">
          <div
            class="modal"
            role="dialog"
            aria-modal="true"
            (click)="$event.stopPropagation()"
            (keydown)="$event.stopPropagation()"
          >
            <h3>Novo lote de lavanderia</h3>
            <label>Fornecedor <input [(ngModel)]="novoLote.fornecedor" /></label>
            <label
              >Quantidade de itens <input type="number" [(ngModel)]="novoLote.qtd_itens"
            /></label>
            <label
              >Custo total (R$) <input type="number" step="0.01" [(ngModel)]="novoLote.custo"
            /></label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalLote.set(false)">Cancelar</button>
              <button
                class="btn"
                [disabled]="!novoLote.fornecedor || !novoLote.qtd_itens"
                (click)="abrirLote()"
              >
                Enviar lote
              </button>
            </div>
          </div>
        </div>
      }

      @if (modalMov()) {
        <div class="overlay" (click)="modalMov.set(false)" (keydown.escape)="modalMov.set(false)">
          <div
            class="modal"
            role="dialog"
            aria-modal="true"
            (click)="$event.stopPropagation()"
            (keydown)="$event.stopPropagation()"
          >
            <h3>Movimentação de enxoval</h3>
            <label
              >Peça
              <input [(ngModel)]="novaMov.tipo_item" placeholder="Lençol casal, toalha banho…"
            /></label>
            <label>Quantidade <input type="number" [(ngModel)]="novaMov.quantidade" /></label>
            <label
              >Origem
              <select [(ngModel)]="novaMov.origem">
                <option value="estoque">Estoque</option>
                <option value="quarto">Quarto</option>
                <option value="lavanderia">Lavanderia</option>
                <option value="descarte">Descarte</option>
              </select>
            </label>
            <label
              >Destino
              <select [(ngModel)]="novaMov.destino">
                <option value="quarto">Quarto</option>
                <option value="lavanderia">Lavanderia</option>
                <option value="estoque">Estoque</option>
                <option value="descarte">Descarte</option>
              </select>
            </label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalMov.set(false)">Cancelar</button>
              <button
                class="btn"
                [disabled]="!novaMov.tipo_item || !novaMov.quantidade"
                (click)="gravarMov()"
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .pg {
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .pg-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .pg-titulo {
        font-size: 1.35rem;
        margin: 0;
      }
      .pg-sub {
        margin: 0.15rem 0 0;
        color: var(--mut, #667);
        font-size: 0.85rem;
      }
      .filtros {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .filtros input {
        padding: 0.45rem 0.6rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 8px;
        font-size: 0.85rem;
      }
      .abas {
        display: flex;
        gap: 0.4rem;
        border-bottom: 1px solid var(--borda, #e3e6ea);
      }
      .aba {
        padding: 0.55rem 1rem;
        border: 0;
        background: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        font-size: 0.88rem;
      }
      .aba.ativa {
        border-bottom-color: #0b7285;
        font-weight: 700;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 0.75rem;
      }
      .card {
        background: var(--card, #fff);
        border: 1px solid var(--borda, #e3e6ea);
        border-radius: 12px;
        padding: 0.9rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .card span {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--mut, #667);
      }
      .card strong {
        font-size: 1.15rem;
      }
      .card small {
        color: var(--mut, #667);
        font-size: 0.72rem;
      }
      .bloco {
        background: var(--card, #fff);
        border: 1px solid var(--borda, #e3e6ea);
        border-radius: 12px;
        padding: 1rem;
        overflow-x: auto;
      }
      .bloco h3 {
        margin: 0 0 0.75rem;
        font-size: 0.95rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.45rem 0.6rem;
        border-bottom: 1px solid var(--borda, #eee);
      }
      th {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--mut, #667);
      }
      .st {
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 600;
      }
      .st-pendente,
      .st-enviado,
      .st-devolvido_parcial {
        background: #fdf3d7;
        color: #8a6200;
      }
      .st-em_andamento {
        background: #e8ecfd;
        color: #345;
      }
      .st-concluida,
      .st-devolvido,
      .st-fechado {
        background: #e4f6e8;
        color: #146c2e;
      }
      .critica td {
        background: #fff5f5;
      }
      .acoes-td {
        white-space: nowrap;
      }
      select {
        padding: 0.3rem 0.5rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 6px;
        font-size: 0.78rem;
      }
      .btn-mini {
        font-size: 0.72rem;
        padding: 0.3rem 0.7rem;
        border-radius: 6px;
        border: 1px solid var(--borda, #ccd);
        background: #fff;
        cursor: pointer;
      }
      .vazio {
        color: var(--mut, #667);
        font-size: 0.85rem;
        padding: 0.5rem 0;
      }
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 15, 20, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 60;
      }
      .modal {
        background: #fff;
        border-radius: 14px;
        padding: 1.5rem;
        width: min(420px, 92vw);
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }
      .modal h3 {
        margin: 0;
      }
      .modal label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        font-size: 0.78rem;
        font-weight: 600;
      }
      .modal input,
      .modal select {
        padding: 0.55rem 0.65rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 8px;
        font-size: 0.9rem;
      }
      .acoes {
        display: flex;
        gap: 0.6rem;
        margin-top: 0.4rem;
      }
      .btn {
        flex: 1;
        padding: 0.6rem;
        border: 0;
        border-radius: 8px;
        background: #0b7285;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      .btn:disabled {
        opacity: 0.6;
      }
      .btn-sec {
        padding: 0.6rem 1rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
      }
    `,
  ],
})
export class GovernancaComponent extends GovernancaStore {}
