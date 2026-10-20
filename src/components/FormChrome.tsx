"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type FormChrome = {
  title: string;
  titleId: string;
  close: () => void;
};

const FormChromeContext = createContext<FormChrome | null>(null);
const SetFormChromeContext = createContext<(value: FormChrome | null) => void>(() => {});

export function FormChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<FormChrome | null>(null);
  return (
    <SetFormChromeContext.Provider value={setChrome}>
      <FormChromeContext.Provider value={chrome}>{children}</FormChromeContext.Provider>
    </SetFormChromeContext.Provider>
  );
}

export function useFormChrome() {
  return useContext(FormChromeContext);
}

export function useSetFormChrome() {
  return useContext(SetFormChromeContext);
}
