/** Wires the Slack handlers into a Bolt app. */
import type { App } from "@slack/bolt";
import { type ActionArgs, createHandlers } from "./handlers.ts";
import { Notifier, type SlackDeps } from "./notifier.ts";
import { IDS } from "./views.ts";

export function registerSlack(app: App, deps: SlackDeps): Notifier {
  const notifier = new Notifier(deps);
  const h = createHandlers(deps, notifier);
  // Bolt's argument types are wider unions than the handlers read; the handlers type only the fields they use.
  const as = <T>(handler: (args: T) => Promise<unknown>) => handler as (args: any) => Promise<void>;

  app.command("/thanks", as(h.thanksCommand));
  app.command("/build", as(h.buildCommand));
  app.command("/trade", as(h.tradeCommand));
  app.command("/osada", as(h.osadaCommand));
  app.command("/osada-admin", as(h.adminCommand));
  app.shortcut(IDS.thanksShortcut, as(h.thanksShortcut));
  app.view(IDS.thanksModal, as(h.thanksSubmit));
  app.view(IDS.buildModal, as(h.buildSubmit));
  app.view(IDS.offerModal, as(h.offerSubmit));
  app.view(IDS.bankModal, as(h.bankSubmit));
  app.action(IDS.openBuild, as(h.openBuildAction));
  app.action(
    IDS.openOffer,
    as((args: ActionArgs) => h.openTradeAction(false, args)),
  );
  app.action(
    IDS.openBank,
    as((args: ActionArgs) => h.openTradeAction(true, args)),
  );
  app.action(IDS.acceptOffer, as(h.acceptOfferAction));
  app.action(IDS.cancelOffer, as(h.cancelOfferAction));
  app.action(IDS.mapLink, async ({ ack }) => ack());
  app.event("app_home_opened", as(h.homeOpened));
  return notifier;
}
