// Porte do AgentAudioVisualizerAura (LiveKit/@agents-ui, MIT) para Angular:
// mesmo shader GLSL, mesma máquina de estados do useAgentAudioVisualizerAura.
// Fonte: livekit/components-js — packages/shadcn/components/agents-ui.

import {
  Component, ElementRef, NgZone, OnDestroy, afterNextRender, computed, inject, input, viewChild,
} from '@angular/core';

export type AuraState =
  | 'idle' | 'disconnected' | 'pre-connect-buffering' | 'connecting'
  | 'initializing' | 'listening' | 'thinking' | 'speaking' | 'failed';

const VERT = `attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}`;

// Fragment shader idêntico ao oficial (Shadertoy-style: iResolution/iTime).
const FRAG_BODY = `const float TAU = 6.283185;

// Noise for dithering
vec2 randFibo(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.xx + p.yx) * p.xy);
}

// Tonemap
vec3 Tonemap(vec3 x) {
  x *= 4.0;
  return x / (1.0 + x);
}

// Luma for alpha
float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

// RGB to HSV
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// SDF shapes
float sdCircle(vec2 st, float r) {
  return length(st) - r;
}

float sdLine(vec2 p, float r) {
  float halfLen = r * 2.0;
  vec2 a = vec2(-halfLen, 0.0);
  vec2 b = vec2(halfLen, 0.0);
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float getSdf(vec2 st) {
  if(uShape == 1.0) return sdCircle(st, uScale);
  else if(uShape == 2.0) return sdLine(st, uScale);
  return sdCircle(st, uScale); // Default
}

vec2 turb(vec2 pos, float t, float it) {
  // Initial rotation matrix for swirl direction
  mat2 rotation = mat2(0.6, -0.25, 0.25, 0.9);
  // Secondary rotation applied each iteration (approx 53 degree rotation)
  mat2 layerRotation = mat2(0.6, -0.8, 0.8, 0.6);

  float frequency = mix(2.0, 15.0, uFrequency);
  float amplitude = uAmplitude;
  float frequencyGrowth = 1.4;
  float animTime = t * 0.1 * uSpeed;

  const int LAYERS = 4;
  for(int i = 0; i < LAYERS; i++) {
    // Calculate wave displacement for this layer
    vec2 rotatedPos = pos * rotation;
    vec2 wave = sin(frequency * rotatedPos + float(i) * animTime + it);

    // Apply displacement along rotation direction
    pos += (amplitude / frequency) * rotation[0] * wave;

    // Evolve parameters for next layer
    rotation *= layerRotation;
    amplitude *= mix(1.0, max(wave.x, wave.y), uVariance);
    frequency *= frequencyGrowth;
  }

  return pos;
}

const float ITERATIONS = 36.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  vec3 pp = vec3(0.0);
  vec3 bloom = vec3(0.0);
  float t = iTime * 0.5;
  vec2 pos = uv - 0.5;

  vec2 prevPos = turb(pos, t, 0.0 - 1.0 / ITERATIONS);
  float spacing = mix(1.0, TAU, uSpacing);

  for(float i = 1.0; i < ITERATIONS + 1.0; i++) {
    float iter = i / ITERATIONS;
    vec2 st = turb(pos, t, iter * spacing);
    float d = abs(getSdf(st));
    float pd = distance(st, prevPos);
    prevPos = st;
    float dynamicBlur = exp2(pd * 2.0 * 1.4426950408889634) - 1.0;
    float ds = smoothstep(0.0, uBlur * 0.05 + max(dynamicBlur * uSmoothing, 0.001), d);

    // Shift color based on iteration using uColorScale
    vec3 color = uColor;
    if(uColorShift > 0.01) {
      vec3 hsv = rgb2hsv(color);
      // Shift hue by iteration
      hsv.x = fract(hsv.x + (1.0 - iter) * uColorShift * 0.3);
      color = hsv2rgb(hsv);
    }

    float invd = 1.0 / max(d + dynamicBlur, 0.001);
    pp += (ds - 1.0) * color;
    bloom += clamp(invd, 0.0, 250.0) * color;
  }

  pp *= 1.0 / ITERATIONS;

  vec3 color;

  // Dark mode (default)
  if(uMode < 0.5) {
    // use bloom effect
    bloom = bloom / (bloom + 2e4);
    color = (-pp + bloom * 3.0 * uBloom) * 1.2;
    color += (randFibo(fragCoord).x - 0.5) / 255.0;
    color = Tonemap(color);
    float alpha = luma(color) * uMix;
    fragColor = vec4(color * uMix, alpha);
  }

  // Light mode
  else {
    // no bloom effect
    color = -pp;
    color += (randFibo(fragCoord).x - 0.5) / 255.0;

    // Preserve hue by tone mapping brightness only
    float brightness = length(color);
    vec3 direction = brightness > 0.0 ? color / brightness : color;

    // Reinhard on brightness
    float factor = 2.0;
    float mappedBrightness = (brightness * factor) / (1.0 + brightness * factor);
    color = direction * mappedBrightness;

    // Boost saturation to compensate for white background bleed-through
    // When alpha < 1.0, white bleeds through making colors look desaturated
    // So we increase saturation to maintain vibrant appearance
    float gray = dot(color, vec3(0.2, 0.5, 0.1));
    float saturationBoost = 3.0;
    color = mix(vec3(gray), color, saturationBoost);

    // Clamp between 0-1
    color = clamp(color, 0.0, 1.0);

    float alpha = mappedBrightness * clamp(uMix, 1.0, 2.0);
    fragColor = vec4(color, alpha);
  }
}`;

const FRAG = `precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform float uSpeed,uBlur,uScale,uShape,uFrequency,uAmplitude,uBloom,uMix,uSpacing,uColorShift,uVariance,uSmoothing,uMode;
uniform vec3 uColor;
${FRAG_BODY}
void main(){vec4 c;mainImage(c,gl_FragCoord.xy);gl_FragColor=c;}`;

/** Alvos por estado — tabela fiel ao useAgentAudioVisualizerAura. */
const ALVOS: Record<string, { speed: number; scale: number; amp: number; freq: number; br: number; pulse: [number, number] | null }> = {
  idle:                   { speed: 10, scale: 0.2, amp: 1.2,  freq: 0.4,  br: 1.0, pulse: null },
  failed:                 { speed: 10, scale: 0.2, amp: 1.2,  freq: 0.4,  br: 1.0, pulse: null },
  disconnected:           { speed: 10, scale: 0.2, amp: 1.2,  freq: 0.4,  br: 1.0, pulse: null },
  listening:              { speed: 20, scale: 0.3, amp: 1.0,  freq: 0.7,  br: 1.5, pulse: [1.5, 2.0] },
  'pre-connect-buffering': { speed: 20, scale: 0.3, amp: 1.0,  freq: 0.7,  br: 1.5, pulse: [1.5, 2.0] },
  thinking:               { speed: 30, scale: 0.3, amp: 0.5,  freq: 1.0,  br: 0.5, pulse: [0.5, 2.5] },
  connecting:             { speed: 30, scale: 0.3, amp: 0.5,  freq: 1.0,  br: 0.5, pulse: [0.5, 2.5] },
  initializing:           { speed: 30, scale: 0.3, amp: 0.5,  freq: 1.0,  br: 0.5, pulse: [0.5, 2.5] },
  speaking:               { speed: 70, scale: 0.3, amp: 0.75, freq: 1.25, br: 1.5, pulse: null },
};

const TAM: Record<string, number> = { icon: 24, sm: 56, md: 112, lg: 224, xl: 448 };
const MAX_DPR = 2; // teto de pixel ratio do componente original

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (m) return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  return [0.239, 0.427, 0.71]; // #3d6db5
}

/** Parâmetro animado — aproximação suave (easeOut) do alvo por frame. */
class Param {
  cur: number;
  alvo: number;
  constructor(v: number) { this.cur = v; this.alvo = v; }
  step(dt: number, tau = 0.18): void {
    this.cur += (this.alvo - this.cur) * (1 - Math.exp(-dt / tau));
  }
}

@Component({
  selector: 'app-maria-aura',
  template: '<canvas #cv></canvas>',
  styles: `
    :host { display: block; line-height: 0; }
    canvas { width: 100%; height: 100%; display: block; }
  `,
  host: {
    role: 'img',
    '[attr.aria-label]': 'ariaLabel()',
    '[style.width.px]': 'px()',
    '[style.height.px]': 'px()',
  },
})
export class MariaAuraComponent implements OnDestroy {
  private readonly zone = inject(NgZone);

  /** Mesma API do componente React. */
  readonly size = input<'icon' | 'sm' | 'md' | 'lg' | 'xl'>('lg');
  readonly state = input<AuraState>('connecting');
  readonly color = input<`#${string}` | string>('#3d6db5');
  readonly colorShift = input(0.05);
  readonly themeMode = input<'dark' | 'light'>('dark');
  /** Getter de volume 0..1 — chamado a cada frame (sem custo de CD). */
  readonly volumeSrc = input<() => number>(() => 0);

  readonly px = computed(() => TAM[this.size()] ?? 224);
  readonly ariaLabel = computed(() => `visualização de áudio — ${this.state()}`);

  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');

  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private locs: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private t0 = 0;
  private tPrev = 0;
  private settle = 0;
  private pulseT = 0;

  private readonly speed = new Param(10);
  private readonly scale = new Param(0.2);
  private readonly amp = new Param(1.2);
  private readonly freq = new Param(0.4);
  private readonly br = new Param(1.0);
  private ultimoEstado: AuraState = 'connecting';

  constructor() {
    afterNextRender(() => {
      this.zone.runOutsideAngular(() => this.iniciar());
    });
  }

  private iniciar(): void {
    const canvas = this.cv().nativeElement;
    const gl = canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) return;
    this.gl = gl;

    const prog = this.compilar(gl);
    if (!prog) { this.gl = null; return; }
    this.prog = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    for (const u of ['iResolution', 'iTime', 'uSpeed', 'uBlur', 'uScale', 'uShape', 'uFrequency',
      'uAmplitude', 'uBloom', 'uMix', 'uSpacing', 'uColorShift', 'uVariance', 'uSmoothing',
      'uMode', 'uColor']) {
      this.locs[u] = gl.getUniformLocation(prog, u);
    }

    // Uniforms fixos do componente original (AuraShader defaults + wrapper).
    gl.uniform1f(this.locs['uBlur'], 0.2);
    gl.uniform1f(this.locs['uShape'], 1.0);
    gl.uniform1f(this.locs['uBloom'], 0.0);
    gl.uniform1f(this.locs['uSpacing'], 0.5);
    gl.uniform1f(this.locs['uVariance'], 0.1);
    gl.uniform1f(this.locs['uSmoothing'], 1.0);

    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(canvas);
    this.redimensionar();

    this.t0 = performance.now();
    this.tPrev = this.t0;
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private compilar(gl: WebGLRenderingContext): WebGLProgram | null {
    const mk = (tipo: number, src: string): WebGLShader | null => {
      const s = gl.createShader(tipo);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Aura shader:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = mk(gl.VERTEX_SHADER, VERT);
    const fs = mk(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    if (!p) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Aura link:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  private redimensionar(): void {
    const canvas = this.cv().nativeElement;
    const gl = this.gl;
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  private frame(now: number): void {
    const gl = this.gl;
    if (!gl) return;
    const dt = Math.min(0.1, (now - this.tPrev) / 1000);
    this.tPrev = now;

    const estado = this.state();
    const alvo = ALVOS[estado] ?? ALVOS['idle'];
    if (estado !== this.ultimoEstado) {
      this.ultimoEstado = estado;
      this.settle = 0;
      this.pulseT = 0;
      this.speed.alvo = alvo.speed;
      this.scale.alvo = alvo.scale;
      this.amp.alvo = alvo.amp;
      this.freq.alvo = alvo.freq;
      this.br.alvo = alvo.br;
    }
    this.settle += dt;
    this.pulseT += dt;

    // Transições suaves (~0.5s easeOut do motion/react).
    this.speed.step(dt, 0.12);
    this.amp.step(dt);
    this.freq.step(dt);

    // speaking: após a transição, a escala segue o volume — igual ao hook
    // (scale = 0.2 + 0.2 * volume, sem animação).
    if (estado === 'speaking' && this.settle > 0.5) {
      this.scale.cur = 0.2 + 0.2 * Math.max(0, Math.min(1, this.volumeSrc()()));
      this.scale.alvo = this.scale.cur;
    } else {
      this.scale.step(dt);
    }

    // listening/thinking: brilho pulsa espelhado (0.35s mirror → ciclo 0.7s).
    let brilho = this.br.cur;
    if (alvo.pulse) {
      const [lo, hi] = alvo.pulse;
      brilho = lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.pulseT) / 0.7));
      this.br.cur = brilho;
    } else {
      this.br.step(dt);
      brilho = this.br.cur;
    }

    const rgb = hexToRgb(this.color());
    gl.uniform1f(this.locs['iTime'], (now - this.t0) / 1000);
    gl.uniform3f(this.locs['iResolution'], gl.drawingBufferWidth, gl.drawingBufferHeight, 1);
    gl.uniform1f(this.locs['uSpeed'], this.speed.cur);
    gl.uniform1f(this.locs['uScale'], this.scale.cur);
    gl.uniform1f(this.locs['uFrequency'], this.freq.cur);
    gl.uniform1f(this.locs['uAmplitude'], this.amp.cur);
    gl.uniform1f(this.locs['uMix'], brilho);
    gl.uniform1f(this.locs['uColorShift'], this.colorShift());
    gl.uniform1f(this.locs['uMode'], this.themeMode() === 'light' ? 1 : 0);
    gl.uniform3f(this.locs['uColor'], rgb[0], rgb[1], rgb[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    const gl = this.gl;
    if (gl) {
      if (this.prog) gl.deleteProgram(this.prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.gl = null;
    this.prog = null;
  }
}
