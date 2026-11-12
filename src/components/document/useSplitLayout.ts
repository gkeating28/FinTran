"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { clampSplit, readStoredSplitWidth, SPLIT_HANDLE, SPLIT_MIN, SPLIT_WIDTH_KEY } from "./shared";

/** The header and lines side by side, with a draggable handle between them. On a narrow panel they stack. */
export function useSplitLayout() {
  const [headerWidth, setHeaderWidth] = useState<number | null>(readStoredSplitWidth);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const splitRef = useRef<HTMLDivElement>(null);
  const headerWidthRef = useRef<number | null>(headerWidth);
  const sideBySideRef = useRef(true);

  useEffect(() => {
    const node = splitRef.current;
    if (!node) return;
    const watch = () => {
      setPanelWidth(node.clientWidth);
      const wide = node.clientWidth >= 860;
      if (wide === sideBySideRef.current) return;
      sideBySideRef.current = wide;
      setSideBySide(wide);
    };
    watch();
    const observer = new ResizeObserver(watch);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function paintWidth(width: number) {
    const node = splitRef.current;
    if (!node) return;
    node.style.gridTemplateColumns = `${width}px ${SPLIT_HANDLE}px minmax(0, 1fr)`;
  }

  function rememberWidth(next: number) {
    const node = splitRef.current;
    const width = node ? clampSplit(next, node.clientWidth) : next;
    headerWidthRef.current = width;
    paintWidth(width);
    setHeaderWidth(width);
    window.localStorage.setItem(SPLIT_WIDTH_KEY, String(width));
  }

  function dragSplit(event: React.PointerEvent<HTMLButtonElement>) {
    if (!sideBySideRef.current) return;
    const node = splitRef.current;
    if (!node) return;
    event.preventDefault();
    const bounds = node.getBoundingClientRect();
    const origin = headerWidthRef.current ?? (bounds.width - SPLIT_HANDLE) / 2;
    const startX = event.clientX;
    const target = event.currentTarget;
    let latest = origin;
    let frame = 0;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paintWidth(latest);
      });
    };
    const stop = (ev: PointerEvent) => {
      if (frame) window.cancelAnimationFrame(frame);
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      rememberWidth(latest);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function nudgeSplit(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const node = splitRef.current;
    if (!node || !sideBySide) return;
    event.preventDefault();
    const current = headerWidthRef.current ?? (node.clientWidth - SPLIT_HANDLE) / 2;
    const delta = event.key === "ArrowLeft" ? -24 : 24;
    rememberWidth(current + (event.shiftKey ? delta * 3 : delta));
  }

  const splitStyle: CSSProperties = sideBySide
    ? {
        gridTemplateColumns:
          headerWidth == null ? "minmax(0, 1fr) 10px minmax(0, 1fr)" : `${headerWidth}px 10px minmax(0, 1fr)`,
      }
    : {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
      };
  const splitMax = panelWidth ? Math.max(SPLIT_MIN, panelWidth - SPLIT_MIN - SPLIT_HANDLE) : 1200;

  return { splitRef, headerWidth, sideBySide, splitStyle, splitMax, dragSplit, nudgeSplit };
}
