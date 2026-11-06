"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type NavContext = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const Context = createContext<NavContext>({ open: false, toggle: () => {}, close: () => {} });

/** Whether the sidebar menu is open on a narrow screen. On a wide screen the sidebar is always shown. */
export function NavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState({ open: false, pathname });

  // Following a link closes the menu. Comparing the stored path avoids a state update inside an effect.
  const open = state.open && state.pathname === pathname;

  const toggle = useCallback(() => setState({ open: !open, pathname }), [open, pathname]);
  const close = useCallback(() => setState({ open: false, pathname }), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const value = useMemo(() => ({ open, toggle, close }), [open, toggle, close]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNav() {
  return useContext(Context);
}
