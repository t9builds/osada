/** The resource types a team can produce. Each team in a season owns exactly one. */
export const RESOURCES = ["wood", "brick", "wool", "grain", "ore", "glass"] as const;
export type Resource = (typeof RESOURCES)[number];

export function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}

/** A bag of resources, e.g. an inventory or one side of a trade. Missing keys mean zero. */
export type ResourceBag = Partial<Record<Resource, number>>;

/** Resource types sorted in the canonical order, so output is stable regardless of insertion order. */
export function sortResources(resources: Iterable<Resource>): Resource[] {
  return [...resources].sort((a, b) => RESOURCES.indexOf(a) - RESOURCES.indexOf(b));
}
