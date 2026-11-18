// Lógica e estado de integracao-channex — separada da camada de UI (integracao-channex.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';
import { estadoDe, rotuloAmbiente } from './integracoes.const';

/**
 * Channex — channel manager (PMS → OTAs). Credenciais + vínculo da
 * propriedade remota, mapeamento acomodação→room type+rate plan,
 * publicação ARI (sincronizar/pausar/reconciliar) e a trilha inbound
 * (revisões + pendências operacionais).
 */
@Directive()
export abstract class IntegracaoChannexStore implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);

  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly opcoes = signal<M.DistOpcoes | null>(null);
  protected readonly propriedades = signal<M.ChannexPropriedade[]>([]);
  protected readonly revisoes = signal<M.DistRevisao[]>([]);
  protected readonly pendencias = signal<M.DistPendencia[]>([]);
  protected readonly resumo = signal<M.DistResumo | null>(null);
  protected readonly selRt = signal<Record<number, string>>({});
  protected readonly selRp = signal<Record<number, string>>({});
  protected readonly ocupado = signal(false);

  protected readonly fApiKey = this.fb.nonNullable.control('');
  protected readonly fSecret = this.fb.nonNullable.control('');

  protected readonly rotuloAmbiente = rotuloAmbiente;
  protected readonly estadoDe = estadoDe;

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.ambiente.set((p.get('ambiente') as M.AmbienteIntegracao) ?? 'producao');
      this.carregar();
    });
  }

  private carregar(): void {
    const amb = this.ambiente();
    this.api.buscar('channex', amb).subscribe({ next: (i) => this.i.set(i) });
    this.opcoes.set(null);
    this.api.distOpcoes(amb).subscribe({ next: (r) => this.opcoes.set(r.data) });
    this.api.distRevisoes(amb).subscribe({ next: (r) => this.revisoes.set(r.data) });
    this.api.distPendencias(amb).subscribe({ next: (r) => this.pendencias.set(r.data) });
    this.api.distResumo(amb).subscribe({ next: (r) => this.resumo.set(r.data) });
  }

  protected salvar(): void {
    const i = this.i();
    if (!i) return;
    const segredos: Record<string, string> = {};
    if (this.fApiKey.value.trim()) segredos['api_key'] = this.fApiKey.value.trim();
    if (this.fSecret.value.trim()) segredos['webhook_secret'] = this.fSecret.value.trim();
    if (!Object.keys(segredos).length) {
      this.notify.aviso('Nada para salvar.');
      return;
    }
    this.ocupado.set(true);
    this.api.salvar('channex', i.ambiente, { versao: i.versao, segredos }).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.fApiKey.setValue('');
        this.fSecret.setValue('');
        this.notify.ok('Credenciais salvas.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected habilitar(i: M.IntegracaoView): void {
    this.ocupado.set(true);
    this.api.habilitacao('channex', i.ambiente, !i.habilitado).subscribe({
      next: (nova) => {
        this.ocupado.set(false);
        this.i.set(nova);
        this.notify.ok(nova.habilitado ? 'Integração habilitada.' : 'Integração desabilitada.');
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected testar(): void {
    this.ocupado.set(true);
    this.api.testar('channex', this.ambiente()).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Conexão verificada — conta Channex autenticada.');
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected carregarPropriedades(): void {
    this.ocupado.set(true);
    this.api.distPropriedades(this.ambiente()).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.propriedades.set(r.data);
        if (!r.data.length) this.notify.aviso('Nenhuma propriedade na conta Channex.');
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected vincular(property_id: string): void {
    this.ocupado.set(true);
    this.api.distVincular(this.ambiente(), property_id).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Propriedade vinculada.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected registrarWebhook(): void {
    this.ocupado.set(true);
    this.api.distRegistrarWebhook(this.ambiente()).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Webhook assinado registrado — segredo capturado no vault.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected mapaDe(idacomodacao: number): M.DistMapa | undefined {
    return this.opcoes()?.mapeamentos.find((m) => m.idacomodacao === idacomodacao && m.ativo);
  }

  protected ratePlansDe(roomTypeId: string): M.ChannexRatePlan[] {
    return this.opcoes()?.rate_plans.filter((r) => r.room_type_id === roomTypeId) ?? [];
  }

  protected tituloRt(id: string): string {
    return this.opcoes()?.room_types.find((r) => r.id === id)?.title ?? id;
  }

  protected tituloRp(id: string): string {
    return this.opcoes()?.rate_plans.find((r) => r.id === id)?.title ?? id;
  }

  protected selRtMuda(idacomodacao: number, v: string): void {
    this.selRt.update((m) => ({ ...m, [idacomodacao]: v }));
    this.selRp.update((m) => ({ ...m, [idacomodacao]: '' }));
  }

  protected selRpMuda(idacomodacao: number, v: string): void {
    this.selRp.update((m) => ({ ...m, [idacomodacao]: v }));
  }

  protected mapear(idacomodacao: number): void {
    const rt = this.selRt()[idacomodacao];
    const rp = this.selRp()[idacomodacao];
    if (!rt || !rp) return;
    this.ocupado.set(true);
    this.api.distMapear(this.ambiente(), idacomodacao, rt, rp).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Acomodação mapeada — ARI enfileirada.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected desmapear(id: number): void {
    this.ocupado.set(true);
    this.api.distDesmapear(this.ambiente(), id).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Mapeamento removido.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected sincronizar(): void {
    const hoje = new Date();
    const fim = new Date(hoje.getTime() + 90 * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    this.ocupado.set(true);
    this.api.distSincronizar(this.ambiente(), iso(hoje), iso(fim)).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.notify.ok(
          `${r.enfileirados} acomodações enfileiradas — o worker publica em segundos.`,
        );
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected reconciliar(): void {
    this.ocupado.set(true);
    this.api.distReconciliar(this.ambiente()).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.notify.ok(`Reconciliação enfileirada (${r.enfileirados} unidades) + feed consultado.`);
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected pausar(): void {
    const pausada = !this.opcoes()?.publicacao_pausada;
    this.ocupado.set(true);
    this.api.distPausar(this.ambiente(), pausada).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok(
          pausada ? 'Publicação pausada.' : 'Publicação retomada — reconcilie a janela.',
        );
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected reprocessar(revision_id: string): void {
    this.ocupado.set(true);
    this.api.distReprocessar(this.ambiente(), revision_id).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.notify.ok('Revisão reprocessada.');
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected resolverPendencia(id: number): void {
    this.ocupado.set(true);
    this.api.distResolverPendencia(this.ambiente(), id).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.carregar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected rotuloPendencia(tipo: string): string {
    const r: Record<string, string> = {
      mapeamento_ausente: 'Reserva sem mapeamento',
      conflito_inventario: 'Conflito de inventário',
      importacao_incompleta: 'Importação incompleta',
      cancelamento_em_estadia: 'Cancelamento em estadia',
      envio_falhou: 'Falha de publicação',
      envio_parcial: 'Aceite parcial da Channex',
      propriedade_desconhecida: 'Propriedade divergente',
      webhook_sem_assinatura: 'Webhook sem assinatura',
      revisao_orfa: 'Revisão órfã',
    };
    return r[tipo] ?? tipo;
  }

  protected copiar(texto: string): void {
    navigator.clipboard
      .writeText(texto)
      .then(() => this.notify.ok('URL copiada.'))
      .catch(() => this.notify.erroMsg('Não foi possível copiar.'));
  }
}
