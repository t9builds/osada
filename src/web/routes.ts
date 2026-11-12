/**
 * The app's own HTTP routes, served next to Slack's: the map image and web view behind unguessable links, a health
 * check, and the scheduler endpoint Cloud Scheduler calls.
 */
import type { GameService } from "../game/service.ts";
import { renderMapPage } from "../render/map-page.ts";
import { svgToPng } from "../render/map-png.ts";
import { renderMapSvg } from "../render/map-svg.ts";
import { readMapToken } from "./map-links.ts";

export interface WebDeps {
  game: GameService;
  mapSecret: string;
  /** Without one, the scheduler endpoint is off. */
  cronSecret?: string;
  tick(): Promise<unknown>;
}

export type WebHandler = (request: Request) => Promise<Response>;

export function createWebHandler(deps: WebDeps): WebHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/cron/tick") return cron(deps, request);
    const map = /^\/map\/([\w-]+)(\/image\.png)?$/.exec(url.pathname);
    if (map && request.method === "GET") return mapRoute(deps, map[1]!, map[2] !== undefined);
    return new Response("Not found", { status: 404 });
  };
}

async function cron(deps: WebDeps, request: Request): Promise<Response> {
  if (!deps.cronSecret || request.method !== "POST") return new Response("Not found", { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${deps.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await deps.tick());
}

async function mapRoute(deps: WebDeps, token: string, image: boolean): Promise<Response> {
  const ref = readMapToken(deps.mapSecret, token);
  const board = ref && (await deps.game.board(ref.seasonId));
  if (!board) return new Response("Not found", { status: 404 });
  const title = `Osada – season ${board.seasonId}`;
  const svg = renderMapSvg(board, { title });
  if (image) {
    const png = svgToPng(svg, 1200);
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  return new Response(renderMapPage(board, svg, title), { headers: { "content-type": "text/html; charset=utf-8" } });
}
