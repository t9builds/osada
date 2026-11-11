/**
 * Data access for the game service, over a transaction. Inventory changes always go through `credit` and `debit`,
 * which write the ledger in the same step.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import type { LedgerKind } from "../db/schema.ts";
import * as t from "../db/schema.ts";
import { RESOURCES, type Resource, type ResourceBag } from "../engine/resources.ts";
import type { Placed } from "../engine/rules.ts";
import { DEFAULT_CONFIG, type GameConfig, mergeConfig } from "./config.ts";
import type { PlayerId, Rejection, TeamRef, ThanksSummary } from "./types.ts";

export type Season = typeof t.seasons.$inferSelect;
export type Player = typeof t.players.$inferSelect;

/** Thrown inside a command's transaction to roll it back and return `reason` to the caller. */
export class Rejected extends Error {
  constructor(readonly reason: Rejection) {
    super(reason);
  }
}

export function reject(reason: Rejection): never {
  throw new Rejected(reason);
}

export async function loadConfig(db: Database): Promise<GameConfig> {
  const [row] = await db.select().from(t.settings).where(eq(t.settings.id, 1));
  return mergeConfig(DEFAULT_CONFIG, row?.config ?? {});
}

export async function saveConfig(db: Database, config: GameConfig): Promise<void> {
  await db.insert(t.settings).values({ id: 1, config }).onConflictDoUpdate({ target: t.settings.id, set: { config } });
}

/** The active season, locked so concurrent commands on it run one after another. */
export async function lockActiveSeason(db: Database): Promise<Season | undefined> {
  const [season] = await db.select().from(t.seasons).where(eq(t.seasons.status, "active")).for("update");
  return season;
}

export async function activeSeason(db: Database): Promise<Season | undefined> {
  const [season] = await db.select().from(t.seasons).where(eq(t.seasons.status, "active"));
  return season;
}

export async function latestSeason(db: Database): Promise<Season | undefined> {
  const [season] = await db.select().from(t.seasons).orderBy(desc(t.seasons.id)).limit(1);
  return season;
}

export async function teams(db: Database): Promise<TeamRef[]> {
  return db
    .select({ id: t.teams.id, name: t.teams.name, color: t.teams.color, resource: t.teams.resource })
    .from(t.teams)
    .orderBy(t.teams.id);
}

export async function team(db: Database, id: number | null): Promise<TeamRef | null> {
  if (id === null) return null;
  return (await teams(db)).find((x) => x.id === id) ?? null;
}

export async function findPlayer(db: Database, id: PlayerId): Promise<Player | undefined> {
  const [player] = await db.select().from(t.players).where(eq(t.players.id, id));
  return player;
}

/** Players exist from the first time anyone refers to them, so newcomers can be thanked. */
export async function ensurePlayer(db: Database, id: PlayerId, now: Date): Promise<Player> {
  await db.insert(t.players).values({ id, createdAt: now }).onConflictDoNothing();
  return (await findPlayer(db, id))!;
}

export async function activeTeamSize(db: Database, teamId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.players)
    .where(and(eq(t.players.teamId, teamId), eq(t.players.optedOut, false)));
  return row?.n ?? 0;
}

export async function inventory(db: Database, seasonId: number, playerId: PlayerId): Promise<ResourceBag> {
  const rows = await db
    .select()
    .from(t.inventories)
    .where(and(eq(t.inventories.seasonId, seasonId), eq(t.inventories.playerId, playerId)));
  const bag: ResourceBag = {};
  for (const row of rows) if (row.quantity > 0) bag[row.resource] = row.quantity;
  return bag;
}

export function covers(have: ResourceBag, need: ResourceBag): boolean {
  return RESOURCES.every((r) => (have[r] ?? 0) >= (need[r] ?? 0));
}

interface Movement {
  seasonId: number;
  playerId: PlayerId;
  kind: LedgerKind;
  ref?: string;
  note?: string;
  at: Date;
}

export async function credit(db: Database, m: Movement, bag: ResourceBag): Promise<void> {
  for (const [resource, amount] of entries(bag)) {
    await db
      .insert(t.inventories)
      .values({ seasonId: m.seasonId, playerId: m.playerId, resource, quantity: amount })
      .onConflictDoUpdate({
        target: [t.inventories.seasonId, t.inventories.playerId, t.inventories.resource],
        set: { quantity: sql`${t.inventories.quantity} + ${amount}` },
      });
    await writeLedger(db, m, resource, amount);
  }
}

/** Rejects with `reason` when the player no longer holds enough, rolling the whole command back. */
export async function debit(
  db: Database,
  m: Movement,
  bag: ResourceBag,
  reason: Rejection = "INSUFFICIENT_RESOURCES",
): Promise<void> {
  for (const [resource, amount] of entries(bag)) {
    const updated = await db
      .update(t.inventories)
      .set({ quantity: sql`${t.inventories.quantity} - ${amount}` })
      .where(
        and(
          eq(t.inventories.seasonId, m.seasonId),
          eq(t.inventories.playerId, m.playerId),
          eq(t.inventories.resource, resource),
          sql`${t.inventories.quantity} >= ${amount}`,
        ),
      )
      .returning({ quantity: t.inventories.quantity });
    if (updated.length === 0) reject(reason);
    await writeLedger(db, m, resource, -amount);
  }
}

async function writeLedger(db: Database, m: Movement, resource: Resource, delta: number): Promise<void> {
  await db.insert(t.ledger).values({
    seasonId: m.seasonId,
    playerId: m.playerId,
    resource,
    delta,
    kind: m.kind,
    ref: m.ref ?? null,
    note: m.note ?? null,
    createdAt: m.at,
  });
}

export function entries(bag: ResourceBag): [Resource, number][] {
  return RESOURCES.filter((r) => (bag[r] ?? 0) > 0).map((r) => [r, bag[r]!]);
}

export async function buildings(db: Database, seasonId: number): Promise<Placed[]> {
  return db
    .select({
      kind: t.buildings.kind,
      location: t.buildings.location,
      teamId: t.buildings.teamId,
      playerId: t.buildings.playerId,
    })
    .from(t.buildings)
    .where(eq(t.buildings.seasonId, seasonId))
    .orderBy(t.buildings.id);
}

export function toThanksSummary(row: typeof t.thanks.$inferSelect): ThanksSummary {
  return {
    id: row.id,
    from: row.fromPlayer,
    to: row.toPlayer,
    resource: row.resource,
    reason: row.reason,
    sourceRef: row.sourceRef,
    at: row.createdAt,
  };
}
