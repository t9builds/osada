import { describe, expect, test } from "bun:test";
import { createTestGame, expectOk, setUpTeams } from "../game/test-kit.ts";
import { parseResource, runAdminCommand, tokenize } from "./admin.ts";
import { slackHarness } from "./test-slack.ts";

describe("admin commands", () => {
  test("tokenize keeps quoted team names together", () => {
    expect(tokenize('tym "Customer Success" #aabbcc obilí')).toEqual(["tym", "Customer Success", "#aabbcc", "obilí"]);
  });

  test("resources are recognised by Czech name with or without diacritics", () => {
    expect(parseResource("Obilí")).toBe("grain");
    expect(parseResource("drevo")).toBe("wood");
    expect(parseResource("ore")).toBe("ore");
    expect(parseResource("zlato")).toBeUndefined();
  });

  test("set up teams, channels and a season", async () => {
    const { game } = await createTestGame();
    const { deps } = slackHarness(game);
    const run = (text: string) => runAdminCommand(deps, text);
    expect((await run('tym "Customer Success" #aabbcc obilí')).reply).toContain("Tým *Customer Success* je připravený");
    expect((await run("tym Ops red ruda")).reply).toContain("Barvu zadej jako #rrggbb");
    expect((await run("kanal diky <#C0THANKS|osada>")).reply).toContain("<#C0THANKS>");
    expect((await game.config()).thanksChannel).toBe("C0THANKS");
    expect((await run("nastav prideleni 4")).reply).toBe("Nastaveno: prideleni = 4.");
    expect((await game.config()).allowance).toBe(4);
    expect((await run("sezona start")).reply).toContain("aspoň 3 týmy");
    await setUpTeams(game, [
      { name: "A", resource: "ore", players: ["a1"] },
      { name: "B", resource: "wool", players: ["b1"] },
    ]);
    const started = await run("sezona start 4 99");
    expect(started.reply).toContain("Sezóna začala");
    expect(started.events.map((e) => e.type)).toEqual(["SeasonStarted"]);
  });

  test("assign a whole user group", async () => {
    const { game } = await createTestGame();
    await setUpTeams(game);
    const { deps, calls } = slackHarness(game, { "usergroups.users.list": { users: ["u1", "u2"] } });
    const result = await runAdminCommand(deps, "skupina <!subteam^S0DESIGN|@design> Design");
    expect(calls[0]).toMatchObject({ method: "usergroups.users.list", args: { usergroup: "S0DESIGN" } });
    expect(result.reply).toBe("Do týmu *Design* přiřazeno 2 lidí.");
    expect((await game.playerView("u2")).team?.name).toBe("Design");
  });

  test("the audit log lists resource movements", async () => {
    const { game } = await createTestGame();
    await setUpTeams(game);
    expectOk(await game.startSeason());
    expectOk(await game.grant("d1", "ore", 2, "Kvíz"));
    const { deps } = slackHarness(game);
    expect((await runAdminCommand(deps, "audit <@d1>")).reply).toContain("<@d1> +2 :rock: ruda (grant admin) – Kvíz");
  });
});
