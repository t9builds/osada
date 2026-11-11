/** Starts Osada: database, game service, Slack app (Socket Mode or HTTP), map/cron routes and the scheduler. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { App, LogLevel } from "@slack/bolt";
import { openDatabase } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { GameService } from "./game/service.ts";
import { createTick, startInternalScheduler } from "./scheduler/tick.ts";
import { registerSlack } from "./slack/app.ts";
import { createWebHandler, type WebHandler } from "./web/routes.ts";

const env = readEnv();
const { db } = await openDatabase(env.databaseUrl, env.pgliteDir);
const game = new GameService(db, { now: () => new Date() });

let tick: () => Promise<unknown> = async () => ({ rolled: false });
const web = createWebHandler({ game, mapSecret: env.mapSecret, cronSecret: env.cronSecret, tick: () => tick() });
const routes = ["/healthz", "/cron/tick", "/map/:token", "/map/:token/image.png"].map((path) => ({
  path,
  method: ["GET", "POST"],
  handler: nodeAdapter(web),
}));

const app = new App({
  token: env.botToken,
  logLevel: LogLevel.INFO,
  customRoutes: routes,
  ...(env.appToken
    ? { socketMode: true, appToken: env.appToken, installerOptions: { port: env.port } }
    : { signingSecret: env.signingSecret }),
});

const notifier = registerSlack(app, {
  game,
  client: app.client,
  publicUrl: env.publicUrl,
  mapSecret: env.mapSecret,
  admins: env.admins,
});
tick = createTick(game, (events) => notifier.publish(events));

await app.start(env.port);
console.log(`Osada running on port ${env.port} (${env.appToken ? "Socket Mode" : "HTTP"})`);
if (env.internalScheduler) startInternalScheduler(tick);

/** Bolt's custom routes speak node:http; our handler speaks fetch. */
function nodeAdapter(handler: WebHandler) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body,
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
