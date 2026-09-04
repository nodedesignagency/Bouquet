/**
 * Canvas geometry. The SVG always draws into this fixed pixel space and is
 * scaled to fit its container by the viewBox, so the arrangement is identical
 * on a phone, a desktop and in the exported PNG.
 *
 * 4:5, the shape florists' product photography is usually cropped to.
 */
export const CANVAS_WIDTH = 900;
export const CANVAS_HEIGHT = 1125;

/** Multiplier applied when rasterising to PNG. */
export const EXPORT_SCALE = 2;

export const SVG_ROOT_ID = "bouquet-svg";
