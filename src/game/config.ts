/** The workspace's tunable game settings, their defaults and validation. */
import type { Costs, Points } from "../engine/rules.ts";
import { isValidTimeZone } from "../engine/week.ts";

export interface GameConfig {
  thanksChannel: string | null;
  tradeChannel: string | null;
  digestChannel: string | null;
  /** Thanks each player may give per week. */
  allowance: number;
  /** Allowance for players on teams of at most `smallTeamMaxSize` active players. */
  smallTeamAllowance: number;
  smallTeamMaxSize: number;
  timezone: string;
  /** How many different resources each building costs. */
  costs: Costs;
  points: Points;
  seasonWeeks: number;
  /** Identical resources the bank takes for one of your choice. */
  bankRate: number;
  minReasonLength: number;
  longestRoadMin: number;
  longestRoadBonus: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  thanksChannel: null,
  tradeChannel: null,
  digestChannel: null,
  allowance: 3,
  smallTeamAllowance: 5,
  smallTeamMaxSize: 3,
  timezone: "Europe/Prague",
  costs: { road: 2, settlement: 3, city: 4 },
  points: { road: 1, settlement: 3, city: 6 },
  seasonWeeks: 6,
  bankRate: 3,
  minReasonLength: 5,
  longestRoadMin: 5,
  longestRoadBonus: 2,
};

export type ConfigPatch = Partial<Omit<GameConfig, "costs" | "points">> & {
  costs?: Partial<Costs>;
  points?: Partial<Points>;
};

export function mergeConfig(base: GameConfig, patch: ConfigPatch): GameConfig {
  return {
    ...base,
    ...patch,
    costs: { ...base.costs, ...patch.costs },
    points: { ...base.points, ...patch.points },
  };
}

const POSITIVE_INTS = [
  "allowance",
  "smallTeamAllowance",
  "smallTeamMaxSize",
  "seasonWeeks",
  "bankRate",
  "minReasonLength",
  "longestRoadMin",
] as const;

export function isValidConfig(config: GameConfig): boolean {
  const positive = (n: number) => Number.isInteger(n) && n >= 1;
  return (
    POSITIVE_INTS.every((key) => positive(config[key])) &&
    Number.isInteger(config.longestRoadBonus) &&
    config.longestRoadBonus >= 0 &&
    Object.values(config.costs).every(positive) &&
    Object.values(config.points).every((n) => Number.isInteger(n) && n >= 0) &&
    isValidTimeZone(config.timezone)
  );
}
