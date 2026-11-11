/** `/osada-admin`: parses the admin's text command, runs it on the game service and words the reply in Czech. */
import { RESOURCE_NAMES } from "../copy/resources.ts";
import { RESOURCES, type Resource } from "../engine/resources.ts";
import type { ConfigPatch } from "../game/config.ts";
import type { CommandResult, GameEvent } from "../game/types.ts";
import * as copy from "./copy.ts";
import type { SlackDeps } from "./notifier.ts";

export interface AdminReply {
  reply: string;
  events: GameEvent[];
}

export const ADMIN_HELP = [
  "*Osada – příkazy admina*",
  '`/osada-admin tym "Název týmu" #d94f30 ruda` – založí nebo upraví tým (suroviny: ruda, vlna, obilí, dřevo, cihly, sklo)',
  "`/osada-admin tymy` – seznam týmů",
  '`/osada-admin hrac @kolega "Název týmu"` – přiřadí hráče do týmu',
  '`/osada-admin skupina @skupina "Název týmu"` – přiřadí celou skupinu uživatelů',
  "`/osada-admin kanal diky|smena|digest #kanal` – kanál pro poděkování, směny a týdenní shrnutí",
  "`/osada-admin nastav <klíč> <hodnota>` – klíče: " +
    "`prideleni`, `prideleni-maly-tym`, `maly-tym`, `casova-zona`, `cena-cesta`, `cena-osada`, `cena-mesto`, `delka-sezony`, `banka`",
  "`/osada-admin sezona start [týdny] [seed]` / `/osada-admin sezona konec`",
  "`/osada-admin dar @kolega 2 ruda Výhra v kvízu` – přidělí suroviny (zapíše se do auditu)",
  "`/osada-admin audit [@kolega]` – posledních 20 pohybů surovin",
  "`/osada-admin tyden` – hned spustí týdenní přechod (pokud už začal nový týden)",
].join("\n");

const RESOURCE_ALIASES: Record<string, Resource> = Object.fromEntries([
  ...RESOURCES.map((r) => [r, r]),
  ...RESOURCES.map((r) => [RESOURCE_NAMES[r], r]),
  ...RESOURCES.map((r) => [RESOURCE_NAMES[r].normalize("NFD").replace(/\p{Diacritic}/gu, ""), r]),
]);

const NUMBER_SETTINGS: Record<string, (n: number) => ConfigPatch> = {
  prideleni: (n) => ({ allowance: n }),
  "prideleni-maly-tym": (n) => ({ smallTeamAllowance: n }),
  "maly-tym": (n) => ({ smallTeamMaxSize: n }),
  "cena-cesta": (n) => ({ costs: { road: n } }),
  "cena-osada": (n) => ({ costs: { settlement: n } }),
  "cena-mesto": (n) => ({ costs: { city: n } }),
  "delka-sezony": (n) => ({ seasonWeeks: n }),
  banka: (n) => ({ bankRate: n }),
  "min-duvod": (n) => ({ minReasonLength: n }),
};

const CHANNELS: Record<string, keyof ConfigPatch> = {
  diky: "thanksChannel",
  smena: "tradeChannel",
  digest: "digestChannel",
};

/** Splits on whitespace, keeping "quoted phrases" together. */
export function tokenize(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|“([^”]*)”|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

const userId = (token?: string) => /^<@(\w+)(?:\|[^>]*)?>$/.exec(token ?? "")?.[1];
const channelId = (token?: string) => /^<#(\w+)(?:\|[^>]*)?>$/.exec(token ?? "")?.[1];
const groupId = (token?: string) => /^<!subteam\^(\w+)(?:\|[^>]*)?>$/.exec(token ?? "")?.[1];
export const parseResource = (token?: string): Resource | undefined => RESOURCE_ALIASES[(token ?? "").toLowerCase()];

function outcome(result: CommandResult, success: string): AdminReply {
  return result.ok
    ? { reply: success, events: result.events }
    : { reply: `:warning: ${copy.REJECTIONS[result.reason]}`, events: [] };
}

const usage = (text: string): AdminReply => ({ reply: `Použití: ${text}`, events: [] });

export async function runAdminCommand(deps: SlackDeps, text: string): Promise<AdminReply> {
  const [command, ...args] = tokenize(text);
  const { game } = deps;
  switch (command?.toLowerCase()) {
    case "tym":
      return defineTeam(deps, args);
    case "tymy": {
      const teams = await game.teams();
      const lines = teams.map((t) => `• *${t.name}* (${t.color}) – ${copy.resource(t.resource)}`);
      return { reply: lines.length ? lines.join("\n") : "Zatím žádné týmy.", events: [] };
    }
    case "hrac": {
      const player = userId(args[0]);
      if (!player || args.length < 2) return usage('`/osada-admin hrac @kolega "Název týmu"`');
      const team = args.slice(1).join(" ");
      return outcome(await game.assignPlayer(player, team), `<@${player}> je v týmu *${team}*.`);
    }
    case "skupina":
      return assignGroup(deps, args);
    case "kanal":
      return setChannel(deps, args);
    case "nastav":
      return configure(deps, args);
    case "sezona":
      return season(deps, args);
    case "dar":
      return grant(deps, args);
    case "audit":
      return audit(deps, args);
    case "tyden":
      return outcome(await game.rollWeek(), "Týdenní přechod proběhl (pokud už začal nový týden).");
    default:
      return { reply: ADMIN_HELP, events: [] };
  }
}

async function defineTeam({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const [name, color, resourceName] = args;
  const resource = parseResource(resourceName);
  if (!name || !color || !resource) return usage('`/osada-admin tym "Název týmu" #d94f30 ruda`');
  return outcome(
    await game.defineTeam({ name, color, resource }),
    `Tým *${name}* je připravený a vyrábí ${copy.resource(resource)}.`,
  );
}

async function assignGroup({ game, client }: SlackDeps, args: string[]): Promise<AdminReply> {
  const group = groupId(args[0]);
  if (!group || args.length < 2) return usage('`/osada-admin skupina @skupina "Název týmu"`');
  const team = args.slice(1).join(" ");
  const { users = [] } = await client.usergroups.users.list({ usergroup: group });
  const events: GameEvent[] = [];
  const failed: string[] = [];
  for (const user of users) {
    const result = await game.assignPlayer(user, team);
    if (result.ok) events.push(...result.events);
    else failed.push(`<@${user}> (${copy.REJECTIONS[result.reason]})`);
  }
  const skipped = failed.length ? `\nNepřiřazeno: ${failed.join(", ")}` : "";
  return { reply: `Do týmu *${team}* přiřazeno ${events.length} lidí.${skipped}`, events };
}

async function setChannel({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const key = CHANNELS[args[0] ?? ""];
  const channel = channelId(args[1]);
  if (!key || !channel) return usage("`/osada-admin kanal diky|smena|digest #kanal`");
  return outcome(await game.configure({ [key]: channel }), `Hotovo, kanál nastaven na <#${channel}>.`);
}

async function configure({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const [key = "", value = ""] = args;
  let patch: ConfigPatch | undefined;
  if (key === "casova-zona") patch = { timezone: value };
  else if (NUMBER_SETTINGS[key] && /^\d+$/.test(value)) patch = NUMBER_SETTINGS[key](Number(value));
  if (!patch) return usage("`/osada-admin nastav <klíč> <hodnota>`, např. `nastav prideleni 3`");
  return outcome(await game.configure(patch), `Nastaveno: ${key} = ${value}.`);
}

async function season({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const [sub, weeks, seed] = args;
  if (sub === "start") {
    const options = { weeks: weeks ? Number(weeks) : undefined, seed: seed ? Number(seed) : undefined };
    return outcome(await game.startSeason(options), "Sezóna začala! :tada:");
  }
  if (sub === "konec") return outcome(await game.endSeason(), "Sezóna skončila.");
  return usage("`/osada-admin sezona start [týdny] [seed]` nebo `/osada-admin sezona konec`");
}

async function grant({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const player = userId(args[0]);
  const amount = Number(args[1]);
  const resource = parseResource(args[2]);
  const note = args.slice(3).join(" ");
  if (!player || !resource || !note) return usage("`/osada-admin dar @kolega 2 ruda Výhra v kvízu`");
  return outcome(
    await game.grant(player, resource, amount, note),
    `<@${player}> dostává ${amount}× ${copy.resource(resource)}.`,
  );
}

async function audit({ game }: SlackDeps, args: string[]): Promise<AdminReply> {
  const player = userId(args[0]);
  const entries = await game.auditLog({ player, limit: 20 });
  if (!entries.length) return { reply: "Žádné pohyby surovin.", events: [] };
  const lines = entries.map((e) => {
    const sign = e.delta > 0 ? `+${e.delta}` : String(e.delta);
    const note = e.note ? ` – ${e.note}` : "";
    return `• ${e.at.toISOString().slice(0, 16).replace("T", " ")} <@${e.player}> ${sign} ${copy.resource(e.resource)} (${e.kind}${e.ref ? ` ${e.ref}` : ""})${note}`;
  });
  return { reply: lines.join("\n"), events: [] };
}
