/** All copy players see in Slack, and formatting of game values into it. */
import { RESOURCE_EMOJI, RESOURCE_NAMES } from "../copy/resources.ts";
import { RESOURCES, type Resource, type ResourceBag } from "../engine/resources.ts";
import type { BuildingKind } from "../engine/rules.ts";
import type { GameConfig } from "../game/config.ts";
import type { Rejection } from "../game/types.ts";

export const REJECTIONS: Record<Rejection, string> = {
  NO_ACTIVE_SEASON: "No season is running right now. You can play once an admin starts one.",
  SEASON_ALREADY_ACTIVE: "A season is already running. Start a new one after it ends.",
  SEASON_IN_PROGRESS: "That can't be done during a season. Wait until it ends.",
  SELF_THANKS: "You can't thank yourself – thank someone who helped you. :wink:",
  REASON_TOO_SHORT:
    "Please say what you're thanking them for, in a few words at least. Thanks without a story don't count.",
  NO_ALLOWANCE: "You've given all your thanks for this week. New ones arrive on Monday.",
  ALREADY_THANKED_THIS_WEEK: "You've already thanked this person this week. Try again next week.",
  NOT_ON_TEAM: "You're not on a team yet. Ask a game admin to add you.",
  OPTED_OUT: "You've left the game. Rejoin with `/osada join`.",
  RECIPIENT_OPTED_OUT: "This person isn't playing.",
  ILLEGAL_LOCATION: "You can't build there – someone may have just taken the spot. Open the build dialog again.",
  INSUFFICIENT_RESOURCES: "You don't have enough resources for that.",
  OFFERER_INSUFFICIENT_RESOURCES: "The offer's author no longer has what they offered. The trade didn't happen.",
  INVALID_TRADE: "That trade isn't possible. Check what you give and what you want.",
  OFFER_NOT_FOUND: "This offer doesn't exist.",
  OFFER_CLOSED: "This offer is no longer open.",
  OWN_OFFER: "You can't accept your own offer.",
  NOT_YOUR_OFFER: "Only the offer's author can cancel it.",
  OFFER_NOT_FOR_YOU: "This offer is meant for someone else.",
  RESOURCE_NOT_IN_PLAY: "No team in this game produces that resource.",
  TOO_FEW_TEAMS: "A season needs at least 3 teams.",
  TOO_MANY_TEAMS: "The game supports at most 6 teams.",
  RESOURCE_TAKEN: "Another team already produces that resource.",
  UNKNOWN_TEAM: "There's no team with that name.",
  INVALID_COLOR: "Give the colour as #rrggbb, e.g. #d94f30.",
  INVALID_CONFIG: "That setting value isn't valid.",
  INVALID_AMOUNT: "The amount must be a whole number of at least 1.",
};

export const BUILDING_NAMES: Record<BuildingKind, string> = { road: "road", settlement: "settlement", city: "city" };

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function resource(r: Resource): string {
  return `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]}`;
}

/** `2× :rock: ore, 1× :sheep: wool`, or `nothing` for an empty bag. */
export function bag(b: ResourceBag): string {
  const parts = RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${b[r]}× ${resource(r)}`);
  return parts.length ? parts.join(", ") : "nothing";
}

export function building(kind: BuildingKind, location: string): string {
  return `${capitalize(BUILDING_NAMES[kind])} ${location}`;
}

export function points(n: number): string {
  return n === 1 ? "1 point" : `${n} points`;
}

export function differentResources(n: number): string {
  return n === 1 ? "1 resource" : `${n} different resources`;
}

export function help(config: GameConfig): string {
  return [
    "*Osada – how to play*",
    `• Every team produces one resource. Each week you can give away ${config.allowance} of yours (${config.smallTeamAllowance} on teams of up to ${config.smallTeamMaxSize} people), always with a thank-you: \`/thanks @colleague for what\`.`,
    "• You can thank the same person once a week, and never yourself. Unused thanks expire at midnight on Sunday.",
    "• Spend the resources you receive on buildings on the shared map (`/build`):",
    `   – road: ${differentResources(config.costs.road)}, ${points(config.points.road)}; it must connect to your team's network`,
    `   – settlement: ${differentResources(config.costs.settlement)}, ${points(config.points.settlement)}; on your team's road and not right next to another settlement`,
    `   – city: ${differentResources(config.costs.city)}, upgrades your settlement, ${points(config.points.city)} in total`,
    "• Every Sunday at midnight you harvest: a settlement gives 1 and a city 2 of each neighbouring tile's resource (deserts give nothing).",
    `• Trade with other players (\`/trade\`) or with the bank at ${config.bankRate}:1 (\`/trade bank\`). Only resources others gave you can be traded, not your weekly allowance.`,
    `• The team with the longest continuous road (at least ${config.longestRoadMin}) gets +${points(config.longestRoadBonus)}.`,
    `• Points go to your team. After ${config.seasonWeeks} weeks the season ends and the team with the most points wins.`,
    "More commands: `/osada status`, `/osada map`, `/osada history`, `/osada leave`, `/osada join`.",
  ].join("\n");
}

export const WELCOME = [
  ":wave: *Welcome to Osada!* It's a thank-you game: when someone helps you, send `/thanks @colleague for what` and they get your team's resource.",
  "Resources build roads, settlements and cities on a shared map, and the points go to your team. `/osada help` explains the rules.",
].join("\n");

export const NO_TEAM_YET =
  "You're not on a team yet, so you can't thank anyone or build. Ask a game admin to add you – anything you receive meanwhile is kept for you.";

export const USAGE_THANKS =
  "Usage: `/thanks @colleague what you're thanking them for` – e.g. `/thanks @Jana for helping with the deploy`.";
