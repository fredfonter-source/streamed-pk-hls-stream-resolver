import { handleMatches, handleSports, handleStreams } from "../handlers/catalog.js";
import { resolveStream, type ResolveInput } from "../handlers/resolve.js";
import { proxyHls } from "../proxy/hls.js";
import { serveClient } from "./static.js";

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Render (and most reverse proxies) terminate TLS at the edge and forward
  // requests as HTTP.  The X-Forwarded-Proto header carries the real protocol.
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const origin = `${proto}://${url.host}`;

  try {
    if (url.pathname === "/api/hls") return proxyHls(request);
    if (url.pathname === "/api/sports") return handleSports();
    if (url.pathname === "/api/matches") {
      return handleMatches(url.searchParams.get("sport"), url.searchParams.get("scope"));
    }
    if (url.pathname === "/api/streams") {
      return handleStreams(
        url.searchParams.get("matchId"),
        url.searchParams.get("source"),
        url.searchParams.get("id"),
      );
    }
    if (url.pathname === "/api/resolve") {
      if (request.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
      let input: ResolveInput;
      try {
        input = ((await request.json()) ?? {}) as ResolveInput;
      } catch {
        return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
      }
      return Response.json(await resolveStream(input, origin));
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return serveClient(url.pathname);
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
