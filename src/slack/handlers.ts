/**
 * Slack entry points: slash commands, the message shortcut, modal submissions and buttons. Each parses its payload,
 * calls the game service, and replies; game rules live in the service, Czech copy in `copy.ts` and `views.ts`.
 */
import type { types } from "@slack/bolt";
import { isResource, type Resource } from "../engine/resources.ts";
import type { BuildingKind } from "../engine/rules.ts";
import { type CommandResult, eventOf, type Rejection } from "../game/types.ts";
import { runAdminCommand } from "./admin.ts";
import * as copy from "./copy.ts";
import type { Notifier, SlackDeps } from "./notifier.ts";
import * as views from "./views.ts";

type Ack = (response?: any) => Promise<void>;
type Respond = (message: any) => Promise<unknown>;

export interface CommandArgs {
  command: { user_id: string; text: string; trigger_id: string };
  ack: Ack;
  respond: Respond;
}

export interface ShortcutArgs {
  shortcut: { trigger_id: string; message?: { user?: string; ts: string }; channel?: { id: string } };
  ack: Ack;
}

type StateValue = { selected_option?: { value: string } | null; selected_user?: string | null; value?: string | null };

export interface ViewArgs {
  ack: Ack;
  body: { user: { id: string } };
  view: { private_metadata?: string; state: { values: Record<string, Record<string, StateValue>> } };
}

export interface ActionArgs {
  ack: Ack;
  body: {
    user: { id: string };
    trigger_id?: string;
    channel?: { id: string };
    message?: { ts: string };
  };
  action: { value?: string };
  respond?: Respond;
}

const ephemeral = (text: string) => ({ response_type: "ephemeral" as const, text });

function field(view: ViewArgs["view"], block: string): StateValue {
  return view.state.values[block]?.value ?? {};
}

export function parseThanks(text: string): { to: string; reason: string } | null {
  const match = /^\s*<@(\w+)(?:\|[^>]*)?>\s*(.*)$/s.exec(text);
  return match ? { to: match[1]!, reason: match[2]!.trim() } : null;
}

export function createHandlers(deps: SlackDeps, notifier: Notifier) {
  const { game, client } = deps;

  const openModal = (trigger: string | undefined, view: types.ModalView) =>
    trigger ? client.views.open({ trigger_id: trigger, view }) : Promise.resolve();

  async function openBuild(player: string, trigger: string | undefined, fail: (text: string) => Promise<unknown>) {
    const moves = await game.legalMoves(player);
    if (!moves.ok) {
      await fail(copy.REJECTIONS[moves.reason]);
      return;
    }
    await openModal(trigger, views.buildModal(moves.moves));
  }

  async function openTrade(bank: boolean, trigger: string | undefined, fail: (text: string) => Promise<unknown>) {
    const resources = (await game.teams()).map((t) => t.resource);
    if (!(await game.scoreboard()).length) {
      await fail(copy.REJECTIONS.NO_ACTIVE_SEASON);
      return;
    }
    const config = await game.config();
    await openModal(trigger, bank ? views.bankModal(resources, config.bankRate) : views.offerModal(resources));
  }

  /** Acks a modal with the rejection shown on `block`, or closes it and posts what happened. */
  async function finishModal(ack: Ack, result: CommandResult, block: (reason: Rejection) => string) {
    if (!result.ok) {
      await ack({ response_action: "errors", errors: { [block(result.reason)]: copy.REJECTIONS[result.reason] } });
      return;
    }
    await ack();
    await notifier.publish(result.events);
  }

  return {
    async thanksCommand({ command, ack, respond }: CommandArgs) {
      await ack();
      const parsed = parseThanks(command.text);
      const result = parsed ? await game.thank(command.user_id, parsed.to, parsed.reason) : null;
      if (!result?.ok) {
        await respond(ephemeral(result ? copy.REJECTIONS[result.reason] : copy.USAGE_THANKS));
        return;
      }
      await respond(ephemeral(views.thanksConfirmation(eventOf(result, "ThanksGiven")!)));
      await notifier.publish(result.events);
    },

    async thanksShortcut({ shortcut, ack }: ShortcutArgs) {
      await ack();
      const metadata = JSON.stringify({ channel: shortcut.channel?.id, ts: shortcut.message?.ts });
      await openModal(shortcut.trigger_id, views.thanksModal(shortcut.message?.user, metadata));
    },

    async thanksSubmit({ ack, body, view }: ViewArgs) {
      const to = field(view, "recipient").selected_user ?? "";
      const reason = field(view, "reason").value ?? "";
      const source = JSON.parse(view.private_metadata || "{}") as { channel?: string; ts?: string };
      const permalink =
        source.channel && source.ts
          ? await client.chat
              .getPermalink({ channel: source.channel, message_ts: source.ts })
              .then((r) => r.permalink)
              .catch(() => undefined)
          : undefined;
      const result = await game.thank(body.user.id, to, reason, permalink);
      await finishModal(ack, result, (r) => (r === "REASON_TOO_SHORT" ? "reason" : "recipient"));
      const event = eventOf(result, "ThanksGiven");
      if (event) await notifier.post(body.user.id, { text: views.thanksConfirmation(event) });
    },

    async buildCommand({ command, ack, respond }: CommandArgs) {
      await ack();
      await openBuild(command.user_id, command.trigger_id, (text) => respond(ephemeral(text)));
    },

    async buildSubmit({ ack, body, view }: ViewArgs) {
      const [kind, location] = (field(view, "location").selected_option?.value ?? "|").split("|");
      const result = await game.build(body.user.id, kind as BuildingKind, location!);
      await finishModal(ack, result, () => "location");
    },

    async tradeCommand({ command, ack, respond }: CommandArgs) {
      await ack();
      const bank = command.text.trim().toLowerCase() === "banka";
      await openTrade(bank, command.trigger_id, (text) => respond(ephemeral(text)));
    },

    async offerSubmit({ ack, body, view }: ViewArgs) {
      const give = field(view, "give").selected_option?.value ?? "";
      const want = field(view, "want").selected_option?.value ?? "";
      const to = field(view, "to").selected_user ?? undefined;
      if (!to && !(await game.config()).tradeChannel) {
        return ack({
          response_action: "errors",
          errors: { to: "Kanál pro směny zatím není nastavený – vyber konkrétního hráče." },
        });
      }
      if (!isResource(give) || !isResource(want))
        return ack({ response_action: "errors", errors: { give: copy.REJECTIONS.INVALID_TRADE } });
      const amount = (block: string) => Number(field(view, block).value);
      const result = await game.createOffer(
        body.user.id,
        { [give]: amount("give_amount") },
        { [want]: amount("want_amount") },
        to,
      );
      await finishModal(ack, result, (r) => (r === "RECIPIENT_OPTED_OUT" ? "to" : "give"));
    },

    async bankSubmit({ ack, body, view }: ViewArgs) {
      const give = field(view, "give").selected_option?.value as Resource;
      const get = field(view, "get").selected_option?.value as Resource;
      const result = await game.bankTrade(body.user.id, give, get);
      await finishModal(ack, result, (r) => (r === "INVALID_TRADE" || r === "RESOURCE_NOT_IN_PLAY" ? "get" : "give"));
    },

    async openBuildAction({ ack, body }: ActionArgs) {
      await ack();
      await openBuild(body.user.id, body.trigger_id, (text) => notifier.post(body.user.id, { text }));
    },

    async openTradeAction(bank: boolean, { ack, body }: ActionArgs) {
      await ack();
      await openTrade(bank, body.trigger_id, (text) => notifier.post(body.user.id, { text }));
    },

    async acceptOfferAction({ ack, body, action, respond }: ActionArgs) {
      await ack();
      const result = await game.acceptOffer(body.user.id, Number(action.value));
      if (!result.ok) {
        const text = copy.REJECTIONS[result.reason];
        await (respond
          ? respond({ ...ephemeral(text), replace_original: false })
          : notifier.post(body.user.id, { text }));
        return;
      }
      await updateMessage(body, views.tradeDoneText(eventOf(result, "TradeCompleted")!));
      await notifier.publish(result.events);
    },

    async cancelOfferAction({ ack, body, action, respond }: ActionArgs) {
      await ack();
      const result = await game.cancelOffer(body.user.id, Number(action.value));
      if (!result.ok) {
        const text = copy.REJECTIONS[result.reason];
        if (respond && body.channel) await respond({ ...ephemeral(text), replace_original: false });
        return notifier.refreshHome(body.user.id);
      }
      await updateMessage(body, ":x: Nabídka byla zrušena.");
      await notifier.publish(result.events);
    },

    async osadaCommand({ command, ack, respond }: CommandArgs) {
      await ack();
      await respond(ephemeral(await osada(command.user_id, command.text.trim().toLowerCase())));
    },

    async adminCommand({ command, ack, respond }: CommandArgs) {
      await ack();
      if (!deps.admins.includes(command.user_id)) {
        await respond(ephemeral("Tohle může jen admin hry."));
        return;
      }
      const { reply, events } = await runAdminCommand(deps, command.text);
      await respond(ephemeral(reply));
      await notifier.publish(events);
    },

    async homeOpened({ event }: { event: { user: string; tab?: string } }) {
      if (event.tab === undefined || event.tab === "home") await notifier.refreshHome(event.user);
    },
  };

  async function publish(result: CommandResult) {
    if (result.ok) await notifier.publish(result.events);
  }

  async function updateMessage(body: ActionArgs["body"], text: string) {
    if (!body.channel || !body.message) return;
    await client.chat
      .update({ channel: body.channel.id, ts: body.message.ts, text, blocks: [] })
      .catch((error) => (deps.log ?? console.error)("Slack chat.update failed", error));
  }

  async function osada(player: string, sub: string): Promise<string> {
    switch (sub) {
      case "stav":
        return status(player);
      case "mapa": {
        const links = await notifier.mapLinks();
        return links ? `:world_map: <${links.page}|Mapa ve velkém>` : "Mapa zatím není k dispozici.";
      }
      case "historie": {
        const history = await game.seasonHistory();
        if (!history.length) return "Zatím neskončila žádná sezóna.";
        return history
          .map((s) => `• Sezóna ${s.id}: ${s.result.winners.map((t) => `*${t.name}*`).join(" a ") || "bez vítěze"}`)
          .join("\n");
      }
      case "odhlasit":
        await publish(await game.setOptOut(player, true));
        return "Hru máš vypnutou. Nikdo ti nemůže poděkovat a ty nemůžeš hrát. Zpátky se vrátíš přes `/osada prihlasit`.";
      case "prihlasit":
        await publish(await game.setOptOut(player, false));
        return "Vítej zpátky ve hře! :tada:";
      default:
        return copy.help(await game.config());
    }
  }

  async function status(player: string): Promise<string> {
    const view = await game.playerView(player);
    if (!view.season) return copy.REJECTIONS.NO_ACTIVE_SEASON;
    const lines = [
      view.team ? `Tým: *${view.team.name}*` : copy.NO_TEAM_YET,
      `Suroviny: ${copy.bag(view.inventory)}`,
      view.allowance ? `Tento týden můžeš ještě poděkovat ${view.allowance.left}× (z ${view.allowance.total}).` : "",
      view.buildings.length ? `Stavby: ${view.buildings.map((b) => copy.building(b.kind, b.location)).join(", ")}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }
}
