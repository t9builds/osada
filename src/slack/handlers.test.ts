import { describe, expect, test } from "bun:test";
import { expectOk, startedGame } from "../game/test-kit.ts";
import { parseThanks } from "./handlers.ts";
import { fixture, slackHarness } from "./test-slack.ts";

async function gameWithChannels() {
  const ctx = await startedGame();
  expectOk(await ctx.game.configure({ thanksChannel: "C0THANKS", tradeChannel: "C0TRADE", digestChannel: "C0GAME" }));
  return ctx;
}

describe("/dekuju", () => {
  test("parses the mention and the reason", () => {
    expect(parseThanks("<@U123|jana> za pomoc s nasazením")).toEqual({ to: "U123", reason: "za pomoc s nasazením" });
    expect(parseThanks("<@U123>   díky\nmoc")).toEqual({ to: "U123", reason: "díky\nmoc" });
    expect(parseThanks("@jana díky")).toBeNull();
  });

  test("posts the thanks publicly, DMs the recipient, confirms to the giver and refreshes both homes", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    await slack.handlers.thanksCommand({
      command: await fixture("command-dekuju"),
      ack: slack.ack,
      respond: slack.respond,
    });

    expect(slack.replies).toEqual([
      { response_type: "ephemeral", text: expect.stringContaining("<@d1> dostává 1× :rock: ruda") },
    ]);
    expect(slack.replies[0].text).toContain("ještě 2×");
    const [publicPost] = slack.posts("C0THANKS");
    expect(publicPost!.args.text).toContain("<@e1> děkuje <@d1>: „za skvělý návrh onboarding obrazovky“");
    const [dm] = slack.posts("d1");
    expect(dm!.args.text).toContain("Poděkování od <@e1>");
    expect(dm!.args.text).toContain("Vítej v Osadě");
    const homes = slack.calls.filter((c) => c.method === "views.publish").map((c) => c.args.user_id);
    expect(homes.sort()).toEqual(["d1", "e1"]);
  });

  test("answers a rejected thanks with a Czech explanation and posts nothing", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    const command = { ...(await fixture("command-dekuju")), text: "<@e1> jsem nejlepší" };
    await slack.handlers.thanksCommand({ command, ack: slack.ack, respond: slack.respond });
    expect(slack.replies).toEqual([
      { response_type: "ephemeral", text: expect.stringContaining("Sobě poděkovat nejde") },
    ]);
    expect(slack.calls.filter((c) => c.method === "chat.postMessage")).toEqual([]);
  });

  test("explains usage when no one is mentioned", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    const command = { ...(await fixture("command-dekuju")), text: "díky všem" };
    await slack.handlers.thanksCommand({ command, ack: slack.ack, respond: slack.respond });
    expect(slack.replies[0].text).toContain("Použití");
  });
});

describe("thanks shortcut", () => {
  test("opens a modal with the message author preselected and links the message", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game, {
      "chat.getPermalink": { permalink: "https://acme.slack.com/archives/C0GENERAL/p1" },
    });
    await slack.handlers.thanksShortcut({ shortcut: await fixture("shortcut-podekovat"), ack: slack.ack });
    const view = slack.calls.find((c) => c.method === "views.open")!.args.view;
    expect(view.blocks[0].element.initial_user).toBe("d1");

    const values = {
      recipient: { value: { selected_user: "d1" } },
      reason: { value: { value: "Díky za rychlé nasazení" } },
    };
    await slack.handlers.thanksSubmit({
      ack: slack.ack,
      body: { user: { id: "e1" } },
      view: { private_metadata: view.private_metadata, state: { values } },
    });
    expect(slack.acks.at(-1)).toBeUndefined();
    expect(slack.posts("C0THANKS")[0]!.args.blocks[1].elements[0].text).toContain(
      "<https://acme.slack.com/archives/C0GENERAL/p1|původní zpráva>",
    );
  });
});

describe("building", () => {
  test("the build modal offers only affordable buildings, grouped, with their costs", async () => {
    const { game } = await gameWithChannels();
    expectOk(await game.grant("e1", "ore", 1, "test"));
    expectOk(await game.grant("e1", "wool", 1, "test"));
    const slack = slackHarness(game);
    await slack.handlers.buildCommand({
      command: await fixture("command-dekuju"),
      ack: slack.ack,
      respond: slack.respond,
    });
    const view = slack.calls.find((c) => c.method === "views.open")!.args.view;
    const groups = view.blocks[0].element.option_groups;
    expect(groups.map((g: any) => g.label.text)).toEqual(["Cesta"]);
    expect(groups[0].options[0].value).toMatch(/^road\|[A-L]\d+-[A-L]\d+$/);
    expect(view.blocks[1].elements[0].text).toContain("Osada: 3 různé suroviny (na to nemáš)");
  });

  test("a rejected build shows the reason in the modal", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    const payload = await fixture("view-build-submission");
    await slack.handlers.buildSubmit({ ack: slack.ack, body: payload, view: payload.view });
    expect(slack.acks).toEqual([
      { response_action: "errors", errors: { location: expect.stringContaining("Na tohle místo stavět nejde") } },
    ]);
  });

  test("a settlement is announced in the game channel", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    for (const r of ["ore", "wool", "grain"] as const) expectOk(await game.grant("e1", r, 1, "test"));
    const moves = await game.legalMoves("e1");
    const city = moves.ok ? moves.moves[2]!.locations[0]! : "";
    const values = { location: { value: { selected_option: { value: `city|${city}` } } } };
    await slack.handlers.buildSubmit({ ack: slack.ack, body: { user: { id: "e1" } }, view: { state: { values } } });
    expect(slack.posts("C0GAME")[0]!.args.text).toContain(`Tým *Engineering* má město na ${city}`);
  });
});

describe("trading", () => {
  test("accepting an offer from its message swaps resources and closes the message", async () => {
    const { game } = await gameWithChannels();
    expectOk(await game.thank("d1", "e1", "Díky za pomoc"));
    expectOk(await game.thank("e2", "s1", "Díky za pomoc"));
    expectOk(await game.createOffer("e1", { wool: 1 }, { ore: 1 }));
    const slack = slackHarness(game);
    const payload = await fixture("action-accept-offer");
    await slack.handlers.acceptOfferAction({
      ack: slack.ack,
      body: payload,
      action: payload.actions[0],
      respond: slack.respond,
    });
    const update = slack.calls.find((c) => c.method === "chat.update")!;
    expect(update.args).toMatchObject({ channel: "C0TRADE", ts: "1731320000.000100", blocks: [] });
    expect(update.args.text).toContain("Směna hotová");
    expect((await game.playerView("s1")).inventory).toEqual({ wool: 1 });
  });

  test("a failed acceptance is explained only to the clicker", async () => {
    const { game } = await gameWithChannels();
    expectOk(await game.thank("d1", "e1", "Díky za pomoc"));
    expectOk(await game.createOffer("e1", { wool: 1 }, { ore: 1 }));
    const slack = slackHarness(game);
    const payload = await fixture("action-accept-offer");
    await slack.handlers.acceptOfferAction({
      ack: slack.ack,
      body: payload,
      action: payload.actions[0],
      respond: slack.respond,
    });
    expect(slack.replies).toEqual([
      { response_type: "ephemeral", replace_original: false, text: "Na tohle nemáš dost surovin." },
    ]);
    expect(slack.calls.find((c) => c.method === "chat.update")).toBeUndefined();
  });

  test("a public offer goes to the trade channel with accept and cancel buttons", async () => {
    const { game } = await gameWithChannels();
    expectOk(await game.thank("d1", "e1", "Díky za pomoc"));
    const slack = slackHarness(game);
    const values = {
      give: { value: { selected_option: { value: "wool" } } },
      give_amount: { value: { value: "1" } },
      want: { value: { selected_option: { value: "grain" } } },
      want_amount: { value: { value: "2" } },
      to: { value: { selected_user: null } },
    };
    await slack.handlers.offerSubmit({ ack: slack.ack, body: { user: { id: "e1" } }, view: { state: { values } } });
    const [post] = slack.posts("C0TRADE");
    expect(post!.args.text).toBe(
      "<@e1> nabízí *1× :sheep: vlna* za *2× :ear_of_rice: obilí*".replace(/^/, ":handshake: "),
    );
    expect(post!.args.blocks[1].elements.map((e: any) => e.action_id)).toEqual(["accept_offer", "cancel_offer"]);
  });
});

describe("/osada-admin", () => {
  test("is refused to non-admins", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    const command = { ...(await fixture("command-dekuju")), text: "sezona konec" };
    await slack.handlers.adminCommand({ command, ack: slack.ack, respond: slack.respond });
    expect(slack.replies[0].text).toBe("Tohle může jen admin hry.");
    expect((await game.scoreboard()).length).toBe(3);
  });

  test("grants resources and DMs the player", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    const command = {
      ...(await fixture("command-dekuju")),
      user_id: "admin",
      text: "dar <@d1|dana> 2 ruda Výhra v kvízu",
    };
    await slack.handlers.adminCommand({ command, ack: slack.ack, respond: slack.respond });
    expect(slack.replies[0].text).toBe("<@d1> dostává 2× :rock: ruda.");
    expect(slack.posts("d1")[0]!.args.text).toContain("Výhra v kvízu");
  });
});

describe("App Home", () => {
  test("shows team, allowance, inventory, actions and scoreboard", async () => {
    const { game } = await gameWithChannels();
    expectOk(await game.thank("d1", "e1", "Díky za pomoc"));
    const slack = slackHarness(game);
    await slack.handlers.homeOpened({ event: { user: "e1", tab: "home" } });
    const view = slack.calls.find((c) => c.method === "views.publish")!.args.view;
    const text = JSON.stringify(view.blocks);
    expect(text).toContain("Tým *Engineering*");
    expect(text).toContain("ještě poděkovat *3×* (z 3)");
    expect(text).toContain("1× :sheep: vlna");
    expect(text).toContain("open_build");
    expect(text).toContain("Pořadí týmů");
    expect(text).toContain("Díky za pomoc");
  });

  test("tells a player without a team to ask an admin", async () => {
    const { game } = await gameWithChannels();
    const slack = slackHarness(game);
    await slack.handlers.homeOpened({ event: { user: "newbie", tab: "home" } });
    const text = JSON.stringify(slack.calls.find((c) => c.method === "views.publish")!.args.view.blocks);
    expect(text).toContain("Vítej v Osadě");
    expect(text).toContain("Napiš adminovi hry");
    expect(text).not.toContain("open_build");
  });
});
