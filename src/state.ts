import {
  FALL_ACCEL,
  FALL_DECEL,
  FALL_MAX_MS,
  FALL_MIN_MS,
  FALL_SPEED_MAX,
  IDLE_TIMEOUT_MS,
  EFFORT_DECAY_S,
  PUSH_OMEGA,
  SETTLE_MS,
  TOTAL_STEPS, MAX_LEAD, MAX_STEP_ACCEL, MAX_STEP_RATE } from "./config";

export type Phase = "CLIMBING" | "FALLING" | "SETTLING";

// Perfil de velocidade trapezoidal (acelera, cruza, freia) para uma distância d.
interface FallProfile {
  ta: number;
  tc: number;
  tb: number;
  vp: number;
  d: number;
}

function makeProfile(d: number): FallProfile {
  const a = FALL_ACCEL;
  const b = FALL_DECEL;
  const v = FALL_SPEED_MAX;
  const dA = (v * v) / (2 * a);
  const dB = (v * v) / (2 * b);
  let vp = v;
  let tc = 0;
  if (dA + dB > d) {
    vp = Math.sqrt((2 * d * a * b) / (a + b));
  } else {
    tc = (d - dA - dB) / v;
  }
  return { ta: vp / a, tc, tb: vp / b, vp, d };
}

function profileDuration(p: FallProfile): number {
  return p.ta + p.tc + p.tb;
}

// Distância percorrida e velocidade no tempo físico tau (s).
function profileAt(p: FallProfile, tau: number): [number, number] {
  const a = FALL_ACCEL;
  const b = FALL_DECEL;
  if (tau <= 0) return [0, 0];
  if (tau < p.ta) return [0.5 * a * tau * tau, a * tau];
  const xa = 0.5 * a * p.ta * p.ta;
  if (tau < p.ta + p.tc) return [xa + p.vp * (tau - p.ta), p.vp];
  const u = Math.min(tau - p.ta - p.tc, p.tb);
  const x = xa + p.vp * p.tc + p.vp * u - 0.5 * b * u * u;
  return [Math.min(x, p.d), Math.max(0, p.vp - b * u)];
}

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const smootherstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const log = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log("[state]", ...args);
};

export class SisyphusState {
  phase: Phase = "CLIMBING";
  targetSteps = 0;
  visualSteps = 0;
  // velocidade da posição visual (steps/s), da mola do empurrão
  visualVel = 0;
  // 0..1, sobe a cada empurrão e se dissipa em EFFORT_DECAY_S
  effort = 0;
  // relógio interno (s), só avança enquanto a página está visível
  time = 0;
  lastInputAt = 0;
  phaseStart = 0;

  // posição do conjunto em steps (na subida é a de Sísifo, na queda a da pedra)
  pos = 0;
  // velocidade da queda em steps/s (módulo)
  speed = 0;
  // 0 = pose de subida, 1 = pose de queda
  fallPose = 0;
  // fração da distância de queda já percorrida
  fallFraction = 0;
  fallFrom = 0;

  private profile: FallProfile = makeProfile(0);
  private fallDuration = 0;
  private fallTimeScale = 1;

  constructor(initialSteps = 0) {
    const s = Math.max(0, Math.min(TOTAL_STEPS, Math.floor(initialSteps)));
    this.targetSteps = s;
    this.visualSteps = s;
    this.pos = s;
  }

  step(): boolean {
    if (this.phase !== "CLIMBING") return false;
    this.lastInputAt = this.time;
    this.effort = 1;
    // cliques além do que o passo natural acompanha são absorvidos
    if (this.targetSteps - this.visualSteps >= MAX_LEAD) return true;
    if (this.targetSteps < TOTAL_STEPS) this.targetSteps += 1;
    return true;
  }

  resetIdle(): void {
    this.lastInputAt = this.time;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time - this.phaseStart;

    switch (this.phase) {
      case "CLIMBING": {
        // mola criticamente amortecida: o empurrão começa devagar e assenta
        const w = PUSH_OMEGA;
        const x = this.visualSteps - this.targetSteps;
        const acc = Math.min(-w * w * x - 2 * w * this.visualVel, MAX_STEP_ACCEL);
        this.visualVel = Math.min(this.visualVel + acc * dt, MAX_STEP_RATE);
        this.visualSteps += this.visualVel * dt;
        if (this.visualSteps > this.targetSteps) {
          this.visualSteps = this.targetSteps;
          this.visualVel = 0;
        }
        if (Math.abs(this.targetSteps - this.visualSteps) < 0.002 && Math.abs(this.visualVel) < 0.01) {
          this.visualSteps = this.targetSteps;
          this.visualVel = 0;
        }
        this.effort = Math.max(0, this.effort - dt / EFFORT_DECAY_S);
        this.pos = this.visualSteps;
        this.speed = 0;
        this.fallPose = 0;

        const atTop =
          this.targetSteps >= TOTAL_STEPS && this.visualSteps >= TOTAL_STEPS - 0.01;
        const idle =
          this.targetSteps > 0 && (this.time - this.lastInputAt) * 1000 > IDLE_TIMEOUT_MS;
        if (atTop || idle) this.startFall(atTop ? "cume" : "inatividade");
        break;
      }

      case "FALLING": {
        const tau = Math.min(t, this.fallDuration) * this.fallTimeScale;
        const [x, v] = profileAt(this.profile, tau);
        this.pos = Math.max(0, this.fallFrom - x);
        this.speed = v * this.fallTimeScale;
        this.fallFraction = this.profile.d > 0 ? x / this.profile.d : 1;
        this.fallPose = smoothstep(t / 0.45);
        if (t >= this.fallDuration) {
          this.pos = 0;
          this.speed = 0;
          this.fallFraction = 1;
          this.setPhase("SETTLING");
          this.targetSteps = 0;
          this.visualSteps = 0;
        }
        break;
      }

      case "SETTLING": {
        this.pos = 0;
        this.speed = 0;
        this.fallPose = 1 - smootherstep((t * 1000) / SETTLE_MS);
        if (t * 1000 >= SETTLE_MS) {
          this.fallPose = 0;
          this.fallFraction = 0;
          this.setPhase("CLIMBING");
          this.lastInputAt = this.time;
        }
        break;
      }
    }
  }

  private startFall(reason: string): void {
    this.visualVel = 0;
    this.effort = 0;
    this.fallFrom = this.visualSteps;
    this.targetSteps = Math.round(this.visualSteps);
    this.profile = makeProfile(this.fallFrom);
    const natural = profileDuration(this.profile);
    const dur = Math.min(FALL_MAX_MS, Math.max(FALL_MIN_MS, natural * 1000)) / 1000;
    this.fallDuration = dur;
    this.fallTimeScale = natural / dur;
    this.fallFraction = 0;
    this.setPhase("FALLING");
    log(`queda por ${reason}, de ${this.fallFrom.toFixed(1)} steps em ${dur.toFixed(2)} s`);
  }

  private setPhase(p: Phase): void {
    log(`${this.phase} -> ${p}`);
    this.phase = p;
    this.phaseStart = this.time;
  }
}
