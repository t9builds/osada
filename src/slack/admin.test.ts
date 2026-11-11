import { describe, expect, test } from "bun:test";
import { createTestGame, expectOk, setUpTeams } from "../game/test-kit.ts";
import { parseResource, runAdminCommand, tokenize } from "./admin.ts";
import { slackHarness } from "./test-slack.ts";

describe("admin commands", () => {
  test("tokenize keeps quoted team names together", () => {
    expect(tokenize('team "Customer Success" #aabbcc grain')).toEqual(["team", "Customer Success", "#aabbcc", "grain"]);
  });

  test("resources are recognised by name, in any case", () => {
    expect(parseResource("Grain")).toBe("grain");
    expect(parseResource("wood")).toBe("wood");
    expect(parseResource("gold")).toBeUndefined();
  });

  test("set up teams, channels and a season", async () => {
    const { game } = await createTestGame();
    const { deps } = slackHarness(game);
    const run = (text: string) => runAdminCommand(deps, text);
    expect((await run('team "Customer Success" #aabbcc grain')).reply).toContain("Team *Customer Success* is ready");
    expect((await run("team Ops red ore")).reply).toContain("Give the colour as #rrggbb");
    expect((await run("channel thanks <#C0THANKS|osada>")).reply).toContain("<#C0THANKS>");
    expect((await game.config()).thanksChannel).toBe("C0THANKS");
    expect((await run("set allowance 4")).reply).toBe("Set: allowance = 4.");
    expect((await game.config()).allowance).toBe(4);
    expect((await run("season start")).reply).toContain("at least 3 teams");
    await setUpTeams(game, [
      { name: "A", resource: "ore", players: ["a1"] },
      { name: "B", resource: "wool", players: ["b1"] },
    ]);
    const started = await run("season start 4 99");
    expect(started.reply).toContain("The season has started");
    expect(started.events.map((e) => e.type)).toEqual(["SeasonStarted"]);
  });

  test("assign a whole user group", async () => {
    const { game } = await createTestGame();
    await setUpTeams(game);
    const { deps, calls } = slackHarness(game, { "usergroups.users.list": { users: ["u1", "u2"] } });
    const result = await runAdminCommand(deps, "group <!subteam^S0DESIGN|@design> Design");
    expect(calls[0]).toMatchObject({ method: "usergroups.users.list", args: { usergroup: "S0DESIGN" } });
    expect(result.reply).toBe("Added 2 people to team *Design*.");
    expect((await game.playerView("u2")).team?.name).toBe("Design");
  });

  test("the audit log lists resource movements", async () => {
    const { game } = await createTestGame();
    await setUpTeams(game);
    expectOk(await game.startSeason());
    expectOk(await game.grant("d1", "ore", 2, "Quiz"));
    const { deps } = slackHarness(game);
    expect((await runAdminCommand(deps, "audit <@d1>")).reply).toContain("<@d1> +2 :rock: ore (grant admin) – Quiz");
  });
});
