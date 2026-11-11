import { describe, expect, test } from "bun:test";
import { createTestGame, expectOk, setUpTeams, startedGame } from "./test-kit.ts";
import { eventOf } from "./types.ts";

describe("thanking", () => {
  test("gives the recipient one unit of the giver's team resource", async () => {
    const { game } = await startedGame();
    const result = await game.thank("e1", "d1", "Helped me design the screen");
    const event = eventOf(result, "ThanksGiven")!;
    expect(event).toMatchObject({ from: "e1", to: "d1", resource: "ore", reason: "Helped me design the screen" });
    expect(event.fromTeam.name).toBe("Engineering");
    expect(event.toTeam?.name).toBe("Design");
    expect((await game.playerView("d1")).inventory).toEqual({ ore: 1 });
  });

  test("keeps a link to the message it was given from", async () => {
    const { game } = await startedGame();
    const event = eventOf(
      await game.thank("e1", "d1", "Thanks for the answer", "https://x.slack.com/p1"),
      "ThanksGiven",
    );
    expect(event?.sourceRef).toBe("https://x.slack.com/p1");
  });

  test("teammates can be thanked too", async () => {
    const { game } = await startedGame();
    expectOk(await game.thank("e1", "e2", "Code review on Friday evening"));
    expect((await game.playerView("e2")).inventory).toEqual({ ore: 1 });
  });

  test("tells whether the recipient is thanked for the first time", async () => {
    const { game } = await startedGame();
    expect(eventOf(await game.thank("e1", "d1", "First thanks"), "ThanksGiven")?.recipientIsNew).toBe(true);
    expect(eventOf(await game.thank("e2", "d1", "Second thanks"), "ThanksGiven")?.recipientIsNew).toBe(false);
  });

  test("tracks the allowance left this week", async () => {
    const { game } = await startedGame();
    expect((await game.playerView("e1")).allowance).toEqual({ total: 3, used: 0, left: 3 });
    expect(eventOf(await game.thank("e1", "d1", "Thanks a lot!"), "ThanksGiven")?.allowanceLeft).toBe(2);
    expect((await game.playerView("e1")).allowance).toEqual({ total: 3, used: 1, left: 2 });
  });

  describe("rejects", () => {
    test("thanking yourself", async () => {
      const { game } = await startedGame();
      expect(await game.thank("e1", "e1", "I am great")).toEqual({ ok: false, reason: "SELF_THANKS" });
    });

    test("a missing or too short reason", async () => {
      const { game } = await startedGame();
      expect(await game.thank("e1", "d1", "  ty ")).toEqual({ ok: false, reason: "REASON_TOO_SHORT" });
    });

    test("thanking the same person twice in a week", async () => {
      const { game } = await startedGame();
      expectOk(await game.thank("e1", "d1", "Thanks for the help"));
      expect(await game.thank("e1", "d1", "Thanks once more")).toEqual({
        ok: false,
        reason: "ALREADY_THANKED_THIS_WEEK",
      });
    });

    test("thanks beyond the weekly allowance", async () => {
      const { game } = await startedGame();
      for (const to of ["d1", "d2", "d3"]) expectOk(await game.thank("e1", to, "Thanks for the help"));
      expect(await game.thank("e1", "d4", "Thanks for the help")).toEqual({ ok: false, reason: "NO_ALLOWANCE" });
      expect((await game.playerView("d4")).inventory).toEqual({});
    });

    test("an opted-out recipient", async () => {
      const { game } = await startedGame();
      expectOk(await game.setOptOut("d1", true));
      expect(await game.thank("e1", "d1", "Thanks for the help")).toEqual({ ok: false, reason: "RECIPIENT_OPTED_OUT" });
    });

    test("an opted-out giver", async () => {
      const { game } = await startedGame();
      expectOk(await game.setOptOut("e1", true));
      expect(await game.thank("e1", "d1", "Thanks for the help")).toEqual({ ok: false, reason: "OPTED_OUT" });
    });

    test("a giver without a team, who has no resource to give", async () => {
      const { game } = await startedGame();
      expect(await game.thank("newbie", "d1", "Thanks for the help")).toEqual({ ok: false, reason: "NOT_ON_TEAM" });
    });

    test("thanks outside a season", async () => {
      const { game } = await createTestGame();
      await setUpTeams(game);
      expect(await game.thank("e1", "d1", "Thanks for the help")).toEqual({ ok: false, reason: "NO_ACTIVE_SEASON" });
    });
  });

  describe("allowance", () => {
    test("renews at Monday midnight Prague time; unused allowance does not carry over", async () => {
      const { game, clock } = await startedGame();
      expectOk(await game.thank("e1", "d1", "Thanks for the help"));
      clock.set("2026-11-15T22:59:00Z"); // Sunday 23:59 in Prague
      expectOk(await game.thank("e1", "d2", "Thanks for the help"));
      expectOk(await game.thank("e1", "d3", "Thanks for the help"));
      expect(await game.thank("e1", "d4", "Thanks for the help")).toEqual({ ok: false, reason: "NO_ALLOWANCE" });

      clock.set("2026-11-15T23:00:00Z"); // Monday 00:00 in Prague
      expect((await game.playerView("e1")).allowance).toEqual({ total: 3, used: 0, left: 3 });
      expectOk(await game.thank("e1", "d1", "New week, new thanks"));
    });

    test("players on teams of three or fewer get a bigger allowance", async () => {
      const { game } = await startedGame({
        teams: [
          { name: "Engineering", resource: "ore", players: ["e1", "e2", "e3", "e4"] },
          { name: "Design", resource: "wool", players: ["d1", "d2"] },
          { name: "Sales", resource: "grain", players: ["s1", "s2", "s3", "s4"] },
        ],
      });
      expect((await game.playerView("d1")).allowance?.total).toBe(5);
      expect((await game.playerView("e1")).allowance?.total).toBe(3);
    });
  });

  describe("players without a team", () => {
    test("can be thanked, and keep what they received when assigned", async () => {
      const { game } = await startedGame();
      expectOk(await game.thank("e1", "newbie", "Welcome, and thanks for the help"));
      expect(await game.build("newbie", "road", "A1-B1")).toEqual({ ok: false, reason: "NOT_ON_TEAM" });
      const assigned = eventOf(await game.assignPlayer("newbie", "Design"), "PlayerAssigned");
      expect(assigned?.heldResources).toEqual({ ore: 1 });
      expect((await game.playerView("newbie")).team?.name).toBe("Design");
    });
  });
});
