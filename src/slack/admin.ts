/** `/osada-admin`: parses the admin's text command, runs it on the game service and words the reply. */
import { isResource, type Resource } from "../engine/resources.ts";
import type { ConfigPatch } from "../game/config.ts";
import type { CommandResult, GameEvent } from "../game/types.ts";
import * as copy from "./copy.ts";
import type { SlackDeps } from "./notifier.ts";

export interface AdminReply {
  reply: string;
  events: GameEvent[];
}

export const ADMIN_HELP = [
  "*Osada – admin commands*",
  '`/osada-admin team "Team name" #d94f30 ore` – create or update a team (resources: ore, wool, grain, wood, brick, glass)',
  "`/osada-admin teams` – list teams",
  '`/osada-admin player @colleague "Team name"` – put a player on a team',
  '`/osada-admin group @user-group "Team name"` – put a whole Slack user group on a team',
  "`/osada-admin channel thanks|trade|digest #channel` – channels for thanks, trade offers and the weekly digest",
  "`/osada-admin set <key> <value>` – keys: `allowance`, `small-team-allowance`, `small-team-size`, `timezone`, `cost-road`, `cost-settlement`, `cost-city`, `season-weeks`, `bank-rate`, `min-reason`",
  "`/osada-admin season start [weeks] [seed]` / `/osada-admin season end`",
  "`/osada-admin grant @colleague 2 ore Quiz prize` – grant resources (recorded in the audit log)",
  "`/osada-admin audit [@colleague]` – the last 20 resource movements",
  "`/osada-admin week` – run the weekly rollover now (if a new week has started)",
].join("\n");

const NUMBER_SETTINGS: Record<string, (n: number) => ConfigPatch> = {
  allowance: (n) => ({ allowance: n }),
  "small-team-allowance": (n) => ({ smallTeamAllowance: n }),
  "small-team-size": (n) => ({ smallTeamMaxSize: n }),
  "cost-road": (n) => ({ costs: { road: n } }),
  "cost-settlement": (n) => ({ costs: { settlement: n } }),
  "cost-city": (n) => ({ costs: { city: n } }),
  "season-weeks": (n) => ({ seasonWeeks: n }),
  "bank-rate": (n) => ({ bankRate: n }),
  "min-reason": (n) => ({ minReasonLength: n }),
};

const CHANNELS: Record<string, keyof ConfigPatch> = {
  thanks: "thanksChannel",
  trade: "tradeChannel",
  digest: "digestChannel",
};

/** Splits on whitespace, keeping "quoted phrases" together. */
export function tokenize(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|“([^”]*)”|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

const userId = (token?: string) => /^<@(\w+)(?:\|[^>]*)?>$/.exec(token ?? "")?.[1];
const channelId = (token?: string) => /^<#(\w+)(?:\|[^>]*)?>$/.exec(token ?? "")?.[1];
const groupId = (token?: string) => /^<!subteam\^(\w+)(?:\|[^>]*)?>$/.exec(token ?? "")?.[1];
export const parseResource = (token?: string): Resource | undefined => {
  const name = (token ?? "").toLowerCase();
  return isResource(name) ? name : undefined;
};

function outcome(result: CommandResult, success: string): AdminReply {
  return result.ok
    ? { reply: success, events: result.events }
    : { reply: `:warning: ${copy.REJECTIONS[result.reason]}`, events: [] };
}

const usage = (text: string): AdminReply => ({ reply: `Usage: ${text}`, events: [] });

export async function runAdminCommand(deps: SlackDeps, text: string): Promise<AdminReply> {
  const [command, ...args] = tokenize(text);
  const { game } = deps;
  switch (command?.toLowerCase()) {
    case "team":
      return defineTeam(deps, args);
    case "teams": {
      const teams = await game.teams();
      const lines = teams.map((t) => `• *${t.name}* (${t.color}) – ${copy.resource(t.resource)}`);
      return { reply: lines.length ? lines.join("\n") : "No teams yet.", events: [] };
    }
    case "player": {
      const player = userId(args[0]);
      if (!player || args.length < 2) return usage('`/osada-admin player @colleague "Team name"`');
      const team = args.slice(1).join(" ");
      return outcome(await game.assignPlayer(player, team), `<@${player}> is on team *${team}*.`);
    }
    case "group":
      return assignGroup(deps, args);
    case "channel":
      return setChannel(deps, args);
    case "set":
      return configure(deps, args);
    case "season":
      return season(deps, args);
    case "grant":
      return grant(deps, args);
    case "audit":
      return audit(deps, args);
    case "week":
      return outcome(await game.rollWeek(), "Weekly rollover done (if a new week has started).");
    default:
      return { reply: ADMIN_HELP, events: [] };
  }
}

async function defineTeam({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const [name, color, resourceName] = args;
  const resource = parseResource(resourceName);
  if (!name || !color || !resource) return usage('`/osada-admin team "Team name" #d94f30 ore`');
  return outcome(
    await game.defineTeam({ name, color, resource }),
    `Team *${name}* is ready and produces ${copy.resource(resource)}.`,
  );
}

async function assignGroup({ game, client }: SlackDeps, args: string[]): Promise<AdminReply> {
  const group = groupId(args[0]);
  if (!group || args.length < 2) return usage('`/osada-admin group @user-group "Team name"`');
  const team = args.slice(1).join(" ");
  const { users = [] } = await client.usergroups.users.list({ usergroup: group });
  const events: GameEvent[] = [];
  const failed: string[] = [];
  for (const user of users) {
    const result = await game.assignPlayer(user, team);
    if (result.ok) events.push(...result.events);
    else failed.push(`<@${user}> (${copy.REJECTIONS[result.reason]})`);
  }
  const skipped = failed.length ? `\nNot added: ${failed.join(", ")}` : "";
  return { reply: `Added ${events.length} people to team *${team}*.${skipped}`, events };
}

async function setChannel({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const key = CHANNELS[args[0] ?? ""];
  const channel = channelId(args[1]);
  if (!key || !channel) return usage("`/osada-admin channel thanks|trade|digest #channel`");
  return outcome(await game.configure({ [key]: channel }), `Done, the channel is now <#${channel}>.`);
}

async function configure({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const [key = "", value = ""] = args;
  let patch: ConfigPatch | undefined;
  if (key === "timezone") patch = { timezone: value };
  else if (NUMBER_SETTINGS[key] && /^\d+$/.test(value)) patch = NUMBER_SETTINGS[key](Number(value));
  if (!patch) return usage("`/osada-admin set <key> <value>`, e.g. `set allowance 3`");
  return outcome(await game.configure(patch), `Set: ${key} = ${value}.`);
}

async function season({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const [sub, weeks, seed] = args;
  if (sub === "start") {
    const options = { weeks: weeks ? Number(weeks) : undefined, seed: seed ? Number(seed) : undefined };
    return outcome(await game.startSeason(options), "The season has started! :tada:");
  }
  if (sub === "end") return outcome(await game.endSeason(), "The season has ended.");
  return usage("`/osada-admin season start [weeks] [seed]` or `/osada-admin season end`");
}

async function grant({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const player = userId(args[0]);
  const amount = Number(args[1]);
  const resource = parseResource(args[2]);
  const note = args.slice(3).join(" ");
  if (!player || !resource || !note) return usage("`/osada-admin grant @colleague 2 ore Quiz prize`");
  return outcome(
    await game.grant(player, resource, amount, note),
    `<@${player}> gets ${amount}× ${copy.resource(resource)}.`,
  );
}

async function audit({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const player = userId(args[0]);
  const entries = await game.auditLog({ player, limit: 20 });
  if (!entries.length) return { reply: "No resource movements yet.", events: [] };
  const lines = entries.map((e) => {
    const sign = e.delta > 0 ? `+${e.delta}` : String(e.delta);
    const note = e.note ? ` – ${e.note}` : "";
    return `• ${e.at.toISOString().slice(0, 16).replace("T", " ")} <@${e.player}> ${sign} ${copy.resource(e.resource)} (${e.kind}${e.ref ? ` ${e.ref}` : ""})${note}`;
  });
  return { reply: lines.join("\n"), events: [] };
}
