"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { clampSplit, readSplitWidth, SPLIT_HANDLE, SPLIT_MIN, subscribeSplitWidth, writeSplitWidth } from "./splitWidth";

/** The header and lines side by side with a draggable handle between them, stacked on a narrow panel. */
export function useImportSplit() {
  const [sideBySide, setSideBySide] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const headerWidthRef = useRef<number | null>(null);
  const sideBySideRef = useRef(true);
  const storedWidth = useSyncExternalStore(subscribeSplitWidth, readSplitWidth, () => null);

  useEffect(() => {
    headerWidthRef.current = storedWidth;
  }, [storedWidth]);

  useEffect(() => {
    const node = splitRef.current;
    if (!node) return;
    const watch = () => {
      const wide = node.clientWidth >= 860;
      sideBySideRef.current = wide;
      setSideBySide((current) => (current === wide ? current : wide));
      setContainerWidth((current) => (current === node.clientWidth ? current : node.clientWidth));
    };
    const frame = window.requestAnimationFrame(watch);
    const observer = new ResizeObserver(watch);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const splitMax = containerWidth ? Math.max(SPLIT_MIN, containerWidth - SPLIT_MIN - SPLIT_HANDLE) : 1200;
  const splitStyle: CSSProperties = sideBySide
    ? {
        gridTemplateColumns: storedWidth == null ? "minmax(0, 1fr) 10px minmax(0, 1fr)" : `${storedWidth}px 10px minmax(0, 1fr)`,
      }
    : {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
      };

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
    writeSplitWidth(width);
  }

  function dragSplit(event: PointerEvent<HTMLButtonElement>) {
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
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paintWidth(latest);
      });
    };
    const stop = (ev: globalThis.PointerEvent) => {
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

  function nudgeSplit(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const node = splitRef.current;
    if (!node || !sideBySide) return;
    event.preventDefault();
    const current = headerWidthRef.current ?? (node.clientWidth - SPLIT_HANDLE) / 2;
    const delta = event.key === "ArrowLeft" ? -24 : 24;
    rememberWidth(current + (event.shiftKey ? delta * 3 : delta));
  }

  return { sideBySide, splitRef, storedWidth, splitMax, splitStyle, dragSplit, nudgeSplit };
}
