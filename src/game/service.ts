/**
 * The game service: the whole game as commands and queries over the database. It owns every invariant (allowance,
 * weekly limits, legal placement, atomic trades) and runs each command in one transaction that locks the active
 * season, so concurrent commands apply one after another. Commands return domain events or a typed rejection;
 * callers turn those into messages.
 */
import { and, asc, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import * as t from "../db/schema.ts";
import { compareLabels } from "../engine/board.ts";
import { generateMap } from "../engine/generate.ts";
import { isResource, type Resource, type ResourceBag } from "../engine/resources.ts";
import {
  type BoardState,
  type BuildingKind,
  boardState,
  buildingPoints,
  costOf,
  harvest,
  legalLocations,
  longestRoadHolder,
  pickPayment,
} from "../engine/rules.ts";
import { weekKey } from "../engine/week.ts";
import { type ConfigPatch, type GameConfig, isValidConfig, mergeConfig } from "./config.ts";
import * as repo from "./repository.ts";
import { reject, type Season } from "./repository.ts";
import type {
  BoardView,
  Clock,
  CommandResult,
  GameEvent,
  LedgerEntry,
  LegalMoves,
  OfferView,
  PlayerHighlight,
  PlayerId,
  PlayerView,
  SeasonInfo,
  SeasonResult,
  SeasonSummary,
  TeamRef,
  TeamScore,
  ThanksSummary,
  WeeklyDigest,
} from "./types.ts";

const KINDS: BuildingKind[] = ["road", "settlement", "city"];
const MIN_TEAMS = 3;
const MAX_TEAMS = 6;

export interface StartSeasonOptions {
  weeks?: number;
  seed?: number;
}

export interface TeamDefinition {
  name: string;
  color: string;
  resource: Resource;
}

export class GameService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  // ---- Commands -------------------------------------------------------------------------------------------------

  thank(from: PlayerId, to: PlayerId, reason: string, sourceRef?: string): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      if (from === to) reject("SELF_THANKS");
      const config = await repo.loadConfig(tx);
      const text = reason.trim();
      if (text.length < config.minReasonLength) reject("REASON_TOO_SHORT");
      const { team: fromTeam } = await requireTeamPlayer(tx, from, now);
      const recipient = await repo.ensurePlayer(tx, to, now);
      if (recipient.optedOut) reject("RECIPIENT_OPTED_OUT");

      const week = weekKey(now, config.timezone);
      const given = await thanksGiven(tx, season.id, from, week);
      if (given.some((g) => g.toPlayer === to)) reject("ALREADY_THANKED_THIS_WEEK");
      const allowance = await allowanceFor(tx, config, fromTeam.id);
      if (given.length >= allowance) reject("NO_ALLOWANCE");

      const [previous] = await tx.select({ id: t.thanks.id }).from(t.thanks).where(eq(t.thanks.toPlayer, to)).limit(1);
      const [row] = await tx
        .insert(t.thanks)
        .values({
          seasonId: season.id,
          weekKey: week,
          fromPlayer: from,
          toPlayer: to,
          fromTeamId: fromTeam.id,
          toTeamId: recipient.teamId,
          resource: fromTeam.resource,
          reason: text,
          sourceRef: sourceRef ?? null,
          createdAt: now,
        })
        .returning();
      const movement = {
        seasonId: season.id,
        playerId: to,
        kind: "thanks",
        ref: `thanks:${row!.id}`,
        at: now,
      } as const;
      await repo.credit(tx, movement, { [fromTeam.resource]: 1 });
      return [
        {
          type: "ThanksGiven",
          ...repo.toThanksSummary(row!),
          fromTeam,
          toTeam: await repo.team(tx, recipient.teamId),
          recipientIsNew: previous === undefined,
          allowanceLeft: allowance - given.length - 1,
        },
      ];
    });
  }

  build(player: PlayerId, kind: BuildingKind, location: string): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      const config = await repo.loadConfig(tx);
      const { team } = await requireTeamPlayer(tx, player, now);
      const state = await stateOf(tx, season);
      if (!legalLocations(state, kind, team.id, player).includes(location)) reject("ILLEGAL_LOCATION");

      const allTeams = await repo.teams(tx);
      const payment = pickPayment(
        await repo.inventory(tx, season.id, player),
        costOf(kind, config.costs, allTeams.length),
      );
      if (!payment) reject("INSUFFICIENT_RESOURCES");
      const movement = {
        seasonId: season.id,
        playerId: player,
        kind: "build",
        ref: `${kind}:${location}`,
        at: now,
      } as const;
      await repo.debit(tx, movement, Object.fromEntries(payment.map((r) => [r, 1])));

      if (kind === "city") {
        await tx
          .update(t.buildings)
          .set({ kind, playerId: player, builtAt: now })
          .where(and(eq(t.buildings.seasonId, season.id), eq(t.buildings.location, location)));
      } else {
        await tx
          .insert(t.buildings)
          .values({ seasonId: season.id, kind, location, teamId: team.id, playerId: player, builtAt: now });
      }
      const events: GameEvent[] = [{ type: "BuildingBuilt", player, team, kind, location, paid: payment }];
      const roadChange = await updateLongestRoad(tx, season, config, allTeams);
      if (roadChange) events.push(roadChange);
      return events;
    });
  }

  bankTrade(player: PlayerId, give: Resource, get: Resource): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      const config = await repo.loadConfig(tx);
      await requireTeamPlayer(tx, player, now);
      if (give === get) reject("INVALID_TRADE");
      if (!(await resourcesInPlay(tx)).includes(get)) reject("RESOURCE_NOT_IN_PLAY");
      const movement = { seasonId: season.id, playerId: player, kind: "bank", ref: "bank", at: now } as const;
      const gave = { [give]: config.bankRate };
      await repo.debit(tx, movement, gave);
      await repo.credit(tx, movement, { [get]: 1 });
      return [{ type: "BankTradeCompleted", player, gave, got: get }];
    });
  }

  createOffer(player: PlayerId, give: ResourceBag, want: ResourceBag, to?: PlayerId): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      await requireTeamPlayer(tx, player, now);
      await validateTrade(tx, give, want);
      if (to !== undefined) {
        if (to === player) reject("INVALID_TRADE");
        if ((await repo.ensurePlayer(tx, to, now)).optedOut) reject("RECIPIENT_OPTED_OUT");
      }
      if (!repo.covers(await repo.inventory(tx, season.id, player), give)) reject("INSUFFICIENT_RESOURCES");
      const [offer] = await tx
        .insert(t.offers)
        .values({
          seasonId: season.id,
          fromPlayer: player,
          toPlayer: to ?? null,
          give,
          want,
          status: "open",
          createdAt: now,
        })
        .returning();
      return [{ type: "OfferCreated", offerId: offer!.id, from: player, to: to ?? null, give, want }];
    });
  }

  acceptOffer(player: PlayerId, offerId: number): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      const offer = await openOffer(tx, season, offerId);
      if (offer.fromPlayer === player) reject("OWN_OFFER");
      if (offer.toPlayer !== null && offer.toPlayer !== player) reject("OFFER_NOT_FOR_YOU");
      await requireTeamPlayer(tx, player, now);
      if (!repo.covers(await repo.inventory(tx, season.id, offer.fromPlayer), offer.give)) {
        reject("OFFERER_INSUFFICIENT_RESOURCES");
      }
      if (!repo.covers(await repo.inventory(tx, season.id, player), offer.want)) reject("INSUFFICIENT_RESOURCES");

      const base = { seasonId: season.id, kind: "trade", ref: `offer:${offer.id}`, at: now } as const;
      await repo.debit(tx, { ...base, playerId: offer.fromPlayer }, offer.give, "OFFERER_INSUFFICIENT_RESOURCES");
      await repo.debit(tx, { ...base, playerId: player }, offer.want);
      await repo.credit(tx, { ...base, playerId: player }, offer.give);
      await repo.credit(tx, { ...base, playerId: offer.fromPlayer }, offer.want);
      await tx
        .update(t.offers)
        .set({ status: "accepted", acceptedBy: player, closedAt: now })
        .where(eq(t.offers.id, offer.id));
      return [
        {
          type: "TradeCompleted",
          offerId: offer.id,
          from: offer.fromPlayer,
          acceptedBy: player,
          give: offer.give,
          want: offer.want,
        },
      ];
    });
  }

  cancelOffer(player: PlayerId, offerId: number): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      const offer = await openOffer(tx, season, offerId);
      if (offer.fromPlayer !== player) reject("NOT_YOUR_OFFER");
      await tx.update(t.offers).set({ status: "cancelled", closedAt: now }).where(eq(t.offers.id, offer.id));
      return [{ type: "OfferCancelled", offerId, by: player }];
    });
  }

  /**
   * Moves the season into the current week if it isn't there yet: pays the harvest for the week that ended,
   * expires open offers, and ends the season after its last week. Safe to call as often as you like.
   */
  rollWeek(): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      const config = await repo.loadConfig(tx);
      const current = weekKey(now, config.timezone);
      if (current === season.weekKey) return [];

      const events: GameEvent[] = [];
      const state = await stateOf(tx, season);
      const byPlayer = new Map<PlayerId, ResourceBag>();
      for (const share of harvest(state)) {
        const bag = byPlayer.get(share.playerId) ?? {};
        bag[share.resource] = (bag[share.resource] ?? 0) + share.amount;
        byPlayer.set(share.playerId, bag);
      }
      for (const [player, resources] of byPlayer) {
        const ref = `week:${season.weekKey}`;
        await repo.credit(tx, { seasonId: season.id, playerId: player, kind: "harvest", ref, at: now }, resources);
        events.push({ type: "HarvestPaid", player, resources });
      }
      const expired = await expireOffers(tx, season.id, now);
      if (expired) events.push(expired);

      const weekNumber = season.weekNumber + 1;
      await tx.update(t.seasons).set({ weekKey: current, weekNumber }).where(eq(t.seasons.id, season.id));
      events.push({ type: "WeekRolled", seasonId: season.id, endedWeek: season.weekKey, weekNumber });
      if (weekNumber > season.weeks) events.push(...(await closeSeason(tx, season, config, now)));
      return events;
    });
  }

  startSeason(options: StartSeasonOptions = {}): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      if (await repo.lockActiveSeason(tx)) reject("SEASON_ALREADY_ACTIVE");
      const config = await repo.loadConfig(tx);
      const weeks = options.weeks ?? config.seasonWeeks;
      if (!Number.isInteger(weeks) || weeks < 1) reject("INVALID_CONFIG");
      const allTeams = await repo.teams(tx);
      if (allTeams.length < MIN_TEAMS) reject("TOO_FEW_TEAMS");
      if (allTeams.length > MAX_TEAMS) reject("TOO_MANY_TEAMS");

      const seed = options.seed ?? now.getTime() % 2_147_483_647;
      const map = generateMap(
        seed,
        allTeams.map((x) => x.resource),
      );
      const [season] = await tx
        .insert(t.seasons)
        .values({
          status: "active",
          seed,
          weeks,
          weekKey: weekKey(now, config.timezone),
          weekNumber: 1,
          size: map.size,
          tiles: map.tiles,
          startedAt: now,
        })
        .returning();
      await tx.insert(t.buildings).values(
        map.starts.flatMap((start, i) => [
          {
            seasonId: season!.id,
            kind: "settlement" as const,
            location: start.settlement,
            teamId: allTeams[i]!.id,
            builtAt: now,
          },
          { seasonId: season!.id, kind: "road" as const, location: start.road, teamId: allTeams[i]!.id, builtAt: now },
        ]),
      );
      return [{ type: "SeasonStarted", seasonId: season!.id, weeks, seed }];
    });
  }

  endSeason(): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      return closeSeason(tx, season, await repo.loadConfig(tx), now);
    });
  }

  defineTeam(definition: TeamDefinition): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      if (await repo.lockActiveSeason(tx)) reject("SEASON_IN_PROGRESS");
      if (!/^#[0-9a-f]{6}$/i.test(definition.color)) reject("INVALID_COLOR");
      if (!isResource(definition.resource)) reject("RESOURCE_NOT_IN_PLAY");
      const name = definition.name.trim();
      const existing = await teamByName(tx, name);
      const [holder] = await tx.select().from(t.teams).where(eq(t.teams.resource, definition.resource));
      if (holder && holder.id !== existing?.id) reject("RESOURCE_TAKEN");
      const values = { name, color: definition.color.toLowerCase(), resource: definition.resource };
      const [row] = existing
        ? await tx.update(t.teams).set(values).where(eq(t.teams.id, existing.id)).returning()
        : await tx
            .insert(t.teams)
            .values({ ...values, createdAt: now })
            .returning();
      return [{ type: "TeamDefined", team: { id: row!.id, ...values } }];
    });
  }

  /** Moves a player onto a team. During a season only players without a team can be assigned. */
  assignPlayer(player: PlayerId, teamName: string): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const team = await teamByName(tx, teamName);
      if (!team) reject("UNKNOWN_TEAM");
      const season = await repo.lockActiveSeason(tx);
      const current = await repo.ensurePlayer(tx, player, now);
      if (season && current.teamId !== null && current.teamId !== team.id) reject("SEASON_IN_PROGRESS");
      await tx.update(t.players).set({ teamId: team.id }).where(eq(t.players.id, player));
      const heldResources = season ? await repo.inventory(tx, season.id, player) : {};
      return [{ type: "PlayerAssigned", player, team, heldResources }];
    });
  }

  grant(player: PlayerId, resource: Resource, amount: number, note: string): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      const season = await requireSeason(tx);
      if (!Number.isInteger(amount) || amount < 1) reject("INVALID_AMOUNT");
      if (!(await resourcesInPlay(tx)).includes(resource)) reject("RESOURCE_NOT_IN_PLAY");
      await repo.ensurePlayer(tx, player, now);
      const movement = { seasonId: season.id, playerId: player, kind: "grant", ref: "admin", note, at: now } as const;
      await repo.credit(tx, movement, { [resource]: amount });
      return [{ type: "ResourceGranted", player, resource, amount, note }];
    });
  }

  setOptOut(player: PlayerId, optedOut: boolean): Promise<CommandResult> {
    return this.command(async (tx, now) => {
      await repo.lockActiveSeason(tx);
      await repo.ensurePlayer(tx, player, now);
      await tx.update(t.players).set({ optedOut }).where(eq(t.players.id, player));
      return [{ type: "OptOutChanged", player, optedOut }];
    });
  }

  configure(patch: ConfigPatch): Promise<CommandResult> {
    return this.command(async (tx) => {
      const config = mergeConfig(await repo.loadConfig(tx), patch);
      if (!isValidConfig(config)) reject("INVALID_CONFIG");
      await repo.saveConfig(tx, config);
      return [{ type: "ConfigChanged", config }];
    });
  }

  private async command(run: (tx: Database, now: Date) => Promise<GameEvent[]>): Promise<CommandResult> {
    const now = this.clock.now();
    try {
      const events = await this.db.transaction((tx) => run(tx as unknown as Database, now));
      return { ok: true, events };
    } catch (error) {
      if (error instanceof repo.Rejected) return { ok: false, reason: error.reason };
      throw error;
    }
  }

  // ---- Queries --------------------------------------------------------------------------------------------------

  config(): Promise<GameConfig> {
    return repo.loadConfig(this.db);
  }

  teams(): Promise<TeamRef[]> {
    return repo.teams(this.db);
  }

  async playerView(player: PlayerId): Promise<PlayerView> {
    const db = this.db;
    const config = await repo.loadConfig(db);
    const row = await repo.findPlayer(db, player);
    const team = await repo.team(db, row?.teamId ?? null);
    const optedOut = row?.optedOut ?? false;
    const season = await repo.activeSeason(db);
    const [anyThanks] = await db
      .select({ id: t.thanks.id })
      .from(t.thanks)
      .where(or(eq(t.thanks.fromPlayer, player), eq(t.thanks.toPlayer, player)))
      .limit(1);
    const base = { player, team, optedOut, isNewcomer: anyThanks === undefined };
    if (!season) {
      const empty = { inventory: {}, allowance: null, buildings: [], recentGiven: [], recentReceived: [] };
      return { ...base, ...empty, season: null, scoreboard: [], openOffers: [] };
    }
    const allowance =
      team && !optedOut ? await allowanceStatus(db, config, season.id, player, team.id, this.clock.now()) : null;
    const buildings = await db
      .select({ kind: t.buildings.kind, location: t.buildings.location })
      .from(t.buildings)
      .where(and(eq(t.buildings.seasonId, season.id), eq(t.buildings.playerId, player)))
      .orderBy(t.buildings.id);
    return {
      ...base,
      season: seasonInfo(season),
      inventory: await repo.inventory(db, season.id, player),
      allowance,
      buildings,
      scoreboard: await liveScoreboard(db, season, config),
      recentGiven: await recentThanks(db, season.id, eq(t.thanks.fromPlayer, player)),
      recentReceived: await recentThanks(db, season.id, eq(t.thanks.toPlayer, player)),
      openOffers: await this.openOffers(player),
    };
  }

  /** What the player could build right now: each kind's cost and payment (null if unaffordable) and its locations. */
  async legalMoves(player: PlayerId): Promise<LegalMoves> {
    const season = await repo.activeSeason(this.db);
    if (!season) return { ok: false, reason: "NO_ACTIVE_SEASON" };
    const row = await repo.findPlayer(this.db, player);
    if (row?.optedOut) return { ok: false, reason: "OPTED_OUT" };
    if (!row?.teamId) return { ok: false, reason: "NOT_ON_TEAM" };
    const config = await repo.loadConfig(this.db);
    const state = await stateOf(this.db, season);
    const inPlay = (await repo.teams(this.db)).length;
    const inventory = await repo.inventory(this.db, season.id, player);
    const moves = KINDS.map((kind) => {
      const cost = costOf(kind, config.costs, inPlay);
      const locations = legalLocations(state, kind, row.teamId!, player).sort(compareLabels);
      return { kind, cost, payment: pickPayment(inventory, cost), locations };
    });
    return { ok: true, moves };
  }

  /** The board of the given season, or of the active (else most recent) one. Null before the first season. */
  async board(seasonId?: number): Promise<BoardView | null> {
    const season =
      seasonId === undefined
        ? await repo.latestSeason(this.db)
        : (await this.db.select().from(t.seasons).where(eq(t.seasons.id, seasonId)))[0];
    if (!season) return null;
    const config = await repo.loadConfig(this.db);
    return {
      seasonId: season.id,
      status: season.status,
      version: season.boardVersion,
      size: season.size,
      tiles: season.tiles,
      buildings: await repo.buildings(this.db, season.id),
      scoreboard: season.result?.scoreboard ?? (await liveScoreboard(this.db, season, config)),
      longestRoadTeamId: season.longestRoadTeamId,
    };
  }

  async scoreboard(): Promise<TeamScore[]> {
    const season = await repo.activeSeason(this.db);
    return season ? liveScoreboard(this.db, season, await repo.loadConfig(this.db)) : [];
  }

  async openOffers(player?: PlayerId): Promise<OfferView[]> {
    const season = await repo.activeSeason(this.db);
    if (!season) return [];
    const rows = await this.db
      .select()
      .from(t.offers)
      .where(
        and(
          eq(t.offers.seasonId, season.id),
          eq(t.offers.status, "open"),
          player ? eq(t.offers.fromPlayer, player) : undefined,
        ),
      )
      .orderBy(t.offers.id);
    return rows.map((o) => ({ id: o.id, from: o.fromPlayer, to: o.toPlayer, give: o.give, want: o.want }));
  }

  /** A summary of one week of a season: by default the week that just ended in the latest season. */
  async weeklyDigest(seasonId?: number, week?: string): Promise<WeeklyDigest | null> {
    const db = this.db;
    const season =
      seasonId === undefined
        ? await repo.latestSeason(db)
        : (await db.select().from(t.seasons).where(eq(t.seasons.id, seasonId)))[0];
    if (!season) return null;
    const config = await repo.loadConfig(db);
    const key = week ?? previousWeek(season.weekKey);
    const rows = await db
      .select()
      .from(t.thanks)
      .where(and(eq(t.thanks.seasonId, season.id), eq(t.thanks.weekKey, key)));
    const topThanks = rows
      .sort((a, b) => b.reason.length - a.reason.length || a.id - b.id)
      .slice(0, 3)
      .map(repo.toThanksSummary);
    return {
      season: seasonInfo(season),
      weekKey: key,
      thanksCount: rows.length,
      topThanks,
      harvest: await harvestByTeam(db, season.id, key),
      scoreboard: season.result?.scoreboard ?? (await liveScoreboard(db, season, config)),
    };
  }

  async seasonHistory(): Promise<SeasonSummary[]> {
    const rows = await this.db
      .select()
      .from(t.seasons)
      .where(and(eq(t.seasons.status, "ended"), isNotNull(t.seasons.result)))
      .orderBy(desc(t.seasons.id));
    return rows.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt!,
      weeks: s.weeks,
      result: s.result!,
    }));
  }

  async auditLog(options: { player?: PlayerId; limit?: number } = {}): Promise<LedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(t.ledger)
      .where(options.player ? eq(t.ledger.playerId, options.player) : undefined)
      .orderBy(desc(t.ledger.id))
      .limit(options.limit ?? 20);
    return rows.map((r) => ({
      id: r.id,
      player: r.playerId,
      resource: r.resource,
      delta: r.delta,
      kind: r.kind,
      ref: r.ref,
      note: r.note,
      at: r.createdAt,
    }));
  }
}

// ---- Helpers --------------------------------------------------------------------------------------------------

async function requireSeason(tx: Database): Promise<Season> {
  return (await repo.lockActiveSeason(tx)) ?? reject("NO_ACTIVE_SEASON");
}

async function requireTeamPlayer(tx: Database, id: PlayerId, now: Date): Promise<{ team: TeamRef }> {
  const player = await repo.ensurePlayer(tx, id, now);
  if (player.optedOut) reject("OPTED_OUT");
  const team = await repo.team(tx, player.teamId);
  if (!team) reject("NOT_ON_TEAM");
  return { team };
}

async function teamByName(db: Database, name: string): Promise<TeamRef | undefined> {
  const wanted = name.trim().toLocaleLowerCase("en");
  return (await repo.teams(db)).find((x) => x.name.toLocaleLowerCase("en") === wanted);
}

async function resourcesInPlay(db: Database): Promise<Resource[]> {
  return (await repo.teams(db)).map((x) => x.resource);
}

async function stateOf(db: Database, season: Season): Promise<BoardState> {
  return boardState(season, await repo.buildings(db, season.id));
}

async function allowanceFor(db: Database, config: GameConfig, teamId: number): Promise<number> {
  const size = await repo.activeTeamSize(db, teamId);
  return size <= config.smallTeamMaxSize ? config.smallTeamAllowance : config.allowance;
}

async function allowanceStatus(
  db: Database,
  config: GameConfig,
  seasonId: number,
  player: PlayerId,
  teamId: number,
  now: Date,
) {
  const total = await allowanceFor(db, config, teamId);
  const used = (await thanksGiven(db, seasonId, player, weekKey(now, config.timezone))).length;
  return { total, used, left: Math.max(0, total - used) };
}

function thanksGiven(db: Database, seasonId: number, from: PlayerId, week: string) {
  return db
    .select({ toPlayer: t.thanks.toPlayer })
    .from(t.thanks)
    .where(and(eq(t.thanks.seasonId, seasonId), eq(t.thanks.fromPlayer, from), eq(t.thanks.weekKey, week)));
}

async function recentThanks(db: Database, seasonId: number, who: ReturnType<typeof eq>): Promise<ThanksSummary[]> {
  const rows = await db
    .select()
    .from(t.thanks)
    .where(and(eq(t.thanks.seasonId, seasonId), who))
    .orderBy(desc(t.thanks.id))
    .limit(5);
  return rows.map(repo.toThanksSummary);
}

async function validateTrade(db: Database, give: ResourceBag, want: ResourceBag): Promise<void> {
  const inPlay = await resourcesInPlay(db);
  const sides = [Object.entries(give), Object.entries(want)];
  for (const side of sides) {
    if (side.length === 0) reject("INVALID_TRADE");
    for (const [resource, amount] of side) {
      if (!Number.isInteger(amount) || (amount ?? 0) < 1) reject("INVALID_AMOUNT");
      if (!inPlay.includes(resource as Resource)) reject("RESOURCE_NOT_IN_PLAY");
    }
  }
  if (Object.keys(give).some((r) => r in want)) reject("INVALID_TRADE");
}

async function openOffer(tx: Database, season: Season, offerId: number) {
  const [offer] = await tx
    .select()
    .from(t.offers)
    .where(and(eq(t.offers.id, offerId), eq(t.offers.seasonId, season.id)));
  if (!offer) reject("OFFER_NOT_FOUND");
  if (offer.status !== "open") reject("OFFER_CLOSED");
  return offer;
}

async function expireOffers(tx: Database, seasonId: number, now: Date): Promise<GameEvent | null> {
  const expired = await tx
    .update(t.offers)
    .set({ status: "expired", closedAt: now })
    .where(and(eq(t.offers.seasonId, seasonId), eq(t.offers.status, "open")))
    .returning({ id: t.offers.id });
  return expired.length ? { type: "OffersExpired", offerIds: expired.map((o) => o.id) } : null;
}

async function updateLongestRoad(
  tx: Database,
  season: Season,
  config: GameConfig,
  allTeams: TeamRef[],
): Promise<GameEvent | null> {
  const state = await stateOf(tx, season);
  const holder = longestRoadHolder(
    state,
    allTeams.map((x) => x.id),
    season.longestRoadTeamId,
    { minLength: config.longestRoadMin },
  );
  await tx
    .update(t.seasons)
    .set({ boardVersion: sql`${t.seasons.boardVersion} + 1`, longestRoadTeamId: holder })
    .where(eq(t.seasons.id, season.id));
  if (holder === season.longestRoadTeamId) return null;
  const find = (id: number | null) => allTeams.find((x) => x.id === id) ?? null;
  return { type: "LongestRoadChanged", team: find(holder), previous: find(season.longestRoadTeamId) };
}

async function liveScoreboard(db: Database, season: Season, config: GameConfig): Promise<TeamScore[]> {
  const allTeams = await repo.teams(db);
  const points = buildingPoints(await repo.buildings(db, season.id), config.points);
  return allTeams
    .map((team) => {
      const fromBuildings = points.get(team.id) ?? 0;
      const bonus = season.longestRoadTeamId === team.id ? config.longestRoadBonus : 0;
      return { team, points: fromBuildings + bonus, buildingPoints: fromBuildings, bonus };
    })
    .sort((a, b) => b.points - a.points || a.team.name.localeCompare(b.team.name, "en"));
}

async function closeSeason(tx: Database, season: Season, config: GameConfig, now: Date): Promise<GameEvent[]> {
  const scoreboard = await liveScoreboard(tx, season, config);
  const top = scoreboard[0]?.points ?? 0;
  const [totals] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t.thanks)
    .where(eq(t.thanks.seasonId, season.id));
  const result: SeasonResult = {
    scoreboard,
    winners: top > 0 ? scoreboard.filter((s) => s.points === top).map((s) => s.team) : [],
    totalThanks: totals?.n ?? 0,
    mostThanked: await topPlayer(tx, t.thanks.toPlayer, eq(t.thanks.seasonId, season.id)),
    mostCrossTeamThanks: await topPlayer(
      tx,
      t.thanks.fromPlayer,
      and(eq(t.thanks.seasonId, season.id), isNotNull(t.thanks.toTeamId), ne(t.thanks.toTeamId, t.thanks.fromTeamId)),
    ),
  };
  const events: GameEvent[] = [];
  const expired = await expireOffers(tx, season.id, now);
  if (expired) events.push(expired);
  await tx.update(t.seasons).set({ status: "ended", endedAt: now, result }).where(eq(t.seasons.id, season.id));
  events.push({ type: "SeasonEnded", seasonId: season.id, result });
  return events;
}

async function topPlayer(
  tx: Database,
  column: typeof t.thanks.toPlayer | typeof t.thanks.fromPlayer,
  where: ReturnType<typeof and>,
): Promise<PlayerHighlight | null> {
  const count = sql<number>`count(*)::int`;
  const [row] = await tx
    .select({ player: column, count })
    .from(t.thanks)
    .where(where)
    .groupBy(column)
    .orderBy(desc(count), asc(column))
    .limit(1);
  return row ? { player: row.player, count: row.count } : null;
}

async function harvestByTeam(db: Database, seasonId: number, week: string) {
  const amount = sql<number>`sum(${t.ledger.delta})::int`;
  const rows = await db
    .select({ teamId: t.players.teamId, amount })
    .from(t.ledger)
    .innerJoin(t.players, eq(t.players.id, t.ledger.playerId))
    .where(and(eq(t.ledger.seasonId, seasonId), eq(t.ledger.kind, "harvest"), eq(t.ledger.ref, `week:${week}`)))
    .groupBy(t.players.teamId);
  const allTeams = await repo.teams(db);
  const ids = rows.map((r) => r.teamId).filter((id): id is number => id !== null);
  return allTeams
    .filter((team) => ids.includes(team.id))
    .map((team) => ({ team, amount: rows.find((r) => r.teamId === team.id)!.amount }))
    .sort((a, b) => b.amount - a.amount);
}

function seasonInfo(season: Season): SeasonInfo {
  return {
    id: season.id,
    weekNumber: season.weekNumber,
    weeks: season.weeks,
    weekKey: season.weekKey,
    boardVersion: season.boardVersion,
  };
}

function previousWeek(key: string): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
}
