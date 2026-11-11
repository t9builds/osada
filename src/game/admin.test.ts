import { describe, expect, test } from "bun:test";
import { createTestGame, expectOk, setUpTeams, startedGame } from "./test-kit.ts";
import { eventOf } from "./types.ts";

describe("teams", () => {
  test("are defined with a name, colour and a resource no other team has", async () => {
    const { game } = await createTestGame();
    const event = eventOf(await game.defineTeam({ name: "Design", color: "#3B7DD8", resource: "wool" }), "TeamDefined");
    expect(event?.team).toEqual({ id: 1, name: "Design", color: "#3b7dd8", resource: "wool" });
    expect(await game.defineTeam({ name: "Sales", color: "#000000", resource: "wool" })).toEqual({
      ok: false,
      reason: "RESOURCE_TAKEN",
    });
    expect(await game.defineTeam({ name: "Sales", color: "red", resource: "grain" })).toEqual({
      ok: false,
      reason: "INVALID_COLOR",
    });
    expectOk(await game.defineTeam({ name: "design", color: "#111111", resource: "glass" }));
    expect(await game.teams()).toEqual([{ id: 1, name: "design", color: "#111111", resource: "glass" }]);
  });

  test("can't change during a season", async () => {
    const { game } = await startedGame();
    expect(await game.defineTeam({ name: "Ops", color: "#123456", resource: "wood" })).toEqual({
      ok: false,
      reason: "SEASON_IN_PROGRESS",
    });
  });
});

describe("players", () => {
  test("move between teams only between seasons", async () => {
    const { game } = await startedGame();
    expect(await game.assignPlayer("e1", "Design")).toEqual({ ok: false, reason: "SEASON_IN_PROGRESS" });
    expect(await game.assignPlayer("e1", "Nobody")).toEqual({ ok: false, reason: "UNKNOWN_TEAM" });
    expectOk(await game.endSeason());
    expectOk(await game.assignPlayer("e1", "design"));
    expect((await game.playerView("e1")).team?.name).toBe("Design");
  });

  test("can opt out and back in", async () => {
    const { game } = await startedGame();
    expectOk(await game.setOptOut("d1", true));
    const view = await game.playerView("d1");
    expect(view.optedOut).toBe(true);
    expect(view.allowance).toBeNull();
    expect(await game.legalMoves("d1")).toEqual({ ok: false, reason: "OPTED_OUT" });
    expectOk(await game.setOptOut("d1", false));
    expectOk(await game.thank("e1", "d1", "Vítej zpátky"));
  });

  test("a newcomer is flagged until they take part", async () => {
    const { game } = await startedGame();
    expect((await game.playerView("e1")).isNewcomer).toBe(true);
    expectOk(await game.thank("e1", "d1", "Díky za pomoc"));
    expect((await game.playerView("e1")).isNewcomer).toBe(false);
    expect((await game.playerView("nobody")).team).toBeNull();
  });
});

describe("grants and the audit log", () => {
  test("an admin grant adds resources and is logged with its note", async () => {
    const { game } = await startedGame();
    const event = eventOf(await game.grant("d1", "ore", 2, "Výhra v kvízu"), "ResourceGranted");
    expect(event).toMatchObject({ player: "d1", resource: "ore", amount: 2 });
    expect((await game.playerView("d1")).inventory).toEqual({ ore: 2 });
    expect((await game.auditLog())[0]).toMatchObject({ player: "d1", delta: 2, kind: "grant", note: "Výhra v kvízu" });
    expect(await game.grant("d1", "glass", 1, "x")).toEqual({ ok: false, reason: "RESOURCE_NOT_IN_PLAY" });
    expect(await game.grant("d1", "ore", 0, "x")).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
  });

  test("every resource movement is in the log", async () => {
    const { game } = await startedGame();
    expectOk(await game.thank("d1", "e1", "Díky za pomoc"));
    expectOk(await game.thank("d2", "e1", "Díky za pomoc"));
    expectOk(await game.thank("d3", "e1", "Díky za pomoc"));
    expectOk(await game.bankTrade("e1", "wool", "grain"));
    const log = await game.auditLog({ player: "e1" });
    expect(log.map((e) => [e.kind, e.resource, e.delta])).toEqual([
      ["bank", "grain", 1],
      ["bank", "wool", -3],
      ["thanks", "wool", 1],
      ["thanks", "wool", 1],
      ["thanks", "wool", 1],
    ]);
  });
});

describe("configuration", () => {
  test("changes allowance, costs and channels, and rejects invalid values", async () => {
    const { game } = await createTestGame();
    expectOk(await game.configure({ allowance: 4, smallTeamAllowance: 6, costs: { road: 3 }, thanksChannel: "C1" }));
    const config = await game.config();
    expect(config).toMatchObject({ allowance: 4, thanksChannel: "C1", costs: { road: 3, settlement: 3, city: 4 } });
    expect(await game.configure({ allowance: 0 })).toEqual({ ok: false, reason: "INVALID_CONFIG" });
    expect(await game.configure({ timezone: "Mars/Olympus" })).toEqual({ ok: false, reason: "INVALID_CONFIG" });
    await setUpTeams(game);
    expectOk(await game.startSeason());
    expect((await game.playerView("e1")).allowance?.total).toBe(4);
  });
});
