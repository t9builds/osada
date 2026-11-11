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
  thanksShortcut: "thank",
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
  return `• ${who} – “${t.reason}” (${copy.resource(t.resource)})`;
}

export function scoreboardLines(scoreboard: TeamScore[]): string {
  if (!scoreboard.length) return "No points yet.";
  return scoreboard
    .map((s, i) => {
      const bonus = s.bonus ? ` _(+${s.bonus} longest road)_` : "";
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
    blocks.push(section("No season is running. When an admin starts one, the map and your resources show up here."));
  } else {
    blocks.push(...seasonBlocks(view, links));
  }
  if (history.length) {
    const lines = history.slice(0, 5).map((s) => `• Season ${s.id}: ${winnerNames(s.result)}`);
    blocks.push(divider, section(`*Past seasons*\n${lines.join("\n")}`));
  }
  return { type: "home", blocks };
}

function seasonBlocks(view: PlayerView, links: MapLinks | null): Block[] {
  const season = view.season!;
  const blocks: Block[] = [
    context(`Season ${season.id} · week ${Math.min(season.weekNumber, season.weeks)} of ${season.weeks}`),
  ];
  if (view.team) {
    const teamScore = view.scoreboard.find((s) => s.team.id === view.team!.id)?.points ?? 0;
    const allowance = view.allowance
      ? `\nThanks left this week: *${view.allowance.left}* of ${view.allowance.total} – you give ${copy.resource(view.team.resource)}.`
      : "";
    blocks.push(section(`Team *${view.team.name}* · ${copy.points(teamScore)}${allowance}`));
  }
  blocks.push(section(`*Your resources:* ${copy.bag(view.inventory)}`));
  if (view.team && !view.optedOut) {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", text: text(":hammer: Build"), action_id: IDS.openBuild, style: "primary" },
        { type: "button", text: text(":handshake: Offer a trade"), action_id: IDS.openOffer },
        { type: "button", text: text(":bank: Bank"), action_id: IDS.openBank },
        ...(links
          ? [
              {
                type: "button" as const,
                text: text(":world_map: Full-size map"),
                url: links.page,
                action_id: IDS.mapLink,
              },
            ]
          : []),
      ],
    });
  }
  blocks.push(...mapImage(links, "Osada map"));
  if (view.buildings.length) {
    blocks.push(
      section(`*Your buildings:* ${view.buildings.map((b) => copy.building(b.kind, b.location)).join(", ")}`),
    );
  }
  blocks.push(divider, section(`*Team standings*\n${scoreboardLines(view.scoreboard)}`));
  blocks.push(...thanksBlocks(view));
  blocks.push(...offerBlocks(view.openOffers));
  return blocks;
}

function thanksBlocks(view: PlayerView): Block[] {
  const blocks: Block[] = [];
  if (view.recentReceived.length) {
    const lines = view.recentReceived.map((t) => quote(t, `from <@${t.from}>`));
    blocks.push(divider, section(`*Thanks you received*\n${lines.join("\n")}`));
  }
  if (view.recentGiven.length) {
    const lines = view.recentGiven.map((t) => quote(t, `to <@${t.to}>`));
    blocks.push(divider, section(`*Thanks you gave*\n${lines.join("\n")}`));
  }
  return blocks;
}

function offerBlocks(offers: OfferView[]): Block[] {
  if (!offers.length) return [];
  return [
    divider,
    section("*Your open offers*"),
    ...offers.map(
      (o): Block => ({
        type: "section",
        text: mrkdwn(offerText(o)),
        accessory: {
          type: "button",
          text: text("Cancel"),
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
    title: text("Thank someone"),
    submit: text("Thank"),
    close: text("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "recipient",
        label: text("Who are you thanking?"),
        element: { type: "users_select", action_id: "value", ...(initialUser ? { initial_user: initialUser } : {}) },
      },
      {
        type: "input",
        block_id: "reason",
        label: text("What for?"),
        element: { type: "plain_text_input", action_id: "value", multiline: true, min_length: 1 },
      },
    ],
  };
}

export function buildModal(moves: MoveOption[]): ModalView {
  const affordable = moves.filter((m) => m.payment && m.locations.length);
  const costs = moves
    .map((m) => {
      const pays = m.payment ? `you pay ${m.payment.map((r) => RESOURCE_NAMES[r]).join(", ")}` : "you can't afford it";
      return `• ${copy.capitalize(copy.BUILDING_NAMES[m.kind])}: ${copy.differentResources(m.cost)} (${pays})`;
    })
    .join("\n");
  const base = { type: "modal" as const, callback_id: IDS.buildModal, title: text("Build"), close: text("Close") };
  if (!affordable.length) {
    return {
      ...base,
      blocks: [
        section("You can't afford any building right now, or there's no free spot for one. Get thanked, or trade."),
        context(costs),
      ],
    };
  }
  return {
    ...base,
    submit: text("Build"),
    blocks: [
      {
        type: "input",
        block_id: "location",
        label: text("What to build, and where"),
        element: {
          type: "static_select",
          action_id: "value",
          placeholder: text("Pick a building and a spot on the map"),
          option_groups: affordable.map((m) => ({
            label: text(copy.capitalize(copy.BUILDING_NAMES[m.kind])),
            options: m.locations
              .slice(0, 100)
              .map((loc): Option => ({ text: text(copy.building(m.kind, loc)), value: `${m.kind}|${loc}` })),
          })),
        },
      },
      context(`*Costs:*\n${costs}`),
      context("Find each spot by its label on the map in the Home tab."),
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
    title: text("Offer a trade"),
    submit: text("Offer"),
    close: text("Cancel"),
    blocks: [
      resourceSelect("give", "I give", resources),
      amountInput("give_amount", "How many"),
      resourceSelect("want", "I want", resources),
      amountInput("want_amount", "How many"),
      {
        type: "input",
        block_id: "to",
        optional: true,
        label: text("Only for (optional)"),
        hint: text("Pick someone to send them the offer privately. Otherwise the whole trade channel sees it."),
        element: { type: "users_select", action_id: "value" },
      },
    ],
  };
}

export function bankModal(resources: Resource[], rate: number): ModalView {
  return {
    type: "modal",
    callback_id: IDS.bankModal,
    title: text("Bank"),
    submit: text("Trade"),
    close: text("Cancel"),
    blocks: [
      section(`The bank takes ${rate} identical resources and gives you 1 resource of your choice.`),
      resourceSelect("give", `I give ${rate}×`, resources),
      resourceSelect("get", "I get 1×", resources),
    ],
  };
}

// ---- Messages -------------------------------------------------------------------------------------------------

export interface Message {
  text: string;
  blocks?: Block[];
}

export function thanksPost(e: EventOf<"ThanksGiven">): Message {
  const source = e.sourceRef ? ` · <${e.sourceRef}|original message>` : "";
  const line = `:raised_hands: <@${e.from}> thanks <@${e.to}>: “${e.reason}”`;
  return {
    text: `${line} (+1 ${copy.resource(e.resource)})`,
    blocks: [section(line), context(`+1 ${copy.resource(e.resource)} from team *${e.fromTeam.name}*${source}`)],
  };
}

export function thanksDm(e: EventOf<"ThanksGiven">, inventory: string): Message {
  const lines = [
    `:tada: Thanks from <@${e.from}>: “${e.reason}”`,
    `You get 1× ${copy.resource(e.resource)}. You now have: ${inventory}.`,
  ];
  if (e.recipientIsNew) lines.push("", copy.WELCOME);
  if (!e.toTeam) lines.push("", copy.NO_TEAM_YET);
  return { text: lines.join("\n") };
}

export function thanksConfirmation(e: EventOf<"ThanksGiven">): string {
  const left =
    e.allowanceLeft > 0 ? `Thanks left this week: ${e.allowanceLeft}.` : "You've given all your thanks this week.";
  return `:white_check_mark: Done, <@${e.to}> gets 1× ${copy.resource(e.resource)}. ${left}`;
}

export function buildingPost(e: EventOf<"BuildingBuilt">): Message {
  const icon = e.kind === "city" ? ":cityscape:" : ":house:";
  return {
    text: `${icon} Team *${e.team.name}* has a new ${copy.BUILDING_NAMES[e.kind]} at ${e.location}! Built by <@${e.player}>.`,
  };
}

export function longestRoadPost(e: EventOf<"LongestRoadChanged">): Message {
  if (!e.team) return { text: `:construction: Team *${e.previous?.name}* lost the longest-road bonus.` };
  return { text: `:motorway: Team *${e.team.name}* now has the longest road.` };
}

export function offerText(o: { from: string; to: string | null; give: OfferView["give"]; want: OfferView["want"] }) {
  const forWhom = o.to ? ` to <@${o.to}>` : "";
  return `:handshake: <@${o.from}> offers${forWhom} *${copy.bag(o.give)}* for *${copy.bag(o.want)}*`;
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
            text: text("Accept"),
            action_id: IDS.acceptOffer,
            value: String(e.offerId),
            style: "primary",
          },
          { type: "button", text: text("Cancel"), action_id: IDS.cancelOffer, value: String(e.offerId) },
        ],
      },
    ],
  };
}

export function tradeDoneText(e: EventOf<"TradeCompleted">): string {
  return `:white_check_mark: Trade done: <@${e.from}> gave ${copy.bag(e.give)}, <@${e.acceptedBy}> gave ${copy.bag(e.want)}.`;
}

export function harvestDm(e: EventOf<"HarvestPaid">): Message {
  return { text: `:basket: Weekly harvest from your buildings: ${copy.bag(e.resources)}.` };
}

export function digestMessage(digest: WeeklyDigest, links: MapLinks | null): Message {
  const stories = digest.topThanks.map((t) => `• <@${t.from}> → <@${t.to}>: “${t.reason}”`).join("\n");
  const harvest = digest.harvest.map((h) => `${h.team.name} ${h.amount}`).join(", ");
  const blocks: Block[] = [
    header(`Osada – week of ${digest.weekKey}`),
    section(`*${digest.thanksCount}* thanks were given this week.${stories ? `\n${stories}` : ""}`),
    ...(harvest ? [section(`*Harvest:* ${harvest}`)] : []),
    section(`*Team standings*\n${scoreboardLines(digest.scoreboard)}`),
    ...mapImage(links, "Osada map"),
    ...(links ? [context(`<${links.page}|Full-size map>`)] : []),
  ];
  return { text: `Osada – weekly digest for ${digest.weekKey}`, blocks };
}

function winnerNames(result: SeasonResult): string {
  return result.winners.length ? result.winners.map((t) => `*${t.name}*`).join(" and ") : "no winner";
}

export function seasonEndMessage(seasonId: number, result: SeasonResult, links: MapLinks | null): Message {
  const highlights = [
    `Thanks given: *${result.totalThanks}*`,
    result.mostThanked && `Most thanked: <@${result.mostThanked.player}> (${result.mostThanked.count}×)`,
    result.mostCrossTeamThanks &&
      `Most cross-team thanks given: <@${result.mostCrossTeamThanks.player}> (${result.mostCrossTeamThanks.count}×)`,
  ].filter(Boolean);
  const blocks: Block[] = [
    header(`Season ${seasonId} is over!`),
    section(`:trophy: Winner: ${winnerNames(result)}`),
    section(`*Final standings*\n${scoreboardLines(result.scoreboard)}`),
    section(highlights.join("\n")),
    ...mapImage(links, "Final map"),
    context("Inventories have been reset. An admin will start the next season."),
  ];
  return { text: `Season ${seasonId} is over! Winner: ${winnerNames(result)}`, blocks };
}
