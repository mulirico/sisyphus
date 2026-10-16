# Projeto: Sísifo — plano de execução

## Objetivo
Página web estática cujo único conteúdo visível é um retângulo renderizado em
WebGL, mostrando Sísifo empurrando uma pedra montanha acima, em preto e branco,
com estética de litografia romântica do século XIX (crayon litográfico,
claro-escuro dramático, à maneira das litografias de Delacroix para o Fausto).
O usuário faz Sísifo avançar pela seta para cima ou clicando na tela.
Quando a pedra cai, ela arrasta Sísifo montanha abaixo, e ele não a solta.

O jogo fica numa tela pequena e horizontal dentro de um aparelho portátil
escuro e minimalista. Nenhum texto na página: a única pista de como jogar é
uma tecla de seta para cima desenhada ao lado da tela, que se aperta sozinha
até o primeiro input.

## Restrições
- Zero dependências de runtime. Dev: apenas `vite` e `typescript`.
- Sem framework (sem React/Next). TypeScript puro.
- WebGL1 puro, sem bibliotecas (sem three.js, sem regl).
- Paleta estritamente monocromática: só tons de cinza, sem cor.
- Nenhum asset externo (sem imagens, fontes ou requisições de rede).
  Toda a arte é gerada proceduralmente.
- Inspirado no estilo, sem reproduzir nenhuma ilustração existente.
- Build final: arquivos estáticos (`dist/`) servíveis por qualquer host.

## Estrutura de arquivos
index.html
src/main.ts        — bootstrap, loop requestAnimationFrame, resize
src/config.ts      — constantes ajustáveis
src/state.ts       — máquina de estados e lógica de progresso (sem desenho)
src/input.ts       — pointer + teclado, emite eventos "step"
src/scene.ts       — desenho procedural num Canvas2D OFFSCREEN (nunca exibido),
                     usado apenas como textura de entrada do shader
src/litho.ts       — setup WebGL, upload da textura, aplica o shader
src/shaders/litho.frag.glsl, src/shaders/quad.vert.glsl

## Layout
- `index.html`: `main.device` com `.screen` (o `<canvas>`) e a tecla `#up`,
  um keycap de seta para cima desenhado em CSS. Nenhum texto visível.
- `body`: fundo quase preto com brilho radial sutil, aparelho centralizado.
- `.device`: horizontal, tela à esquerda e tecla à direita; em viewport em pé
  a tecla vai para baixo da tela. Cantos arredondados, sombra em camadas.
- `.screen`: paisagem 3:2, largura de até 560px, limitada pela viewport,
  cantos arredondados e reflexo de vidro. O canvas ocupa a tela inteira e o
  buffer acompanha o tamanho do canvas via ResizeObserver.
- Pistas sem texto: enquanto ninguém interagiu (`.is-idle`), a tecla afunda
  sozinha num loop lento e a borda da tela pulsa. A pista volta depois de
  cada queda. Clique na tela gera uma onda no ponto clicado.
- Tecla apagada e cursor padrão na tela durante FALLING e SETTLING.
- `aria-label` no canvas é permitido (não aparece na tela).
- Renderizar em resolução de devicePixelRatio (limitar a 2x).
- `touch-action: manipulation`, `user-select: none`, cursor de clique na tela.
- `prefers-reduced-motion`: sem loop da tecla, sem pulso e sem onda.
- Se WebGL não estiver disponível: não renderizar nada além do fundo cinza.
  Nenhuma mensagem na tela; logar apenas no console.

## config.ts (valores iniciais)
TOTAL_STEPS = 100           // cliques até o topo
PATH_LEN = 35               // metros de encosta; STEP_LEN = 0,35 m por clique
IDLE_TIMEOUT_MS = 8000      // tempo parado até a pedra cair
PUSH_OMEGA = 5              // mola criticamente amortecida de cada empurrão
EFFORT_DECAY_S = 0.9        // duração da postura de esforço após um clique
VIEW_W = 5.5, ASPECT = 3/2  // quadro horizontal
FALL_ACCEL = 4 m/s²         // definidos em metros e convertidos para steps
FALL_DECEL = 8 m/s²
FALL_SPEED_MAX = 9 m/s      // queda do cume em cerca de 5,5 s
FALL_MIN_MS = 1500          // duração mínima da queda (queda curta, idle cedo)
FALL_MAX_MS = 6000          // duração máxima (queda do cume)
SETTLE_MS = 1200            // recomposição na base antes de recomeçar
INK_FPS = 10                // taxa de "tremor" do grão/traço, efeito feito à mão


## Entrada (input.ts)
- `pointerdown` na `.screen` gera 1 step. A tecla desenhada `#up` também
  gera 1 step no `click`, por representar a seta. Clicar em outro ponto da
  página não faz nada.
- `keydown` com `key === "ArrowUp"` gera 1 step, IGNORANDO eventos com
  `event.repeat === true` (segurar a tecla não conta).
- `preventDefault` na seta para não rolar a página. Todo step aceito afunda
  a tecla desenhada, venha de onde vier.
- Input é ignorado nos estados FALLING e SETTLING.

## Máquina de estados (state.ts)
Estados: CLIMBING → FALLING → SETTLING → CLIMBING

- CLIMBING:
  - Cada step: `targetSteps += 1`, `lastInputAt = now`.
  - `visualSteps` vai até `targetSteps` por uma mola criticamente amortecida
    (PUSH_OMEGA): cada clique é um empurrão curto que começa devagar e assenta
    em cerca de 0,8 s. Sísifo para quando os cliques param.
  - Cada step põe `effort = 1`, que decai em EFFORT_DECAY_S.
  - Se `targetSteps >= TOTAL_STEPS` e a posição visual chegou ao topo
    → FALLING.
  - Se `now - lastInputAt > IDLE_TIMEOUT_MS` e `targetSteps > 0` → FALLING.
- FALLING: a pedra perde o equilíbrio e começa a rolar montanha abaixo,
  arrastando Sísifo junto. Ele NÃO solta a pedra:
  - Sísifo e pedra descem como um conjunto. A posição da pedra é dirigida
    pela física da descida (aceleração até FALL_SPEED_MAX); Sísifo fica
    sempre logo abaixo dela na encosta, sendo empurrado.
  - Ele desce de costas para a descida, ainda de frente para a pedra e para
    o cume, deslizando para trás.
  - A duração escala com a distância a percorrer, limitada entre
    FALL_MIN_MS e FALL_MAX_MS, para que uma queda do cume e uma queda
    curta por inatividade tenham ritmo coerente.
  - Ao chegar à base, a pedra perde velocidade e para encostada nele.
  → SETTLING.
- SETTLING: Sísifo e a pedra parados na base, já na posição inicial.
  Ele se recompõe lentamente (endireita o corpo, volta à postura de empurrar)
  durante SETTLE_MS. `targetSteps = visualSteps = 0`.
  Sem fade e sem corte: a continuidade da cena é a punição.
  → CLIMBING.
- Estado inicial: CLIMBING com 0 passos, Sísifo parado na base.
- Sem persistência: recarregar a página recomeça do zero.

## Cena (scene.ts) — Canvas2D offscreen em tons de cinza
- Montanha: caminho definido por `slope(x)` com inclinação crescente e
  irregularidades (ruído determinístico, seed fixa). Comprimento total
  mapeado para TOTAL_STEPS. O cume só aparece nos últimos ~5% do percurso.
- Céu: massas de nuvem pesadas e turbulentas (ruído), escuras nas bordas,
  com uma abertura de luz atrás do cume, contraluz dramático típico
  da litografia romântica.
- Sísifo: nu heroico, cada membro desenhado como uma silhueta contínua ao
  longo das juntas, com perfil de largura próprio de cada lado (quadríceps,
  panturrilha, deltoide, costas e peito saltam de um lado só).
  - Modelado em faixas: a forma é preenchida várias vezes deslocada em direção
    à luz, então a sombra própria acompanha a curvatura. Luz refletida na borda
    da sombra e realce raspado na borda da luz.
  - Cabeça curvada entre os braços, com cabelo e barba escuros, desenhada por
    cima do braço da frente para continuar legível.
  - Pose de subida (CLIMBING): corpo inclinado ~35° contra a pedra, braços
    estendidos. A passada é presa aos cliques: cada clique é meio ciclo em que
    uma perna avança enquanto a outra fica plantada; parado, os dois pés estão
    no chão. Leve respiração parado.
  - O quadril sobe o necessário para o joelho manter KNEE_CLEAR de folga sobre
    a encosta; o pé que sai do alcance escorrega em direção ao quadril.
  - A cada empurrão, `effort` inclina mais o tronco, baixa o quadril e afunda
    a cabeça, e a pose relaxa devagar. A pedra segue a pose de repouso e os
    cotovelos absorvem o esforço, para ela não ir e voltar a cada clique.
  - Valores: figura clara contra fundo e chão escuros, com contorno escuro
    traçado duas vezes, deslocado e quebrado.
  - Pose de queda (FALLING), interpolada a partir da pose de subida:
    - Tronco inclinado para trás contra a pedra, resistindo ao peso.
    - Braços estendidos para cima/à frente, mãos espalmadas na pedra,
      tentando segurá-la; braços tremem levemente pelo esforço.
    - Pernas rígidas e afastadas, pés escorregando na encosta em vez de
      caminhar; tropeções ocasionais (joelho dobra e se recupera),
      com frequência proporcional à velocidade.
    - Cabeça baixa ou tombada entre os braços.
  - Pose de recomposição (SETTLING): interpolação lenta da pose de queda
    de volta à pose de subida.
- Pedra: grande (≈ altura do Sísifo), contorno irregular, iluminada pelo alto,
  com o mesmo contorno nervoso da figura.
  Rotação = distância / raio, em sentido inverso durante a queda.
- Rastro da queda: poeira e pequenas pedras soltas atrás dos pés,
  desenhadas em tons médios para o shader transformar em manchas de crayon.
- Câmera:
  - Na subida, segue Sísifo mantendo-o no terço inferior esquerdo, com a
    encosta subindo em diagonal para a direita. Movimento suavizado.
  - Na queda, segue o conjunto Sísifo + pedra com leve atraso e se acomoda
    no enquadramento inicial ao chegar à base.
- Saída: imagem em tons de cinza com valores bem separados (escuro/médio/claro),
  que o shader interpreta.

## Shader de litografia (litho.frag.glsl)
Uniforms: textura da cena, `u_resolution`, `u_time`, `u_seed`
(atualizado a INK_FPS).

- Papel: base em cinza claro neutro, com fibra e grão fino de papel
  litográfico (ruído multi-escala estático).
- Crayon: o tom da cena é aplicado como "pigmento" que adere ao grão:
  em tons médios, o papel aparece entre os grãos; em tons escuros, o preto
  fica denso e aveludado.
- Claro-escuro: curva de contraste acentuada, pretos profundos, luzes
  preservando o papel.
- Traços de crayon longos: estrias de ruído esticado ao longo do traço, com
  pressão variável, seguindo as formas pelo gradiente de luminância e, onde a
  forma é plana (céu, massas de sombra), uma diagonal enérgica.
- Bordas: o gradiente forte reforça o contorno com uma linha que falha.
- Realces raspados: o que é quase branco na cena volta ao papel sem grão.
- Margem do quadro: leve irregularidade e vinheta, como impressão
  litográfica na folha.
- "Boiling": `u_seed` muda a ~INK_FPS, deslocando sutilmente grão e traços
  para parecer desenhado quadro a quadro.

## Loop (main.ts)
- requestAnimationFrame com dt real, limitado a 50 ms por frame.
- Por frame: atualizar estado → desenhar cena offscreen → enviar textura
  → render do shader.
- Pausar quando `document.hidden`; ao voltar, reiniciar `lastInputAt`
  (tempo oculto não conta como inatividade).
- `prefers-reduced-motion`: desligar o boiling e suavizar a câmera.

## Etapas de execução
1. Scaffold com Vite (template vanilla-ts), remover todo conteúdo de exemplo,
   incluindo textos, estilos e ícones.
   Verificar: fundo cinza com canvas WebGL centralizado, nenhum texto visível.
2. state.ts + input.ts, testes via console.log.
   Verificar: clique e seta incrementam; segurar a seta não; inatividade
   dispara a queda; transições FALLING → SETTLING → CLIMBING corretas.
3. scene.ts com a pose de subida, montanha, céu, pedra e câmera.
   Para depurar, exibir temporariamente o canvas offscreen
   (remover antes de concluir).
   Verificar: caminhada coerente com a distância; parado sem cliques.
4. litho.ts + shader.
   Verificar: aparência de litografia a crayon, monocromática, com grão vivo.
5. Queda e recomposição: pose de queda, arrasto, rastro, câmera da descida,
   SETTLING. Para testar, aceitar `?steps=20` na URL somente em modo dev.
   Verificar os dois casos: queda do cume e queda por inatividade no meio
   da subida.
6. Polimento: resize, DPR, mobile, reduced-motion, build de produção.

## Critérios de aceite
- A página mostra o aparelho horizontal com a tela e a tecla desenhada.
  Nenhum texto visível, inclusive em caso de erro.
- Cada clique na tela ou seta faz Sísifo avançar um empurrão curto e pesado;
  sem input, ele para.
- Segurar a seta para cima conta como um único passo.
- Em 100 passos ele chega ao cume; a pedra começa a rolar e arrasta Sísifo
  montanha abaixo, de costas, com as mãos na pedra tentando segurá-la,
  até a base, onde ele se recompõe e tudo recomeça sem corte.
- Após IDLE_TIMEOUT_MS sem input, acontece a mesma descida a partir do ponto
  onde ele estava.
- Visual estritamente monocromático, com aparência de litografia romântica.
- `npm run build` gera site estático sem dependências de runtime.
- 60 fps em notebook comum e celular médio.

## Fora de escopo
Texto dentro da tela do jogo, som, contador, pontuação, persistência, analytics,
frameworks, bibliotecas gráficas, outros estilos visuais.
