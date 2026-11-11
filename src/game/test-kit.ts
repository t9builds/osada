/**
 * Test support: a game service on an in-process PGlite database with a settable clock. One database is shared by
 * all tests in the run and emptied for each new game, since creating one takes half a second.
 */
import { sql } from "drizzle-orm";
import { type Database, openDatabase } from "../db/client.ts";
import type { Resource } from "../engine/resources.ts";
import { GameService } from "./service.ts";
import type { CommandResult, PlayerId } from "./types.ts";

let shared: Promise<Database> | undefined;

async function freshDatabase(): Promise<Database> {
  shared ??= openDatabase().then(({ db }) => db);
  const db = await shared;
  await db.execute(
    sql`truncate settings, teams, players, seasons, buildings, inventories, thanks, offers, ledger restart identity cascade`,
  );
  return db;
}

export class FakeClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(at: string | Date): void {
    this.current = new Date(at);
  }
  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
}

/** Wednesday noon in Prague. */
export const WEDNESDAY = "2026-11-11T11:00:00Z";

export async function createTestGame(at: string = WEDNESDAY) {
  const clock = new FakeClock(new Date(at));
  const game = new GameService(await freshDatabase(), clock);
  return { game, clock };
}

export interface TeamSetup {
  name: string;
  resource: Resource;
  players: PlayerId[];
}

/** Three teams of four (so the regular allowance applies), with players named after their team: `e1`, `d1`, `s1`… */
export const DEFAULT_TEAMS: TeamSetup[] = [
  { name: "Engineering", resource: "ore", players: ["e1", "e2", "e3", "e4"] },
  { name: "Design", resource: "wool", players: ["d1", "d2", "d3", "d4"] },
  { name: "Sales", resource: "grain", players: ["s1", "s2", "s3", "s4"] },
];

const COLORS = ["#d94f30", "#3b7dd8", "#e0b020", "#4caf50", "#8e44ad", "#16a085"];

export async function setUpTeams(game: GameService, teams: TeamSetup[] = DEFAULT_TEAMS): Promise<void> {
  for (const [i, team] of teams.entries()) {
    expectOk(await game.defineTeam({ name: team.name, color: COLORS[i]!, resource: team.resource }));
    for (const player of team.players) expectOk(await game.assignPlayer(player, team.name));
  }
}

/** Teams set up and a season started with a fixed seed. */
export async function startedGame(options: { at?: string; teams?: TeamSetup[]; seed?: number } = {}) {
  const ctx = await createTestGame(options.at);
  await setUpTeams(ctx.game, options.teams);
  expectOk(await ctx.game.startSeason({ seed: options.seed ?? 42 }));
  return ctx;
}

export function expectOk(result: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result;
}
