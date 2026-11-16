"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type FormChrome = {
  title: string;
  titleId: string;
  close: () => void;
};

const FormChromeContext = createContext<FormChrome | null>(null);
const SetFormChromeContext = createContext<(value: FormChrome | null) => void>(() => {});
// The name of the page the person is on, when the page knows something better than the address does. A transaction
// page is addressed by a type code such as PPY, and it knows the type is called Supplier payment.
const PageLabelContext = createContext<string | null>(null);
const SetPageLabelContext = createContext<(value: string | null) => void>(() => {});

export function FormChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<FormChrome | null>(null);
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  return (
    <SetFormChromeContext.Provider value={setChrome}>
      <FormChromeContext.Provider value={chrome}>
        <SetPageLabelContext.Provider value={setPageLabel}>
          <PageLabelContext.Provider value={pageLabel}>{children}</PageLabelContext.Provider>
        </SetPageLabelContext.Provider>
      </FormChromeContext.Provider>
    </SetFormChromeContext.Provider>
  );
}

export function useFormChrome() {
  return useContext(FormChromeContext);
}

export function useSetFormChrome() {
  return useContext(SetFormChromeContext);
}

export function usePageLabel() {
  return useContext(PageLabelContext);
}

/** A page calls this to give the title bar its name. The name goes when the page does. */
export function useRegisterPageLabel(label: string | null | undefined) {
  const set = useContext(SetPageLabelContext);
  useEffect(() => {
    if (!label) return;
    set(label);
    return () => set(null);
  }, [label, set]);
}
