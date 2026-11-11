import { describe, expect, test } from "bun:test";
import { geometry, vertexDistances } from "./board.ts";
import { generateMap } from "./generate.ts";
import { boardState, legalRoads, legalSettlements, longestRoad, type Placed } from "./rules.ts";

describe("board geometry", () => {
  test("a small board has 19 tiles, 54 vertices and 72 edges", () => {
    const geo = geometry("small");
    expect(geo.tiles).toHaveLength(19);
    expect(geo.vertices.size).toBe(54);
    expect(geo.edges.size).toBe(72);
  });

  test("a large board has 30 tiles", () => {
    expect(geometry("large").tiles).toHaveLength(30);
  });

  test("vertices are labelled by row letter and position, edges by their two vertices upper first", () => {
    const geo = geometry("small");
    expect(geo.vertices.has("A1")).toBe(true);
    expect(geo.vertices.has("A3")).toBe(true);
    expect(geo.vertices.has("A4")).toBe(false);
    for (const edge of geo.edges.values()) {
      expect(edge.id).toBe(`${edge.a}-${edge.b}`);
      expect(edge.a < edge.b || edge.a[0]! < edge.b[0]!).toBe(true);
    }
  });

  test("interior vertices touch three tiles and three edges", () => {
    const geo = geometry("small");
    const centre = geo.tiles[9]!;
    for (const id of centre.corners) {
      expect(geo.vertices.get(id)!.tiles).toHaveLength(3);
      expect(geo.vertices.get(id)!.neighbors).toHaveLength(3);
    }
  });
});

describe("map generation", () => {
  test("the same seed gives the same map", () => {
    expect(generateMap(42, ["wood", "ore", "wool"])).toEqual(generateMap(42, ["wood", "ore", "wool"]));
    expect(generateMap(42, ["wood", "ore", "wool"]).tiles).not.toEqual(generateMap(7, ["wood", "ore", "wool"]).tiles);
  });

  test("resources are spread evenly with one desert on a small board, two on a large one", () => {
    const small = generateMap(1, ["wood", "ore", "wool"]);
    expect(small.tiles.filter((t) => t === "desert")).toHaveLength(1);
    expect(small.tiles.filter((t) => t === "wood")).toHaveLength(6);
    const large = generateMap(1, ["wood", "ore", "wool", "grain", "brick", "glass"]);
    expect(large.size).toBe("large");
    expect(large.tiles.filter((t) => t === "desert")).toHaveLength(2);
  });

  test("starting settlements respect the distance rule and each road touches its settlement", () => {
    for (let seed = 0; seed < 20; seed++) {
      const map = generateMap(seed, ["wood", "ore", "wool", "grain", "brick", "glass"]);
      const geo = geometry(map.size);
      const settlements = map.starts.map((s) => s.settlement);
      expect(new Set(settlements).size).toBe(6);
      for (const s of map.starts) {
        const v = geo.vertices.get(s.settlement)!;
        expect(v.edges).toContain(s.road);
        expect(v.neighbors.some((n) => settlements.includes(n))).toBe(false);
      }
    }
  });
});

describe("longest road", () => {
  const geo = geometry("small");
  const road = (location: string, teamId = 1): Placed => ({ kind: "road", location, teamId, playerId: "p" });

  test("follows a branching network along its longest path", () => {
    // A path A1 -> B1 -> C1 ... plus a spur; the spur must not be counted twice.
    const path = walkPath(geo, "A1", 6);
    const spurFrom = path.slice(1, -1).find((v) => geo.vertices.get(v)!.edges.length === 3)!;
    const spur = geo.vertices.get(spurFrom)!.edges.find((e) => !pathEdges(path).includes(e))!;
    const state = boardState({ size: "small", tiles: [] }, [...pathEdges(path).map((e) => road(e)), road(spur)]);
    expect(longestRoad(state, 1)).toBe(6);
  });

  test("a rival's settlement in the middle breaks the chain", () => {
    const path = walkPath(geo, "A1", 6);
    const rival: Placed = { kind: "settlement", location: path[3]!, teamId: 2, playerId: "q" };
    const state = boardState({ size: "small", tiles: [] }, [...pathEdges(path).map((e) => road(e)), rival]);
    expect(longestRoad(state, 1)).toBe(3);
  });

  test("a closed loop counts every edge once", () => {
    const tile = geo.tiles[0]!;
    const loop = tile.corners.map((c, i) => edgeBetween(geo, c, tile.corners[(i + 1) % 6]!));
    const state = boardState(
      { size: "small", tiles: [] },
      loop.map((e) => road(e)),
    );
    expect(longestRoad(state, 1)).toBe(6);
  });
});

describe("placement", () => {
  test("a road cannot extend through a rival's settlement", () => {
    const geo = geometry("small");
    const path = walkPath(geo, "A1", 2);
    const state = boardState({ size: "small", tiles: [] }, [
      { kind: "road", location: edgeBetween(geo, path[0]!, path[1]!), teamId: 1, playerId: "p" },
      { kind: "settlement", location: path[1]!, teamId: 2, playerId: "q" },
    ]);
    const roads = legalRoads(state, 1);
    for (const e of geo.vertices.get(path[1]!)!.edges) expect(roads).not.toContain(e);
    expect(legalSettlements(state, 1)).not.toContain(path[0]!);
  });
});

/** A simple path that keeps moving away from its start. */
function walkPath(geo: ReturnType<typeof geometry>, from: string, edges: number): string[] {
  const distance = vertexDistances(geo, from);
  const path = [from];
  while (path.length <= edges) {
    const last = geo.vertices.get(path.at(-1)!)!;
    path.push(last.neighbors.find((n) => distance.get(n)! > distance.get(last.id)!)!);
  }
  return path;
}

function pathEdges(path: string[]): string[] {
  const geo = geometry("small");
  return path.slice(1).map((v, i) => edgeBetween(geo, path[i]!, v));
}

function edgeBetween(geo: ReturnType<typeof geometry>, a: string, b: string): string {
  return geo.vertices.get(a)!.edges.find((e) => geo.edges.get(e)!.a === b || geo.edges.get(e)!.b === b)!;
}
