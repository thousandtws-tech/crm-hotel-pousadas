// Didit — verificação de identidade (KYC) de funcionários.
// Credenciais write-only, workflow/callback, portão de login
// (exigir_verificacao) e registro do webhook assinado.

import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { IntegracoesApi } from '@core/api/integracoes.api';
import { VerificacaoApi } from '@core/api/verificacao.api';
import { Notify } from '@core/services/notify.service';
import * as M from '@core/models';
import {
  CAMPOS_POR_PROVEDOR,
  CampoCredencial,
  ROTULO_AMBIENTE,
  estadoDe,
} from './integracoes.const';

@Component({
  selector: 'app-integracao-didit',
  imports: [RouterLink, ReactiveFormsModule, MatIconModule],
  template: `
    <div class="pag">
      <div class="cab">
        <div>
          <a class="volta" routerLink="/integracoes"><mat-icon>arrow_back</mat-icon> Integrações</a>
          <h2 class="titulo">Didit <span class="amb">{{ rotuloAmb }}</span></h2>
          <p class="sub">
            Verificação de identidade (KYC) dos funcionários — documento, biometria facial e
            análise de IP em sessão hospedada pela Didit.
          </p>
        </div>
        @if (i(); as int) {
          <span class="pill" [class]="estadoDe(int.estado).pill">{{ estadoDe(int.estado).rotulo }}</span>
        }
      </div>

      @if (carregando()) {
        <p class="mut">Carregando…</p>
      } @else if (!i()) {
        <div class="card"><p class="mut">Integração ainda não criada — salve as credenciais.</p></div>
      }

      <!-- Credenciais -->
      <section class="card">
        <h3 class="card-t"><mat-icon>key</mat-icon> Credenciais</h3>
        <p class="mut">Valores nunca são exibidos — só o estado configurado.</p>
        @for (c of campos; track c.nome) {
          <label class="fld">
            <span class="fld-l">{{ c.rotulo }}
              @if (configurado(c)) { <em class="conf">•••••• configurado</em> }
            </span>
            <input
              class="fld-i"
              [type]="c.segredo ? 'password' : 'text'"
              [formControl]="controle(c.nome)"
              [placeholder]="c.placeholder ?? (configurado(c) ? 'Deixe em branco para manter' : '')"
              autocomplete="off"
            />
            @if (c.dica) { <span class="fld-d">{{ c.dica }}</span> }
            @if (configurado(c)) {
              <label class="mini"><input type="checkbox" [checked]="limpar()[c.nome]" (change)="toggleLimpar(c.nome)" /> Limpar ao salvar</label>
            }
          </label>
        }
        <div class="acoes">
          <button type="button" class="btn-pri" (click)="salvar()" [disabled]="salvando()">
            {{ salvando() ? 'Salvando…' : 'Salvar credenciais' }}
          </button>
          <button type="button" class="btn-sec" (click)="testar()" [disabled]="testando()">
            <mat-icon>bolt</mat-icon> {{ testando() ? 'Testando…' : 'Testar conexão' }}
          </button>
        </div>
        @if (teste(); as t) {
          <p class="teste" [class.ok]="t.verificacao_status === 'ok'" [class.erro]="t.verificacao_status !== 'ok'">
            {{ t.mensagem }} {{ t.nome_conta ? '— ' + t.nome_conta : '' }}
          </p>
        }
      </section>

      <!-- Operação -->
      @if (i(); as int) {
        <section class="card">
          <h3 class="card-t"><mat-icon>tune</mat-icon> Operação</h3>
          <label class="sw">
            <input type="checkbox" [checked]="int.habilitado" (change)="alternar(int)" [disabled]="alternando()" />
            <span><strong>Integração habilitada</strong> — sessões de verificação podem ser criadas.</span>
          </label>
        </section>
      }

      <!-- Verificação -->
      <section class="card">
        <h3 class="card-t"><mat-icon>verified_user</mat-icon> Verificação de identidade</h3>
        <p class="mut">
          O workflow define os checks (documento + rosto + AML). Crie/edite em
          <b>business.didit.me → Workflows</b> e cole o ID aqui.
        </p>
        <label class="fld">
          <span class="fld-l">Workflow ID</span>
          <input class="fld-i" [formControl]="fWorkflow" placeholder="UUID do workflow Didit" />
        </label>
        <label class="fld">
          <span class="fld-l">URL de retorno (opcional)</span>
          <input class="fld-i" [formControl]="fCallback" placeholder="https://crm.espiritodomar.com.br/verificacao" />
          <span class="fld-d">Para onde o funcionário volta ao terminar a verificação hospedada.</span>
        </label>
        <label class="sw">
          <input type="checkbox" [formControl]="fExigir" />
          <span>
            <strong>Exigir verificação no login</strong> — funcionários não aprovados ficam na
            tela de verificação até concluir o KYC (válido só para a integração de produção).
          </span>
        </label>
        <div class="acoes">
          <button type="button" class="btn-pri" (click)="salvarConfig()" [disabled]="salvandoCfg()">
            {{ salvandoCfg() ? 'Salvando…' : 'Salvar configuração' }}
          </button>
        </div>
      </section>

      <!-- Webhook -->
      <section class="card">
        <h3 class="card-t"><mat-icon>webhook</mat-icon> Webhook</h3>
        @if (i()?.webhook_url) {
          <div class="hook">
            <code class="hook-url">{{ i()!.webhook_url }}</code>
            <button type="button" class="btn-sec" (click)="copiar(i()!.webhook_url!)">
              <mat-icon>content_copy</mat-icon> Copiar
            </button>
          </div>
          <p class="mut">Registrado na Didit — o segredo de assinatura já está guardado.</p>
        } @else {
          <p class="mut">
            Registre o destino para receber os eventos <code>status.updated</code> — sem ele o
            status só avança pela sincronização manual.
          </p>
        }
        <div class="acoes">
          <button type="button" class="btn-sec" (click)="registrarWebhook()" [disabled]="registrandoHook()">
            <mat-icon>add_link</mat-icon>
            {{ registrandoHook() ? 'Registrando…' : 'Registrar webhook na Didit' }}
          </button>
        </div>
      </section>

      <section class="card aviso-card">
        <h3 class="card-t"><mat-icon>info</mat-icon> Como funciona</h3>
        <ul class="lista">
          <li>Cada funcionário recebe um <b>link hospedado</b> (em Funcionários → Verificar) para fazer o KYC — documento + selfie.</li>
          <li>O status chega pelo <b>webhook</b> (ou pelo botão Sincronizar) e aparece como badge na equipe.</li>
          <li>Com <b>“Exigir verificação”</b> ligado, quem não aprovou fica na tela de verificação após o login — admin pode seguir em emergência.</li>
          <li>Ambiente <b>teste</b> nunca bloqueia login — serve para homologar o fluxo com cenários de sandbox.</li>
        </ul>
      </section>
    </div>
  `,
  styles: `
    .pag { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; display: grid; gap: 16px; }
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .volta { display: inline-flex; align-items: center; gap: 4px; font-size: 13px;
      color: #4B95AB; text-decoration: none; font-weight: 600; }
    .volta mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .titulo { font-size: 22px; font-weight: 700; margin: 6px 0 4px; color: #0b2437; }
    .amb { font-size: 13px; font-weight: 600; color: #4B95AB; }
    .sub { font-size: 13px; color: #5a6b76; margin: 0; line-height: 1.5; }
    .card { background: #fff; border: 1px solid #e4ecf0; border-radius: 14px; padding: 18px; }
    .card-t { display: flex; align-items: center; gap: 8px; font-size: 15px;
      font-weight: 700; color: #0b2437; margin: 0 0 8px; }
    .card-t mat-icon { color: #054054; font-size: 20px; width: 20px; height: 20px; }
    .mut { font-size: 13px; color: #7a8b96; margin: 0 0 10px; line-height: 1.5; }
    .fld { display: grid; gap: 4px; margin-bottom: 12px; }
    .fld-l { font-size: 13px; font-weight: 600; color: #0b2437; }
    .conf { font-style: normal; font-size: 12px; color: #1e7d32; font-weight: 600; }
    .fld-i { padding: 10px 12px; border: 1px solid #d5e0e6; border-radius: 10px;
      font-size: 14px; font-family: inherit; }
    .fld-i:focus { outline: 2px solid #4B95AB; border-color: transparent; }
    .fld-d { font-size: 12px; color: #7a8b96; }
    .mini { font-size: 12px; color: #7a8b96; display: inline-flex; gap: 6px; align-items: center; }
    .acoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
    .btn-pri { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px;
      border: 0; border-radius: 999px; background: #054054; color: #fff;
      font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-pri:disabled { opacity: .6; }
    .btn-sec { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px;
      border: 1px solid #d5e0e6; border-radius: 999px; background: #fff;
      color: #054054; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-sec:disabled { opacity: .6; }
    .btn-sec mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pill { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .pill-ok { background: #e6f4ea; color: #1e7d32; }
    .pill-warn { background: #fff7e0; color: #8a5a00; }
    .pill-erro { background: #fdecea; color: #b3261e; }
    .pill-off { background: #eef2f4; color: #5a6b76; }
    .pill-info { background: #e3f2f7; color: #216a80; }
    .sw { display: flex; gap: 10px; align-items: flex-start; font-size: 13px;
      color: #39464f; line-height: 1.5; margin: 10px 0; cursor: pointer; }
    .sw input { margin-top: 3px; }
    .teste { font-size: 13px; margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; }
    .teste.ok { background: #e6f4ea; color: #1e7d32; }
    .teste.erro { background: #fdecea; color: #b3261e; }
    .hook { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    .hook-url { font-size: 12px; background: #f2f6f8; padding: 8px 10px;
      border-radius: 8px; word-break: break-all; }
    .lista { margin: 0; padding-left: 18px; font-size: 13px; color: #39464f;
      display: grid; gap: 6px; line-height: 1.5; }
    .aviso-card { background: #f7fafb; }
  `,
})
export class IntegracaoDiditComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(IntegracoesApi);
  private readonly verificacao = inject(VerificacaoApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly i = signal<M.IntegracaoView | null>(null);
  protected readonly ambiente = signal<M.AmbienteIntegracao>('producao');
  protected readonly carregando = signal(true);
  protected readonly salvando = signal(false);
  protected readonly salvandoCfg = signal(false);
  protected readonly alternando = signal(false);
  protected readonly testando = signal(false);
  protected readonly registrandoHook = signal(false);
  protected readonly teste = signal<M.TesteIntegracao | null>(null);
  protected readonly limpar = signal<Record<string, boolean>>({});

  protected readonly campos: CampoCredencial[] = CAMPOS_POR_PROVEDOR['didit'];
  protected readonly estadoDe = estadoDe;
  private readonly controles = new Map<string, FormControl<string>>();

  protected readonly fWorkflow = this.fb.nonNullable.control('');
  protected readonly fCallback = this.fb.nonNullable.control('');
  protected readonly fExigir = this.fb.nonNullable.control(false);

  protected get rotuloAmb(): string {
    return ROTULO_AMBIENTE[this.ambiente()];
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.ambiente.set(p.get('ambiente') === 'teste' ? 'teste' : 'producao');
      this.carregar();
    });
  }

  protected controle(nome: string): FormControl<string> {
    let c = this.controles.get(nome);
    if (!c) {
      c = this.fb.nonNullable.control('');
      this.controles.set(nome, c);
    }
    return c;
  }

  protected configurado(c: CampoCredencial): boolean {
    return this.i()?.segredos.campos[c.nome] === true;
  }

  protected toggleLimpar(nome: string): void {
    this.limpar.update((l) => ({ ...l, [nome]: !l[nome] }));
  }

  private carregar(): void {
    this.carregando.set(true);
    this.api.buscar('didit', this.ambiente()).subscribe({
      next: (i) => {
        this.i.set(i);
        this.fWorkflow.setValue((i?.config?.['workflow_id'] as string) ?? '');
        this.fCallback.setValue((i?.config?.['callback_url'] as string) ?? '');
        this.fExigir.setValue(i?.config?.['exigir_verificacao'] === true);
        this.carregando.set(false);
      },
      error: () => {
        this.i.set(null);
        this.carregando.set(false);
      },
    });
  }

  protected salvar(): void {
    const segredos: Record<string, string> = {};
    for (const c of this.campos) {
      const v = this.controle(c.nome).value.trim();
      if (this.limpar()[c.nome]) segredos[c.nome] = '';
      else if (v) segredos[c.nome] = v;
    }
    if (!Object.keys(segredos).length) {
      this.notify.aviso('Nada para salvar — preencha um campo ou marque Limpar.');
      return;
    }
    this.salvando.set(true);
    this.api
      .salvar('didit', this.ambiente(), { versao: this.i()?.versao ?? 0, segredos })
      .subscribe({
      next: () => {
        this.salvando.set(false);
        for (const c of this.campos) this.controle(c.nome).setValue('');
        this.limpar.set({});
        this.notify.ok('Credenciais salvas.');
        this.carregar();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e?.error?.message ?? 'Falha ao salvar.');
      },
    });
  }

  protected salvarConfig(): void {
    this.salvandoCfg.set(true);
    this.verificacao
      .configurar(this.ambiente(), {
        workflowId: this.fWorkflow.value.trim(),
        callbackUrl: this.fCallback.value.trim(),
        exigirVerificacao: this.fExigir.value,
      })
      .subscribe({
        next: () => {
          this.salvandoCfg.set(false);
          this.notify.ok('Configuração salva.');
          this.carregar();
        },
        error: (e) => {
          this.salvandoCfg.set(false);
          this.notify.erro(e?.error?.message ?? 'Falha ao salvar.');
        },
      });
  }

  protected alternar(int: M.IntegracaoView): void {
    this.alternando.set(true);
    this.api.habilitacao(int.provedor, int.ambiente, !int.habilitado).subscribe({
      next: () => {
        this.alternando.set(false);
        this.carregar();
      },
      error: (e) => {
        this.alternando.set(false);
        this.notify.erro(e?.error?.message ?? 'Falha ao alterar.');
      },
    });
  }

  protected testar(): void {
    this.testando.set(true);
    this.teste.set(null);
    this.api.testar('didit', this.ambiente()).subscribe({
      next: (t) => {
        this.teste.set(t);
        this.testando.set(false);
      },
      error: (e) => {
        this.testando.set(false);
        this.teste.set({
          verificacao_status: 'falha',
          nome_conta: null,
          mensagem: e?.error?.message ?? 'Falha.',
        });
      },
    });
  }

  protected registrarWebhook(): void {
    this.registrandoHook.set(true);
    this.verificacao.registrarWebhook(this.ambiente()).subscribe({
      next: () => {
        this.registrandoHook.set(false);
        this.notify.ok('Webhook registrado — segredo capturado e guardado.');
        this.carregar();
      },
      error: (e) => {
        this.registrandoHook.set(false);
        this.notify.erro(e?.error?.message ?? 'Falha ao registrar webhook.');
      },
    });
  }

  protected copiar(texto: string): void {
    navigator.clipboard.writeText(texto).then(() => this.notify.ok('URL copiada.'));
  }
}
