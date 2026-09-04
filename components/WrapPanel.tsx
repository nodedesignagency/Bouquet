"use client";

import { formatPrice } from "@/lib/pricing";
import { getWrapStyle, RIBBONS, WRAP_MATERIALS, WRAP_STYLES } from "@/lib/wrap";
import type { BouquetState, WrapStyle } from "@/lib/types";
import { Choice, Panel } from "./ui";

interface Props {
  state: BouquetState;
  onChange: (patch: Partial<BouquetState>) => void;
}

export function WrapPanel({ state, onChange }: Props) {
  const style = getWrapStyle(state.wrapStyle);
  const wrapped = state.wrapStyle !== "none";

  return (
    <Panel title="Wrap" hint={style.name}>
      <div className="space-y-4">
        <Field label="Style" note={style.description}>
          {WRAP_STYLES.map((option) => (
            <Choice
              key={option.id}
              selected={state.wrapStyle === option.id}
              onSelect={() => onChange({ wrapStyle: option.id as WrapStyle })}
            >
              {option.name}
            </Choice>
          ))}
        </Field>

        {wrapped ? (
          <Field label="Paper">
            {WRAP_MATERIALS.map((material) => (
              <Choice
                key={material.id}
                selected={state.wrapMaterial === material.id}
                onSelect={() => onChange({ wrapMaterial: material.id })}
                swatch={
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 rounded-sm border border-black/30"
                    style={{
                      background: material.front,
                      opacity: material.opacity < 1 ? 0.6 : 1,
                    }}
                  />
                }
              >
                {material.name}
              </Choice>
            ))}
          </Field>
        ) : null}

        <Field label="Ribbon">
          {RIBBONS.map((ribbon) => (
            <Choice
              key={ribbon.id}
              selected={state.ribbon === ribbon.id}
              onSelect={() => onChange({ ribbon: ribbon.id })}
              swatch={
                ribbon.widthMm > 0 ? (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 rounded-sm border border-black/30"
                    style={{ background: ribbon.color }}
                  />
                ) : undefined
              }
            >
              {ribbon.name}
            </Choice>
          ))}
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5 pt-1">
          <input
            type="checkbox"
            checked={state.hasTape}
            onChange={(event) => onChange({ hasTape: event.target.checked })}
            className="h-4 w-4 rounded border-bench-500 bg-bench-700 accent-kraft"
          />
          <span className="text-xs text-bench-200">Bind with floral tape</span>
          <span className="ml-auto font-mono text-[10px] text-bench-400">
            {formatPrice(0)}
          </span>
        </label>
      </div>
    </Panel>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="rule-label text-bench-400">{label}</h3>
        {note ? <span className="text-[11px] text-bench-400">{note}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
