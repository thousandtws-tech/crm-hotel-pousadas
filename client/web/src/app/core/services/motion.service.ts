import { Injectable, inject, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export interface ScrollRevealOptions {
  y?: number;
  duration?: number;
  delay?: number;
  stagger?: number;
  trigger?: HTMLElement;
  start?: string;
  ease?: string;
}

export interface ParallaxOptions {
  yPercent?: number;
  scrub?: boolean | number;
  start?: string;
  end?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MotionService {
  private readonly platformId = inject(PLATFORM_ID);
  private isRegistered = false;

  constructor() {
    if (this.isBrowser) {
      this.ensurePluginRegistered();
      // Resiliência: elementos entram em opacity:0 até o ScrollTrigger disparar.
      // Aba em 2º plano, restore do bfcache ou retorno de suspensão podem impedir
      // a avaliação — refresh recalcula e dispara os triggers já passados.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) ScrollTrigger.refresh();
      });
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) ScrollTrigger.refresh();
      });
    }
  }

  public get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  public get prefersReducedMotion(): boolean {
    if (!this.isBrowser || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  public get isMobile(): boolean {
    if (!this.isBrowser) return false;
    return window.innerWidth < 768;
  }

  private ensurePluginRegistered(): void {
    if (!this.isRegistered && this.isBrowser && typeof window.matchMedia === 'function') {
      gsap.registerPlugin(ScrollTrigger);
      this.isRegistered = true;
    }
  }

  /**
   * Creates an isolated, leak-proof GSAP Context bound to a component scope.
   * If destroyRef is provided, automatically calls ctx.revert() on component destruction.
   */
  public createScope(
    scopeElement: HTMLElement,
    setupFn: (context: gsap.Context) => void,
    destroyRef?: DestroyRef
  ): gsap.Context | null {
    if (!this.isBrowser) return null;

    this.ensurePluginRegistered();

    const ctx = gsap.context((self) => {
      if (this.prefersReducedMotion) {
        // If reduced motion is requested, reveal all content immediately
        gsap.set(scopeElement.querySelectorAll('*'), { clearProps: 'all' });
        return;
      }
      setupFn(self);
    }, scopeElement);

    if (destroyRef) {
      destroyRef.onDestroy(() => {
        ctx.revert();
      });
    }

    return ctx;
  }

  /**
   * Hero entrance sequence: background subtle scale + staggered content reveal
   */
  public animateHero(
    scope: HTMLElement,
    elements: {
      background?: HTMLElement | null;
      eyebrow?: HTMLElement | null;
      title?: HTMLElement | null;
      subtitle?: HTMLElement | null;
      ctas?: HTMLElement | null;
      scrollIndicator?: HTMLElement | null;
    }
  ): gsap.core.Timeline | null {
    if (!this.isBrowser || this.prefersReducedMotion) return null;

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

    // 1. Background image enters with gentle fade and micro-scale
    if (elements.background) {
      tl.fromTo(
        elements.background,
        { scale: 1.035, opacity: 0.8 },
        { scale: 1.0, opacity: 1, duration: 1.4, ease: 'power2.out' },
        0
      );

      // Subtle scroll parallax on desktop
      if (!this.isMobile) {
        gsap.to(elements.background, {
          yPercent: 10,
          ease: 'none',
          scrollTrigger: {
            trigger: scope,
            start: 'top top',
            end: 'bottom top',
            scrub: 0.5
          }
        });
      }
    }

    // 2. Editorial content sequential entrance with tight, elegant stagger
    const contentItems: HTMLElement[] = [];
    if (elements.eyebrow) contentItems.push(elements.eyebrow);
    if (elements.title) contentItems.push(elements.title);
    if (elements.subtitle) contentItems.push(elements.subtitle);
    if (elements.ctas) contentItems.push(elements.ctas);

    if (contentItems.length > 0) {
      tl.fromTo(
        contentItems,
        { opacity: 0, y: 30 },
        {
          opacity: 1,
          y: 0,
          duration: 0.85,
          stagger: 0.1,
          ease: 'power3.out'
        },
        0.15
      );
    }

    // 3. Scroll indicator arrives last
    if (elements.scrollIndicator) {
      tl.fromTo(
        elements.scrollIndicator,
        { opacity: 0 },
        { opacity: 1, duration: 0.8, ease: 'power2.out' },
        0.75
      );
    }

    return tl;
  }

  /**
   * Editorial scroll reveal for sections and blocks
   */
  public animateScrollReveal(
    target: HTMLElement | HTMLElement[] | string,
    options: ScrollRevealOptions = {}
  ): gsap.core.Tween | null {
    if (!this.isBrowser || this.prefersReducedMotion) return null;

    const {
      y = 32,
      duration = 0.85,
      delay = 0,
      stagger = 0.08,
      trigger,
      start = 'top 85%',
      ease = 'power2.out'
    } = options;

    return gsap.fromTo(
      target,
      { opacity: 0, y },
      {
        opacity: 1,
        y: 0,
        duration,
        delay,
        stagger,
        ease,
        scrollTrigger: {
          trigger: trigger || (target as any),
          start,
          once: true
        }
      }
    );
  }

  /**
   * Parallax for large editorial images
   */
  public animateParallax(
    image: HTMLElement,
    container: HTMLElement,
    options: ParallaxOptions = {}
  ): gsap.core.Tween | null {
    if (!this.isBrowser || this.prefersReducedMotion || this.isMobile) return null;

    const {
      yPercent = 8,
      scrub = 0.6,
      start = 'top bottom',
      end = 'bottom top'
    } = options;

    return gsap.fromTo(
      image,
      { yPercent: -yPercent },
      {
        yPercent: yPercent,
        ease: 'none',
        scrollTrigger: {
          trigger: container,
          start,
          end,
          scrub
        }
      }
    );
  }

  /**
   * Subtle editorial image reveal (curtain / clip-path style)
   */
  public animateImageReveal(
    image: HTMLElement,
    container: HTMLElement,
    options: { duration?: number; delay?: number } = {}
  ): gsap.core.Tween | null {
    if (!this.isBrowser || this.prefersReducedMotion) return null;

    const { duration = 1.1, delay = 0.1 } = options;

    return gsap.fromTo(
      image,
      {
        clipPath: 'inset(12% 0% 0% 0%)',
        scale: 1.04,
        opacity: 0.85
      },
      {
        clipPath: 'inset(0% 0% 0% 0%)',
        scale: 1.0,
        opacity: 1,
        duration,
        delay,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: container,
          start: 'top 80%',
          once: true
        }
      }
    );
  }
}
