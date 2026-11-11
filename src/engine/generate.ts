/**
 * Map generation from a seed: which resource each tile yields, and where each team's starting settlement and road
 * go. The same seed and teams always give the same map.
 */
import { type BoardSize, boardSizeFor, geometry, vertexDistances } from "./board.ts";
import type { Resource } from "./resources.ts";
import { createRng, shuffle } from "./rng.ts";

export type TileKind = Resource | "desert";

export interface StartingPlacement {
  settlement: string;
  road: string;
}

export interface GeneratedMap {
  size: BoardSize;
  tiles: TileKind[];
  /** One per team, in the order the resources were given. */
  starts: StartingPlacement[];
}

/** `resources` holds one resource per team, in team order. */
export function generateMap(seed: number, resources: Resource[]): GeneratedMap {
  const size = boardSizeFor(resources.length);
  const geo = geometry(size);
  const deserts = size === "small" ? 1 : 2;
  const productive = geo.tiles.length - deserts;
  const kinds: TileKind[] = Array.from({ length: productive }, (_, i) => resources[i % resources.length]!);
  for (let i = 0; i < deserts; i++) kinds.push("desert");
  const tiles = shuffle(kinds, createRng(seed));
  return { size, tiles, starts: pickStarts(seed, size, tiles, resources.length) };
}

/** Spread the starts out: each next one is the interior vertex farthest from the starts picked so far. */
function pickStarts(seed: number, size: BoardSize, tiles: TileKind[], count: number): StartingPlacement[] {
  const geo = geometry(size);
  const rng = createRng(seed ^ 0x9e3779b9);
  const interior = [...geo.vertices.values()].filter(
    (v) => v.tiles.length === 3 && v.tiles.every((t) => tiles[t] !== "desert"),
  );
  const candidates = shuffle(
    interior.map((v) => v.id),
    rng,
  );
  const chosen: string[] = [candidates[0]!];
  const distances = [vertexDistances(geo, chosen[0]!)];
  while (chosen.length < count) {
    let best = "";
    let bestDistance = -1;
    for (const id of candidates) {
      const nearest = Math.min(...distances.map((d) => d.get(id) ?? 0));
      if (nearest > bestDistance) [best, bestDistance] = [id, nearest];
    }
    chosen.push(best);
    distances.push(vertexDistances(geo, best));
  }
  return chosen.map((settlement) => {
    const edges = geo.vertices.get(settlement)!.edges;
    return { settlement, road: edges[Math.floor(rng() * edges.length)]! };
  });
}
