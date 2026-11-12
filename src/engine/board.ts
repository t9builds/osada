/**
 * Board geometry: pointy-top hex tiles laid out in rows, their corners (vertices) and sides (edges), adjacency and
 * the short labels players pick locations by. Vertices are labelled by row letter and position (`C7`), edges by
 * their two vertices, upper first (`C7-D7`).
 *
 * Coordinates are on an integer lattice: x in half tile widths, y in quarter tile heights, so corners shared by
 * neighbouring tiles get identical keys.
 */
export type BoardSize = "small" | "large";

const ROW_LENGTHS: Record<BoardSize, number[]> = {
  small: [3, 4, 5, 4, 3],
  large: [3, 4, 5, 6, 5, 4, 3],
};

/** Corner offsets of a pointy-top hex, clockwise from the top. */
const CORNERS: [number, number][] = [
  [0, -2],
  [1, -1],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
];

export interface TileGeo {
  index: number;
  x: number;
  y: number;
  /** Vertex ids of the tile's corners, clockwise from the top. */
  corners: string[];
}

export interface VertexGeo {
  id: string;
  x: number;
  y: number;
  tiles: number[];
  edges: string[];
  neighbors: string[];
}

export interface EdgeGeo {
  id: string;
  a: string;
  b: string;
}

export interface Geometry {
  size: BoardSize;
  tiles: TileGeo[];
  vertices: Map<string, VertexGeo>;
  edges: Map<string, EdgeGeo>;
  /** Lattice bounds, for rendering. */
  width: number;
  height: number;
}

/** Roughly 19 tiles for up to four teams, 30 for five or six. */
export function boardSizeFor(teamCount: number): BoardSize {
  return teamCount <= 4 ? "small" : "large";
}

const cache = new Map<BoardSize, Geometry>();

export function geometry(size: BoardSize): Geometry {
  let geo = cache.get(size);
  if (!geo) {
    geo = buildGeometry(size);
    cache.set(size, geo);
  }
  return geo;
}

function buildGeometry(size: BoardSize): Geometry {
  const rows = ROW_LENGTHS[size];
  const maxLen = Math.max(...rows);
  const centers: { x: number; y: number }[] = [];
  rows.forEach((len, r) => {
    for (let c = 0; c < len; c++) centers.push({ x: 2 * c + (maxLen - len) + 1, y: 3 * r + 2 });
  });

  const points = new Map<string, { x: number; y: number }>();
  const tileCornerKeys = centers.map(({ x, y }) =>
    CORNERS.map(([dx, dy]) => {
      const key = `${x + dx},${y + dy}`;
      points.set(key, { x: x + dx, y: y + dy });
      return key;
    }),
  );

  const label = labelPoints([...points.values()]);
  const vertices = new Map<string, VertexGeo>();
  for (const [key, p] of points) {
    const id = label.get(key)!;
    vertices.set(id, { id, x: p.x, y: p.y, tiles: [], edges: [], neighbors: [] });
  }

  const edges = new Map<string, EdgeGeo>();
  const tiles = centers.map((center, index) => {
    const corners = tileCornerKeys[index]!.map((key) => label.get(key)!);
    corners.forEach((id, i) => {
      vertices.get(id)!.tiles.push(index);
      addEdge(edges, vertices, id, corners[(i + 1) % 6]!);
    });
    return { index, x: center.x, y: center.y, corners };
  });

  const height = 3 * rows.length + 1;
  return { size, tiles, vertices, edges, width: 2 * maxLen, height };
}

function labelPoints(points: { x: number; y: number }[]): Map<string, string> {
  const ys = [...new Set(points.map((p) => p.y))].sort((a, b) => a - b);
  const labels = new Map<string, string>();
  ys.forEach((y, row) => {
    const letter = String.fromCharCode(65 + row);
    points
      .filter((p) => p.y === y)
      .sort((a, b) => a.x - b.x)
      .forEach((p, i) => {
        labels.set(`${p.x},${p.y}`, `${letter}${i + 1}`);
      });
  });
  return labels;
}

function addEdge(edges: Map<string, EdgeGeo>, vertices: Map<string, VertexGeo>, p: string, q: string): void {
  const vp = vertices.get(p)!;
  const vq = vertices.get(q)!;
  const [a, b] = vp.y < vq.y || (vp.y === vq.y && vp.x < vq.x) ? [vp, vq] : [vq, vp];
  const id = `${a.id}-${b.id}`;
  if (edges.has(id)) return;
  edges.set(id, { id, a: a.id, b: b.id });
  a.edges.push(id);
  b.edges.push(id);
  a.neighbors.push(b.id);
  b.neighbors.push(a.id);
}

/** Shortest number of edges between two vertices. */
export function vertexDistances(geo: Geometry, from: string): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i]!;
    for (const n of geo.vertices.get(v)!.neighbors) {
      if (dist.has(n)) continue;
      dist.set(n, dist.get(v)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** Orders labels the way players read them: by row letter, then by number. */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}
