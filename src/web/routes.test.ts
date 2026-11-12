import { describe, expect, test } from "bun:test";
import { startedGame } from "../game/test-kit.ts";
import { mapLinks, mapToken, readMapToken } from "./map-links.ts";
import { createWebHandler } from "./routes.ts";

describe("map links", () => {
  test("round-trip a signed token and reject a forged one", () => {
    const token = mapToken("secret", { seasonId: 3, version: 7 });
    expect(readMapToken("secret", token)).toEqual({ seasonId: 3, version: 7 });
    expect(readMapToken("other", token)).toBeNull();
    expect(readMapToken("secret", token.replace("3-7", "4-7"))).toBeNull();
  });

  test("are only handed out with a public URL", () => {
    expect(mapLinks(undefined, "s", { seasonId: 1, version: 0 })).toBeNull();
    expect(mapLinks("https://osada.example.com/", "s", { seasonId: 1, version: 0 })?.image).toMatch(
      /^https:\/\/osada\.example\.com\/map\/1-0-[\w-]{22}\/image\.png$/,
    );
  });
});

describe("web routes", () => {
  async function handler(ticks: number[] = []) {
    const { game } = await startedGame();
    return createWebHandler({ game, mapSecret: "secret", cronSecret: "cron", tick: async () => ticks.push(1) });
  }

  test("serve the map as PNG and as a web page for a valid token only", async () => {
    const web = await handler();
    const token = mapToken("secret", { seasonId: 1, version: 0 });
    const png = await web(new Request(`http://x/map/${token}/image.png`));
    expect(png.headers.get("content-type")).toBe("image/png");
    const page = await web(new Request(`http://x/map/${token}`));
    expect(await page.text()).toContain("<svg");
    expect((await web(new Request("http://x/map/1-0-AAAAAAAAAAAAAAAAAAAAAA"))).status).toBe(404);
  });

  test("run the scheduled tick only with the cron secret", async () => {
    const ticks: number[] = [];
    const web = await handler(ticks);
    expect((await web(new Request("http://x/cron/tick", { method: "POST" }))).status).toBe(401);
    const ok = await web(
      new Request("http://x/cron/tick", { method: "POST", headers: { authorization: "Bearer cron" } }),
    );
    expect(ok.status).toBe(200);
    expect(ticks).toHaveLength(1);
  });
});
