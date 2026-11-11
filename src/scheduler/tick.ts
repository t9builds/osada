/**
 * The scheduled job: rolls the game into a new week (harvest, offer expiry, digest, season end) and announces what
 * happened. The in-process timer (local dev) and the authenticated HTTP endpoint (Cloud Scheduler) both call this.
 */
import type { GameService } from "../game/service.ts";
import type { GameEvent } from "../game/types.ts";

export interface TickResult {
  rolled: boolean;
  events: GameEvent["type"][];
}

export function createTick(game: GameService, publish: (events: GameEvent[]) => Promise<void>) {
  return async (): Promise<TickResult> => {
    const result = await game.rollWeek();
    if (!result.ok || result.events.length === 0) return { rolled: false, events: [] };
    await publish(result.events);
    return { rolled: true, events: result.events.map((e) => e.type) };
  };
}

/** Checks every few minutes; rolling is a no-op until the week changes. */
export function startInternalScheduler(tick: () => Promise<unknown>, everyMs = 5 * 60_000): () => void {
  const run = () => tick().catch((error) => console.error("Scheduled tick failed", error));
  const timer = setInterval(run, everyMs);
  run();
  return () => clearInterval(timer);
}
