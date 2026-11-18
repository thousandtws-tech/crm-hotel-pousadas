// Lógica e estado de reserva-detail — separada da camada de UI (reserva-detail.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, OnInit, effect, Directive } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { EstabelecimentoApi } from '@core/api/estabelecimento.api';
import { FrigobaresApi } from '@core/api/frigobares.api';
import { ImpressorasApi } from '@core/api/impressoras.api';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { ReservasApi } from '@core/api/reservas.api';
import { ComunicacaoApi } from '@core/api/comunicacao.api';
import { ItemFila } from '@core/models/comunicacao.models';
import { STATUS_RESERVA } from '@core/models/reservas.models';
import { num } from '@core/utils/num.utils';
import { TIPOS_DOCUMENTO, TipoDocumento } from '@core/models/clientes.models';
import { ItemFrigobarView } from '@core/models/frigobares.models';
import { FormaPagamento } from '@core/models/pagamentos.models';
import {
  Acompanhante,
  AdicionalConsumo,
  Fnrh,
  ItemConsumido,
  ReservaDetalhe,
} from '@core/models/reservas.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { imprimirFnrh } from '@shared/utils/fnrh-print';
import { switchMap } from 'rxjs';

type Modal =
  'checkin' | 'checkout' | 'dados-checkin' | 'dados-checkout' | 'cancelar' | 'fnrh' | null;

/** Motivos de viagem do modelo oficial da FNRH. */
const MOTIVOS_VIAGEM = [
  'Turismo/lazer',
  'Negócios/trabalho',
  'Congresso/evento',
  'Visita a parentes',
  'Saúde/tratamento',
  'Trânsito/conexão',
  'Outro',
] as const;

const PARENTESCOS = [
  'Cônjuge/companheiro(a)',
  'Filho(a)',
  'Pai/mãe',
  'Irmão(ã)',
  'Neto(a)',
  'Amigo(a)',
  'Outro',
] as const;

const TIPOS_DOC = Object.entries(TIPOS_DOCUMENTO) as [TipoDocumento, string][];

interface AdicionalLinha {
  motivo: string;
  valor: number;
}

// -- página de detalhe --------------------------------------------------------------
// Espelha legado/app/reserva/visualizarReserva.php + include/header.php
// + include/mCheck-in.php, mCheck-out.php, mDadosCheckin.php, mDadosCheckout.php.

@Directive()
export abstract class ReservaDetailStore implements OnInit {
  private readonly rt = inject(RealtimeService);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido', 'adicional_consumo');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        const id = this.id();
        if (id > 0) {
          this.reservasApi.buscarReserva(id).subscribe({
            next: (r) => {
              this.r.set(r);
              this.carregarExtras(r);
            },
            error: () => undefined,
          });
        }
      }
    });
  }
  private readonly estabelecimentoApi = inject(EstabelecimentoApi);
  private readonly frigobaresApi = inject(FrigobaresApi);
  private readonly impressorasApi = inject(ImpressorasApi);
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly comunicacaoApi = inject(ComunicacaoApi);
  private readonly notify = inject(NotifyService);
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthStore);
  private readonly fb = inject(FormBuilder);

  protected readonly id = signal(0);
  protected readonly r = signal<ReservaDetalhe | null>(null);
  protected readonly itens = signal<ItemConsumido[]>([]);
  protected readonly adicionaisList = signal<AdicionalConsumo[]>([]);
  protected readonly itensFrigobar = signal<ItemFrigobarView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly num = num;

  // modais
  protected readonly modal = signal<Modal>(null);
  protected readonly enviando = signal(false);
  protected readonly checkinFake = signal(false);
  /** ECA — check-in bloqueado aguardando autorização de menor. */
  protected readonly ecaBloqueio = signal(false);
  protected readonly realizador = signal<string | null>(null);
  protected readonly pagamentos = signal<FormaPagamento[]>([]);
  protected readonly custosAdicionais = signal(false);
  protected readonly adicionaisCheckout = signal<AdicionalLinha[]>([]);
  protected readonly cancelarAdmin = signal(false);

  // registro de hóspedes
  protected readonly acompanhantes = signal<Acompanhante[]>([]);
  protected readonly fichas = signal<Fnrh[]>([]);
  protected readonly comunicacoes = signal<ItemFila[]>([]);
  protected readonly retencaoAnos = signal(5);
  protected sneIni = '';
  protected sneFim = '';
  protected readonly motivosViagem = MOTIVOS_VIAGEM;
  protected readonly parentescos = PARENTESCOS;
  protected readonly tiposDoc = TIPOS_DOC;

  protected readonly itemForm = this.fb.nonNullable.group({
    iditem_frigobar: [0, Validators.min(1)],
    quantidade: [1, [Validators.required, Validators.min(1)]],
  });
  protected readonly adicionalForm = this.fb.nonNullable.group({
    motivo: ['', Validators.required],
    valor: [0, [Validators.required, Validators.min(0.01)]],
  });
  protected readonly checkinForm = this.fb.nonNullable.group({
    modo: ['auto' as 'auto' | 'manual'],
    data: [''],
    hora: [''],
    autorizacao: [''],
  });
  protected readonly checkoutForm = this.fb.nonNullable.group({
    idforma_pagamento: [0, Validators.min(1)],
    desconto: [0, Validators.min(0)],
  });
  protected readonly adminForm = this.fb.nonNullable.group({
    login_admin: ['', Validators.required],
    senha_admin: ['', Validators.required],
  });
  protected readonly acompForm = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    data_nascimento: [''],
    parentesco: [''],
    doc_tipo: [''],
    doc_numero: [''],
  });
  protected readonly fnrhForm = this.fb.nonNullable.group({
    motivo_viagem: [''],
    placa_veiculo: [''],
  });

  /** Valor unitário do item do frigobar selecionado (exibição no form). */
  protected valorItem(): number {
    const id = Number(this.itemForm.value.iditem_frigobar ?? 0);
    const it = this.itensFrigobar().find((i) => i.id === id);
    return it ? num(it.valor_unitario) : 0;
  }

  /** Check-in só liberado a partir da data de entrada prevista (legado). */
  podeCheckin(res: ReservaDetalhe): boolean {
    return this.hoje() >= res.entradaprevista.slice(0, 10);
  }

  hoje(): string {
    return new Date().toISOString().slice(0, 10);
  }
  hojeMenosUm(): string {
    return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  }

  /** Diárias efetivas: check-in → hoje, mínimo 1 (regra do mCheck-out.php). */
  diarias(): number {
    const cin = this.r()?.checkin_em;
    if (!cin) return 1;
    const diff = Math.floor(
      (new Date(this.hoje()).getTime() - new Date(cin.slice(0, 10)).getTime()) / 86400000,
    );
    return Math.max(1, diff);
  }

  /** Total do check-out — mesma fórmula do backend (estadia + itens +
   *  adicionais já lançados + adicionais do modal - desconto). */
  totalFinal(): number {
    const c = this.r()?.consumo;
    if (!c) return 0;
    const novos = this.adicionaisCheckout().reduce((s, a) => s + (a.valor || 0), 0);
    const t =
      num(c.valor_estadia) +
      num(c.valor_itens) +
      num(c.valor_adicional) +
      novos -
      (this.checkoutForm.value.desconto || 0);
    return Math.max(0, t);
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(switchMap((p) => this.reservasApi.buscarReserva(Number(p.get('id')))))
      .subscribe({
        next: (r) => {
          this.id.set(r.id);
          this.r.set(r);
          this.carregarExtras(r);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  private carregarExtras(res: ReservaDetalhe): void {
    this.carregando.set(true);
    this.reservasApi.itensConsumidos(res.id).subscribe({
      next: (i) => this.itens.set(i),
      error: () => undefined,
    });
    this.reservasApi.adicionais(res.id).subscribe({
      next: (a) => this.adicionaisList.set(a),
      error: () => undefined,
    });
    this.reservasApi.listarAcompanhantes(res.id).subscribe({
      next: (a) => this.acompanhantes.set(a),
      error: () => undefined,
    });
    this.reservasApi.fnrhReserva(res.id).subscribe({
      next: (f) => this.fichas.set(f),
      error: () => undefined,
    });
    this.comunicacaoApi.comunicacoesReserva(res.id).subscribe({
      next: (c) => this.comunicacoes.set(c),
      error: () => undefined,
    });
    this.estabelecimentoApi.obterEstabelecimento().subscribe({
      next: (e) => this.retencaoAnos.set(e.retencao_dados_anos ?? 5),
      error: () => undefined,
    });
    if (res.status === 'i') {
      this.frigobaresApi.listarFrigobares().subscribe({
        next: (fs) => {
          const f = fs.find((x) => x.idacomodacao === res.idacomodacao && x.ativo);
          if (f) {
            this.frigobaresApi.itensFrigobar(f.id).subscribe({
              next: (its) => this.itensFrigobar.set(its.filter((i) => i.ativo && i.quantidade > 0)),
              error: () => undefined,
            });
          }
        },
        error: () => undefined,
      });
    }
    this.carregando.set(false);
  }

  private recarregar(): void {
    this.reservasApi.buscarReserva(this.id()).subscribe({
      next: (r) => {
        this.r.set(r);
        this.carregarExtras(r);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  protected reenviarComunicacao(iditem: number): void {
    const id = this.id();
    if (id <= 0) return;
    this.enviando.set(true);
    this.comunicacaoApi.reenviarComunicacao(id, iditem).subscribe({
      next: () => {
        this.enviando.set(false);
        this.notify.ok('Mensagem reenfileirada para envio.');
        this.carregarExtras(this.r()!);
      },
      error: (e) => {
        this.enviando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected rotuloCanal(canal: ItemFila['canal']): string {
    return { email: 'E-mail', whatsapp: 'WhatsApp', push: 'Push', inbox: 'Interna' }[canal];
  }

  protected rotuloStatus(status: ItemFila['status']): string {
    return {
      pendente: 'Na fila',
      enviando: 'Enviando',
      enviado: 'Enviado',
      falhou: 'Falhou',
      cancelado: 'Cancelado',
      suprimido: 'Suprimido',
      desconhecido: 'Resultado incerto',
    }[status];
  }

  protected rotuloTemplate(template: string): string {
    const mapa: Record<string, string> = {
      reserva_confirmada: 'Reserva confirmada',
      reserva_pagamento: 'Pagamento confirmado',
      reserva_cancelada: 'Reserva cancelada',
      reserva_expirada: 'Reserva expirada',
      lembrete_checkin: 'Lembrete de check-in',
      fnrh_link: 'Pré-check-in (FNRH)',
      checkout_link: 'Check-out online',
      pesquisa_satisfacao: 'Pesquisa de satisfação',
      pesquisa_lembrete: 'Lembrete de pesquisa',
      cobranca: 'Cobrança',
    };
    return mapa[template] ?? template;
  }

  // -- modais --------------------------------------------------------------------

  abrirModal(m: Exclude<Modal, null>): void {
    if (m === 'cancelar') {
      this.cancelarAdmin.set(false);
      this.adminForm.reset({ login_admin: '', senha_admin: '' });
    }
    if (m === 'checkin') {
      this.ecaBloqueio.set(false);
      this.checkinForm.reset({ modo: 'auto', data: this.hoje(), hora: '', autorizacao: '' });
    }
    this.modal.set(m);
  }

  fecharModal(): void {
    this.modal.set(null);
    this.enviando.set(false);
  }

  mostrarCheckinFake(): void {
    this.checkinFake.set(true);
    setTimeout(() => this.checkinFake.set(false), 4000);
  }

  // -- check-in (mCheck-in.php: automático ou manual ±1 dia) ----------------------

  confirmarCheckin(): void {
    const v = this.checkinForm.getRawValue();
    let data: string | null = null;
    let hora: string | null = null;
    if (v.modo === 'manual') {
      if (!v.data || !v.hora) {
        this.notify.erro(new Error('Informe a data e a hora do check-in.'));
        return;
      }
      const diff = Math.abs(new Date(v.data).getTime() - new Date(this.hoje()).getTime());
      if (diff > 86400000) {
        this.notify.erro(new Error('Check-in manual permite no máximo 1 dia de diferença.'));
        return;
      }
      data = v.data;
      hora = v.hora;
    }
    this.enviando.set(true);
    this.reservasApi.checkin(this.id(), data, hora).subscribe({
      next: () => {
        this.notify.ok('Check-in realizado.');
        this.ecaBloqueio.set(false);
        this.fecharModal();
        this.recarregar();
      },
      error: (e) => {
        this.enviando.set(false);
        // ECA art. 82 — menor desacompanhado pede autorização documentada.
        const msg = String(e?.error?.erro?.mensagem ?? e?.message ?? '');
        if (/menor|ECA|autoriza/i.test(msg)) {
          this.ecaBloqueio.set(true);
        } else {
          this.notify.erro(e);
        }
      },
    });
  }

  /** Registra a autorização dos pais (ECA) e refaz o check-in. */
  registrarAutorizacao(): void {
    const doc = this.checkinForm.value.autorizacao?.trim();
    if (!doc) return;
    this.enviando.set(true);
    this.reservasApi.autorizacaoMenor(this.id(), doc).subscribe({
      next: () => this.confirmarCheckin(),
      error: (e) => {
        this.enviando.set(false);
        this.notify.erro(e);
      },
    });
  }

  // -- check-out (mCheck-out.php) --------------------------------------------------

  abrirCheckout(): void {
    this.pagamentosApi.listarPagamentos(true).subscribe({
      next: (p) => {
        this.pagamentos.set(p);
        this.custosAdicionais.set(false);
        this.adicionaisCheckout.set([]);
        this.checkoutForm.reset({ idforma_pagamento: 0, desconto: 0 });
        this.modal.set('checkout');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  toggleCustos(): void {
    const on = !this.custosAdicionais();
    this.custosAdicionais.set(on);
    this.adicionaisCheckout.set(on ? [{ motivo: '', valor: 0 }] : []);
  }
  addAdicional(): void {
    this.adicionaisCheckout.update((xs) => [...xs, { motivo: '', valor: 0 }]);
  }
  removerAdicional(i: number): void {
    this.adicionaisCheckout.update((xs) => xs.filter((_, j) => j !== i));
  }
  editAdMotivo(i: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.adicionaisCheckout.update((xs) => xs.map((a, j) => (j === i ? { ...a, motivo: v } : a)));
  }
  editAdValor(i: number, e: Event): void {
    const v = Number((e.target as HTMLInputElement).value) || 0;
    this.adicionaisCheckout.update((xs) => xs.map((a, j) => (j === i ? { ...a, valor: v } : a)));
  }

  confirmarCheckout(): void {
    const v = this.checkoutForm.getRawValue();
    this.enviando.set(true);
    this.reservasApi
      .checkout(this.id(), {
        idforma_pagamento: v.idforma_pagamento,
        total_desconto: v.desconto || null,
        adicionais: this.adicionaisCheckout().filter((a) => a.motivo.trim() && a.valor > 0),
      })
      .subscribe({
        next: () => {
          this.notify.ok('Check-out concluído.');
          this.fecharModal();
          this.recarregar();
        },
        error: (e) => {
          this.enviando.set(false);
          this.notify.erro(e);
        },
      });
  }

  // -- dados do check-in / check-out (mDadosCheckin/mDadosCheckout) ----------------

  /** Busca no log de auditoria quem executou a ação nesta reserva. */
  abrirDados(acao: 'checkin' | 'checkout'): void {
    this.realizador.set(null);
    this.modal.set(acao === 'checkin' ? 'dados-checkin' : 'dados-checkout');
    this.relatoriosApi
      .logs({ tabela: 'reserva', acao, idtabela: this.id(), porPagina: 1 })
      .subscribe({
        next: (p) => this.realizador.set(p.items[0]?.funcionario_nome ?? null),
        error: () => undefined,
      });
  }

  baixarComprovante(): void {
    const res = this.r();
    if (!res) return;
    this.pagamentosApi.comprovanteTexto(res.id).subscribe({
      next: (texto) => {
        const nome = res.consumo?.comprovante ?? `comprovante_${res.id}.txt`;
        const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- cancelar (mCancelarReserva / mCancelarReservaAdministrador) ------------------

  /** SIM — se em estadia sem ser admin, revela o form de credenciais (legado). */
  simCancelar(): void {
    const res = this.r();
    const precisaAdmin = !!res?.checkin_em && !res?.checkout_em && !this.auth.isAdmin();
    if (precisaAdmin) {
      this.cancelarAdmin.set(true);
    } else {
      this.confirmarCancelar();
    }
  }

  confirmarCancelar(): void {
    const v = this.adminForm.getRawValue();
    this.enviando.set(true);
    this.reservasApi
      .cancelarReserva(this.id(), {
        login_admin: this.cancelarAdmin() ? v.login_admin : null,
        senha_admin: this.cancelarAdmin() ? v.senha_admin : null,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Reserva cancelada.');
          this.fecharModal();
          this.recarregar();
        },
        error: (e) => {
          this.enviando.set(false);
          this.notify.erro(e);
        },
      });
  }

  // -- consumo ----------------------------------------------------------------------

  registrarItem(): void {
    if (this.itemForm.invalid) return;
    const v = this.itemForm.getRawValue();
    this.reservasApi.registrarItemConsumido(this.id(), v.iditem_frigobar, v.quantidade).subscribe({
      next: () => {
        this.notify.ok('Consumo lançado.');
        this.itemForm.reset({ iditem_frigobar: 0, quantidade: 1 });
        this.recarregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Lançamento avulso na conta durante a estadia (consumo adicional). */
  lancarAdicional(): void {
    const v = this.adicionalForm.getRawValue();
    this.reservasApi.lancarAdicional(this.id(), v.motivo, v.valor).subscribe({
      next: () => {
        this.notify.ok('Adicional lançado.');
        this.adicionalForm.reset({ motivo: '', valor: 0 });
        this.recarregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Reimprime os tickets de produção — um por impressora de setor. */
  reimprimirProducao(): void {
    this.impressorasApi.imprimirProducao(this.id()).subscribe({
      next: (r) => this.notify.ok(r.mensagem),
      error: (e) => this.notify.erro(e),
    });
  }

  // -- registro de hóspedes (acompanhantes + FNRH) ------------------------------

  adicionarAcompanhante(): void {
    if (this.acompForm.invalid) return;
    const v = this.acompForm.getRawValue();
    this.reservasApi
      .adicionarAcompanhante(this.id(), {
        nome: v.nome.trim(),
        data_nascimento: v.data_nascimento || null,
        parentesco: v.parentesco || null,
        doc_tipo: v.doc_tipo || null,
        doc_numero: v.doc_numero || null,
      })
      .subscribe({
        next: (a) => {
          this.acompanhantes.update((xs) => [...xs, a]);
          this.acompForm.reset({
            nome: '',
            data_nascimento: '',
            parentesco: '',
            doc_tipo: '',
            doc_numero: '',
          });
          this.notify.ok('Acompanhante adicionado.');
        },
        error: (e) => this.notify.erro(e),
      });
  }

  removerAcompanhante(a: Acompanhante): void {
    this.reservasApi.removerAcompanhante(a.id).subscribe({
      next: () => {
        this.acompanhantes.update((xs) => xs.filter((x) => x.id !== a.id));
        this.notify.ok('Acompanhante removido.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirFnrh(): void {
    this.fnrhForm.reset({ motivo_viagem: '', placa_veiculo: '' });
    this.modal.set('fnrh');
  }

  /** Emite a ficha (snapshot imutável no servidor) e já abre a impressão. */
  emitirFnrh(): void {
    const v = this.fnrhForm.getRawValue();
    this.enviando.set(true);
    this.reservasApi
      .emitirFnrh(this.id(), {
        motivo_viagem: v.motivo_viagem || null,
        placa_veiculo: v.placa_veiculo || null,
      })
      .subscribe({
        next: (f) => {
          this.fichas.update((xs) => [f, ...xs]);
          this.notify.ok('Ficha FNRH emitida.');
          this.fecharModal();
          imprimirFnrh(f);
        },
        error: (e) => {
          this.enviando.set(false);
          this.notify.erro(e);
        },
      });
  }

  imprimirFnrh(f: Fnrh): void {
    imprimirFnrh(f);
  }

  retencaoAte(emitidaEm: string): string {
    const d = new Date(emitidaEm);
    d.setFullYear(d.getFullYear() + this.retencaoAnos());
    return d.toLocaleDateString('pt-BR');
  }

  exportarSne(): void {
    if (!this.sneIni || !this.sneFim) return;
    this.reservasApi.exportarFnrh(this.sneIni, this.sneFim).subscribe({
      next: (csv) => {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `fnrh-sne-${this.sneIni}_${this.sneFim}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  rotuloDoc(t: string): string {
    return TIPOS_DOCUMENTO[t as TipoDocumento] ?? t;
  }

  rotulo(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.rotulo ?? s;
  }
}
