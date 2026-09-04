"use client";

import { CATALOG, CATEGORY_GROUPS, CATEGORY_LABEL } from "@/lib/catalog";
import { formatPrice } from "@/lib/pricing";
import { countOfItem, MAX_STEMS } from "@/lib/state";
import type { BouquetState, CatalogItem } from "@/lib/types";
import { Panel, Stepper } from "./ui";

/** The widest thing in the catalog, so the swatches can be drawn to one scale. */
const WIDEST_MM = Math.max(...CATALOG.map((item) => item.realWidthMm));
const SWATCH_BOX = 34;

interface Props {
  state: BouquetState;
  onAdd: (itemId: string) => void;
  onRemove: (itemId: string) => void;
}

/**
 * The catalog.
 *
 * Every swatch is drawn at its true size relative to every other one — a 180mm
 * sunflower really is 2.4x a 75mm rose here, the same ratio the canvas uses.
 * The list doubles as the size table the arrangement is built from.
 */
export function CatalogPanel({ state, onAdd, onRemove }: Props) {
  const full = state.stems.length >= MAX_STEMS;

  return (
    <Panel title="Catalog" hint={`${state.stems.length}/${MAX_STEMS} stems`}>
      <div className="space-y-5">
        {CATEGORY_GROUPS.map((category) => {
          const items = CATALOG.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <div key={category}>
              <h3 className="rule-label mb-2 text-bench-400">{CATEGORY_LABEL[category]}</h3>
              <ul className="space-y-1">
                {items.map((item) => (
                  <CatalogRow
                    key={item.id}
                    item={item}
                    count={countOfItem(state, item.id)}
                    full={full}
                    onAdd={() => onAdd(item.id)}
                    onRemove={() => onRemove(item.id)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {full ? (
        <p className="mt-4 font-mono text-[10px] text-kraft-soft">
          That is as many stems as one hand can tie. Remove one to add another.
        </p>
      ) : null}
    </Panel>
  );
}

function CatalogRow({
  item,
  count,
  full,
  onAdd,
  onRemove,
}: {
  item: CatalogItem;
  count: number;
  full: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const diameter = Math.max(5, (item.realWidthMm / WIDEST_MM) * SWATCH_BOX);
  return (
    <li
      className={`flex items-center gap-3 rounded px-2 py-1.5 transition-colors ${
        count > 0 ? "bg-bench-700" : "hover:bg-bench-700/50"
      }`}
    >
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center"
        style={{ width: SWATCH_BOX, height: SWATCH_BOX }}
      >
        <span
          className="block rounded-full"
          style={{
            width: diameter,
            height: diameter,
            background: item.headColor,
            boxShadow: `inset 0 0 0 ${Math.max(1, diameter * 0.09)}px ${item.accentColor}`,
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-bench-100">{item.name}</span>
        <span className="block font-mono text-[10px] text-bench-400">
          {item.realWidthMm} mm · {formatPrice(item.pricePerStem)}
        </span>
      </span>
      <Stepper
        value={count}
        onAdd={onAdd}
        onRemove={onRemove}
        addLabel={`Add one ${item.name}`}
        removeLabel={`Remove one ${item.name}`}
        addDisabled={full}
      />
    </li>
  );
}
