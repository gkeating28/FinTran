const ROW_CONTROL = "a, button, input, select, textarea";

export function clickOpensRow(target: EventTarget | null) {
  return !(target instanceof Element && target.closest(ROW_CONTROL));
}
