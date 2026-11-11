/** All Czech copy players see in Slack, and formatting of game values into it. */
import { RESOURCE_EMOJI, RESOURCE_NAMES } from "../copy/resources.ts";
import { RESOURCES, type Resource, type ResourceBag } from "../engine/resources.ts";
import type { BuildingKind } from "../engine/rules.ts";
import type { GameConfig } from "../game/config.ts";
import type { Rejection } from "../game/types.ts";

export const REJECTIONS: Record<Rejection, string> = {
  NO_ACTIVE_SEASON: "Právě neběží žádná sezóna. Až ji admin spustí, můžeš hrát.",
  SEASON_ALREADY_ACTIVE: "Sezóna už běží. Novou můžeš spustit, až tahle skončí.",
  SEASON_IN_PROGRESS: "Tohle během sezóny nejde. Počkej na její konec.",
  SELF_THANKS: "Sobě poděkovat nejde – zkus to někomu, kdo ti pomohl. :wink:",
  REASON_TOO_SHORT: "Napiš prosím, za co děkuješ (aspoň pár slov). Díky bez příběhu se nepočítají.",
  NO_ALLOWANCE: "Tento týden už nemáš co rozdat. Nové díky dostaneš v pondělí.",
  ALREADY_THANKED_THIS_WEEK: "Tenhle člověk už od tebe tento týden poděkování má. Zkus to zase příští týden.",
  NOT_ON_TEAM: "Zatím nejsi v žádném týmu. Napiš adminovi hry, ať tě přiřadí.",
  OPTED_OUT: "Hru máš vypnutou. Zapneš ji příkazem `/osada prihlasit`.",
  RECIPIENT_OPTED_OUT: "Tenhle člověk se hry neúčastní.",
  ILLEGAL_LOCATION: "Na tohle místo stavět nejde – možná ho mezitím někdo zabral. Otevři stavění znovu.",
  INSUFFICIENT_RESOURCES: "Na tohle nemáš dost surovin.",
  OFFERER_INSUFFICIENT_RESOURCES: "Autor nabídky už nemá suroviny, které nabízel. Směna neproběhla.",
  INVALID_TRADE: "Takovou směnu udělat nejde. Zkontroluj, co dáváš a co chceš.",
  OFFER_NOT_FOUND: "Tahle nabídka neexistuje.",
  OFFER_CLOSED: "Tahle nabídka už neplatí.",
  OWN_OFFER: "Vlastní nabídku přijmout nemůžeš.",
  NOT_YOUR_OFFER: "Zrušit může jen autor nabídky.",
  OFFER_NOT_FOR_YOU: "Tahle nabídka je určená někomu jinému.",
  RESOURCE_NOT_IN_PLAY: "Tuhle surovinu v této hře žádný tým nevyrábí.",
  TOO_FEW_TEAMS: "Na sezónu jsou potřeba aspoň 3 týmy.",
  TOO_MANY_TEAMS: "Hra podporuje nejvýš 6 týmů.",
  TEAM_NAME_TAKEN: "Tým s tímto jménem už existuje.",
  RESOURCE_TAKEN: "Tuhle surovinu už vyrábí jiný tým.",
  UNKNOWN_TEAM: "Takový tým neznám.",
  INVALID_COLOR: "Barvu zadej jako #rrggbb, např. #d94f30.",
  INVALID_CONFIG: "Taková hodnota nastavení není platná.",
  INVALID_AMOUNT: "Počet musí být celé kladné číslo.",
};

export const BUILDING_NAMES: Record<BuildingKind, string> = { road: "cesta", settlement: "osada", city: "město" };
const BUILDING_ACCUSATIVE: Record<BuildingKind, string> = { road: "cestu", settlement: "osadu", city: "město" };

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function resource(r: Resource): string {
  return `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]}`;
}

/** `2× :rock: ruda, 1× :sheep: vlna`, or `nic` for an empty bag. */
export function bag(b: ResourceBag): string {
  const parts = RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${b[r]}× ${resource(r)}`);
  return parts.length ? parts.join(", ") : "nic";
}

export function building(kind: BuildingKind, location: string): string {
  return `${capitalize(BUILDING_NAMES[kind])} ${location}`;
}

export function builtAnnouncement(kind: BuildingKind): string {
  return BUILDING_ACCUSATIVE[kind];
}

export function points(n: number): string {
  if (n === 1) return "1 bod";
  if (n >= 2 && n <= 4) return `${n} body`;
  return `${n} bodů`;
}

export function differentResources(n: number): string {
  return n >= 2 && n <= 4 ? `${n} různé suroviny` : `${n} různých surovin`;
}

export function help(config: GameConfig): string {
  return [
    "*Osada – jak se hraje*",
    `• Každý tým vyrábí jednu surovinu. Každý týden můžeš rozdat ${config.allowance} kusy (v týmech do ${config.smallTeamMaxSize} lidí ${config.smallTeamAllowance}) – vždy s poděkováním: \`/dekuju @kolega za co\`.`,
    "• Stejnému člověku můžeš poděkovat jednou týdně, sobě ne. Nevyužité díky v neděli o půlnoci propadají.",
    "• Suroviny, které dostaneš, utrácíš za stavby na společné mapě (`/stavet`):",
    `   – cesta: ${differentResources(config.costs.road)}, ${points(config.points.road)}; musí navazovat na síť tvého týmu`,
    `   – osada: ${differentResources(config.costs.settlement)}, ${points(config.points.settlement)}; na cestě týmu a ne hned vedle jiné osady`,
    `   – město: ${differentResources(config.costs.city)}, vylepšení tvé osady, celkem ${points(config.points.city)}`,
    "• Každou neděli o půlnoci sklízíš: osada dává 1 a město 2 suroviny z každého sousedního pole (pustina nic).",
    `• Směňovat můžeš s ostatními (\`/smena\`) nebo s bankou ${config.bankRate} : 1 (\`/smena banka\`). Směňovat jde jen suroviny od ostatních, ne týdenní příděl.`,
    `• Tým s nejdelší souvislou cestou (aspoň ${config.longestRoadMin}) má +${points(config.longestRoadBonus)}.`,
    `• Body jdou týmu. Po ${config.seasonWeeks} týdnech sezóna končí a vyhrává tým s nejvíc body.`,
    "Další příkazy: `/osada stav`, `/osada mapa`, `/osada historie`, `/osada odhlasit`, `/osada prihlasit`.",
  ].join("\n");
}

export const WELCOME = [
  ":wave: *Vítej v Osadě!* Je to hra na poděkování: kdo ti pomůže, tomu pošli `/dekuju @kolega za co` a dostane surovinu tvého týmu.",
  "Za suroviny se staví cesty, osady a města na společné mapě a body jdou tvému týmu. Pravidla vypíše `/osada pomoc`.",
].join("\n");

export const NO_TEAM_YET =
  "Zatím nejsi v žádném týmu, takže stavět ani děkovat ještě nemůžeš. Napiš adminovi hry, ať tě přiřadí – suroviny, které mezitím dostaneš, ti počkají.";

export const USAGE_THANKS = "Použití: `/dekuju @kolega za co děkuješ` – třeba `/dekuju @Jana za pomoc s nasazením`.";
