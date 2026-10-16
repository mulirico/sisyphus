import { INK_FPS, MAX_DPR, MAX_SCENE_W } from "./config";
import { bindInput } from "./input";
import { Litho } from "./litho";
import { Scene } from "./scene";
import { SisyphusState } from "./state";

function start(): void {
  const canvas = document.getElementById("c") as HTMLCanvasElement | null;
  const device = document.querySelector<HTMLElement>(".device");
  const screen = document.querySelector<HTMLElement>(".screen");
  if (!canvas || !screen) return;

  let litho: Litho;
  let scene: Scene;
  try {
    litho = new Litho(canvas);
    scene = new Scene();
  } catch (err) {
    // a tela fica vazia, sem mensagem
    console.error(err);
    canvas.style.display = "none";
    return;
  }

  let initialSteps = 0;
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get("steps");
    if (q) initialSteps = Number(q) || 0;
  }
  const state = new SisyphusState(initialSteps);
  bindInput(screen, () => {
    if (!state.step()) return false;
    device?.classList.remove("is-idle");
    return true;
  });

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  motionQuery.addEventListener?.("change", (e) => {
    reducedMotion = e.matches;
  });

  let bw = 0;
  let bh = 0;
  // o tamanho em CSS vem da .screen; aqui só ajustamos o buffer ao DPR
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const nw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const nh = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (nw === bw && nh === bh) return;
    bw = nw;
    bh = nh;
    canvas.width = bw;
    canvas.height = bh;
    scene.resize(Math.min(bw, MAX_SCENE_W));
  };
  resize();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(canvas);
  }
  window.addEventListener("resize", resize);

  let shownPhase = "";
  const syncPhase = () => {
    if (state.phase === shownPhase) return;
    // depois de cair e se recompor, a tecla volta a se oferecer
    if (shownPhase === "SETTLING" && state.phase === "CLIMBING") device?.classList.add("is-idle");
    shownPhase = state.phase;
    if (device) device.dataset.phase = state.phase.toLowerCase();
  };

  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - last, 50) / 1000;
    last = now;
    state.update(dt);
    syncPhase();
    const img = scene.draw({
      phase: state.phase,
      pos: state.pos,
      speed: state.speed,
      fallPose: state.fallPose,
      fallFraction: state.fallFraction,
      effort: state.effort,
      time: state.time,
      dt,
      reducedMotion,
    });
    const seed = reducedMotion ? 0 : Math.floor(state.time * INK_FPS) % 997;
    litho.render(img, bw, bh, state.time, seed);
  };

  const run = () => {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      // tempo oculto não conta como inatividade
      state.resetIdle();
      run();
    }
  });

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try {
      litho = new Litho(canvas);
      run();
    } catch (err) {
      console.error(err);
    }
  });

  run();
}

start();
