import { describe, expect, test } from "bun:test";
import { expectOk, startedGame } from "./test-kit.ts";
import { eventOf } from "./types.ts";

async function tradingGame() {
  const ctx = await startedGame();
  // Received resources only: e1 holds 3 wool, s1 holds 2 ore.
  for (const from of ["d1", "d2", "d3"]) expectOk(await ctx.game.thank(from, "e1", "Díky za pomoc"));
  for (const from of ["e2", "e3"]) expectOk(await ctx.game.thank(from, "s1", "Díky za pomoc"));
  return ctx;
}

describe("bank trade", () => {
  test("takes three identical resources for one of your choice", async () => {
    const { game } = await tradingGame();
    const event = eventOf(await game.bankTrade("e1", "wool", "grain"), "BankTradeCompleted");
    expect(event).toMatchObject({ player: "e1", gave: { wool: 3 }, got: "grain" });
    expect((await game.playerView("e1")).inventory).toEqual({ grain: 1 });
  });

  test("rejects without three of the resource", async () => {
    const { game } = await tradingGame();
    expect(await game.bankTrade("s1", "ore", "wool")).toEqual({ ok: false, reason: "INSUFFICIENT_RESOURCES" });
  });

  test("rejects a resource no team produces", async () => {
    const { game } = await tradingGame();
    expect(await game.bankTrade("e1", "wool", "glass")).toEqual({ ok: false, reason: "RESOURCE_NOT_IN_PLAY" });
  });

  test("only received resources count: the weekly allowance can't be traded", async () => {
    const { game } = await tradingGame();
    expect(await game.bankTrade("d4", "wool", "ore")).toEqual({ ok: false, reason: "INSUFFICIENT_RESOURCES" });
  });
});

describe("player offers", () => {
  test("an accepted offer swaps both sides", async () => {
    const { game } = await tradingGame();
    const created = eventOf(await game.createOffer("e1", { wool: 2 }, { ore: 1 }), "OfferCreated")!;
    expect(await game.openOffers()).toHaveLength(1);
    const done = eventOf(await game.acceptOffer("s1", created.offerId), "TradeCompleted");
    expect(done).toMatchObject({ from: "e1", acceptedBy: "s1", give: { wool: 2 }, want: { ore: 1 } });
    expect((await game.playerView("e1")).inventory).toEqual({ wool: 1, ore: 1 });
    expect((await game.playerView("s1")).inventory).toEqual({ wool: 2, ore: 1 });
    expect(await game.acceptOffer("s2", created.offerId)).toEqual({ ok: false, reason: "OFFER_CLOSED" });
  });

  test("an offer needs the offerer to hold what they give", async () => {
    const { game } = await tradingGame();
    expect(await game.createOffer("e1", { wool: 4 }, { ore: 1 })).toEqual({
      ok: false,
      reason: "INSUFFICIENT_RESOURCES",
    });
  });

  test("acceptance fails cleanly when the offerer no longer has the resources", async () => {
    const { game } = await tradingGame();
    const { offerId } = eventOf(await game.createOffer("e1", { wool: 2 }, { ore: 1 }), "OfferCreated")!;
    expectOk(await game.bankTrade("e1", "wool", "grain"));
    expect(await game.acceptOffer("s1", offerId)).toEqual({ ok: false, reason: "OFFERER_INSUFFICIENT_RESOURCES" });
    expect((await game.playerView("s1")).inventory).toEqual({ ore: 2 });
    expect((await game.playerView("e1")).inventory).toEqual({ grain: 1 });
  });

  test("acceptance fails cleanly when the acceptor lacks what's wanted", async () => {
    const { game } = await tradingGame();
    const { offerId } = eventOf(await game.createOffer("e1", { wool: 1 }, { ore: 3 }), "OfferCreated")!;
    expect(await game.acceptOffer("s1", offerId)).toEqual({ ok: false, reason: "INSUFFICIENT_RESOURCES" });
    expect((await game.playerView("e1")).inventory).toEqual({ wool: 3 });
  });

  test("a direct offer can only be accepted by its addressee", async () => {
    const { game } = await tradingGame();
    const { offerId, to } = eventOf(await game.createOffer("e1", { wool: 1 }, { ore: 1 }, "s1"), "OfferCreated")!;
    expect(to).toBe("s1");
    expect(await game.acceptOffer("s2", offerId)).toEqual({ ok: false, reason: "OFFER_NOT_FOR_YOU" });
    expectOk(await game.acceptOffer("s1", offerId));
  });

  test("you can't accept your own offer", async () => {
    const { game } = await tradingGame();
    const { offerId } = eventOf(await game.createOffer("e1", { wool: 1 }, { ore: 1 }), "OfferCreated")!;
    expect(await game.acceptOffer("e1", offerId)).toEqual({ ok: false, reason: "OWN_OFFER" });
  });

  test("only the offerer can cancel, and a cancelled offer can't be accepted", async () => {
    const { game } = await tradingGame();
    const { offerId } = eventOf(await game.createOffer("e1", { wool: 1 }, { ore: 1 }), "OfferCreated")!;
    expect(await game.cancelOffer("s1", offerId)).toEqual({ ok: false, reason: "NOT_YOUR_OFFER" });
    expectOk(await game.cancelOffer("e1", offerId));
    expect(await game.acceptOffer("s1", offerId)).toEqual({ ok: false, reason: "OFFER_CLOSED" });
    expect(await game.openOffers()).toEqual([]);
  });

  test("rejects malformed offers", async () => {
    const { game } = await tradingGame();
    expect((await game.createOffer("e1", {}, { ore: 1 })).ok).toBe(false);
    expect(await game.createOffer("e1", { wool: 1 }, { wool: 1 })).toEqual({ ok: false, reason: "INVALID_TRADE" });
    expect(await game.createOffer("e1", { wool: 0 }, { ore: 1 })).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(await game.acceptOffer("s1", 999)).toEqual({ ok: false, reason: "OFFER_NOT_FOUND" });
  });

  test("open offers expire when the week rolls over", async () => {
    const { game, clock } = await tradingGame();
    const { offerId } = eventOf(await game.createOffer("e1", { wool: 1 }, { ore: 1 }), "OfferCreated")!;
    clock.advanceDays(7);
    expect(eventOf(await game.rollWeek(), "OffersExpired")?.offerIds).toEqual([offerId]);
    expect(await game.acceptOffer("s1", offerId)).toEqual({ ok: false, reason: "OFFER_CLOSED" });
  });
});
