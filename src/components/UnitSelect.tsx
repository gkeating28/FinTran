"use client";

import type { UnitChoice } from "@/lib/code-lists";

export default function UnitSelect({
  units,
  value,
  onChange,
  name,
  disabled,
}: {
  units: UnitChoice[];
  value: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
}) {
  const common = units.filter((unit) => unit.common);
  const rest = units.filter((unit) => !unit.common);

  return (
    <select
      name={name}
      autoComplete="off"
      value={value}
      disabled={disabled}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
    >
      {common.length ? (
        <optgroup label="Common">
          {common.map((unit) => (
            <option key={unit.code} value={unit.code}>
              {unit.code} — {unit.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="All units">
        {rest.map((unit) => (
          <option key={unit.code} value={unit.code}>
            {unit.code} — {unit.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
