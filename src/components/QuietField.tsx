"use client";

import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import SpellingNote from "@/components/SpellingNote";

const quiet = {
  autoComplete: "one-time-code",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

export function QuietInput({
  readOnly = false,
  spellCheck = false,
  value,
  disabled,
  onFocus,
  onPointerDown,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [editable, setEditable] = useState(false);
  const locked = Boolean(readOnly);

  return (
    <>
      <input
        {...props}
        {...quiet}
        value={value}
        disabled={disabled}
        readOnly={locked || !editable}
        onPointerDown={(event) => {
          if (!locked) setEditable(true);
          onPointerDown?.(event);
        }}
        onFocus={(event) => {
          if (!locked) setEditable(true);
          onFocus?.(event);
        }}
      />
      {spellCheck && !locked && !disabled ? <SpellingNote text={String(value ?? "")} /> : null}
    </>
  );
}

export function QuietTextarea({
  readOnly = false,
  spellCheck = false,
  value,
  disabled,
  onFocus,
  onPointerDown,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [editable, setEditable] = useState(false);
  const locked = Boolean(readOnly);

  return (
    <>
      <textarea
        {...props}
        {...quiet}
        value={value}
        disabled={disabled}
        readOnly={locked || !editable}
        onPointerDown={(event) => {
          if (!locked) setEditable(true);
          onPointerDown?.(event);
        }}
        onFocus={(event) => {
          if (!locked) setEditable(true);
          onFocus?.(event);
        }}
      />
      {spellCheck && !locked && !disabled ? <SpellingNote text={String(value ?? "")} /> : null}
    </>
  );
}
