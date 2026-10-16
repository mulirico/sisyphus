// Ways to climb: up arrow, or click/tap on the screen. Holding the key does not count.

export function bindInput(screen: HTMLElement, onStep: () => boolean): () => void {
  const onScreen = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    onStep();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp") return;
    e.preventDefault();
    if (e.repeat) return;
    onStep();
  };

  screen.addEventListener("pointerdown", onScreen);
  window.addEventListener("keydown", onKey);
  return () => {
    screen.removeEventListener("pointerdown", onScreen);
    window.removeEventListener("keydown", onKey);
  };
}
