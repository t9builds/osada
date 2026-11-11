/** Czech names and map colours of resources and tiles, shared by the Slack copy and the map renderer. */
import type { TileKind } from "../engine/generate.ts";
import type { Resource } from "../engine/resources.ts";

export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: "dřevo",
  brick: "cihly",
  wool: "vlna",
  grain: "obilí",
  ore: "ruda",
  glass: "sklo",
};

export const RESOURCE_EMOJI: Record<Resource, string> = {
  wood: ":evergreen_tree:",
  brick: ":bricks:",
  wool: ":sheep:",
  grain: ":ear_of_rice:",
  ore: ":rock:",
  glass: ":crystal_ball:",
};

export const TILE_COLORS: Record<TileKind, string> = {
  wood: "#4f7d45",
  brick: "#b8573d",
  wool: "#9fcf7f",
  grain: "#e9c64d",
  ore: "#8b8f96",
  glass: "#86cbd8",
  desert: "#e5d6ab",
};

export const TILE_LABELS: Record<TileKind, string> = {
  wood: "Dřevo",
  brick: "Cihly",
  wool: "Vlna",
  grain: "Obilí",
  ore: "Ruda",
  glass: "Sklo",
  desert: "Pustina",
};
