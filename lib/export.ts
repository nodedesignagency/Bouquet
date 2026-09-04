/**
 * PNG export.
 *
 * The SVG on the page is the artwork, so the export rasterises that exact node
 * rather than re-drawing anything: what you see is what saves. The only thing
 * removed is the guides overlay, which is a tool rather than part of the
 * bouquet.
 */

import { CANVAS_HEIGHT, CANVAS_WIDTH, EXPORT_SCALE, SVG_ROOT_ID } from "./canvas";
import type { BouquetState } from "./types";

export class ExportError extends Error {}

function serialize(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("class");
  clone.removeAttribute("id");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(CANVAS_WIDTH));
  clone.setAttribute("height", String(CANVAS_HEIGHT));
  clone.querySelectorAll("[data-guides]").forEach((node) => node.remove());
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterises the bouquet and returns it as a PNG blob. */
export async function renderPng(scale = EXPORT_SCALE): Promise<Blob> {
  const svg = document.getElementById(SVG_ROOT_ID);
  if (!(svg instanceof SVGSVGElement)) {
    throw new ExportError("The bouquet canvas is not on the page.");
  }

  const source = serialize(svg);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = new Image();
    image.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new ExportError("The bouquet could not be rasterised."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH * scale;
    canvas.height = CANVAS_HEIGHT * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new ExportError("This browser will not give us a canvas to draw on.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new ExportError("The PNG came back empty.")),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A filename that says which bouquet this is: the seed reproduces it exactly. */
export function exportFilename(state: BouquetState): string {
  return `bouquet-${state.seed}-${state.stems.length}-stems.png`;
}

export async function downloadPng(state: BouquetState): Promise<void> {
  const blob = await renderPng();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(state);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the download has taken the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
