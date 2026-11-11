import { describe, expect, test } from "bun:test";
import { geometry } from "../engine/board.ts";
import type { GameService } from "./service.ts";
import { createTestGame, expectOk, setUpTeams, startedGame } from "./test-kit.ts";
import { eventOf } from "./types.ts";

async function buildFirstSettlement(game: GameService, player: string) {
  for (let i = 0; i < 6; i++) {
    const moves = await game.legalMoves(player);
    if (!moves.ok) throw new Error(moves.reason);
    const [road, settlement] = moves.moves;
    for (const r of ["ore", "wool", "grain"] as const) expectOk(await game.grant(player, r, 1, "test"));
    if (settlement!.locations[0]) return expectOk(await game.build(player, "settlement", settlement!.locations[0]));
    expectOk(await game.build(player, "road", road!.locations[0]!));
  }
  throw new Error("no settlement spot");
}

describe("season start", () => {
  test("places one settlement and one road per team, from a reproducible seed", async () => {
    const { game } = await startedGame({ seed: 7 });
    const board = (await game.board())!;
    expect(board.size).toBe("small");
    expect(board.tiles).toHaveLength(19);
    for (const teamId of [1, 2, 3]) {
      expect(board.buildings.filter((b) => b.teamId === teamId).map((b) => b.kind)).toEqual(["settlement", "road"]);
    }
    const again = await startedGame({ seed: 7 });
    expect((await again.game.board())!.tiles).toEqual(board.tiles);
  });

  test("scales the board with the number of teams", async () => {
    const { game } = await startedGame({
      teams: ["ore", "wool", "grain", "wood", "brick"].map((resource, i) => ({
        name: `Tým ${i}`,
        resource: resource as "ore",
        players: [`p${i}`],
      })),
    });
    expect((await game.board())!.tiles).toHaveLength(30);
  });

  test("needs at least three teams and no running season", async () => {
    const { game } = await createTestGame();
    expect(await game.startSeason()).toEqual({ ok: false, reason: "TOO_FEW_TEAMS" });
    await setUpTeams(game);
    expectOk(await game.startSeason({ weeks: 4 }));
    expect(await game.startSeason()).toEqual({ ok: false, reason: "SEASON_ALREADY_ACTIVE" });
    expect((await game.playerView("e1")).season).toMatchObject({ weekNumber: 1, weeks: 4 });
  });

  test("starting buildings give every team the same score", async () => {
    const { game } = await startedGame();
    expect((await game.scoreboard()).map((s) => s.points)).toEqual([4, 4, 4]);
  });
});

describe("week rollover", () => {
  test("does nothing until a new week starts, then advances once", async () => {
    const { game, clock } = await startedGame();
    expect(await game.rollWeek()).toEqual({ ok: true, events: [] });
    clock.set("2026-11-16T08:00:00Z");
    expect(eventOf(await game.rollWeek(), "WeekRolled")).toMatchObject({ endedWeek: "2026-11-09", weekNumber: 2 });
    expect(await game.rollWeek()).toEqual({ ok: true, events: [] });
  });

  test("pays each settlement one resource per adjacent productive tile", async () => {
    const { game, clock } = await startedGame();
    await buildFirstSettlement(game, "e1");
    const board = (await game.board())!;
    const own = board.buildings.find((b) => b.kind === "settlement" && b.playerId === "e1")!;
    clock.advanceDays(7);
    const paid = eventOf(await game.rollWeek(), "HarvestPaid");
    expect(paid?.player).toBe("e1");
    const total = Object.values(paid!.resources).reduce((a, b) => a + b, 0);
    expect(total).toBe(productiveTilesAround(board.tiles, own.location, board.size));
  });

  test("cities pay double; team-owned starting settlements pay nothing", async () => {
    const { game, clock } = await startedGame();
    const start = (await game.board())!.buildings.find((b) => b.kind === "settlement" && b.teamId === 1)!;
    clock.advanceDays(7);
    expect(eventOf(await game.rollWeek(), "HarvestPaid")).toBeUndefined();
    for (const r of ["ore", "wool", "grain"] as const) expectOk(await game.grant("e1", r, 1, "test"));
    expectOk(await game.build("e1", "city", start.location));
    clock.advanceDays(7);
    const paid = eventOf(await game.rollWeek(), "HarvestPaid")!;
    const board = (await game.board())!;
    const total = Object.values(paid.resources).reduce((a, b) => a + b, 0);
    expect(total).toBe(2 * productiveTilesAround(board.tiles, start.location, board.size));
  });

  test("the weekly digest summarises the week that ended", async () => {
    const { game, clock } = await startedGame();
    expectOk(await game.thank("e1", "d1", "Krátké díky"));
    expectOk(await game.thank("e2", "d1", "Velmi dlouhé a podrobné poděkování za pomoc s releasem"));
    clock.advanceDays(7);
    expectOk(await game.rollWeek());
    const digest = (await game.weeklyDigest())!;
    expect(digest.weekKey).toBe("2026-11-09");
    expect(digest.thanksCount).toBe(2);
    expect(digest.topThanks[0]!.from).toBe("e2");
    expect(digest.scoreboard).toHaveLength(3);
  });
});

describe("season end", () => {
  test("ends after its last week with the winner and highlights, and resets inventories", async () => {
    const { game, clock } = await startedGame();
    expectOk(await game.thank("e1", "d1", "Díky za pomoc"));
    expectOk(await game.thank("s1", "d1", "Díky za pomoc"));
    expectOk(await game.thank("e2", "e3", "Díky za pomoc"));
    await buildFirstSettlement(game, "d2");
    let ended: ReturnType<typeof eventOf<"SeasonEnded">>;
    for (let week = 0; week < 6; week++) {
      expect(ended).toBeUndefined();
      clock.advanceDays(7);
      ended = eventOf(await game.rollWeek(), "SeasonEnded");
    }
    expect(ended!.result.winners.map((t) => t.name)).toEqual(["Design"]);
    expect(ended!.result.mostThanked).toEqual({ player: "d1", count: 2 });
    expect(ended!.result.mostCrossTeamThanks).toEqual({ player: "e1", count: 1 });
    expect(ended!.result.totalThanks).toBe(3);

    expect(await game.thank("e1", "d1", "Díky za pomoc")).toEqual({ ok: false, reason: "NO_ACTIVE_SEASON" });
    const history = await game.seasonHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.result.winners[0]!.name).toBe("Design");
    expect((await game.board())!.status).toBe("ended");

    expectOk(await game.startSeason());
    expect((await game.playerView("d1")).inventory).toEqual({});
  });

  test("an admin can end the season early", async () => {
    const { game } = await startedGame();
    const ended = eventOf(await game.endSeason(), "SeasonEnded")!;
    expect(ended.result.winners).toHaveLength(3); // tied on starting buildings
    expect(await game.endSeason()).toEqual({ ok: false, reason: "NO_ACTIVE_SEASON" });
  });
});

function productiveTilesAround(tiles: string[], vertex: string, size: "small" | "large"): number {
  return geometry(size)
    .vertices.get(vertex)!
    .tiles.filter((t) => tiles[t] !== "desert").length;
}
