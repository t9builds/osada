/** The read-only web view of the map: the SVG at full size with the scoreboard. */
import type { BoardView } from "../game/types.ts";
import { escapeXml } from "./map-svg.ts";

export function renderMapPage(board: BoardView, svg: string, title: string): string {
  const rows = board.scoreboard
    .map(
      (s) =>
        `<tr><td><span class="swatch" style="background:${s.team.color}"></span>${escapeXml(s.team.name)}</td><td>${s.buildingPoints}</td><td>${s.bonus}</td><td><b>${s.points}</b></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(title)}</title>
<style>
  body { margin: 0; padding: 16px; background: #1f4d68; color: #fff; font-family: system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  svg { width: 100%; height: auto; border-radius: 8px; }
  table { border-collapse: collapse; margin-top: 16px; }
  td, th { padding: 6px 12px; text-align: left; border-bottom: 1px solid #ffffff33; }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; }
</style>
</head>
<body><main>
${svg}
<table><thead><tr><th>Tým</th><th>Stavby</th><th>Bonus</th><th>Body</th></tr></thead><tbody>${rows}</tbody></table>
</main></body>
</html>`;
}
