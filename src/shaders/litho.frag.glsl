#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

varying vec2 v_uv;

// Margem da folha em fração do quadro (mantém a proporção da imagem).
const float MARGIN = 0.045;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}

float lum(vec2 uv) {
  return texture2D(u_scene, uv).r;
}

void main() {
  // coordenadas da folha em unidades independentes da resolução (~600 de largura)
  float k = u_resolution.x / 600.0;
  vec2 px = v_uv * u_resolution;
  vec2 p = px / k;

  // deslocamento do "boiling": muda a INK_FPS
  vec2 boil = vec2(hash(vec2(u_seed, 1.7)), hash(vec2(u_seed, 9.2))) * 97.0;

  // papel: fibra e grão estáticos
  // grão da pedra litográfica, mais aberto que o de um papel comum
  float tooth = vnoise(p * 0.5) * 0.45 + vnoise(p * 1.3 + 11.0) * 0.35 + vnoise(p * 3.6 + 3.0) * 0.2;
  vec2 fp = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float fiber = vnoise(vec2(fp.x * 0.06, fp.y * 1.1));
  float cloud = fbm(p * 0.02 + 5.0);
  float paper = 0.875 + 0.045 * (cloud - 0.5) + 0.01 * (fiber - 0.5) + 0.025 * (tooth - 0.5);

  // área impressa com borda irregular
  vec2 d2 = min(v_uv, 1.0 - v_uv) / MARGIN - 1.0;
  float wob = (fbm(p * 0.04 + 3.0) - 0.5) * 0.35 + (vnoise(p * 0.5 + boil * 0.02) - 0.5) * 0.12;
  float inside = smoothstep(-0.06, 0.22, min(d2.x, d2.y) + wob);

  vec2 iuv = (v_uv - MARGIN) / (1.0 - 2.0 * MARGIN);

  // amostragem suave: jitter mínimo e desfoque amplo para tons contínuos
  vec2 jit = (vec2(vnoise(p * 0.3 + boil), vnoise(p * 0.3 + boil + 7.3)) - 0.5) * 0.0012;
  vec2 suv = clamp(iuv + jit, 0.001, 0.999);
  float r = 0.0042;
  float t0 = lum(suv);
  float tb = t0 * 0.2;
  tb += (lum(suv + vec2(r, 0.0)) + lum(suv - vec2(r, 0.0)) +
         lum(suv + vec2(0.0, r * 0.8)) + lum(suv - vec2(0.0, r * 0.8))) * 0.1;
  tb += (lum(suv + vec2(r * 2.0, r * 1.6)) + lum(suv - vec2(r * 2.0, r * 1.6)) +
         lum(suv + vec2(r * 2.0, -r * 1.6)) + lum(suv - vec2(r * 2.0, -r * 1.6))) * 0.1;
  float tone = mix(t0, tb, 0.8);

  // claro-escuro: médios escuros e pretos aveludados, luz onde a cena é clara
  float t = smoothstep(0.1, 0.82, tone);
  t = pow(t, 1.35);
  float ink = 1.0 - t;

  // vinheta interna da imagem
  vec2 ic = iuv - 0.5;
  ink = clamp(ink + 0.12 * smoothstep(0.12, 0.5, dot(ic, ic)), 0.0, 1.0);

  // grão fino da pedra: modula suavemente a densidade, sem cortar em preto/branco
  float liveGrain = vnoise(p * 1.1 + boil) * 0.5 + vnoise(p * 2.6 + boil * 1.3) * 0.5;
  float grain = mix(tooth, liveGrain, 0.25);
  float cov = clamp(ink + (grain - 0.5) * 0.34 * (1.0 - abs(ink * 2.0 - 1.0) * 0.6), 0.0, 1.0);
  // luzes quase brancas voltam ao papel suavemente
  cov *= smoothstep(0.02, 0.2, ink);
  // pretos densos fecham
  cov = max(cov, smoothstep(0.7, 0.92, ink));

  // tinta: preto aveludado com leve variação
  float inkTone = 0.045 + 0.045 * (liveGrain - 0.5) + 0.04 * (1.0 - ink);
  float col = mix(paper, inkTone, cov * inside);

  // u_time só agita levemente a tinta mais densa, quase imperceptível
  col += 0.004 * sin(u_time * 0.7 + cloud * 6.0) * cov;

  gl_FragColor = vec4(vec3(col), 1.0);
}
