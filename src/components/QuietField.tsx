"use client";

import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

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

export function QuietInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [editable, setEditable] = useState(false);

  return (
    <input
      {...props}
      {...quiet}
      readOnly={!editable}
      onPointerDown={() => setEditable(true)}
      onFocus={(event) => {
        setEditable(true);
        props.onFocus?.(event);
      }}
    />
  );
}

export function QuietTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [editable, setEditable] = useState(false);

  return (
    <textarea
      {...props}
      {...quiet}
      readOnly={!editable}
      onPointerDown={() => setEditable(true)}
      onFocus={(event) => {
        setEditable(true);
        props.onFocus?.(event);
      }}
    />
  );
}
