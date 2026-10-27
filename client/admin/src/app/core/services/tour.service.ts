import { Service } from '@angular/core';
import { driver, type Driver, type DriveStep } from 'driver.js';

/**
 * Tour guiado (Driver.js) para telas do painel.
 * Passa os passos em português e o service cuida do tema, dos botões
 * e da navegação — inclusive abrir/fechar o drawer durante o tour.
 */
@Service()
export class TourGuiado {
  private instancia: Driver | null = null;

  /**
   * @param passos passos do Driver.js (element pode ser seletor CSS)
   * @param aoDestruir chamado quando o usuário fecha o tour (Esc, ✕ ou fim)
   */
  iniciar(passos: DriveStep[], aoDestruir?: () => void): void {
    this.instancia?.destroy();
    this.instancia = driver({
      showProgress: true,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      overlayColor: '#02141b',
      overlayOpacity: 0.55,
      stagePadding: 8,
      stageRadius: 8,
      popoverOffset: 12,
      nextBtnText: 'Próximo →',
      prevBtnText: '← Anterior',
      doneBtnText: 'Concluir ✓',
      progressText: 'Passo {{current}} de {{total}}',
      steps: passos,
      onDestroyed: () => {
        this.instancia = null;
        aoDestruir?.();
      },
    });
    this.instancia.drive();
  }

  /** true enquanto um tour está visível (impede o Esc fechar o drawer embaixo). */
  ativo(): boolean {
    return this.instancia !== null;
  }

  avancar(): void {
    this.instancia?.moveNext();
  }

  voltar(): void {
    this.instancia?.movePrevious();
  }

  encerrar(): void {
    this.instancia?.destroy();
  }
}
