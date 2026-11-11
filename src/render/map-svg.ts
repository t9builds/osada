/**
 * Draws a board as SVG: tiles coloured and labelled by resource, every vertex labelled so players can find a
 * location from the build dialog, buildings in their team's colour, and a legend with the score.
 */
import { TILE_COLORS, TILE_LABELS } from "../copy/resources.ts";
import { geometry, type VertexGeo } from "../engine/board.ts";
import type { BoardBuilding, BoardView, TeamScore } from "../game/types.ts";

/** Hex size (centre to corner) in pixels; the lattice unit is half a tile width across and a quarter tile down. */
const SIZE = 56;
const UNIT_X = (Math.sqrt(3) / 2) * SIZE;
const UNIT_Y = SIZE / 2;
const MARGIN = 28;
const LEGEND_LINE = 26;
const FONT = "DejaVu Sans, Verdana, Arial, sans-serif";

export interface MapSvgOptions {
  title: string;
}

export function renderMapSvg(board: BoardView, options: MapSvgOptions): string {
  const geo = geometry(board.size);
  const width = Math.round(geo.width * UNIT_X + 2 * MARGIN);
  const mapHeight = Math.round(geo.height * UNIT_Y + 2 * MARGIN) + 30;
  const height = mapHeight + board.scoreboard.length * LEGEND_LINE + MARGIN;
  const px = (v: { x: number; y: number }) => [MARGIN + v.x * UNIT_X, MARGIN + 30 + v.y * UNIT_Y] as const;
  const colors = new Map(board.scoreboard.map((s) => [s.team.id, s.team.color]));

  const tiles = geo.tiles.map((tile, i) => {
    const kind = board.tiles[i]!;
    const corners = tile.corners.map((id) => px(geo.vertices.get(id)!).join(",")).join(" ");
    const [cx, cy] = px(tile);
    return [
      `<polygon class="tile tile-${kind}" points="${corners}" fill="${TILE_COLORS[kind]}" stroke="#f6f1e3" stroke-width="3"/>`,
      `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="bold" fill="#2b2b2b" fill-opacity="0.75">${TILE_LABELS[kind]}</text>`,
    ].join("");
  });

  const roads = board.buildings
    .filter((b) => b.kind === "road")
    .map((b) => drawRoad(b, geo.edges.get(b.location)!, geo.vertices, px, colors));
  const places = board.buildings
    .filter((b) => b.kind !== "road")
    .map((b) => drawPlace(b, px(geo.vertices.get(b.location)!), colors.get(b.teamId)!));
  const labels = [...geo.vertices.values()].map((v) => {
    const [x, y] = px(v);
    return `<text class="vertex-label" x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="10" fill="#1d1d1d" stroke="#ffffff" stroke-width="3" paint-order="stroke">${v.id}</text>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<rect width="100%" height="100%" fill="#2f6b8f"/>`,
    `<text x="${MARGIN}" y="${MARGIN + 6}" font-size="20" font-weight="bold" fill="#ffffff">${escapeXml(options.title)}</text>`,
    ...tiles,
    ...roads,
    ...places,
    ...labels,
    legend(board.scoreboard, board.longestRoadTeamId, mapHeight),
    "</svg>",
  ].join("\n");
}

type Px = (v: { x: number; y: number }) => readonly [number, number];

function drawRoad(
  b: BoardBuilding,
  edge: { a: string; b: string },
  vertices: Map<string, VertexGeo>,
  px: Px,
  colors: Map<number, string>,
): string {
  const [x1, y1] = px(vertices.get(edge.a)!);
  const [x2, y2] = px(vertices.get(edge.b)!);
  const inset = 0.18;
  const ax = x1 + (x2 - x1) * inset;
  const ay = y1 + (y2 - y1) * inset;
  const bx = x2 - (x2 - x1) * inset;
  const by = y2 - (y2 - y1) * inset;
  const line = `x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke-linecap="round"`;
  return `<g class="road" data-location="${b.location}"><line ${line} stroke="#1d1d1d" stroke-width="10"/><line ${line} stroke="${colors.get(b.teamId)}" stroke-width="6"/></g>`;
}

function drawPlace(b: BoardBuilding, [x, y]: readonly [number, number], color: string): string {
  const shape =
    b.kind === "city"
      ? // A wider building with a tower.
        `M${x - 13},${y + 9} L${x - 13},${y - 3} L${x - 4},${y - 3} L${x - 4},${y - 13} L${x + 2},${y - 18} L${x + 8},${y - 13} L${x + 8},${y - 3} L${x + 13},${y - 3} L${x + 13},${y + 9} Z`
      : `M${x - 9},${y + 8} L${x - 9},${y - 3} L${x},${y - 11} L${x + 9},${y - 3} L${x + 9},${y + 8} Z`;
  return `<path class="${b.kind}" data-location="${b.location}" d="${shape}" fill="${color}" stroke="#1d1d1d" stroke-width="2.5" stroke-linejoin="round"/>`;
}

function legend(scoreboard: TeamScore[], longestRoadTeamId: number | null, top: number): string {
  return scoreboard
    .map((s, i) => {
      const y = top + i * LEGEND_LINE;
      const bonus = s.team.id === longestRoadTeamId ? " · longest road" : "";
      return [
        `<rect x="${MARGIN}" y="${y - 13}" width="16" height="16" rx="3" fill="${s.team.color}" stroke="#ffffff"/>`,
        `<text x="${MARGIN + 24}" y="${y}" font-size="15" fill="#ffffff">${escapeXml(s.team.name)}: ${s.points} pts${bonus}</text>`,
      ].join("");
    })
    .join("\n");
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
