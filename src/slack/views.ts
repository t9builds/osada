/** Block Kit for App Home, modals and messages, built from the game service's views and events. */
import type { types } from "@slack/bolt";
import { RESOURCE_NAMES } from "../copy/resources.ts";
import type { Resource } from "../engine/resources.ts";
import type {
  EventOf,
  MoveOption,
  OfferView,
  PlayerView,
  SeasonResult,
  SeasonSummary,
  TeamScore,
  ThanksSummary,
  WeeklyDigest,
} from "../game/types.ts";
import type { MapLinks } from "../web/map-links.ts";
import * as copy from "./copy.ts";

type Block = types.KnownBlock;
type ModalView = types.ModalView;
type Option = types.PlainTextOption;

export const IDS = {
  thanksModal: "thanks_modal",
  buildModal: "build_modal",
  offerModal: "offer_modal",
  bankModal: "bank_modal",
  openBuild: "open_build",
  openOffer: "open_offer",
  openBank: "open_bank",
  acceptOffer: "accept_offer",
  cancelOffer: "cancel_offer",
  mapLink: "map_link",
  thanksShortcut: "podekovat",
} as const;

const text = (t: string): types.PlainTextElement => ({ type: "plain_text", text: t, emoji: true });
const mrkdwn = (t: string): types.MrkdwnElement => ({ type: "mrkdwn", text: t });
const section = (t: string): Block => ({ type: "section", text: mrkdwn(t) });
const context = (t: string): Block => ({ type: "context", elements: [mrkdwn(t)] });
const divider: Block = { type: "divider" };
const header = (t: string): Block => ({ type: "header", text: text(t) });

function mapImage(links: MapLinks | null, alt: string): Block[] {
  return links ? [{ type: "image", image_url: links.image, alt_text: alt }] : [];
}

function quote(t: ThanksSummary, who: string): string {
  return `• ${who} – „${t.reason}“ (${copy.resource(t.resource)})`;
}

export function scoreboardLines(scoreboard: TeamScore[]): string {
  if (!scoreboard.length) return "Zatím žádné body.";
  return scoreboard
    .map((s, i) => {
      const bonus = s.bonus ? ` _(+${s.bonus} nejdelší cesta)_` : "";
      return `${i + 1}. *${s.team.name}* – ${copy.points(s.points)}${bonus}`;
    })
    .join("\n");
}

// ---- App Home -------------------------------------------------------------------------------------------------

export function homeView(view: PlayerView, links: MapLinks | null, history: SeasonSummary[]): types.HomeView {
  const blocks: Block[] = [header("Osada")];
  if (view.isNewcomer) blocks.push(section(copy.WELCOME));
  if (view.optedOut) blocks.push(section(copy.REJECTIONS.OPTED_OUT));
  else if (!view.team) blocks.push(section(copy.NO_TEAM_YET));

  if (!view.season) {
    blocks.push(section("Právě neběží žádná sezóna. Až ji admin spustí, objeví se tu mapa a tvoje suroviny."));
  } else {
    blocks.push(...seasonBlocks(view, links));
  }
  if (history.length) {
    const lines = history.slice(0, 5).map((s) => `• Sezóna ${s.id}: ${winnerNames(s.result)}`);
    blocks.push(divider, section(`*Minulé sezóny*\n${lines.join("\n")}`));
  }
  return { type: "home", blocks };
}

function seasonBlocks(view: PlayerView, links: MapLinks | null): Block[] {
  const season = view.season!;
  const blocks: Block[] = [
    context(`Sezóna ${season.id} · týden ${Math.min(season.weekNumber, season.weeks)} z ${season.weeks}`),
  ];
  if (view.team) {
    const teamScore = view.scoreboard.find((s) => s.team.id === view.team!.id)?.points ?? 0;
    const allowance = view.allowance
      ? `\nTento týden můžeš ještě poděkovat *${view.allowance.left}×* (z ${view.allowance.total}) – rozdáváš ${copy.resource(view.team.resource)}.`
      : "";
    blocks.push(section(`Tým *${view.team.name}* · ${copy.points(teamScore)}${allowance}`));
  }
  blocks.push(section(`*Tvoje suroviny:* ${copy.bag(view.inventory)}`));
  if (view.team && !view.optedOut) {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", text: text(":hammer: Stavět"), action_id: IDS.openBuild, style: "primary" },
        { type: "button", text: text(":handshake: Nabídnout směnu"), action_id: IDS.openOffer },
        { type: "button", text: text(":bank: Banka"), action_id: IDS.openBank },
        ...(links
          ? [
              {
                type: "button" as const,
                text: text(":world_map: Mapa ve velkém"),
                url: links.page,
                action_id: IDS.mapLink,
              },
            ]
          : []),
      ],
    });
  }
  blocks.push(...mapImage(links, "Mapa Osady"));
  if (view.buildings.length) {
    blocks.push(section(`*Tvoje stavby:* ${view.buildings.map((b) => copy.building(b.kind, b.location)).join(", ")}`));
  }
  blocks.push(divider, section(`*Pořadí týmů*\n${scoreboardLines(view.scoreboard)}`));
  blocks.push(...thanksBlocks(view));
  blocks.push(...offerBlocks(view.openOffers));
  return blocks;
}

function thanksBlocks(view: PlayerView): Block[] {
  const blocks: Block[] = [];
  if (view.recentReceived.length) {
    const lines = view.recentReceived.map((t) => quote(t, `od <@${t.from}>`));
    blocks.push(divider, section(`*Poděkování pro tebe*\n${lines.join("\n")}`));
  }
  if (view.recentGiven.length) {
    const lines = view.recentGiven.map((t) => quote(t, `pro <@${t.to}>`));
    blocks.push(divider, section(`*Tvoje poděkování*\n${lines.join("\n")}`));
  }
  return blocks;
}

function offerBlocks(offers: OfferView[]): Block[] {
  if (!offers.length) return [];
  return [
    divider,
    section("*Tvoje otevřené nabídky*"),
    ...offers.map(
      (o): Block => ({
        type: "section",
        text: mrkdwn(offerText(o)),
        accessory: {
          type: "button",
          text: text("Zrušit"),
          action_id: IDS.cancelOffer,
          value: String(o.id),
          style: "danger",
        },
      }),
    ),
  ];
}

// ---- Modals ---------------------------------------------------------------------------------------------------

export function thanksModal(initialUser: string | undefined, metadata: string): ModalView {
  return {
    type: "modal",
    callback_id: IDS.thanksModal,
    private_metadata: metadata,
    title: text("Poděkovat"),
    submit: text("Poděkovat"),
    close: text("Zrušit"),
    blocks: [
      {
        type: "input",
        block_id: "recipient",
        label: text("Komu děkuješ"),
        element: { type: "users_select", action_id: "value", ...(initialUser ? { initial_user: initialUser } : {}) },
      },
      {
        type: "input",
        block_id: "reason",
        label: text("Za co"),
        element: { type: "plain_text_input", action_id: "value", multiline: true, min_length: 1 },
      },
    ],
  };
}

export function buildModal(moves: MoveOption[]): ModalView {
  const affordable = moves.filter((m) => m.payment && m.locations.length);
  const costs = moves
    .map((m) => {
      const pays = m.payment ? `zaplatíš ${m.payment.map((r) => RESOURCE_NAMES[r]).join(", ")}` : "na to nemáš";
      return `• ${copy.capitalize(copy.BUILDING_NAMES[m.kind])}: ${copy.differentResources(m.cost)} (${pays})`;
    })
    .join("\n");
  const base = { type: "modal" as const, callback_id: IDS.buildModal, title: text("Stavět"), close: text("Zavřít") };
  if (!affordable.length) {
    return {
      ...base,
      blocks: [
        section("Teď nemáš na žádnou stavbu, nebo pro ni není volné místo. Nech si poděkovat, nebo směňuj."),
        context(costs),
      ],
    };
  }
  return {
    ...base,
    submit: text("Postavit"),
    blocks: [
      {
        type: "input",
        block_id: "location",
        label: text("Co a kam postavit"),
        element: {
          type: "static_select",
          action_id: "value",
          placeholder: text("Vyber stavbu a místo na mapě"),
          option_groups: affordable.map((m) => ({
            label: text(copy.capitalize(copy.BUILDING_NAMES[m.kind])),
            options: m.locations
              .slice(0, 100)
              .map((loc): Option => ({ text: text(copy.building(m.kind, loc)), value: `${m.kind}|${loc}` })),
          })),
        },
      },
      context(`*Ceny:*\n${costs}`),
      context("Místa najdeš podle popisků na mapě v záložce Domů."),
    ],
  };
}

function resourceSelect(blockId: string, label: string, resources: Resource[]): Block {
  return {
    type: "input",
    block_id: blockId,
    label: text(label),
    element: {
      type: "static_select",
      action_id: "value",
      options: resources.map((r) => ({ text: text(copy.resource(r)), value: r })),
    },
  };
}

function amountInput(blockId: string, label: string): Block {
  return {
    type: "input",
    block_id: blockId,
    label: text(label),
    element: {
      type: "number_input",
      action_id: "value",
      is_decimal_allowed: false,
      min_value: "1",
      initial_value: "1",
    },
  };
}

export function offerModal(resources: Resource[]): ModalView {
  return {
    type: "modal",
    callback_id: IDS.offerModal,
    title: text("Nabídnout směnu"),
    submit: text("Nabídnout"),
    close: text("Zrušit"),
    blocks: [
      resourceSelect("give", "Dávám", resources),
      amountInput("give_amount", "Kolik"),
      resourceSelect("want", "Chci", resources),
      amountInput("want_amount", "Kolik"),
      {
        type: "input",
        block_id: "to",
        optional: true,
        label: text("Jen pro (nepovinné)"),
        hint: text("Když někoho vybereš, nabídka mu přijde soukromě. Jinak ji uvidí celý kanál pro směny."),
        element: { type: "users_select", action_id: "value" },
      },
    ],
  };
}

export function bankModal(resources: Resource[], rate: number): ModalView {
  return {
    type: "modal",
    callback_id: IDS.bankModal,
    title: text("Banka"),
    submit: text("Směnit"),
    close: text("Zrušit"),
    blocks: [
      section(`Banka bere ${rate} stejné suroviny a dá ti 1 surovinu podle tvé volby.`),
      resourceSelect("give", `Dávám ${rate}×`, resources),
      resourceSelect("get", "Dostanu 1×", resources),
    ],
  };
}

// ---- Messages -------------------------------------------------------------------------------------------------

export interface Message {
  text: string;
  blocks?: Block[];
}

export function thanksPost(e: EventOf<"ThanksGiven">): Message {
  const source = e.sourceRef ? ` · <${e.sourceRef}|původní zpráva>` : "";
  const line = `:raised_hands: <@${e.from}> děkuje <@${e.to}>: „${e.reason}“`;
  return {
    text: `${line} (+1 ${copy.resource(e.resource)})`,
    blocks: [section(line), context(`+1 ${copy.resource(e.resource)} od týmu *${e.fromTeam.name}*${source}`)],
  };
}

export function thanksDm(e: EventOf<"ThanksGiven">, inventory: string): Message {
  const lines = [
    `:tada: Poděkování od <@${e.from}>: „${e.reason}“`,
    `Dostáváš 1× ${copy.resource(e.resource)}. Teď máš: ${inventory}.`,
  ];
  if (e.recipientIsNew) lines.push("", copy.WELCOME);
  if (!e.toTeam) lines.push("", copy.NO_TEAM_YET);
  return { text: lines.join("\n") };
}

export function thanksConfirmation(e: EventOf<"ThanksGiven">): string {
  const left =
    e.allowanceLeft > 0 ? `Tento týden můžeš poděkovat ještě ${e.allowanceLeft}×.` : "Pro tento týden máš rozdáno.";
  return `:white_check_mark: Hotovo, <@${e.to}> dostává 1× ${copy.resource(e.resource)}. ${left}`;
}

export function buildingPost(e: EventOf<"BuildingBuilt">): Message {
  const icon = e.kind === "city" ? ":cityscape:" : ":house:";
  return {
    text: `${icon} Tým *${e.team.name}* má ${copy.builtAnnouncement(e.kind)} na ${e.location}! Staví <@${e.player}>.`,
  };
}

export function longestRoadPost(e: EventOf<"LongestRoadChanged">): Message {
  if (!e.team) return { text: `:construction: Tým *${e.previous?.name}* přišel o bonus za nejdelší cestu.` };
  return { text: `:motorway: Nejdelší cestu má teď tým *${e.team.name}* (+2 body).` };
}

export function offerText(o: { from: string; to: string | null; give: OfferView["give"]; want: OfferView["want"] }) {
  const forWhom = o.to ? ` pro <@${o.to}>` : "";
  return `:handshake: <@${o.from}> nabízí${forWhom} *${copy.bag(o.give)}* za *${copy.bag(o.want)}*`;
}

export function offerMessage(e: EventOf<"OfferCreated">): Message {
  const line = offerText(e);
  return {
    text: line,
    blocks: [
      section(line),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: text("Přijmout"),
            action_id: IDS.acceptOffer,
            value: String(e.offerId),
            style: "primary",
          },
          { type: "button", text: text("Zrušit"), action_id: IDS.cancelOffer, value: String(e.offerId) },
        ],
      },
    ],
  };
}

export function tradeDoneText(e: EventOf<"TradeCompleted">): string {
  return `:white_check_mark: Směna hotová: <@${e.from}> předává ${copy.bag(e.give)}, <@${e.acceptedBy}> předává ${copy.bag(e.want)}.`;
}

export function harvestDm(e: EventOf<"HarvestPaid">): Message {
  return { text: `:basket: Týdenní sklizeň z tvých staveb: ${copy.bag(e.resources)}.` };
}

export function digestMessage(digest: WeeklyDigest, links: MapLinks | null): Message {
  const stories = digest.topThanks.map((t) => `• <@${t.from}> → <@${t.to}>: „${t.reason}“`).join("\n");
  const harvest = digest.harvest.map((h) => `${h.team.name} ${h.amount}`).join(", ");
  const blocks: Block[] = [
    header(`Osada – týden ${digest.weekKey}`),
    section(`Tento týden padlo *${digest.thanksCount}* poděkování.${stories ? `\n${stories}` : ""}`),
    ...(harvest ? [section(`*Sklizeň:* ${harvest}`)] : []),
    section(`*Pořadí týmů*\n${scoreboardLines(digest.scoreboard)}`),
    ...mapImage(links, "Mapa Osady"),
    ...(links ? [context(`<${links.page}|Mapa ve velkém>`)] : []),
  ];
  return { text: `Osada – shrnutí týdne ${digest.weekKey}`, blocks };
}

function winnerNames(result: SeasonResult): string {
  return result.winners.length ? result.winners.map((t) => `*${t.name}*`).join(" a ") : "bez vítěze";
}

export function seasonEndMessage(seasonId: number, result: SeasonResult, links: MapLinks | null): Message {
  const highlights = [
    `Celkem poděkování: *${result.totalThanks}*`,
    result.mostThanked && `Nejvíc poděkování: <@${result.mostThanked.player}> (${result.mostThanked.count}×)`,
    result.mostCrossTeamThanks &&
      `Nejvíc díků napříč týmy rozdává <@${result.mostCrossTeamThanks.player}> (${result.mostCrossTeamThanks.count}×)`,
  ].filter(Boolean);
  const blocks: Block[] = [
    header(`Konec sezóny ${seasonId}!`),
    section(`:trophy: Vítěz: ${winnerNames(result)}`),
    section(`*Konečné pořadí*\n${scoreboardLines(result.scoreboard)}`),
    section(highlights.join("\n")),
    ...mapImage(links, "Konečná mapa"),
    context("Inventáře se vynulovaly. Další sezónu spustí admin."),
  ];
  return { text: `Konec sezóny ${seasonId}! Vítěz: ${winnerNames(result)}`, blocks };
}
