import { describe, expect, test } from "bun:test";
import type { Resource } from "../engine/resources.ts";
import type { GameService } from "./service.ts";
import { expectOk, startedGame } from "./test-kit.ts";
import { eventOf, type MoveOption } from "./types.ts";

async function fund(game: GameService, player: string, resources: Resource[], amount = 1) {
  for (const r of resources) expectOk(await game.grant(player, r, amount, "test"));
}

async function moves(game: GameService, player: string): Promise<Record<string, MoveOption>> {
  const result = await game.legalMoves(player);
  if (!result.ok) throw new Error(result.reason);
  return Object.fromEntries(result.moves.map((m) => [m.kind, m]));
}

/** Builds roads until a settlement spot opens up for the player's team, returning it. */
async function roadToSettlementSpot(game: GameService, player: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const spot = (await moves(game, player)).settlement!.locations[0];
    if (spot) return spot;
    await fund(game, player, ["ore", "wool"]);
    expectOk(await game.build(player, "road", (await moves(game, player)).road!.locations[0]!));
  }
  throw new Error("no settlement spot reachable");
}

describe("building", () => {
  test("lists each building's cost in different resources and what would be paid", async () => {
    const { game } = await startedGame();
    await fund(game, "e1", ["ore", "wool"]);
    const m = await moves(game, "e1");
    expect(m.road).toMatchObject({ cost: 2, payment: ["wool", "ore"] });
    expect(m.settlement).toMatchObject({ cost: 3, payment: null });
    // A city costs 4 but only three resources are in play.
    expect(m.city!.cost).toBe(3);
  });

  test("a road must touch the team's network", async () => {
    const { game } = await startedGame();
    const roads = (await moves(game, "e1")).road!.locations;
    expect(roads.length).toBeGreaterThan(0);
    const board = (await game.board())!;
    const start = board.buildings.find((b) => b.kind === "settlement" && b.teamId === 1)!;
    const startRoad = board.buildings.find((b) => b.kind === "road" && b.teamId === 1)!;
    const [a, b] = startRoad.location.split("-");
    for (const road of roads) {
      const ends = road.split("-");
      expect(ends.includes(start.location) || ends.includes(a!) || ends.includes(b!)).toBe(true);
    }
  });

  test("a road spends two different resources and scores a point for the team", async () => {
    const { game } = await startedGame();
    await fund(game, "e1", ["ore", "wool", "grain"]);
    const road = (await moves(game, "e1")).road!.locations[0]!;
    const before = (await game.scoreboard()).find((s) => s.team.name === "Engineering")!.points;
    const event = eventOf(await game.build("e1", "road", road), "BuildingBuilt");
    expect(event).toMatchObject({ player: "e1", kind: "road", location: road });
    expect(event!.paid).toHaveLength(2);
    const view = await game.playerView("e1");
    expect(Object.values(view.inventory).reduce((a, b) => a + b, 0)).toBe(1);
    expect(view.buildings).toEqual([{ kind: "road", location: road }]);
    expect(view.scoreboard.find((s) => s.team.name === "Engineering")!.points).toBe(before + 1);
  });

  test("teammates share the network", async () => {
    const { game } = await startedGame();
    await fund(game, "e1", ["ore", "wool"]);
    const road = (await moves(game, "e1")).road!.locations[0]!;
    expectOk(await game.build("e1", "road", road));
    const [, far] = road.split("-");
    expect((await moves(game, "e2")).road!.locations.some((r) => r.split("-").includes(far!))).toBe(true);
  });

  test("rejects building without the resources", async () => {
    const { game } = await startedGame();
    await fund(game, "e1", ["ore"], 5);
    const road = (await moves(game, "e1")).road!.locations[0]!;
    expect(await game.build("e1", "road", road)).toEqual({ ok: false, reason: "INSUFFICIENT_RESOURCES" });
  });

  test("rejects an illegal location", async () => {
    const { game } = await startedGame();
    await fund(game, "e1", ["ore", "wool"]);
    const rivalStart = (await game.board())!.buildings.find((b) => b.kind === "settlement" && b.teamId === 2)!;
    expect(await game.build("e1", "settlement", rivalStart.location)).toEqual({
      ok: false,
      reason: "ILLEGAL_LOCATION",
    });
    expect(await game.build("e1", "road", "Z1-Z2")).toEqual({ ok: false, reason: "ILLEGAL_LOCATION" });
  });

  test("a settlement goes on the team's roads, away from other settlements, and scores 3", async () => {
    const { game } = await startedGame();
    const spot = await roadToSettlementSpot(game, "e1");
    const board = (await game.board())!;
    await fund(game, "e1", ["ore", "wool", "grain"]);
    const before = (await game.scoreboard()).find((s) => s.team.name === "Engineering")!.points;
    expectOk(await game.build("e1", "settlement", spot));
    expect((await game.scoreboard()).find((s) => s.team.name === "Engineering")!.points).toBe(before + 3);
    // The distance rule: no settlement spot is next to the new one.
    const roadEnds = board.buildings.filter((b) => b.kind === "road").flatMap((b) => b.location.split("-"));
    expect(roadEnds).toContain(spot);
    const after = (await moves(game, "e1")).settlement!.locations;
    expect(after).not.toContain(spot);
  });

  test("a player upgrades their own settlement, or the team's starting one, to a city worth 6", async () => {
    const { game } = await startedGame();
    const start = (await game.board())!.buildings.find((b) => b.kind === "settlement" && b.teamId === 1)!;
    expect((await moves(game, "e1")).city!.locations).toEqual([start.location]);
    expect((await moves(game, "d1")).city!.locations).not.toContain(start.location);
    await fund(game, "e1", ["ore", "wool", "grain"]);
    const before = (await game.scoreboard()).find((s) => s.team.name === "Engineering")!.points;
    expectOk(await game.build("e1", "city", start.location));
    expect((await game.scoreboard()).find((s) => s.team.name === "Engineering")!.points).toBe(before + 3);
    expect((await game.playerView("e1")).buildings).toEqual([{ kind: "city", location: start.location }]);
    // Now it is e1's city: a teammate can't upgrade it again.
    expect((await moves(game, "e2")).city!.locations).toEqual([]);
  });

  test("a location taken between listing and building is rejected", async () => {
    const { game } = await startedGame();
    await fund(game, "e1", ["ore", "wool"]);
    await fund(game, "e2", ["ore", "wool"]);
    const road = (await moves(game, "e1")).road!.locations[0]!;
    expect((await moves(game, "e2")).road!.locations).toContain(road);
    const [first, second] = await Promise.all([game.build("e1", "road", road), game.build("e2", "road", road)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(first.ok ? second : first).toEqual({ ok: false, reason: "ILLEGAL_LOCATION" });
    // The loser keeps their resources.
    const loser = first.ok ? "e2" : "e1";
    expect((await game.playerView(loser)).inventory).toEqual({ ore: 1, wool: 1 });
  });

  test("the team with the longest road of at least five gets two bonus points", async () => {
    const { game } = await startedGame();
    let change: ReturnType<typeof eventOf<"LongestRoadChanged">>;
    for (let i = 0; i < 4 && !change; i++) {
      await fund(game, "e1", ["ore", "wool"]);
      const road = await extendingRoad(game, "e1");
      change = eventOf(await game.build("e1", "road", road), "LongestRoadChanged");
    }
    expect(change?.team?.name).toBe("Engineering");
    const score = (await game.scoreboard()).find((s) => s.team.name === "Engineering")!;
    expect(score.bonus).toBe(2);
    expect(score.points).toBe(score.buildingPoints + 2);
  });
});

/** A legal road that lengthens the team's longest chain: one leaving the current far end. */
async function extendingRoad(game: GameService, player: string): Promise<string> {
  const board = (await game.board())!;
  const own = board.buildings.filter((b) => b.kind === "road" && b.teamId === 1).map((b) => b.location);
  const settlement = board.buildings.find((b) => b.kind === "settlement" && b.teamId === 1)!.location;
  const degree = new Map<string, number>();
  for (const r of own) for (const v of r.split("-")) degree.set(v, (degree.get(v) ?? 0) + 1);
  const ends = [...degree].filter(([v, n]) => n === 1 && v !== settlement).map(([v]) => v);
  const legal = (await moves(game, player)).road!.locations;
  return legal.find((r) => r.split("-").some((v) => ends.includes(v))) ?? legal[0]!;
}
