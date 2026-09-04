/**
 * PNG export.
 *
 * The SVG on the page is the artwork, so the export rasterises that exact node
 * rather than re-drawing anything: what you see is what saves. The only thing
 * removed is the guides overlay, which is a tool rather than part of the
 * bouquet.
 *
 * The sprites have to be inlined first. An SVG rasterised through an <img> is
 * loaded in secure static mode, which refuses to fetch anything external — so a
 * <image href="/assets/rose.png"> silently renders as nothing and the export
 * comes back as an empty wrap. Every sprite is therefore turned into a data URI
 * before serialising, and cached, since a bouquet uses the same handful of
 * files over and over.
 */

import { CANVAS_HEIGHT, CANVAS_WIDTH, EXPORT_SCALE, SVG_ROOT_ID } from "./canvas";
import type { BouquetState } from "./types";

export class ExportError extends Error {}

/** Sprite path to data URI. Survives across exports; the sprites never change. */
const spriteCache = new Map<string, string>();

async function toDataUrl(src: string): Promise<string> {
  const cached = spriteCache.get(src);
  if (cached) return cached;

  const response = await fetch(src);
  if (!response.ok) throw new ExportError(`Could not read ${src} (${response.status}).`);
  const blob = await response.blob();

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ExportError(`Could not encode ${src}.`));
    reader.readAsDataURL(blob);
  });

  spriteCache.set(src, dataUrl);
  return dataUrl;
}

/** Rewrites every sprite reference in the clone to carry its own pixels. */
async function inlineSprites(root: SVGSVGElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("image"));
  const sources = new Set<string>();
  for (const image of images) {
    const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
    if (href && !href.startsWith("data:")) sources.add(href);
  }

  const resolved = new Map<string, string>();
  await Promise.all(
    Array.from(sources, async (src) => {
      resolved.set(src, await toDataUrl(src));
    }),
  );

  for (const image of images) {
    const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
    const dataUrl = href ? resolved.get(href) : undefined;
    if (!dataUrl) continue;
    image.removeAttribute("xlink:href");
    image.setAttribute("href", dataUrl);
  }
}

async function serialize(svg: SVGSVGElement): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("class");
  clone.removeAttribute("id");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(CANVAS_WIDTH));
  clone.setAttribute("height", String(CANVAS_HEIGHT));
  clone.querySelectorAll("[data-guides]").forEach((node) => node.remove());
  await inlineSprites(clone);
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterises the bouquet and returns it as a PNG blob. */
export async function renderPng(scale = EXPORT_SCALE): Promise<Blob> {
  const svg = document.getElementById(SVG_ROOT_ID);
  if (!(svg instanceof SVGSVGElement)) {
    throw new ExportError("The bouquet canvas is not on the page.");
  }

  const source = await serialize(svg);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = new Image();
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
