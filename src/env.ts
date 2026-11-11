/** Reads the app's settings from the environment. */
export interface Env {
  botToken: string;
  signingSecret: string | undefined;
  /** Set: Socket Mode (local dev). Unset: HTTP mode (production). */
  appToken: string | undefined;
  databaseUrl: string | undefined;
  pgliteDir: string;
  publicUrl: string | undefined;
  mapSecret: string;
  cronSecret: string | undefined;
  admins: string[];
  port: number;
  internalScheduler: boolean;
}

export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const botToken = required(env, "SLACK_BOT_TOKEN");
  const appToken = env.SLACK_APP_TOKEN || undefined;
  const signingSecret = env.SLACK_SIGNING_SECRET || undefined;
  if (!appToken && !signingSecret)
    throw new Error("Set SLACK_SIGNING_SECRET (HTTP mode) or SLACK_APP_TOKEN (Socket Mode)");
  return {
    botToken,
    signingSecret,
    appToken,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || ".pglite",
    publicUrl: env.PUBLIC_URL || undefined,
    mapSecret: env.MAP_SECRET || signingSecret || botToken,
    cronSecret: env.CRON_SECRET || undefined,
    admins: (env.OSADA_ADMINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    port: Number(env.PORT || 3000),
    internalScheduler: env.INTERNAL_SCHEDULER ? env.INTERNAL_SCHEDULER === "true" : Boolean(appToken),
  };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
