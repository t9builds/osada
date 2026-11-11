/** Test support: a fake Slack Web API client that records calls, and handler wiring around a test game. */
import type { GameService } from "../game/service.ts";
import { createHandlers } from "./handlers.ts";
import { Notifier, type SlackClient, type SlackDeps } from "./notifier.ts";

export interface SlackCall {
  method: string;
  args: any;
}

export function fakeSlack(responses: Record<string, unknown> = {}) {
  const calls: SlackCall[] = [];
  const proxy = (path: string[]): any =>
    new Proxy(() => {}, {
      get: (_, key: string) => proxy([...path, key]),
      apply: async (_, __, [args]) => {
        const method = path.join(".");
        calls.push({ method, args });
        return { ok: true, ...((responses[method] as object) ?? {}) };
      },
    });
  return { client: proxy([]) as SlackClient, calls };
}

export function slackHarness(game: GameService, responses?: Record<string, unknown>) {
  const { client, calls } = fakeSlack(responses);
  const deps: SlackDeps = { game, client, mapSecret: "secret", admins: ["admin"], log: () => {} };
  const handlers = createHandlers(deps, new Notifier(deps));
  const replies: any[] = [];
  const acks: any[] = [];
  const ack = async (response?: unknown) => void acks.push(response);
  const respond = async (message: unknown) => void replies.push(message);
  const posts = (channel: string) => calls.filter((c) => c.method === "chat.postMessage" && c.args.channel === channel);
  return { handlers, deps, calls, replies, acks, ack, respond, posts };
}

export async function fixture(name: string): Promise<any> {
  return Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).json();
}
