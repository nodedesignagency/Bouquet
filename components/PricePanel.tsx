"use client";

import { useEffect, useState } from "react";

import { downloadPng } from "@/lib/export";
import { formatPrice, priceBouquet, type PriceLine } from "@/lib/pricing";
import { shareUrl } from "@/lib/share";
import type { BouquetState } from "@/lib/types";
import { ActionButton, Panel } from "./ui";

type Status = { kind: "idle" } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function PricePanel({ state, onReset }: { state: BouquetState; onReset: () => void }) {
  const price = priceBouquet(state);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  // Clear the confirmation once it has been read, so it never goes stale
  // against a bouquet that has since changed.
  useEffect(() => {
    if (status.kind === "idle") return;
    const timer = setTimeout(() => setStatus({ kind: "idle" }), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  async function savePng() {
    setBusy(true);
    try {
      await downloadPng(state);
      setStatus({ kind: "done", message: "Saved to your downloads." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "The PNG could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const url = shareUrl(state, window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, "", url);
      setStatus({ kind: "done", message: "Link copied. It rebuilds this exact bouquet." });
    } catch {
      // Clipboard access can be refused; putting the link in the address bar
      // still leaves it somewhere the person can copy it by hand.
      window.history.replaceState(null, "", url);
      setStatus({ kind: "error", message: "Copy was blocked — the link is in the address bar." });
    }
  }

  return (
    <Panel title="Price" hint={`${state.stems.length} stems`}>
      {state.stems.length === 0 && price.finishing.length === 0 ? (
        <p className="text-sm text-bench-300">Nothing to price yet.</p>
      ) : (
        <dl className="space-y-1">
          {price.flowers.map((line) => (
            <Line key={line.key} line={line} />
          ))}
          {price.finishing.length > 0 ? (
            <div className="mt-2 space-y-1 border-t border-bench-600 pt-2">
              {price.finishing.map((line) => (
                <Line key={line.key} line={line} />
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-baseline justify-between border-t border-bench-500 pt-2">
            <dt className="rule-label text-bench-300">Total</dt>
            <dd className="font-display text-2xl text-bench-100">{formatPrice(price.total)}</dd>
          </div>
        </dl>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton onClick={savePng} variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save PNG"}
        </ActionButton>
        <ActionButton onClick={copyLink}>Copy link</ActionButton>
        <ActionButton onClick={onReset} disabled={state.stems.length === 0}>
          Start over
        </ActionButton>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`mt-2 min-h-[1rem] text-[11px] ${
          status.kind === "error" ? "text-kraft-soft" : "text-bench-400"
        }`}
      >
        {status.kind === "idle" ? "" : status.message}
      </p>
    </Panel>
  );
}

function Line({ line }: { line: PriceLine }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 truncate text-xs text-bench-200">
        {line.label}
        {line.detail ? (
          <span className="ml-1.5 font-mono text-[10px] text-bench-400">{line.detail}</span>
        ) : null}
      </dt>
      <dd className="shrink-0 font-mono text-xs tabular-nums text-bench-200">
        {formatPrice(line.amount)}
      </dd>
    </div>
  );
}
