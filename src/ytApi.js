const API_BASE = "https://www.googleapis.com/youtube/v3";

async function apiCall(token, method, path, { query = null, body = null } = {}) {
  const url = new URL(API_BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function listMyPlaylists(token) {
  const { ok, json } = await apiCall(token, "GET", "/playlists", {
    query: { part: "snippet,contentDetails", mine: "true", maxResults: "50" },
  });
  if (!ok) throw new Error(`playlists.list failed: ${JSON.stringify(json)}`);
  return (json.items ?? []).map((it) => ({
    id: it.id,
    title: it.snippet.title,
    itemCount: it.contentDetails.itemCount,
  }));
}

export async function createPlaylist(token, { title, privacyStatus }) {
  const { ok, json } = await apiCall(token, "POST", "/playlists", {
    query: { part: "snippet,status" },
    body: {
      snippet: { title },
      status: { privacyStatus },
    },
  });
  if (!ok) throw new Error(`playlists.insert failed: ${JSON.stringify(json)}`);
  return json.id;
}

export async function addVideoToPlaylist(token, playlistId, videoId) {
  const { ok, status, json } = await apiCall(token, "POST", "/playlistItems", {
    query: { part: "snippet" },
    body: {
      snippet: {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      },
    },
  });
  if (ok) return { ok: true };
  const reason = json?.error?.errors?.[0]?.reason ?? `status_${status}`;
  const message = json?.error?.message ?? "";
  if (reason === "videoAlreadyInPlaylist") {
    return { ok: false, reason, alreadyInPlaylist: true };
  }
  if (reason === "quotaExceeded" || status === 403) {
    return { ok: false, reason, quotaExceeded: reason === "quotaExceeded", message };
  }
  return { ok: false, reason, message };
}
