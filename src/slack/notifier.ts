/**
 * Turns game events into Slack posts, DMs and App Home refreshes. A failed post (a missing channel, say) is logged
 * and never undoes the move that caused it.
 */
import type { webApi } from "@slack/bolt";
import type { GameService } from "../game/service.ts";
import type { EventOf, GameEvent, PlayerId } from "../game/types.ts";
import { type MapLinks, mapLinks } from "../web/map-links.ts";
import * as copy from "./copy.ts";
import * as views from "./views.ts";

export type SlackClient = webApi.WebClient;

export interface SlackDeps {
  game: GameService;
  client: SlackClient;
  /** Where Slack can fetch map images from; without it, messages carry no map. */
  publicUrl?: string;
  mapSecret: string;
  admins: string[];
  log?: (message: string, error?: unknown) => void;
}

export class Notifier {
  constructor(private readonly deps: SlackDeps) {}

  async publish(events: GameEvent[]): Promise<void> {
    const homes = new Set<PlayerId>();
    for (const event of events) {
      for (const player of await this.announce(event)) homes.add(player);
    }
    await Promise.all([...homes].map((p) => this.refreshHome(p)));
  }

  /** Posts what the event is worth posting; returns the players whose App Home changed. */
  private async announce(e: GameEvent): Promise<PlayerId[]> {
    const config = await this.deps.game.config();
    const gameChannel = config.digestChannel ?? config.thanksChannel;
    switch (e.type) {
      case "ThanksGiven":
        await this.thanksGiven(e, config.thanksChannel);
        return [e.from, e.to];
      case "BuildingBuilt":
        if (e.kind !== "road") await this.post(gameChannel, views.buildingPost(e));
        return [e.player];
      case "LongestRoadChanged":
        await this.post(gameChannel, views.longestRoadPost(e));
        return [];
      case "OfferCreated":
        await this.post(e.to ?? config.tradeChannel, views.offerMessage(e));
        return [e.from];
      case "TradeCompleted":
        await this.post(e.from, { text: views.tradeDoneText(e) });
        return [e.from, e.acceptedBy];
      case "HarvestPaid":
        await this.post(e.player, views.harvestDm(e));
        return [e.player];
      case "WeekRolled":
        await this.digest(e, gameChannel);
        return [];
      default:
        return this.announceAdminEvent(e, gameChannel);
    }
  }

  private async announceAdminEvent(e: GameEvent, gameChannel: string | null): Promise<PlayerId[]> {
    switch (e.type) {
      case "SeasonStarted": {
        const links = await this.mapLinks(e.seasonId);
        const image = links ? [{ type: "image" as const, image_url: links.image, alt_text: "Mapa Osady" }] : [];
        const message = `:tada: Začíná sezóna ${e.seasonId} Osady! Hraje se ${e.weeks} týdnů. Děkuj kolegům přes \`/dekuju\` a stav na mapě přes \`/stavet\`.`;
        await this.post(gameChannel, {
          text: message,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: message } }, ...image],
        });
        return [];
      }
      case "SeasonEnded":
        await this.post(gameChannel, views.seasonEndMessage(e.seasonId, e.result, await this.mapLinks(e.seasonId)));
        return [];
      case "PlayerAssigned":
        await this.post(e.player, {
          text: `:busts_in_silhouette: Jsi v týmu *${e.team.name}*. Rozdáváš ${copy.resource(e.team.resource)}. Pravidla: \`/osada pomoc\``,
        });
        return [e.player];
      case "ResourceGranted":
        await this.post(e.player, { text: `:gift: Dostáváš ${e.amount}× ${copy.resource(e.resource)}: ${e.note}` });
        return [e.player];
      case "BankTradeCompleted":
        return [e.player];
      case "OfferCancelled":
        return [e.by];
      case "OptOutChanged":
        return [e.player];
      default:
        return [];
    }
  }

  private async thanksGiven(e: EventOf<"ThanksGiven">, channel: string | null): Promise<void> {
    await this.post(channel, views.thanksPost(e));
    const view = await this.deps.game.playerView(e.to);
    await this.post(e.to, views.thanksDm(e, copy.bag(view.inventory)));
  }

  private async digest(e: EventOf<"WeekRolled">, channel: string | null): Promise<void> {
    const digest = await this.deps.game.weeklyDigest(e.seasonId, e.endedWeek);
    if (digest) await this.post(channel, views.digestMessage(digest, await this.mapLinks(e.seasonId)));
  }

  async mapLinks(seasonId?: number): Promise<MapLinks | null> {
    if (!this.deps.publicUrl) return null;
    const board = await this.deps.game.board(seasonId);
    if (!board) return null;
    return mapLinks(this.deps.publicUrl, this.deps.mapSecret, { seasonId: board.seasonId, version: board.version });
  }

  async refreshHome(player: PlayerId): Promise<void> {
    const { game } = this.deps;
    const view = await game.playerView(player);
    const links = view.season ? await this.mapLinks(view.season.id) : null;
    const home = views.homeView(view, links, await game.seasonHistory());
    await this.call("views.publish", () => this.deps.client.views.publish({ user_id: player, view: home }));
  }

  /** Posts to a channel, or to a user's DM with the app when given a user id. No channel configured: skipped. */
  async post(channel: string | null | undefined, message: views.Message): Promise<void> {
    if (!channel) return;
    await this.call("chat.postMessage", () =>
      this.deps.client.chat.postMessage({ channel, text: message.text, blocks: message.blocks, unfurl_links: false }),
    );
  }

  private async call(what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      (this.deps.log ?? console.error)(`Slack ${what} failed`, error);
    }
  }
}
