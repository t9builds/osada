/** The Drizzle schema. Only the game service reads and writes these tables (through `game/repository.ts`). */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { BoardSize } from "../engine/board.ts";
import type { TileKind } from "../engine/generate.ts";
import type { Resource, ResourceBag } from "../engine/resources.ts";
import type { BuildingKind } from "../engine/rules.ts";
import type { ConfigPatch } from "../game/config.ts";
import type { SeasonResult } from "../game/types.ts";

const createdAt = () => timestamp({ withTimezone: true }).notNull();

/** One row (id 1) holding the admin's overrides of the default config. */
export const settings = pgTable("settings", {
  id: integer().primaryKey(),
  config: jsonb().$type<ConfigPatch>().notNull(),
});

export const teams = pgTable("teams", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  color: text().notNull(),
  resource: text().$type<Resource>().notNull().unique(),
  createdAt: createdAt(),
});

/** Players are keyed by their Slack user id. */
export const players = pgTable("players", {
  id: text().primaryKey(),
  teamId: integer().references(() => teams.id),
  optedOut: boolean().notNull().default(false),
  createdAt: createdAt(),
});

export const seasons = pgTable(
  "seasons",
  {
    id: serial().primaryKey(),
    status: text().$type<"active" | "ended">().notNull(),
    seed: integer().notNull(),
    weeks: integer().notNull(),
    /** The Monday of the week the season is currently in. */
    weekKey: text().notNull(),
    weekNumber: integer().notNull(),
    size: text().$type<BoardSize>().notNull(),
    tiles: jsonb().$type<TileKind[]>().notNull(),
    /** Bumped on every build, so map image URLs change when the map does. */
    boardVersion: integer().notNull().default(0),
    longestRoadTeamId: integer(),
    startedAt: createdAt(),
    endedAt: timestamp({ withTimezone: true }),
    result: jsonb().$type<SeasonResult>(),
  },
  (t) => [uniqueIndex("one_active_season").on(t.status).where(sql`${t.status} = 'active'`)],
);

export const buildings = pgTable(
  "buildings",
  {
    id: serial().primaryKey(),
    seasonId: integer()
      .notNull()
      .references(() => seasons.id),
    kind: text().$type<BuildingKind>().notNull(),
    location: text().notNull(),
    teamId: integer()
      .notNull()
      .references(() => teams.id),
    /** Null for a team's starting buildings. */
    playerId: text().references(() => players.id),
    builtAt: createdAt(),
  },
  (t) => [unique().on(t.seasonId, t.location)],
);

/** What each player holds this season. Kept in step with the ledger in the same transaction. */
export const inventories = pgTable(
  "inventories",
  {
    seasonId: integer()
      .notNull()
      .references(() => seasons.id),
    playerId: text()
      .notNull()
      .references(() => players.id),
    resource: text().$type<Resource>().notNull(),
    quantity: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.playerId, t.resource] }),
    check("quantity_non_negative", sql`${t.quantity} >= 0`),
  ],
);

export const thanks = pgTable(
  "thanks",
  {
    id: serial().primaryKey(),
    seasonId: integer()
      .notNull()
      .references(() => seasons.id),
    weekKey: text().notNull(),
    fromPlayer: text()
      .notNull()
      .references(() => players.id),
    toPlayer: text()
      .notNull()
      .references(() => players.id),
    fromTeamId: integer().notNull(),
    toTeamId: integer(),
    resource: text().$type<Resource>().notNull(),
    reason: text().notNull(),
    sourceRef: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.seasonId, t.weekKey, t.fromPlayer, t.toPlayer), index().on(t.toPlayer)],
);

export const offers = pgTable("offers", {
  id: serial().primaryKey(),
  seasonId: integer()
    .notNull()
    .references(() => seasons.id),
  fromPlayer: text()
    .notNull()
    .references(() => players.id),
  /** Set for a direct offer to one player. */
  toPlayer: text().references(() => players.id),
  give: jsonb().$type<ResourceBag>().notNull(),
  want: jsonb().$type<ResourceBag>().notNull(),
  status: text().$type<"open" | "accepted" | "cancelled" | "expired">().notNull(),
  acceptedBy: text(),
  createdAt: createdAt(),
  closedAt: timestamp({ withTimezone: true }),
});

export type LedgerKind = "thanks" | "harvest" | "trade" | "bank" | "build" | "grant";

/** Append-only audit of every resource movement. */
export const ledger = pgTable(
  "ledger",
  {
    id: serial().primaryKey(),
    seasonId: integer()
      .notNull()
      .references(() => seasons.id),
    playerId: text()
      .notNull()
      .references(() => players.id),
    resource: text().$type<Resource>().notNull(),
    delta: integer().notNull(),
    kind: text().$type<LedgerKind>().notNull(),
    /** What caused it, e.g. `thanks:12`, `offer:3`, `build:C7`. */
    ref: text(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.playerId)],
);
