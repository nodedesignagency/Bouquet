"use client";

interface Props {
  seed: number;
  showGuides: boolean;
  onSeed: (seed: number) => void;
  onShuffle: () => void;
  onToggleGuides: () => void;
}

/**
 * The seed, out in the open.
 *
 * Every scattered detail in the arrangement comes from this one number, so it
 * is editable rather than hidden: type the same seed with the same stems and
 * you get the same bouquet back, down to the pixel.
 */
export function SeedBar({ seed, showGuides, onSeed, onShuffle, onToggleGuides }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 rounded border border-bench-600 bg-bench-800 py-1 pl-3 pr-1">
        <span className="rule-label text-bench-400">Seed</span>
        <input
          type="text"
          inputMode="numeric"
          value={seed}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
            onSeed(digits === "" ? 0 : Number(digits));
          }}
          className="w-24 bg-transparent px-1 py-1 font-mono text-xs tabular-nums text-bench-100 outline-none"
          aria-label="Arrangement seed"
        />
      </label>
      <button
        type="button"
        onClick={onShuffle}
        className="rounded border border-bench-500 px-3 py-2 text-xs font-medium text-bench-200 transition-colors hover:border-bench-400 hover:bg-bench-600"
      >
        Shuffle
      </button>
      <button
        type="button"
        onClick={onToggleGuides}
        aria-pressed={showGuides}
        className={`rounded border px-3 py-2 text-xs font-medium transition-colors ${
          showGuides
            ? "border-kraft bg-kraft/15 text-kraft-soft"
            : "border-bench-500 text-bench-200 hover:border-bench-400 hover:bg-bench-600"
        }`}
      >
        Guides
      </button>
    </div>
  );
}
