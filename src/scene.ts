// Desenho procedural da cena num Canvas2D offscreen, em tons de cinza.
// Esta imagem nunca é exibida diretamente: serve de entrada para o shader.

import { ASPECT, INK_FPS, STEP_LEN, TOTAL_STEPS, VIEW_W } from "./config";
import type { Phase } from "./state";

// ---------------------------------------------------------------------------
// Ruído determinístico

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash1(i: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash2(x: number, y: number): number {
  return hash1(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663));
}

const fade = (t: number) => t * t * (3 - 2 * t);

function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  return hash1(i) + (hash1(i + 1) - hash1(i)) * fade(f);
}

function fbm1(x: number, oct = 4): number {
  let s = 0;
  let a = 0.5;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise1(x + i * 31.7);
    n += a;
    x *= 2.07;
    a *= 0.5;
  }
  return s / n;
}

function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm2(x: number, y: number, oct = 5): number {
  let s = 0;
  let a = 0.5;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, y);
    n += a;
    x = x * 2.03 + 17.3;
    y = y * 2.03 + 5.1;
    a *= 0.5;
  }
  return s / n;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => fade(clamp((x - a) / (b - a), 0, 1));
const gray = (v: number, a = 1) => {
  const c = Math.round(clamp(v, 0, 1) * 255);
  return a >= 1 ? `rgb(${c},${c},${c})` : `rgba(${c},${c},${c},${a})`;
};

// ---------------------------------------------------------------------------
// Geometria 2D

interface V {
  x: number;
  y: number;
}
const v = (x: number, y: number): V => ({ x, y });
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y);
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y);
const mul = (a: V, k: number): V => v(a.x * k, a.y * k);
const len = (a: V) => Math.hypot(a.x, a.y);
const dirv = (ang: number): V => v(Math.cos(ang), Math.sin(ang));
const vlerp = (a: V, b: V, t: number): V => v(lerp(a.x, b.x, t), lerp(a.y, b.y, t));

// IK de dois segmentos. sign > 0 dobra a junta no sentido anti-horário.
function ik2(root: V, target: V, l1: number, l2: number, sign: number): [V, V] {
  const d0 = sub(target, root);
  const dist = clamp(len(d0), 1e-4, l1 + l2 - 1e-4);
  const base = Math.atan2(d0.y, d0.x);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const a = Math.acos(cosA);
  const joint = add(root, mul(dirv(base + sign * a), l1));
  const end = add(root, mul(dirv(base), dist));
  return [joint, end];
}

// ---------------------------------------------------------------------------
// Montanha: caminho parametrizado por comprimento de arco

const PATH_LEN = TOTAL_STEPS * STEP_LEN;
const BOULDER_R = 0.82;
// cume um pouco à frente do ponto onde a pedra fica no último passo,
// para que ela pare ainda na subida e role de volta
const CREST = PATH_LEN + 1.75;
const DS = 0.02;
const S_MIN = -60;
const S_MAX = CREST + 60;
const N_PTS = Math.ceil((S_MAX - S_MIN) / DS) + 1;

function slopeAngle(s: number): number {
  if (s < 0) return 0.015 * (fbm1(s * 0.2 + 300) - 0.5);
  const u = clamp(s / PATH_LEN, 0, 1);
  const ramp = smooth(0, 5, s);
  const base = lerp(0.2, 0.6, Math.pow(u, 1.2));
  const irregular = 0.2 * (fbm1(s * 0.12) - 0.5) + 0.08 * (fbm1(s * 0.9 + 50) - 0.5);
  const up = (base + irregular) * ramp;
  return up * (1 - smooth(CREST - 3.5, CREST, s)) - 0.55 * smooth(CREST, CREST + 5, s);
}

const PX = new Float32Array(N_PTS);
const PY = new Float32Array(N_PTS);
const PA = new Float32Array(N_PTS);
(() => {
  const i0 = Math.round(-S_MIN / DS);
  PX[i0] = 0;
  PY[i0] = 0;
  PA[i0] = slopeAngle(0);
  for (let i = i0 + 1; i < N_PTS; i++) {
    const s = S_MIN + (i - 0.5) * DS;
    const a = slopeAngle(s);
    PX[i] = PX[i - 1] + Math.cos(a) * DS;
    PY[i] = PY[i - 1] + Math.sin(a) * DS;
    PA[i] = slopeAngle(S_MIN + i * DS);
  }
  for (let i = i0 - 1; i >= 0; i--) {
    const s = S_MIN + (i + 0.5) * DS;
    const a = slopeAngle(s);
    PX[i] = PX[i + 1] - Math.cos(a) * DS;
    PY[i] = PY[i + 1] - Math.sin(a) * DS;
    PA[i] = slopeAngle(S_MIN + i * DS);
  }
})();

interface PathPt {
  p: V;
  a: number;
  t: V; // tangente
  n: V; // normal (para cima)
}

function at(s: number): PathPt {
  const f = clamp((s - S_MIN) / DS, 0, N_PTS - 1.001);
  const i = Math.floor(f);
  const k = f - i;
  const p = v(lerp(PX[i], PX[i + 1], k), lerp(PY[i], PY[i + 1], k));
  const a = lerp(PA[i], PA[i + 1], k);
  const t = dirv(a);
  return { p, a, t, n: v(-t.y, t.x) };
}

// s cujo x no mundo é o dado (x é monotônico em s)
function sAtX(x: number): number {
  let lo = 0;
  let hi = N_PTS - 1;
  if (x <= PX[lo]) return S_MIN;
  if (x >= PX[hi]) return S_MAX;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (PX[m] < x) lo = m;
    else hi = m;
  }
  return S_MIN + (lo + (x - PX[lo]) / (PX[hi] - PX[lo])) * DS;
}

const groundY = (x: number) => at(sAtX(x)).p.y;

// rugosidade visual da superfície (pequena, para os pés não afundarem)
const rough = (s: number) =>
  0.05 * (fbm1(s * 1.1 + 900) - 0.5) + 0.025 * (noise1(s * 7 + 77) - 0.5);

// Pedras embutidas na encosta
interface Rock {
  s: number;
  depth: number;
  w: number;
  h: number;
  rot: number;
  shape: number[];
}
const ROCKS: Rock[] = (() => {
  const rnd = mulberry32(7);
  const out: Rock[] = [];
  for (let s = S_MIN; s < S_MAX; s += 0.8 + rnd() * 2.2) {
    const shape: number[] = [];
    for (let k = 0; k < 11; k++) shape.push(0.55 + rnd() * 0.6);
    out.push({
      s,
      depth: 0.2 + rnd() * 1.8,
      w: 0.3 + rnd() * 0.9,
      h: 0.08 + rnd() * 0.2,
      rot: (rnd() - 0.5) * 0.4,
      shape,
    });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Figura

const THIGH = 0.45;
const SHIN = 0.45;
const LEG = THIGH + SHIN;
const TORSO = 0.5;
const UPPER_ARM = 0.31;
const FOREARM = 0.29;
const ARM = UPPER_ARM + FOREARM + 0.05;
const ANKLE_H = 0.07;
const KNEE_CLEAR = 0.11; // folga mínima do joelho sobre o chão
const FOOT_FRONT = -0.07; // pé da frente ao pousar, relativo ao quadril
const LIGHT = (() => {
  const l = v(0.55, 0.85);
  return mul(l, 1 / len(l));
})();

interface PoseInput {
  fall: number; // 0 subida, 1 queda
  gait: number; // distância percorrida (m) na subida
  breath: number; // fase de respiração (rad)
  stumble: number; // 0..1 envelope do tropeço
  effort: number; // 0..1 envelope do empurrão na subida
  time: number;
}

interface Body {
  hip: V;
  shoulder: V;
  lean: number;
  feet: [V, V]; // tornozelos
  toes: [V, V];
  knees: [V, V];
  footLift: [number, number];
}

// Passada pesada, presa aos cliques: cada clique é meio ciclo em que uma perna
// avança enquanto a outra fica plantada. Parado num clique inteiro, os dois
// pés estão no chão.
function footOffsets(pi: PoseInput): [number, number, number, number] {
  const u = pi.gait / STEP_LEN;
  const res: number[] = [];
  for (let leg = 0; leg < 2; leg++) {
    const k = (u - leg) / 2;
    const p = k - Math.floor(k);
    let off: number;
    let lift = 0;
    if (p < 0.5) {
      // balanço: o pé sai de trás e pousa à frente enquanto o corpo avança
      const f = p * 2;
      const sw = smooth(0.15, 0.85, f);
      off = FOOT_FRONT - STEP_LEN + 2 * STEP_LEN * sw - STEP_LEN * f;
      lift = Math.sin(Math.PI * sw) * 0.06;
    } else {
      // apoio: o pé fica parado no chão e o corpo passa por ele
      off = FOOT_FRONT - STEP_LEN * (p - 0.5) * 2;
    }
    const fallOff = leg === 0 ? 0.3 : -0.48;
    res.push(lerp(off, fallOff, pi.fall), lift * (1 - pi.fall));
  }
  return [res[0], res[1], res[2], res[3]];
}

function bodyAt(sSis: number, pi: PoseInput): Body {
  const base = at(sSis);
  const [o0, l0, o1, l1] = footOffsets(pi);
  const offs = [o0, o1];
  const lifts: [number, number] = [l0, l1];
  const ankleAt = (o: number, lift: number) => {
    const g = at(sSis + o);
    return add(add(g.p, mul(g.n, ANKLE_H)), v(0, lift));
  };
  const reach = LEG * 0.985;

  const stumbleDip = pi.stumble * 0.16;
  const breathe = Math.sin(pi.breath) * 0.006 * (1 - pi.fall);
  const strain = pi.effort * (1 - pi.fall);
  let hipY = base.p.y + lerp(0.76, 0.85, pi.fall) - stumbleDip + breathe - strain * 0.02;
  const hipX = base.p.x;
  // abaixa o quadril se as pernas não alcançam os pés
// o limite vem do pé mais atrás do ciclo, não do pé atual: o quadril fica
    // numa altura estável em vez de subir e descer a cada passo
    const limits: [number, number][] = [
      [offs[0], lifts[0]],
      [offs[1], lifts[1]],
      [lerp(FOOT_FRONT - STEP_LEN, offs[1], pi.fall), 0],
    ];
    for (const [o, lf] of limits) {
      const f = ankleAt(o, lf);
      const dx = hipX - f.x;
      if (Math.abs(dx) < reach) hipY = Math.min(hipY, f.y + Math.sqrt(reach * reach - dx * dx));
    }

  // na encosta íngreme o joelho da frente avança sobre o chão que sobe:
  // o quadril sobe até o joelho ter folga
  for (let it = 0; it < 4; it++) {
    let need = 0;
    for (let i = 0; i < 2; i++) {
      const [knee] = ik2(v(hipX, hipY), ankleAt(offs[i], lifts[i]), THIGH, SHIN, 1);
      need = Math.max(need, KNEE_CLEAR - (knee.y - groundY(knee.x)));
    }
    if (need <= 0.002) break;
    hipY += need;
  }
  const hip = v(hipX, hipY);

  // o pé que ficou fora de alcance escorrega em direção ao quadril
  for (let i = 0; i < 2; i++) {
    if (len(sub(ankleAt(offs[i], lifts[i]), hip)) <= reach) continue;
    let lo = offs[i];
    let hi = 0;
    for (let it = 0; it < 14; it++) {
      const m = (lo + hi) / 2;
      if (len(sub(ankleAt(m, lifts[i]), hip)) > reach) lo = m;
      else hi = m;
    }
    offs[i] = hi;
  }

  const feet: [V, V] = [v(0, 0), v(0, 0)];
  const toes: [V, V] = [v(0, 0), v(0, 0)];
  const knees: [V, V] = [v(0, 0), v(0, 0)];
  for (let i = 0; i < 2; i++) {
    const g = at(sSis + offs[i]);
    const ankle = ankleAt(offs[i], lifts[i]);
    const toeAng = g.a - lifts[i] * 2.5;
    toes[i] = add(ankle, add(mul(dirv(toeAng), 0.19), mul(g.n, -0.04)));
    const [knee, reached] = ik2(hip, ankle, THIGH, SHIN, 1);
    knees[i] = knee;
    toes[i] = add(toes[i], sub(reached, ankle));
    feet[i] = reached;
  }

  const lean =
    lerp(0.62, -0.14, pi.fall) + Math.sin(pi.breath) * 0.012 * (1 - pi.fall) + pi.stumble * 0.18 + strain * 0.08;
  const shoulder = add(hip, mul(dirv(Math.PI / 2 - lean), TORSO));
  return { hip, shoulder, lean, feet, toes, knees, footLift: lifts };
}

const boulderCenter = (s: number) => {
  const g = at(s);
  return add(g.p, mul(g.n, BOULDER_R));
};

const reachFor = (fall: number) => ARM * lerp(0.9, 0.86, fall);

// Distância ao longo do caminho entre Sísifo e a pedra para a pose dada.
// anchor "sis": Sísifo fixo, pedra à frente. anchor "boulder": pedra fixa.
function solveOffset(anchor: "sis" | "boulder", s: number, pi: PoseInput): number {
  const reach = reachFor(pi.fall);
  let lo = 0.2;
  let hi = 4;
  for (let it = 0; it < 18; it++) {
    const m = (lo + hi) / 2;
    const sSis = anchor === "sis" ? s : s - m;
    const sB = anchor === "sis" ? s + m : s;
    const sh = bodyAt(sSis, pi).shoulder;
    const g = len(sub(sh, boulderCenter(sB))) - BOULDER_R - reach;
    if (g > 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

// Corpo orgânico: cada membro é uma cadeia de juntas com um perfil de largura
// para cada lado, assim o músculo salta de um lado só, como num modelo vivo.

type Profile = (u: number) => number;

interface Seg {
  a: V;
  b: V;
  left: Profile; // lado à esquerda da direção a -> b
  right: Profile;
}

const bump = (u: number, c: number, w: number) => Math.exp(-(((u - c) / w) ** 2));

// Curva fechada suave passando pelos pontos médios (B-spline quadrática).
function smoothClosed(pts: V[]): Path2D {
  const p = new Path2D();
  const n = pts.length;
  const m0 = vlerp(pts[n - 1], pts[0], 0.5);
  p.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const m = vlerp(a, pts[(i + 1) % n], 0.5);
    p.quadraticCurveTo(a.x, a.y, m.x, m.y);
  }
  p.closePath();
  return p;
}

function limbPath(segs: Seg[], samples = 7): Path2D {
  const L: V[] = [];
  const R: V[] = [];
  const dirs = segs.map((sg) => {
    const d = sub(sg.b, sg.a);
    return mul(d, 1 / Math.max(1e-6, len(d)));
  });
  segs.forEach((sg, i) => {
    for (let k = i === 0 ? 0 : 1; k <= samples; k++) {
      const u = k / samples;
      let t = dirs[i];
      // na junta, a normal é a bissetriz dos dois segmentos
      if (k === samples && i < segs.length - 1) {
        const m = add(dirs[i], dirs[i + 1]);
        t = mul(m, 1 / Math.max(1e-6, len(m)));
      }
      const nrm = v(-t.y, t.x);
      const c = vlerp(sg.a, sg.b, u);
      L.push(add(c, mul(nrm, sg.left(u))));
      R.push(sub(c, mul(nrm, sg.right(u))));
    }
  });
  const first = segs[0];
  const last = segs[segs.length - 1];
  const t0 = dirs[0];
  const t1 = dirs[dirs.length - 1];
  const r0 = (first.left(0) + first.right(0)) / 2;
  const r1 = (last.left(1) + last.right(1)) / 2;
  const capEnd = add(last.b, mul(t1, r1 * 0.85));
  const capStart = sub(first.a, mul(t0, r0 * 0.85));
  return smoothClosed([...L, capEnd, ...R.reverse(), capStart]);
}

// Tons do modelado, da sombra própria até a luz, e realces de borda.
interface Modeling {
  tones: number[];
  step: number; // deslocamento entre faixas, em metros
  reflect: number; // tom da luz refletida na borda da sombra
  rim: number; // tom do realce raspado na borda da luz
  edge: number; // largura das bordas de luz e de reflexo
}

const NEAR: Modeling = { tones: [0.1, 0.22, 0.38, 0.56, 0.74], step: 0.02, reflect: 0.32, rim: 0.94, edge: 0.012 };
const NEAR_TORSO: Modeling = { ...NEAR, step: 0.04, edge: 0.016 };
const FAR: Modeling = { tones: [0.07, 0.14, 0.24, 0.34], step: 0.02, reflect: 0.2, rim: 0.6, edge: 0.01 };
const HAIR: Modeling = { tones: [0.05, 0.1, 0.16], step: 0.02, reflect: 0.1, rim: 0.42, edge: 0.01 };

// ---------------------------------------------------------------------------
// Partículas da queda

interface Particle {
  p: V;
  vel: V;
  life: number;
  max: number;
  r: number;
  kind: 0 | 1; // 0 poeira, 1 pedrinha
  tone: number;
}

// ---------------------------------------------------------------------------

export interface SceneInput {
  phase: Phase;
  pos: number; // steps
  speed: number; // steps/s
  fallPose: number;
  fallFraction: number;
  effort: number;
  time: number;
  dt: number;
  reducedMotion: boolean;
}

export class Scene {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private sky: HTMLCanvasElement;
  private boulderTex: HTMLCanvasElement;
  private boulderLayer: HTMLCanvasElement;
  private dot: HTMLCanvasElement;
  private cam: V | null = null;
  private particles: Particle[] = [];
  private rnd = mulberry32(1234);
  private stumbleT = -1;
  private lastPhase: Phase = "CLIMBING";
  private fallStartDelta = 0;
  private baseDelta: number;
  private inkClock = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D indisponível");
    this.ctx = ctx;
    this.sky = makeSky();
    this.boulderTex = makeBoulderTexture();
    this.boulderLayer = document.createElement("canvas");
    this.dot = makeDot();
    this.baseDelta = solveOffset("sis", 0, this.pose(0, 0, 0));
    this.fallStartDelta = this.baseDelta;
  }

  resize(w: number): void {
    const width = Math.max(200, Math.round(w));
    const height = Math.round(width / ASPECT);
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private pose(fall: number, gait: number, time: number, effort = 0): PoseInput {
    let stumble = 0;
    if (this.stumbleT >= 0) {
      const k = this.stumbleT / 0.42;
      stumble = k < 1 ? Math.sin(Math.PI * k) * (1 - k * 0.3) : 0;
    }
    return {
      fall,
      gait,
      breath: time * 1.9,
      stumble: stumble * fall,
      effort,
      time,
    };
  }

  draw(inp: SceneInput): HTMLCanvasElement {
    const { ctx, w, h } = this;
    const dt = inp.dt;
    this.inkClock = inp.reducedMotion ? 0 : inp.time;

    // transições
    if (inp.phase === "FALLING" && this.lastPhase !== "FALLING") {
      const climbPose = this.pose(0, inp.pos * STEP_LEN, inp.time);
      this.fallStartDelta = solveOffset("sis", inp.pos * STEP_LEN, climbPose);
    }
    this.lastPhase = inp.phase;

    // tropeços: frequência proporcional à velocidade
    const speedM = inp.speed * STEP_LEN;
    if (this.stumbleT >= 0) {
      this.stumbleT += dt;
      if (this.stumbleT > 0.42) this.stumbleT = -1;
    } else if (inp.phase === "FALLING" && this.rnd() < speedM * 0.03 * dt) {
      this.stumbleT = 0;
    }

    // posições de Sísifo e da pedra
    let sSis: number;
    let sB: number;
    const climbing = inp.phase === "CLIMBING";
    const gait = climbing ? inp.pos * STEP_LEN : 0;
    // envelope do esforço: sobe em ~0,3 s e relaxa devagar
    const e = clamp(inp.effort, 0, 1);
    const effort = fade(Math.min(1, (1 - e) * 3)) * fade(e);
    const pi = this.pose(inp.fallPose, gait, inp.time, effort);
    if (climbing) {
      sSis = inp.pos * STEP_LEN;
      // a pedra segue a postura de repouso; o esforço só dobra os cotovelos
      sB = sSis + solveOffset("sis", sSis, { ...pi, effort: 0, breath: 0 });
    } else {
      const delta =
        inp.phase === "FALLING"
          ? lerp(this.fallStartDelta, this.baseDelta, inp.fallFraction)
          : this.baseDelta;
      sB = inp.pos * STEP_LEN + delta;
      sSis = sB - solveOffset("boulder", sB, pi);
    }
    const body = bodyAt(sSis, pi);
    const bc = boulderCenter(sB);

    // câmera
    const viewH = VIEW_W / ASPECT;
    // na queda o enquadramento abre para o conjunto e compensa o atraso da câmera
    const fb = inp.fallPose;
    const focus = vlerp(body.hip, bc, lerp(0.5, 0.4, fb));
    const fx = 0.5;
    const fy = lerp(0.58, 0.54, fb);
    const target = v(focus.x + (0.5 - fx) * VIEW_W, focus.y + (fy - 0.5) * viewH);
    if (!this.cam) this.cam = target;
    const k = inp.phase === "FALLING" ? 5 : inp.reducedMotion ? 2.4 : 4.5;
    const a = 1 - Math.exp(-k * dt);
    let cam = vlerp(this.cam, target, a);
    const dev = sub(cam, target);
    const maxDev = inp.phase === "FALLING" ? 0.7 : 0.6;
    if (len(dev) > maxDev) cam = add(target, mul(dev, maxDev / len(dev)));
    this.cam = cam;

    const ppm = w / VIEW_W;
    const toWorld = () => ctx.setTransform(ppm, 0, 0, -ppm, w / 2 - cam.x * ppm, h / 2 + cam.y * ppm);
    const x0 = cam.x - VIEW_W / 2 - 1;
    const x1 = cam.x + VIEW_W / 2 + 1;
    const y0 = cam.y - viewH / 2 - 1;

    // céu
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky(cam);

    // cordilheiras distantes
    this.drawRidges(cam);

    // clarão atrás do cume
    toWorld();
    const crest = at(CREST).p;
    const near = smooth(30, 6, Math.abs(crest.x - cam.x));
    if (near > 0) {
      const gc = add(crest, v(1.5, 4));
      const grad = ctx.createRadialGradient(gc.x, gc.y, 0.5, gc.x, gc.y, 10);
      grad.addColorStop(0, gray(1, 0.75 * near));
      grad.addColorStop(0.4, gray(0.95, 0.3 * near));
      grad.addColorStop(1, gray(0.9, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(crest.x - 12, crest.y - 8, 26, 26);
    }

    // montanha
    this.drawGround(x0, x1, y0);

    // pedrinhas e poeira (atrás das figuras)
    this.updateParticles(inp, body, sB, dt);
    this.drawParticles(0);

    // pedra
    this.drawBoulder(bc, sB, cam, ppm);

    // Sísifo
    toWorld();
    this.drawFigure(body, bc, pi);

    // pedrinhas na frente
    this.drawParticles(1);

    return this.canvas;
  }

  private drawSky(cam: V): void {
    const { ctx, w, h } = this;
    const top = at(CREST).p;
    const u = clamp(cam.x / top.x, 0, 1);
    const vv = clamp(cam.y / top.y, 0, 1);
    const sw = this.sky.width / 1.5;
    const sh = this.sky.height / 1.5;
    const sx = (this.sky.width - sw) * u;
    const sy = (this.sky.height - sh) * (1 - vv) * 0.5;
    ctx.drawImage(this.sky, sx, sy, sw, sh, 0, 0, w, h);
  }

  private drawRidges(cam: V): void {
    const { ctx, w, h } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const layers = [
      { y: 0.6, amp: 0.09, tone: 0.6, par: 0.04, f: 0.006 },
      { y: 0.65, amp: 0.08, tone: 0.44, par: 0.09, f: 0.01 },
    ];
    for (const L of layers) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      const off = cam.x * L.par * (w / VIEW_W);
      for (let x = 0; x <= w + 8; x += 8) {
        const n = fbm1((x + off) * L.f * (720 / w) + L.tone * 100, 5);
        ctx.lineTo(x, h * (L.y - L.amp * (n - 0.3) * 2));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = gray(L.tone);
      ctx.fill();
    }
  }

  private drawGround(x0: number, x1: number, y0: number): void {
    const { ctx } = this;
    const s0 = sAtX(x0) - 1;
    const s1 = sAtX(x1) + 1;
    const step = 0.08;
    const surf = new Path2D();
    let first = true;
    for (let s = s0; s <= s1; s += step) {
      const g = at(s);
      const p = add(g.p, mul(g.n, rough(s)));
      if (first) {
        surf.moveTo(p.x, p.y);
        first = false;
      } else surf.lineTo(p.x, p.y);
    }
    const end = at(s1).p;
    const start = at(s0).p;
    const ground = new Path2D(surf);
    ground.lineTo(end.x, y0 - 30);
    ground.lineTo(start.x, y0 - 30);
    ground.closePath();

    // gradiente perpendicular à encosta média visível
    const mid = at((s0 + s1) / 2);
    const g0 = mid.p;
    const g1 = sub(mid.p, mul(mid.n, 6));
    const grad = this.ctx.createLinearGradient(g0.x, g0.y, g1.x, g1.y);
    grad.addColorStop(0, gray(0.36));
    grad.addColorStop(0.08, gray(0.24));
    grad.addColorStop(0.45, gray(0.13));
    grad.addColorStop(1, gray(0.06));
    ctx.fillStyle = grad;
    ctx.fill(ground);

    ctx.save();
    ctx.clip(ground);
    // pedras embutidas: face clara em cima, sombra embaixo
    for (const r of ROCKS) {
      if (r.s < s0 - 2 || r.s > s1 + 2) continue;
      const g = at(r.s);
      const c = sub(add(g.p, mul(g.n, rough(r.s))), mul(g.n, r.depth));
      const shapeAt = (dx: number, dy: number) => {
        const p = new Path2D();
        for (let k = 0; k < r.shape.length; k++) {
          const ang = (k / r.shape.length) * Math.PI * 2;
          const q = v(Math.cos(ang) * r.w * r.shape[k], Math.sin(ang) * r.h * r.shape[k]);
          const rot = g.a + r.rot;
          const pq = v(
            c.x + dx + q.x * Math.cos(rot) - q.y * Math.sin(rot),
            c.y + dy + q.x * Math.sin(rot) + q.y * Math.cos(rot),
          );
          if (k === 0) p.moveTo(pq.x, pq.y);
          else p.lineTo(pq.x, pq.y);
        }
        p.closePath();
        return p;
      };
      const shade = 1 - clamp(r.depth / 2, 0, 1);
      ctx.fillStyle = gray(0.05, 0.7);
      ctx.fill(shapeAt(-0.04, -0.06));
      ctx.fillStyle = gray(lerp(0.14, 0.3, shade));
      ctx.fill(shapeAt(0, 0));
      ctx.fillStyle = gray(lerp(0.2, 0.42, shade), 0.6);
      ctx.fill(shapeAt(0.03, 0.03 + r.h * 0.3));
    }
    ctx.restore();

    // borda iluminada da encosta
    ctx.lineJoin = "round";
    ctx.strokeStyle = gray(0.8);
    ctx.lineWidth = 0.035;
    ctx.stroke(surf);
    ctx.strokeStyle = gray(0.04, 0.85);
    ctx.lineWidth = 0.04;
    ctx.save();
    ctx.translate(0, -0.06);
    ctx.stroke(surf);
    ctx.restore();
  }

  private drawBoulder(c: V, sB: number, cam: V, ppm: number): void {
    const { ctx, w, h } = this;
    const R = BOULDER_R;
    const size = Math.ceil(R * 2.3 * ppm);
    const L = this.boulderLayer;
    if (L.width !== size) {
      L.width = size;
      L.height = size;
    }
    const lc = L.getContext("2d");
    if (!lc) return;
    const half = size / 2;
    // rotação: distância / raio, sentido horário ao subir
    const rot = -sB / R;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "source-over";
    lc.clearRect(0, 0, size, size);
    lc.translate(half, half);
    lc.rotate(-rot);
    const d = R * 2.2 * ppm;
    lc.drawImage(this.boulderTex, -d / 2, -d / 2, d, d);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    // iluminação fixa, vinda do alto à direita
    lc.globalCompositeOperation = "multiply";
    const lx = half + LIGHT.x * R * 0.5 * ppm;
    const ly = half - LIGHT.y * R * 0.5 * ppm;
    const grad = lc.createRadialGradient(lx, ly, R * 0.05 * ppm, half, half, R * 1.15 * ppm);
    grad.addColorStop(0, gray(1));
    grad.addColorStop(0.45, gray(0.72));
    grad.addColorStop(0.85, gray(0.3));
    grad.addColorStop(1, gray(0.18));
    lc.fillStyle = grad;
    lc.fillRect(0, 0, size, size);
    lc.globalCompositeOperation = "destination-in";
    lc.translate(half, half);
    lc.rotate(-rot);
    lc.drawImage(this.boulderTex, -d / 2, -d / 2, d, d);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "source-over";

    // contorno nervoso da pedra, em coordenadas da textura
    const boil = Math.floor(this.inkClock * INK_FPS);
    const ts = d / BOULDER_TEX;
    lc.lineJoin = "round";
    lc.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.translate(half + (hash2(pass, boil) - 0.5) * 2, half + (hash2(pass + 3, boil) - 0.5) * 2);
      lc.rotate(-rot);
      lc.scale(ts, ts);
      lc.translate(-BOULDER_TEX / 2, -BOULDER_TEX / 2);
      lc.setLineDash(pass === 0 ? [60, 6, 34, 5] : [22, 12, 48, 8]);
      lc.lineDashOffset = pass * 17;
      lc.strokeStyle = gray(0.03, pass === 0 ? 0.95 : 0.6);
      lc.lineWidth = (pass === 0 ? 0.05 : 0.03) / ts * ppm;
      lc.stroke(BOULDER_CONTOUR);
    }
    lc.setLineDash([]);
    lc.setTransform(1, 0, 0, 1, 0, 0);

    // sombra de contato no chão
    const g = at(sB);
    ctx.setTransform(ppm, 0, 0, -ppm, w / 2 - cam.x * ppm, h / 2 + cam.y * ppm);
    ctx.save();
    ctx.translate(g.p.x - 0.1, g.p.y + 0.02);
    ctx.rotate(g.a);
    ctx.scale(1, 0.12);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
    sg.addColorStop(0, gray(0.04, 0.85));
    sg.addColorStop(1, gray(0.04, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = w / 2 + (c.x - cam.x) * ppm;
    const sy = h / 2 - (c.y - cam.y) * ppm;
    ctx.drawImage(L, sx - half, sy - half);
  }

  private drawFigure(b: Body, bc: V, pi: PoseInput): void {
    const { ctx } = this;
    const fall = pi.fall;
    const torsoAng = Math.PI / 2 - b.lean;
    const tdir = dirv(torsoAng);
    const back = v(-tdir.y, tdir.x); // lado das costas quando inclinado para frente

    // ombros com leve separação de profundidade
    const shF = add(b.shoulder, mul(back, 0.0));
    const shB = add(add(b.shoulder, mul(back, 0.04)), mul(tdir, 0.015));

    // mãos na pedra
    const toSh = sub(b.shoulder, bc);
    const phi = Math.atan2(toSh.y, toSh.x) - lerp(0.05, 0.35, fall);
    const trem = fall * 0.014;
    const t = pi.time;
    const tremF = v(Math.sin(t * 37) * trem, Math.sin(t * 41 + 1) * trem);
    const tremB = v(Math.sin(t * 33 + 2) * trem, Math.sin(t * 29 + 3) * trem);
    const handF = add(add(bc, mul(dirv(phi - 0.07), BOULDER_R + 0.02)), tremF);
    const handB = add(add(bc, mul(dirv(phi + 0.1), BOULDER_R + 0.02)), tremB);
    const [elbF, wristF] = ik2(shF, handF, UPPER_ARM, FOREARM + 0.05, -1);
    const [elbB, wristB] = ik2(shB, handB, UPPER_ARM, FOREARM + 0.05, -1);
    const wristFi = add(elbF, mul(sub(wristF, elbF), FOREARM / (FOREARM + 0.05)));
    const wristBi = add(elbB, mul(sub(wristB, elbB), FOREARM / (FOREARM + 0.05)));

    // cabeça
    const neck = add(b.shoulder, mul(tdir, 0.04));
    const headTilt =
      lerp(-0.4, -1.0, fall) + Math.sin(pi.breath) * 0.03 * (1 - fall) - pi.effort * (1 - fall) * 0.15;
    const headAng = torsoAng + headTilt;
    const headC = add(neck, mul(dirv(headAng), 0.17));

    // ---- formas
    const leg = (i: number): Path2D => {
      const knee = b.knees[i];
      const ankle = b.feet[i];
      return limbPath([
        {
          a: b.hip,
          b: knee,
          left: (u) => lerp(0.105, 0.055, u) + 0.03 * bump(u, 0.42, 0.24), // quadríceps
          right: (u) => lerp(0.11, 0.05, u) + 0.012 * bump(u, 0.22, 0.2),
        },
        {
          a: knee,
          b: ankle,
          left: (u) => lerp(0.05, 0.03, u) + 0.006 * bump(u, 0.15, 0.15),
          right: (u) => lerp(0.05, 0.027, u) + 0.042 * bump(u, 0.27, 0.17), // panturrilha
        },
      ]);
    };

    const foot = (i: number): Path2D => {
      const ankle = b.feet[i];
      const toe = b.toes[i];
      const fd = sub(toe, ankle);
      const heel = sub(ankle, mul(fd, 0.28));
      return limbPath(
        [
          {
            a: heel,
            b: toe,
            left: (u) => lerp(0.04, 0.016, u) + 0.012 * bump(u, 0.25, 0.2),
            right: (u) => lerp(0.032, 0.012, u),
          },
        ],
        6,
      );
    };

    const arm = (sh: V, elb: V, wr: V, hand: V): Path2D =>
      limbPath([
        {
          a: sh,
          b: elb,
          left: (u) => lerp(0.07, 0.046, u) + 0.035 * bump(u, 0.1, 0.18) + 0.012 * bump(u, 0.55, 0.2), // deltoide
          right: (u) => lerp(0.058, 0.042, u) + 0.02 * bump(u, 0.5, 0.22),
        },
        {
          a: elb,
          b: wr,
          left: (u) => lerp(0.047, 0.029, u) + 0.016 * bump(u, 0.25, 0.2),
          right: (u) => lerp(0.044, 0.027, u) + 0.008 * bump(u, 0.3, 0.2),
        },
        {
          a: wr,
          b: hand,
          left: (u) => lerp(0.028, 0.03, u),
          right: (u) => lerp(0.026, 0.022, u),
        },
      ]);

    const torso = (): Path2D => {
      const a = sub(b.hip, mul(tdir, 0.08));
      const z = add(b.shoulder, mul(tdir, 0.05));
      // "left" aqui é o lado das costas
      return limbPath(
        [
          {
            a,
            b: z,
            left: (u) =>
              0.12 + 0.045 * bump(u, 0.12, 0.13) - 0.01 * bump(u, 0.4, 0.12) + 0.045 * bump(u, 0.74, 0.2) -
              0.05 * smooth(0.9, 1, u),
            right: (u) => 0.11 - 0.01 * bump(u, 0.45, 0.15) + 0.05 * bump(u, 0.76, 0.14) - 0.04 * smooth(0.88, 1, u),
          },
        ],
        14,
      );
    };

    const neckPath = limbPath(
      [
        {
          a: add(b.shoulder, mul(back, 0.02)),
          b: headC,
          left: (u) => lerp(0.07, 0.05, u),
          right: (u) => lerp(0.055, 0.045, u),
        },
      ],
      4,
    );

    // cabeça em coordenadas locais: x para a frente (rosto), y para o alto da cabeça
    const ha = dirv(headAng);
    const hf = v(ha.y, -ha.x);
    const hp = (x: number, y: number) => add(headC, add(mul(hf, x), mul(ha, y)));
    const head = smoothClosed([
      hp(0.07, 0.08),
      hp(0.095, 0.035),
      hp(0.1, 0.005),
      hp(0.125, -0.025),
      hp(0.1, -0.045),
      hp(0.1, -0.07),
      hp(0.07, -0.115),
      hp(0.0, -0.1),
      hp(-0.07, -0.05),
      hp(-0.1, 0.02),
      hp(-0.06, 0.1),
      hp(0.01, 0.12),
    ]);
    // cabelo preto liso em cuia: franja reta na testa, laterais curtas e nuca baixa
    const hh = (x: number, y: number) => hp(x * 0.92, y * 0.92);
    const hair = smoothClosed([
      hh(0.118, 0.035),
      hh(0.122, 0.07),
      hh(0.095, 0.125),
      hh(0.02, 0.16),
      hh(-0.07, 0.15),
      hh(-0.138, 0.09),
      hh(-0.15, 0.0),
      hh(-0.135, -0.075),
      hh(-0.09, -0.075),
      hh(-0.045, -0.035),
      hh(0.0, 0.0),
      hh(0.04, 0.02),
      hh(0.08, 0.03),
    ]);

    // sombra dos pés no chão
    for (let i = 0; i < 2; i++) {
      const g = at(sAtX(b.feet[i].x));
      ctx.save();
      ctx.translate(g.p.x + 0.05, g.p.y);
      ctx.rotate(g.a);
      ctx.scale(1, 0.18);
      ctx.fillStyle = gray(0.05, 0.55 * (1 - clamp(b.footLift[i] * 6, 0, 0.8)));
      ctx.beginPath();
      ctx.arc(0, 0, 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- desenho, de trás para a frente
    const boil = Math.floor(pi.time * INK_FPS);
    let n = 0;
    const draw = (path: Path2D, m: Modeling) => {
      this.contour(path, n++, boil);
      this.model(path, m);
    };
    draw(leg(1), FAR);
    draw(foot(1), FAR);
    draw(arm(shB, elbB, wristBi, handB), FAR);
    // a perna da frente vem antes do tronco para o glúteo cobrir a junção
    draw(leg(0), NEAR);
    draw(foot(0), NEAR);
    draw(torso(), NEAR_TORSO);
    draw(neckPath, NEAR);
    draw(arm(shF, elbF, wristFi, handF), NEAR);
    // a cabeça curvada entre os braços fica por cima, para não sumir
    draw(head, NEAR);
    draw(hair, HAIR);
  }

  // Contorno nervoso: traçado duas vezes, deslocado e quebrado. O preenchimento
  // que vem depois cobre a metade interna e sobra só a linha de fora.
  private contour(path: Path2D, i: number, boil: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      const hx = hash2(i * 7 + pass, boil) - 0.5;
      const hy = hash2(i * 13 + pass, boil + 31) - 0.5;
      ctx.save();
      ctx.translate(hx * 0.014, hy * 0.014);
      ctx.setLineDash(pass === 0 ? [0.5, 0.04, 0.3, 0.03] : [0.2, 0.08, 0.36, 0.05]);
      ctx.lineDashOffset = hash2(i, pass + 5) * 0.8;
      ctx.strokeStyle = gray(0.03, pass === 0 ? 0.95 : 0.55);
      ctx.lineWidth = pass === 0 ? 0.034 : 0.022;
      ctx.stroke(path);
      ctx.restore();
    }
    ctx.restore();
  }

  // Modelado em faixas: cada faixa é a forma deslocada em direção à luz, então
  // a parte que sobra escura é sempre o lado da sombra, seguindo a curvatura.
  private model(path: Path2D, m: Modeling, clipTo?: Path2D): void {
    const { ctx } = this;
    ctx.save();
    if (clipTo) ctx.clip(clipTo);
    ctx.clip(path);
    ctx.fillStyle = gray(m.tones[0]);
    ctx.fill(path);
    for (let i = 1; i < m.tones.length; i++) {
      ctx.save();
      ctx.translate(LIGHT.x * m.step * i, LIGHT.y * m.step * i);
      ctx.fillStyle = gray(m.tones[i]);
      ctx.fill(path);
      ctx.restore();
    }
    // luz refletida na borda da sombra e realce raspado na borda da luz
    for (const [sign, tone] of [
      [1, m.reflect],
      [-1, m.rim],
    ] as const) {
      ctx.save();
      ctx.translate(LIGHT.x * m.edge * sign, LIGHT.y * m.edge * sign);
      const outside = new Path2D();
      outside.rect(-1e3, -1e3, 3e3, 3e3);
      outside.addPath(path);
      ctx.fillStyle = gray(tone);
      ctx.fill(outside, "evenodd");
      ctx.restore();
    }
    ctx.restore();
  }

  private updateParticles(inp: SceneInput, b: Body, sB: number, dt: number): void {
    const speedM = inp.speed * STEP_LEN;
    if (inp.phase === "FALLING" && speedM > 0.05) {
      const rate = Math.min(140, speedM * 9 + 6);
      let n = rate * dt;
      while (n > 0) {
        if (n < 1 && this.rnd() > n) break;
        n -= 1;
        const src = this.rnd() < 0.7 ? b.feet[this.rnd() < 0.5 ? 0 : 1] : at(sB).p;
        const dust = this.rnd() < 0.85;
        this.particles.push({
          p: add(src, v((this.rnd() - 0.5) * 0.3, this.rnd() * 0.1)),
          vel: dust
            ? v((this.rnd() - 0.3) * 0.8, 0.3 + this.rnd() * 0.9)
            : v((this.rnd() - 0.5) * 1.5, 0.4 + this.rnd() * 1.4),
          life: 0,
          max: dust ? 1.2 + this.rnd() * 1.6 : 1 + this.rnd(),
          r: dust ? 0.2 + this.rnd() * 0.3 : 0.025 + this.rnd() * 0.04,
          kind: dust ? 0 : 1,
          tone: dust ? 0.5 + this.rnd() * 0.15 : 0.1 + this.rnd() * 0.25,
        });
      }
      if (this.particles.length > 320) this.particles.splice(0, this.particles.length - 320);
    }
    for (const p of this.particles) {
      p.life += dt;
      if (p.kind === 0) {
        p.vel = mul(p.vel, Math.exp(-1.5 * dt));
        p.p = add(p.p, mul(p.vel, dt));
        p.r += dt * 0.35;
      } else {
        p.vel.y -= 9.8 * dt;
        p.p = add(p.p, mul(p.vel, dt));
        const gy = groundY(p.p.x) + p.r;
        if (p.p.y < gy) {
          p.p.y = gy;
          p.vel = v(p.vel.x * 0.6, Math.abs(p.vel.y) * 0.35);
        }
      }
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  private drawParticles(kind: 0 | 1): void {
    const { ctx, w, h } = this;
    const cam = this.cam;
    if (!cam) return;
    const ppm = w / VIEW_W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of this.particles) {
      if (p.kind !== kind) continue;
      const x = w / 2 + (p.p.x - cam.x) * ppm;
      const y = h / 2 - (p.p.y - cam.y) * ppm;
      const k = p.life / p.max;
      if (kind === 0) {
        const r = p.r * ppm;
        ctx.globalAlpha = 0.7 * (1 - k) * Math.min(1, 0.4 + p.life * 12);
        ctx.drawImage(this.dot, x - r, y - r, r * 2, r * 2);
      } else {
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = gray(p.tone);
        const r = p.r * ppm;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.75, p.max * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Texturas geradas uma vez

function makeSky(): HTMLCanvasElement {
  const W = 720;
  const H = 480;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(W, H);
  // abertura de luz no alto à direita
  const ox = 0.72;
  const oy = 0.3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const vv = y / H;
      const px = u * 6;
      const py = vv * 4;
      const wx = fbm2(px * 0.7 + 3, py * 0.7, 4);
      const wy = fbm2(px * 0.7 + 11, py * 0.7 + 7, 4);
      const n = fbm2(px * 1.2 + wx * 2.4, py * 0.9 + wy * 2.4, 6);
      const dx = (u - ox) / 0.2;
      const dy = (vv - oy) / 0.13;
      const glow = Math.exp(-(dx * dx + dy * dy));
      const ex = Math.abs(u - 0.5) * 2;
      const ey = Math.abs(vv - 0.45) * 2;
      const edge = Math.min(1, Math.pow(ex, 2.2) * 0.7 + Math.pow(ey, 2) * 0.8);
      const dens = smooth(0.38, 0.62, n + edge * 0.45 - glow * 0.45 + 0.06);
      const lit = smooth(0.3, 0.7, fbm2(px * 2 + 40, py * 2, 3)) * (1 - dens) * 0.25;
      const inner = fbm2(px * 3 + 20, py * 3 + wx * 2, 4) - 0.5;
      let l = lerp(0.84, 0.36, dens) + inner * 0.26 * dens + glow * 0.25 + lit - edge * 0.12;
      // bordas iluminadas das nuvens voltadas para a abertura
      l += glow * dens * (1 - dens) * 0.6;
      l = clamp(l, 0.05, 1);
      const i = (y * W + x) * 4;
      const g = Math.round(l * 255);
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const BOULDER_TEX = 256;
const BOULDER_CONTOUR = new Path2D();

function makeBoulderTexture(): HTMLCanvasElement {
  const S = BOULDER_TEX;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const R = (S / 2) * (1 / 1.1);
  const cx = S / 2;
  const cy = S / 2;
  const contour = BOULDER_CONTOUR;
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = R * (1 + 0.06 * (fbm1(Math.cos(a) * 2 + 5 + Math.sin(a) * 1.3, 3) - 0.5) * 2);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) contour.moveTo(x, y);
    else contour.lineTo(x, y);
  }
  contour.closePath();
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm2(x * 0.03, y * 0.03, 5);
      const m = fbm2(x * 0.12 + 50, y * 0.12, 3);
      let l = 0.62 + (n - 0.5) * 0.45 + (m - 0.5) * 0.15;
      // fissuras
      const crack = Math.abs(fbm2(x * 0.035 + 9, y * 0.05 + 3, 4) - 0.5);
      const mask = smooth(0.55, 0.7, fbm2(x * 0.02 + 70, y * 0.02, 2));
      l *= 1 - (1 - smooth(0.004, 0.016, crack)) * mask * 0.55;
      const i = (y * S + x) * 4;
      const g = Math.round(clamp(l, 0, 1) * 255);
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = S;
  tmp.height = S;
  tmp.getContext("2d")?.putImageData(img, 0, 0);
  ctx.save();
  ctx.clip(contour);
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
  return c;
}

function makeDot(): HTMLCanvasElement {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, gray(0.62, 0.8));
  g.addColorStop(0.5, gray(0.6, 0.35));
  g.addColorStop(1, gray(0.6, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

