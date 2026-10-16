// Constantes ajustáveis do projeto.

// Progresso e ritmo
export const TOTAL_STEPS = 100; // cliques até o topo
export const IDLE_TIMEOUT_MS = 8000; // tempo parado até a pedra cair
export const PUSH_OMEGA = 5; // rigidez da mola que leva a posição visual ao alvo (rad/s)
export const EFFORT_DECAY_S = 0.9; // tempo para o esforço de um empurrão se dissipar
export const MAX_STEP_RATE = 2.8; // teto da velocidade de subida, em passos/s (~1 m/s)
export const MAX_STEP_ACCEL = 14; // teto da aceleração de subida, em passos/s²
export const MAX_LEAD = 2.5; // quanto o alvo pode passar da posição visual; cliques além disso são absorvidos // tempo para o esforço de um empurrão se dissipar

// Cena (unidades de mundo em metros)
export const PATH_LEN = 35; // comprimento da encosta da base ao último passo
export const STEP_LEN = PATH_LEN / TOTAL_STEPS; // avanço por passo ao longo da encosta
export const VIEW_W = 5.5; // largura do mundo visível no quadro
export const ASPECT = 3 / 2; // largura / altura do quadro
export const MAX_SCENE_W = 900; // largura máxima do canvas offscreen
export const MAX_DPR = 2;

// Queda, definida em metros e convertida para steps. Calibrada para que uma
// queda do cume dure cerca de 5,5 s; quedas curtas são esticadas até FALL_MIN_MS.
export const FALL_ACCEL = 4 / STEP_LEN; // aceleração inicial da pedra na queda (4 m/s²)
export const FALL_DECEL = 8 / STEP_LEN; // frenagem ao chegar na base (8 m/s²)
export const FALL_SPEED_MAX = 9 / STEP_LEN; // velocidade máxima da descida (9 m/s)
export const FALL_MIN_MS = 1500; // duração mínima da queda
export const FALL_MAX_MS = 6000; // duração máxima (queda do cume)
export const SETTLE_MS = 1200; // recomposição na base antes de recomeçar

// Tinta
export const INK_FPS = 10; // taxa de "tremor" do grão e do traço
