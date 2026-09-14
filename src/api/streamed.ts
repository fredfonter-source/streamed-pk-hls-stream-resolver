import { streamedOrigin } from "../config/site.js";
import { sourceRank } from "../config/sources.js";
import type { Match, Sport, StreamLink } from "../types/models.js";
import { httpHeaders } from "./headers.js";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${streamedOrigin}${path}`, {
    headers: httpHeaders(undefined, { Accept: "application/json" }),
  });
  if (!res.ok) throw new Error(`streamed.pk ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export function listSports(): Promise<Sport[]> {
  return getJson("/api/sports");
}

export function listStreams(source: string, id: string): Promise<StreamLink[]> {
  return getJson(`/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
}

async function matchHasStreams(match: Match): Promise<boolean> {
  const groups = await Promise.all(match.sources.map((src) => listStreams(src.source, src.id)));
  return groups.some((links) => links.length > 0);
}

async function listLive(sport?: string | null): Promise<Match[]> {
  const live = await getJson<Match[]>("/api/matches/live");
  const scoped = !sport || sport === "all" ? live : live.filter((match) => match.category === sport);
  const flags = await Promise.all(scoped.map(matchHasStreams));
  return scoped.filter((_, index) => flags[index]);
}

export async function listMatches(sport: string, scope: "live" | "popular" | "all" = "live"): Promise<Match[]> {
  if (scope === "popular") return getJson(`/api/matches/${encodeURIComponent(sport)}/popular`);
  if (scope === "all") return getJson(`/api/matches/${encodeURIComponent(sport)}`);
  return listLive(sport);
}

export function listLivePopular(): Promise<Match[]> {
  return getJson("/api/matches/live/popular");
}

export async function findMatch(matchId: string): Promise<Match> {
  const live = await getJson<Match[]>("/api/matches/live");
  const fromLive = live.find((item) => item.id === matchId);
  if (fromLive) return fromLive;
  const all = await getJson<Match[]>("/api/matches/all");
  const match = all.find((item) => item.id === matchId);
  if (!match) throw new Error(`match not found: ${matchId}`);
  return match;
}

export async function listMatchStreams(match: Match): Promise<StreamLink[]> {
  const groups = await Promise.all(match.sources.map((src) => listStreams(src.source, src.id)));
  return groups
    .flat()
    .filter((link) => link.source && link.id)
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || Number(b.hd) - Number(a.hd) || a.streamNo - b.streamNo);
}
