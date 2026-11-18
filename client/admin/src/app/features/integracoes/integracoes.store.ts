// Lógica e estado de integracoes — separada da camada de UI (integracoes.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, inject, signal, Directive } from '@angular/core';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { NotifyService } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  CATEGORIA_PROVEDOR,
  ORDEM_CATEGORIA,
  ORDEM_PROVEDOR,
  ROTULO_CATEGORIA,
  estadoDe,
  rotuloAmbiente,
  rotuloProvedor,
  sessaoZapi,
} from './integracoes.const';

interface ProvedorGrupo {
  provedor: M.ProvedorIntegracao;
  producao: M.IntegracaoView | null;
  teste: M.IntegracaoView | null;
}

interface CategoriaSecao {
  categoria: M.CategoriaIntegracao;
  rotulo: string;
  grupos: ProvedorGrupo[];
}

/** Produto de checkout/canal implementado pelo adapter — factual, não marketing. */
const DESCRITOR_PROVEDOR: Record<M.ProvedorIntegracao, string> = {
  stripe: 'Stripe Checkout',
  pagbank: 'Checkout PagBank',
  mercadopago: 'Checkout Pro',
  zapi: 'WhatsApp Business',
  spedy: 'NFS-e de hospedagem',
  didit: 'Verificação de identidade (KYC)',
  channex: 'Channel manager (OTAs)',
};

/**
 * Integrações — catálogo agrupado por categoria: Pagamentos (um card por
 * provedor com as linhas Produção/Teste) e Comunicação (Z-API/WhatsApp,
 * só Produção). A faixa superior responde a pergunta operacional
 * principal: quem cobra o site hoje. Credenciais são cifradas e
 * write-only; aqui só aparecem estado, conta, sessão e cobertura.
 */
@Directive()
export abstract class IntegracoesStore implements OnInit {
  private readonly api = inject(IntegracoesApi);
  private readonly notify = inject(NotifyService);

  protected readonly integracoes = signal<M.IntegracaoView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly falhou = signal(false);
  protected readonly skel = [0, 1, 2];

  protected readonly rotuloProvedor = rotuloProvedor;
  protected readonly rotuloAmbiente = rotuloAmbiente;
  protected readonly estadoDe = estadoDe;

  /** Um card por provedor, ambientes na ordem Produção → Teste. */
  protected readonly grupos = computed<ProvedorGrupo[]>(() => {
    const porPar = new Map<string, M.IntegracaoView>(
      this.integracoes().map((i) => [`${i.provedor}/${i.ambiente}`, i]),
    );
    return ORDEM_PROVEDOR.map((provedor) => ({
      provedor,
      producao: porPar.get(`${provedor}/producao`) ?? null,
      teste: porPar.get(`${provedor}/teste`) ?? null,
    })).filter((g) => g.producao !== null || g.teste !== null);
  });

  /** Seções na ordem Pagamentos → Comunicação, sem categorias vazias. */
  protected readonly secoes = computed<CategoriaSecao[]>(() =>
    ORDEM_CATEGORIA.map((categoria) => ({
      categoria,
      rotulo: ROTULO_CATEGORIA[categoria],
      grupos: this.grupos().filter((g) => CATEGORIA_PROVEDOR[g.provedor] === categoria),
    })).filter((s) => s.grupos.length > 0),
  );

  /** Faixa do topo é só cobrança — o padrão WhatsApp aparece no card Z-API. */
  protected readonly padraoSite = computed(
    () => this.integracoes().find((i) => i.categoria === 'pagamento' && i.padrao_site) ?? null,
  );

  /** Frase da faixa: quem cobra o site — padrão, env legado ou nada. */
  protected readonly descricaoPadrao = computed(() => {
    const p = this.padraoSite();
    if (p) {
      return `${rotuloProvedor(p.provedor)} · ${rotuloAmbiente(p.ambiente)} é o provedor padrão.`;
    }
    const legado = this.integracoes().find(
      (i) =>
        i.provedor === 'stripe' &&
        i.ambiente === 'producao' &&
        i.estado === 'gerenciado_pelo_ambiente',
    );
    if (legado) {
      return 'Stripe · Produção via variáveis de ambiente — defina um padrão para gerenciar por aqui.';
    }
    return 'Nenhum provedor padrão — configure uma integração e defina como padrão.';
  });

  ngOnInit(): void {
    this.carregar();
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.falhou.set(false);
    this.api.listar().subscribe({
      next: (l) => {
        this.integracoes.set(l);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.falhou.set(true);
        this.notify.erroMsg('Falha ao carregar as integrações.');
      },
    });
  }

  protected descriptorDe(p: M.ProvedorIntegracao): string {
    return DESCRITOR_PROVEDOR[p] ?? '';
  }

  /** Sessão WhatsApp ativa — credencial válida não implica pareamento. */
  protected sessaoConectada(i: M.IntegracaoView): boolean {
    return sessaoZapi(i)?.conectado === true;
  }

  /** Linha secundária: conta verificada, cobertura de credenciais ou dica. */
  protected resumoDe(i: M.IntegracaoView): string {
    if (i.provedor === 'zapi') {
      return this.resumoZapi(i);
    }
    if (i.nome_conta) {
      return `Conta ${i.nome_conta}`;
    }
    const configuradas = Object.values(i.segredos?.campos ?? {}).filter(Boolean).length;
    const total = CAMPOS_POR_PROVEDOR[i.provedor]?.length ?? 0;
    if (configuradas > 0 && total > 0) {
      return `${configuradas} de ${total} credenciais configuradas`;
    }
    if (i.ultima_verificacao_em && i.verificacao_status === 'ok') {
      return `Verificada em ${this.dataBr(i.ultima_verificacao_em)}`;
    }
    return i.habilitado ? 'Habilitada' : 'Toque para configurar';
  }

  /** Z-API: o que interessa na listagem é a sessão — número ou pareamento. */
  private resumoZapi(i: M.IntegracaoView): string {
    const s = sessaoZapi(i);
    if (s?.conectado) {
      return s.telefone ? `Número ${s.telefone}` : 'Sessão ativa';
    }
    if (i.estado === 'nao_configurada') {
      return 'Toque para configurar';
    }
    if (s?.desconectado_em) {
      return `Desconectado em ${this.dataBr(s.desconectado_em)} — leia um novo QR Code`;
    }
    return 'Aguardando pareamento do WhatsApp';
  }

  protected dataBr(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
