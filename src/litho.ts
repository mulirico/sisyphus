import vertSrc from "./shaders/quad.vert.glsl?raw";
import fragSrc from "./shaders/litho.frag.glsl?raw";

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader falhou");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader: ${info}`);
  }
  return sh;
}

// Aplica o shader de litografia sobre a imagem da cena.
export class Litho {
  private gl: WebGLRenderingContext;
  private tex: WebGLTexture;
  private uRes: WebGLUniformLocation | null;
  private uTime: WebGLUniformLocation | null;
  private uSeed: WebGLUniformLocation | null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL indisponível");
    this.gl = gl;

    const prog = gl.createProgram();
    if (!prog) throw new Error("createProgram falhou");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture falhou");
    this.tex = tex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.uniform1i(gl.getUniformLocation(prog, "u_scene"), 0);

    this.uRes = gl.getUniformLocation(prog, "u_resolution");
    this.uTime = gl.getUniformLocation(prog, "u_time");
    this.uSeed = gl.getUniformLocation(prog, "u_seed");
  }

  render(scene: HTMLCanvasElement, width: number, height: number, time: number, seed: number): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    gl.viewport(0, 0, width, height);
    gl.uniform2f(this.uRes, width, height);
    gl.uniform1f(this.uTime, time);
    gl.uniform1f(this.uSeed, seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
