// Lógica e estado de funcionarios — separada da camada de UI (funcionarios.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, Directive } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { FuncionariosApi } from '@core/api/funcionarios.api';
import { CargosApi } from '@core/api/cargos.api';
import { VerificacaoApi } from '@core/api/verificacao.api';
import * as M from '@core/models';
import {
  Cargo,
  Funcionario,
  FuncionarioInput,
  FuncionarioUpdate,
} from '@core/models/funcionarios.models';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourService } from '@core/services/tour.service';

// Gestão da equipe: contas de acesso ao sistema (Recepção / Gerente / Administrador).
@Directive()
export abstract class FuncionariosStore implements OnInit {
  private readonly funcionariosApi = inject(FuncionariosApi);
  private readonly cargosApi = inject(CargosApi);
  private readonly verificacaoApi = inject(VerificacaoApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmService);
  private readonly rt = inject(RealtimeService);
  private readonly fb = inject(FormBuilder);
  private readonly tour = inject(TourService);
  protected readonly auth = inject(AuthStore);

  /** Última verificação de identidade por funcionário (produção). */
  protected readonly verificacoes = signal(new Map<number, M.VerificacaoIdentidade>());
  /** Link gerado para envio manual — exibido num modal com copiar. */
  protected readonly linkVerificacao = signal<{ url: string; nome: string } | null>(null);
  protected readonly gerandoLink = signal(0);

  protected readonly items = signal<Funcionario[]>([]);
  protected readonly total = signal(0);
  protected readonly carregando = signal(true);
  protected readonly pagina = signal(0);
  protected readonly editando = signal<Funcionario | null>(null);
  protected readonly trocaSenha = signal(false);
  protected readonly verSenha = signal(false);
  protected readonly drawerAberto = signal(false);
  protected readonly tentou = signal(false);
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly skel = [0, 1, 2, 3, 4];

  /** Cargos disponíveis — alimenta o select do formulário e a tela de gestão. */
  protected readonly cargos = signal<Cargo[]>([]);
  protected readonly cargosAberto = signal(false);
  protected readonly editandoCargo = signal<Cargo | null>(null);
  protected readonly tentouCargo = signal(false);

  /** Formulário único — criar e editar usam o mesmo drawer. */
  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    data_nascimento: ['', Validators.required],
    cpf: ['', Validators.required],
    cargo_id: [0, [Validators.required, Validators.min(1)]],
    login: ['', Validators.required],
    senha: ['', [Validators.required, Validators.minLength(8)]],
  });

  /** Formulário do cargo no drawer de gestão. */
  protected readonly cargoForm = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    descricao: [''],
    nivel: [3, Validators.required],
  });

  private readonly cargosPorId = computed(() => {
    const mapa = new Map<number, Cargo>();
    for (const c of this.cargos()) mapa.set(c.id, c);
    return mapa;
  });

  protected readonly ativos = computed(() => this.items().filter((f) => f.ativo).length);
  protected readonly porNivel = (n: number) =>
    this.items().filter((f) => f.nivel === n && f.ativo).length;

  protected readonly filtrados = computed(() => {
    const t = this.termo().trim().toLowerCase();
    if (!t) return this.items();
    return this.items().filter(
      (f) =>
        f.nome.toLowerCase().includes(t) ||
        f.login.toLowerCase().includes(t) ||
        (f.cpf ?? '').includes(t),
    );
  });

  protected readonly pageSize = signal(10);
  protected readonly paginados = computed(() => {
    const ini = this.pagina() * this.pageSize();
    return this.filtrados().slice(ini, ini + this.pageSize());
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('funcionario');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
    let ultimoCargo = -1;
    effect(() => {
      const v = this.rt.mudanca('cargo');
      if (ultimoCargo < 0) {
        ultimoCargo = v;
        return;
      }
      if (v !== ultimoCargo) {
        ultimoCargo = v;
        this.carregarCargos();
      }
    });
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarCargos();
  }

  onEsc(): void {
    if (this.cargosAberto()) this.fecharCargos();
    else if (this.drawerAberto()) this.fecharDrawer();
  }

  carregar(): void {
    this.funcionariosApi.listarFuncionarios(1, 500).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.total.set(p.total);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
    // Badges de identidade — falha silenciosa quando a Didit não está
    // configurada (a coluna mostra "—" para todo mundo).
    this.verificacaoApi.listar('producao').subscribe({
      next: (p) => {
        const mapa = new Map<number, M.VerificacaoIdentidade>();
        for (const v of p.items) {
          if (!mapa.has(v.verificacao.funcionario_id)) {
            mapa.set(v.verificacao.funcionario_id, v.verificacao);
          }
        }
        this.verificacoes.set(mapa);
      },
      error: () => this.verificacoes.set(new Map()),
    });
  }

  carregarCargos(): void {
    this.cargosApi.listar().subscribe({
      next: (cs) => this.cargos.set(cs),
      error: (e) => this.notify.erro(e),
    });
  }

  /** Título do cargo do funcionário; cai no nível quando não veio da lista. */
  cargoNome(f: Funcionario): string {
    return this.cargosPorId().get(f.cargo_id)?.nome ?? this.nivelNome(f.nivel);
  }

  /** Rótulo + selo + classe do badge de identidade. */
  verificacaoDe(id: number): { rotulo: string; cls: string; icone: string; titulo: string } {
    const v = this.verificacoes().get(id);
    if (!v) {
      return {
        rotulo: '—',
        cls: 'v-off',
        icone: 'person_outline',
        titulo: 'Sem verificação de identidade — gere um link pelo ícone ao lado',
      };
    }
    const quando = v.decidido_em
      ? ` em ${new Date(v.decidido_em).toLocaleDateString('pt-BR')}`
      : '';
    switch (v.status) {
      case 'aprovada':
        return {
          rotulo: 'Verificado',
          cls: 'v-ok',
          icone: 'verified',
          titulo: `Identidade verificada via Didit${quando}`,
        };
      case 'recusada':
        return {
          rotulo: 'Recusada',
          cls: 'v-erro',
          icone: 'cancel',
          titulo: `Verificação recusada${quando} — gere um novo link`,
        };
      case 'em_revisao':
        return {
          rotulo: 'Em revisão',
          cls: 'v-warn',
          icone: 'pending_actions',
          titulo: 'Verificação em revisão manual pela Didit',
        };
      case 'expirada':
      case 'abandonada':
      case 'kyc_expirada':
        return {
          rotulo: 'Expirada',
          cls: 'v-off',
          icone: 'schedule',
          titulo: 'Verificação expirada — gere um novo link',
        };
      default:
        return {
          rotulo: 'Pendente',
          cls: 'v-warn',
          icone: 'hourglass_empty',
          titulo: 'Aguardando o funcionário concluir a verificação',
        };
    }
  }

  /** Gera (ou recupera a viva) a sessão Didit e mostra o link para envio. */
  verificar(f: Funcionario): void {
    this.gerandoLink.set(f.id);
    this.verificacaoApi.sessaoFuncionario(f.id).subscribe({
      next: (s) => {
        this.gerandoLink.set(0);
        this.linkVerificacao.set({ url: s.url, nome: f.nome });
        this.carregar();
      },
      error: (e) => {
        this.gerandoLink.set(0);
        this.notify.erro(e?.error?.message ?? 'Não foi possível gerar o link — Didit configurada?');
      },
    });
  }

  copiarLink(): void {
    const l = this.linkVerificacao();
    if (l) navigator.clipboard.writeText(l.url).then(() => this.notify.ok('Link copiado.'));
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex);
    this.pageSize.set(e.pageSize);
  }

  nivelNome(n: number): string {
    return n === 1 ? 'Administrador' : n === 2 ? 'Gerente' : 'Recepção';
  }
  nivelIcone(n: number): string {
    return n === 1 ? 'admin_panel_settings' : n === 2 ? 'manage_accounts' : 'room_service';
  }

  iniciais(nome: string | null | undefined): string {
    if (!nome) return '?';
    const p = nome.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  invalido(campo: string): boolean {
    const c = this.form.get(campo);
    return !!c && c.invalid && (c.touched || this.tentou());
  }

  status(f: Funcionario, ativo: boolean): void {
    this.funcionariosApi.statusFuncionario(f.id, ativo).subscribe({
      next: (novo) => this.items.update((xs) => xs.map((x) => (x.id === novo.id ? novo : x))),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(f: Funcionario): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o funcionário ${f.nome}? A conta de acesso será apagada.`,
      { titulo: 'Excluir funcionário', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.funcionariosApi.excluirFuncionario(f.id).subscribe({
      next: () => {
        this.notify.ok('Funcionário excluído.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirNovo(): void {
    this.editando.set(null);
    this.trocaSenha.set(false);
    this.verSenha.set(false);
    this.tentou.set(false);
    this.form.controls.senha.enable();
    this.form.controls.senha.setValidators([Validators.required, Validators.minLength(8)]);
    this.form.controls.senha.updateValueAndValidity();
    this.form.reset({
      nome: '',
      data_nascimento: '',
      cpf: '',
      cargo_id:
        this.cargos().find((c) => c.sistema && c.nivel === 3)?.id ??
        this.cargos().find((c) => c.ativo)?.id ??
        0,
      login: '',
      senha: '',
    });
    this.drawerAberto.set(true);
    setTimeout(() => document.getElementById('fu-nome')?.focus(), 250);
  }

  abrirEdicao(f: Funcionario): void {
    this.editando.set(f);
    this.trocaSenha.set(false);
    this.verSenha.set(false);
    this.tentou.set(false);
    this.form.controls.senha.disable();
    this.form.controls.senha.setValidators([Validators.minLength(8)]);
    this.form.controls.senha.updateValueAndValidity();
    this.form.reset({
      nome: f.nome,
      data_nascimento: f.data_nascimento ?? '',
      cpf: f.cpf ?? '',
      cargo_id: f.cargo_id,
      login: f.login,
      senha: '',
    });
    this.drawerAberto.set(true);
  }

  fecharDrawer(): void {
    this.drawerAberto.set(false);
    this.editando.set(null);
  }

  /** Habilita/desabilita o campo de senha na edição (checkbox "Alterar senha"). */
  alternarSenha(): void {
    const on = !this.trocaSenha();
    this.trocaSenha.set(on);
    const ctrl = this.form.controls.senha;
    if (on) {
      ctrl.enable();
      ctrl.setValidators([Validators.required, Validators.minLength(8)]);
    } else {
      ctrl.disable();
      ctrl.setValue('');
      ctrl.setValidators([Validators.minLength(8)]);
    }
    ctrl.updateValueAndValidity();
  }

  salvar(): void {
    this.tentou.set(true);
    if (this.form.invalid) {
      setTimeout(
        () => document.querySelector('.drawer .inval')?.scrollIntoView({ block: 'center' }),
        60,
      );
      return;
    }
    const v = this.form.getRawValue();
    const f = this.editando();

    if (!f) {
      const input: FuncionarioInput = {
        nome: v.nome,
        login: v.login,
        senha: v.senha,
        cpf: v.cpf || null,
        data_nascimento: v.data_nascimento || null,
        cargo_id: v.cargo_id,
      };
      this.funcionariosApi.criarFuncionario(input).subscribe({
        next: (salvo) => {
          this.notify.ok('Funcionário cadastrado.');
          this.fecharDrawer();
          this.items.update((xs) =>
            [...xs, salvo].sort((a, b) => a.nome.localeCompare(b.nome)),
          );
        },
        error: (e) => this.notify.erro(e),
      });
    } else {
      const input: FuncionarioUpdate = {
        nome: v.nome,
        login: v.login,
        cpf: v.cpf || null,
        data_nascimento: v.data_nascimento || null,
        cargo_id: v.cargo_id,
        version: f.version,
      };
      if (v.senha) input.senha = v.senha;
      this.funcionariosApi.atualizarFuncionario(f.id, input).subscribe({
        next: (salvo) => {
          this.notify.ok('Funcionário salvo.');
          this.fecharDrawer();
          this.items.update((xs) => xs.map((x) => (x.id === salvo.id ? salvo : x)));
        },
        error: (e) => this.notify.erro(e),
      });
    }
  }

  // ---------- gestão de cargos ----------

  abrirCargos(): void {
    this.cancelarCargo();
    this.cargosAberto.set(true);
  }

  fecharCargos(): void {
    this.cargosAberto.set(false);
    this.cancelarCargo();
  }

  invalidoCargo(campo: string): boolean {
    const c = this.cargoForm.get(campo);
    return !!c && c.invalid && (c.touched || this.tentouCargo());
  }

  editarCargo(c: Cargo): void {
    this.editandoCargo.set(c);
    this.tentouCargo.set(false);
    this.cargoForm.reset({ nome: c.nome, descricao: c.descricao ?? '', nivel: c.nivel });
    // Cargo-base: nível travado (o backend recusa mudança).
    if (c.sistema) this.cargoForm.controls.nivel.disable();
    else this.cargoForm.controls.nivel.enable();
    setTimeout(() => document.getElementById('cg-nome')?.focus(), 150);
  }

  cancelarCargo(): void {
    this.editandoCargo.set(null);
    this.tentouCargo.set(false);
    this.cargoForm.controls.nivel.enable();
    this.cargoForm.reset({ nome: '', descricao: '', nivel: 3 });
  }

  salvarCargo(): void {
    this.tentouCargo.set(true);
    if (this.cargoForm.invalid) return;
    const v = this.cargoForm.getRawValue();
    const editando = this.editandoCargo();
    const descricao = v.descricao.trim() || null;

    if (!editando) {
      this.cargosApi.criar({ nome: v.nome.trim(), descricao, nivel: v.nivel }).subscribe({
        next: () => {
          this.notify.ok('Cargo criado.');
          this.cancelarCargo();
          this.carregarCargos();
        },
        error: (e) => this.notify.erro(e),
      });
      return;
    }

    // Cargo-base: o select fica desabilitado — não envia `nivel` (o backend
    // recusa mudança). Demais campos seguem o formulário.
    this.cargosApi
      .atualizar(editando.id, {
        nome: v.nome.trim(),
        descricao,
        ...(editando.sistema ? {} : { nivel: v.nivel }),
      })
      .subscribe({
        next: () => {
          this.notify.ok('Cargo salvo.');
          this.cancelarCargo();
          this.carregarCargos();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  statusCargo(c: Cargo, ativo: boolean): void {
    this.cargosApi.atualizar(c.id, { ativo }).subscribe({
      next: () => this.carregarCargos(),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirCargo(c: Cargo): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o cargo ${c.nome}? Funcionários com este cargo impedem a exclusão.`,
      { titulo: 'Excluir cargo', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.cargosApi.excluir(c.id).subscribe({
      next: () => {
        this.notify.ok('Cargo excluído.');
        this.carregarCargos();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js) — abre o drawer no meio do caminho. */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à tela de Funcionários!',
          description:
            'Aqui você cadastra a <b>equipe</b> que acessa o sistema e ' +
            'define o que cada um pode fazer. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '.fn-resumo',
        popover: {
          title: 'Sua equipe em números',
          description:
            'Total de funcionários, quantos estão <b>ativos</b> e a ' +
            'distribuição por função: Recepção, Gerentes e Administradores.',
          side: 'bottom',
        },
      },
      {
        element: '.fn-busca',
        popover: {
          title: 'Busca instantânea',
          description:
            'Digite <b>nome, login ou CPF</b> — a lista filtra sozinha, ' + 'sem apertar botão.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista da equipe',
          description:
            'O selo de <b>função</b> indica o nível de acesso. O selo ' +
            '<b>Status</b> ativa/desativa a conta. Você não pode mexer na ' +
            'sua própria conta — segurança.',
          side: 'top',
        },
      },
      {
        element: '#tour-novo',
        popover: {
          title: 'Novo funcionário',
          description: 'Abre o painel lateral de cadastro. Vou abrir agora para você ver…',
          side: 'bottom',
        },
      },
      {
        element: '.drawer',
        popover: {
          title: 'Cadastro em 2 etapas',
          description:
            '<b>Dados pessoais</b> (nome, nascimento, CPF) e <b>Função & ' +
            'acesso</b> (cargo, login e senha). Na edição, a senha só muda se ' +
            'você marcar "Alterar senha atual".',
          side: 'left',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Equipe configurada. Cada ação fica registrada em ' +
            '<b>Auditoria</b> com o nome de quem fez — transparência total.',
        },
      },
    ]);
    setTimeout(() => this.abrirNovo(), 600);
  }
}
