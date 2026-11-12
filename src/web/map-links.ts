/**
 * Unguessable map URLs: a token names the season and board version and carries an HMAC, so only links the app
 * handed out work, and a new build changes the URL (Slack caches images by URL).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface MapRef {
  seasonId: number;
  version: number;
}

export interface MapLinks {
  image: string;
  page: string;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 22);
}

export function mapToken(secret: string, ref: MapRef): string {
  const payload = `${ref.seasonId}-${ref.version}`;
  return `${payload}-${sign(secret, payload)}`;
}

export function readMapToken(secret: string, token: string): MapRef | null {
  const match = /^(\d+)-(\d+)-([\w-]{22})$/.exec(token);
  if (!match) return null;
  const expected = Buffer.from(sign(secret, `${match[1]}-${match[2]}`));
  const given = Buffer.from(match[3]!);
  if (!timingSafeEqual(expected, given)) return null;
  return { seasonId: Number(match[1]), version: Number(match[2]) };
}

/** Null without a public URL: Slack can't fetch images from localhost. */
export function mapLinks(publicUrl: string | undefined, secret: string, ref: MapRef): MapLinks | null {
  if (!publicUrl) return null;
  const base = `${publicUrl.replace(/\/$/, "")}/map/${mapToken(secret, ref)}`;
  return { image: `${base}/image.png`, page: base };
}
