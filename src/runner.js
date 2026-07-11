import { parseSongList } from "./parser.js";
import { searchYouTube } from "./ytSearch.js";
import { createPlaylist, addVideoToPlaylist } from "./ytApi.js";

export async function runSearchPhase(text, onProgress) {
  const parsed = parseSongList(text);
  const results = [];
  for (let i = 0; i < parsed.length; i++) {
    const { artist, song } = parsed[i];
    const query = artist ? `${artist} - ${song}` : song;
    let match;
    try {
      match = await searchYouTube({ artist, song });
    } catch (e) {
      match = { videoId: null, matchedTitle: "", channelName: "", lowConfidence: false, noMatch: true };
    }
    const entry = { artist, song, query, ...match };
    results.push(entry);
    if (onProgress) onProgress(i + 1, parsed.length, entry);
  }
  return results;
}

export async function runInsertPhase({ token, target, entries, onProgress, startIndex = 0 }) {
  let playlistId;
  if (target.mode === "create") {
    if (startIndex === 0) {
      playlistId = await createPlaylist(token, {
        title: target.title,
        privacyStatus: target.privacyStatus,
      });
    } else {
      playlistId = target.existingPlaylistId; // resume path passes the existing id here
    }
  } else {
    playlistId = target.playlistId;
  }

  const report = { added: 0, alreadyInPlaylist: 0, noMatch: 0, failed: [], lastAddedIndex: startIndex - 1 };

  for (let i = startIndex; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.noMatch || !entry.videoId) {
      report.noMatch++;
      if (onProgress) onProgress(i + 1, entries.length, entry, { status: "no-match" });
      continue;
    }
    const res = await addVideoToPlaylist(token, playlistId, entry.videoId);
    if (res.ok) {
      report.added++;
      report.lastAddedIndex = i;
      if (onProgress) onProgress(i + 1, entries.length, entry, { status: "added" });
    } else if (res.alreadyInPlaylist) {
      report.alreadyInPlaylist++;
      report.lastAddedIndex = i;
      if (onProgress) onProgress(i + 1, entries.length, entry, { status: "already" });
    } else if (res.quotaExceeded) {
      if (onProgress) onProgress(i + 1, entries.length, entry, { status: "quota" });
      throw Object.assign(new Error(`Quota exceeded at song ${i + 1} of ${entries.length}`), {
        quotaExceeded: true,
        stoppedAtIndex: i,
        playlistId,
      });
    } else {
      report.failed.push({ query: entry.query, reason: res.reason });
      if (onProgress) onProgress(i + 1, entries.length, entry, { status: "failed", reason: res.reason });
    }
  }

  return { playlistId, report };
}

export function formatReport(report, entries) {
  const noMatchList = entries.filter((e) => e.noMatch).map((e) => `  - ${e.query}`);
  const failedList = report.failed.map((f) => `  - ${f.query} (${f.reason})`);
  const lines = [
    `Added: ${report.added} | Skipped (already in playlist): ${report.alreadyInPlaylist} | No match: ${report.noMatch} | Failed: ${report.failed.length}`,
  ];
  if (noMatchList.length) lines.push("", "No match:", ...noMatchList);
  if (failedList.length) lines.push("", "Failed:", ...failedList);
  return lines.join("\n");
}
