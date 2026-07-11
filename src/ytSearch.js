const REJECT_WORDS = ["live", "cover", "reaction", "karaoke", "remix", "lyrics only"];
const MIN_DURATION = 60;
const MAX_DURATION = 900;
const YT_INITIAL_DATA_RE = /var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s;

function parseDurationText(text) {
  if (!text) return 0;
  const parts = text.split(":").map((n) => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function walkVideoRenderers(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkVideoRenderers(item, out);
    return;
  }
  if (node.videoRenderer && node.videoRenderer.videoId) {
    const v = node.videoRenderer;
    const title = v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? "";
    const channelName = v.ownerText?.runs?.[0]?.text ?? "";
    const durationText = v.lengthText?.simpleText ?? "";
    out.push({
      videoId: v.videoId,
      title,
      channelName,
      durationSeconds: parseDurationText(durationText),
    });
    return;
  }
  for (const key of Object.keys(node)) walkVideoRenderers(node[key], out);
}

export function extractResults(html) {
  const m = html.match(YT_INITIAL_DATA_RE);
  if (!m) return [];
  let json;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const out = [];
  walkVideoRenderers(json, out);
  return out;
}

function isPreferredChannel(channelName, artist) {
  const c = channelName.toLowerCase();
  if (artist && c.includes(artist.toLowerCase())) return true;
  if (c.endsWith("- topic")) return true;
  if (c.includes("vevo")) return true;
  return false;
}

function passesRejectFilter(result, query) {
  const title = result.title.toLowerCase();
  const q = query.toLowerCase();
  for (const word of REJECT_WORDS) {
    const wordRe = new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`);
    if (wordRe.test(title) && !wordRe.test(q)) return false;
  }
  if (result.durationSeconds > 0) {
    if (result.durationSeconds < MIN_DURATION) return false;
    if (result.durationSeconds > MAX_DURATION) return false;
  }
  return true;
}

export function pickBest(results, { artist, song, query }) {
  if (!results.length) {
    return { videoId: null, matchedTitle: "", channelName: "", lowConfidence: false, noMatch: true };
  }
  const filtered = results.filter((r) => passesRejectFilter(r, query));
  if (!filtered.length) {
    const first = results[0];
    return {
      videoId: first.videoId,
      matchedTitle: first.title,
      channelName: first.channelName,
      lowConfidence: true,
      noMatch: false,
    };
  }
  const preferred = filtered.find((r) => isPreferredChannel(r.channelName, artist));
  const pick = preferred ?? filtered[0];
  return {
    videoId: pick.videoId,
    matchedTitle: pick.title,
    channelName: pick.channelName,
    lowConfidence: false,
    noMatch: false,
  };
}

export async function searchYouTube({ artist, song }) {
  const query = artist ? `${artist} - ${song}` : song;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    return { videoId: null, matchedTitle: "", channelName: "", lowConfidence: false, noMatch: true };
  }
  const html = await res.text();
  const results = extractResults(html);
  return pickBest(results, { artist, song, query });
}
