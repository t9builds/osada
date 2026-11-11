/** Rasterises the map SVG to PNG for Slack image blocks. */
import { Resvg } from "@resvg/resvg-js";

export function svgToPng(svg: string, width?: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: "width", value: width } : { mode: "original" },
    font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
}
