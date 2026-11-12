/**
 * The game rules over a board snapshot: where a team may build, what a building costs and how it is paid, scoring,
 * the longest road and the weekly harvest. Pure functions, no I/O.
 */
import { type Geometry, geometry } from "./board.ts";
import type { GeneratedMap, TileKind } from "./generate.ts";
import { RESOURCES, type Resource, type ResourceBag } from "./resources.ts";

export type BuildingKind = "road" | "settlement" | "city";

export interface Placed {
  kind: BuildingKind;
  /** A vertex id for settlements and cities, an edge id for roads. */
  location: string;
  teamId: number;
  /** Null for a team's starting buildings, which belong to the whole team. */
  playerId: string | null;
}

export interface BoardState {
  geo: Geometry;
  tiles: TileKind[];
  buildings: Placed[];
}

export function boardState(map: Pick<GeneratedMap, "size" | "tiles">, buildings: Placed[]): BoardState {
  return { geo: geometry(map.size), tiles: map.tiles, buildings };
}

interface Occupancy {
  vertex: Map<string, Placed>;
  edge: Map<string, Placed>;
}

function occupancy(state: BoardState): Occupancy {
  const vertex = new Map<string, Placed>();
  const edge = new Map<string, Placed>();
  for (const b of state.buildings) (b.kind === "road" ? edge : vertex).set(b.location, b);
  return { vertex, edge };
}

/** A team's network reaches a vertex if it has a building there, or a road ending there not cut by a rival's building. */
function reaches(state: BoardState, occ: Occupancy, teamId: number, vertexId: string): boolean {
  const owner = occ.vertex.get(vertexId);
  if (owner) return owner.teamId === teamId;
  return state.geo.vertices.get(vertexId)!.edges.some((e) => occ.edge.get(e)?.teamId === teamId);
}

export function legalRoads(state: BoardState, teamId: number): string[] {
  const occ = occupancy(state);
  return [...state.geo.edges.values()]
    .filter((e) => !occ.edge.has(e.id) && (reaches(state, occ, teamId, e.a) || reaches(state, occ, teamId, e.b)))
    .map((e) => e.id);
}

export function legalSettlements(state: BoardState, teamId: number): string[] {
  const occ = occupancy(state);
  return [...state.geo.vertices.values()]
    .filter(
      (v) =>
        !occ.vertex.has(v.id) &&
        v.neighbors.every((n) => !occ.vertex.has(n)) &&
        v.edges.some((e) => occ.edge.get(e)?.teamId === teamId),
    )
    .map((v) => v.id);
}

/** A player upgrades their own settlements, and anyone on the team may upgrade the team's starting settlement. */
export function legalCities(state: BoardState, teamId: number, playerId: string): string[] {
  return state.buildings
    .filter((b) => b.kind === "settlement" && b.teamId === teamId && (b.playerId === playerId || b.playerId === null))
    .map((b) => b.location);
}

export function legalLocations(state: BoardState, kind: BuildingKind, teamId: number, playerId: string): string[] {
  if (kind === "road") return legalRoads(state, teamId);
  if (kind === "settlement") return legalSettlements(state, teamId);
  return legalCities(state, teamId, playerId);
}

export type Costs = Record<BuildingKind, number>;

/** How many different resources a building costs, capped at the number of resource types in play. */
export function costOf(kind: BuildingKind, costs: Costs, resourcesInPlay: number): number {
  return Math.min(costs[kind], resourcesInPlay);
}

/** Which resources pay a cost of `count` different ones: the ones the player holds most of. Null if they can't. */
export function pickPayment(inventory: ResourceBag, count: number): Resource[] | null {
  const held = RESOURCES.filter((r) => (inventory[r] ?? 0) > 0).sort(
    (a, b) => (inventory[b] ?? 0) - (inventory[a] ?? 0) || RESOURCES.indexOf(a) - RESOURCES.indexOf(b),
  );
  if (held.length < count) return null;
  return held.slice(0, count).sort((a, b) => RESOURCES.indexOf(a) - RESOURCES.indexOf(b));
}

/** The longest chain of a team's roads; a rival's building on a vertex breaks the chain there. */
export function longestRoad(state: BoardState, teamId: number): number {
  const occ = occupancy(state);
  const own = new Set(state.buildings.filter((b) => b.kind === "road" && b.teamId === teamId).map((b) => b.location));
  const blocked = (v: string) => {
    const owner = occ.vertex.get(v);
    return owner !== undefined && owner.teamId !== teamId;
  };
  const walk = (vertexId: string, used: Set<string>): number => {
    let best = 0;
    for (const edgeId of state.geo.vertices.get(vertexId)!.edges) {
      if (!own.has(edgeId) || used.has(edgeId)) continue;
      const edge = state.geo.edges.get(edgeId)!;
      const next = edge.a === vertexId ? edge.b : edge.a;
      used.add(edgeId);
      best = Math.max(best, 1 + (blocked(next) ? 0 : walk(next, used)));
      used.delete(edgeId);
    }
    return best;
  };
  let best = 0;
  for (const edgeId of own) {
    const edge = state.geo.edges.get(edgeId)!;
    best = Math.max(best, walk(edge.a, new Set()), walk(edge.b, new Set()));
  }
  return best;
}

export interface LongestRoadRule {
  minLength: number;
}

/**
 * Who holds the longest-road bonus after a change: the team with the strictly longest road of at least the minimum
 * length. A holder tied for the longest keeps it.
 */
export function longestRoadHolder(
  state: BoardState,
  teamIds: number[],
  currentHolder: number | null,
  rule: LongestRoadRule,
): number | null {
  const lengths = new Map(teamIds.map((t) => [t, longestRoad(state, t)]));
  const best = Math.max(0, ...lengths.values());
  if (best < rule.minLength) return null;
  if (currentHolder !== null && lengths.get(currentHolder) === best) return currentHolder;
  const leaders = teamIds.filter((t) => lengths.get(t) === best);
  return leaders.length === 1 ? leaders[0]! : null;
}

export type Points = Record<BuildingKind, number>;

export function buildingPoints(buildings: Placed[], points: Points): Map<number, number> {
  const scores = new Map<number, number>();
  for (const b of buildings) scores.set(b.teamId, (scores.get(b.teamId) ?? 0) + points[b.kind]);
  return scores;
}

export interface HarvestShare {
  playerId: string;
  resource: Resource;
  amount: number;
}

/** Each player's settlements yield 1 and cities 2 per adjacent non-desert tile. Team-owned buildings yield nothing. */
export function harvest(state: BoardState): HarvestShare[] {
  const totals = new Map<string, HarvestShare>();
  for (const b of state.buildings) {
    if (b.kind === "road" || b.playerId === null) continue;
    const amount = b.kind === "city" ? 2 : 1;
    for (const tile of state.geo.vertices.get(b.location)!.tiles) {
      const resource = state.tiles[tile]!;
      if (resource === "desert") continue;
      const key = `${b.playerId}:${resource}`;
      const share = totals.get(key) ?? { playerId: b.playerId, resource, amount: 0 };
      share.amount += amount;
      totals.set(key, share);
    }
  }
  return [...totals.values()];
}
