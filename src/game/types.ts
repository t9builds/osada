/** What the game service returns: domain events, typed rejections and query views. */
import type { BoardSize } from "../engine/board.ts";
import type { TileKind } from "../engine/generate.ts";
import type { Resource, ResourceBag } from "../engine/resources.ts";
import type { BuildingKind } from "../engine/rules.ts";
import type { GameConfig } from "./config.ts";

/** A player's Slack user id. */
export type PlayerId = string;

export interface Clock {
  now(): Date;
}

export interface TeamRef {
  id: number;
  name: string;
  color: string;
  resource: Resource;
}

export type Rejection =
  | "NO_ACTIVE_SEASON"
  | "SEASON_ALREADY_ACTIVE"
  | "SEASON_IN_PROGRESS"
  | "SELF_THANKS"
  | "REASON_TOO_SHORT"
  | "NO_ALLOWANCE"
  | "ALREADY_THANKED_THIS_WEEK"
  | "NOT_ON_TEAM"
  | "OPTED_OUT"
  | "RECIPIENT_OPTED_OUT"
  | "ILLEGAL_LOCATION"
  | "INSUFFICIENT_RESOURCES"
  | "OFFERER_INSUFFICIENT_RESOURCES"
  | "INVALID_TRADE"
  | "OFFER_NOT_FOUND"
  | "OFFER_CLOSED"
  | "OWN_OFFER"
  | "NOT_YOUR_OFFER"
  | "OFFER_NOT_FOR_YOU"
  | "RESOURCE_NOT_IN_PLAY"
  | "TOO_FEW_TEAMS"
  | "TOO_MANY_TEAMS"
  | "TEAM_NAME_TAKEN"
  | "RESOURCE_TAKEN"
  | "UNKNOWN_TEAM"
  | "INVALID_COLOR"
  | "INVALID_CONFIG"
  | "INVALID_AMOUNT";

export interface ThanksSummary {
  id: number;
  from: PlayerId;
  to: PlayerId;
  resource: Resource;
  reason: string;
  sourceRef: string | null;
  at: Date;
}

export type GameEvent =
  | (ThanksSummary & {
      type: "ThanksGiven";
      fromTeam: TeamRef;
      toTeam: TeamRef | null;
      /** The recipient had never been thanked before: time to explain the game. */
      recipientIsNew: boolean;
      allowanceLeft: number;
    })
  | {
      type: "BuildingBuilt";
      player: PlayerId;
      team: TeamRef;
      kind: BuildingKind;
      location: string;
      paid: Resource[];
    }
  | { type: "LongestRoadChanged"; team: TeamRef | null; previous: TeamRef | null }
  | { type: "BankTradeCompleted"; player: PlayerId; gave: ResourceBag; got: Resource }
  | { type: "OfferCreated"; offerId: number; from: PlayerId; to: PlayerId | null; give: ResourceBag; want: ResourceBag }
  | {
      type: "TradeCompleted";
      offerId: number;
      from: PlayerId;
      acceptedBy: PlayerId;
      give: ResourceBag;
      want: ResourceBag;
    }
  | { type: "OfferCancelled"; offerId: number; by: PlayerId }
  | { type: "OffersExpired"; offerIds: number[] }
  | { type: "HarvestPaid"; player: PlayerId; resources: ResourceBag }
  | { type: "WeekRolled"; seasonId: number; endedWeek: string; weekNumber: number }
  | { type: "SeasonStarted"; seasonId: number; weeks: number; seed: number }
  | { type: "SeasonEnded"; seasonId: number; result: SeasonResult }
  | { type: "TeamDefined"; team: TeamRef }
  | { type: "PlayerAssigned"; player: PlayerId; team: TeamRef; heldResources: ResourceBag }
  | { type: "ResourceGranted"; player: PlayerId; resource: Resource; amount: number; note: string }
  | { type: "OptOutChanged"; player: PlayerId; optedOut: boolean }
  | { type: "ConfigChanged"; config: GameConfig };

export type EventType = GameEvent["type"];
export type EventOf<T extends EventType> = Extract<GameEvent, { type: T }>;

export type CommandResult = { ok: true; events: GameEvent[] } | { ok: false; reason: Rejection };

export function eventOf<T extends EventType>(result: CommandResult, type: T): EventOf<T> | undefined {
  return result.ok ? (result.events.find((e) => e.type === type) as EventOf<T> | undefined) : undefined;
}

export interface TeamScore {
  team: TeamRef;
  points: number;
  buildingPoints: number;
  bonus: number;
}

export interface PlayerHighlight {
  player: PlayerId;
  count: number;
}

export interface SeasonResult {
  scoreboard: TeamScore[];
  /** Several teams when tied for first; empty when nobody scored. */
  winners: TeamRef[];
  totalThanks: number;
  mostThanked: PlayerHighlight | null;
  mostCrossTeamThanks: PlayerHighlight | null;
}

export interface SeasonInfo {
  id: number;
  weekNumber: number;
  weeks: number;
  weekKey: string;
  boardVersion: number;
}

export interface PlayerView {
  player: PlayerId;
  team: TeamRef | null;
  optedOut: boolean;
  /** Never thanked anyone nor been thanked. */
  isNewcomer: boolean;
  season: SeasonInfo | null;
  inventory: ResourceBag;
  allowance: { total: number; used: number; left: number } | null;
  buildings: { kind: BuildingKind; location: string }[];
  scoreboard: TeamScore[];
  recentGiven: ThanksSummary[];
  recentReceived: ThanksSummary[];
  openOffers: OfferView[];
}

export interface OfferView {
  id: number;
  from: PlayerId;
  to: PlayerId | null;
  give: ResourceBag;
  want: ResourceBag;
}

export interface MoveOption {
  kind: BuildingKind;
  /** How many different resources it costs. */
  cost: number;
  /** The resources that would be spent, or null when the player can't afford it. */
  payment: Resource[] | null;
  locations: string[];
}

export type LegalMoves = { ok: true; moves: MoveOption[] } | { ok: false; reason: Rejection };

export interface BoardBuilding {
  kind: BuildingKind;
  location: string;
  teamId: number;
  playerId: PlayerId | null;
}

export interface BoardView {
  seasonId: number;
  status: "active" | "ended";
  version: number;
  size: BoardSize;
  tiles: TileKind[];
  buildings: BoardBuilding[];
  scoreboard: TeamScore[];
  longestRoadTeamId: number | null;
}

export interface WeeklyDigest {
  season: SeasonInfo;
  weekKey: string;
  thanksCount: number;
  topThanks: ThanksSummary[];
  harvest: { team: TeamRef; amount: number }[];
  scoreboard: TeamScore[];
}

export interface SeasonSummary {
  id: number;
  startedAt: Date;
  endedAt: Date;
  weeks: number;
  result: SeasonResult;
}

export interface LedgerEntry {
  id: number;
  player: PlayerId;
  resource: Resource;
  delta: number;
  kind: string;
  ref: string | null;
  note: string | null;
  at: Date;
}
