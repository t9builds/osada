/** Rasterises the map SVG to PNG for Slack image blocks. */
import { Resvg } from "@resvg/resvg-js";

export function svgToPng(svg: string, width?: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: "width", value: width } : { mode: "original" },
    // resvg's system font lookup misses Debian's font folder, so the Docker image's DejaVu is named explicitly.
    font: { loadSystemFonts: true, fontDirs: ["/usr/share/fonts"], defaultFontFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
}
