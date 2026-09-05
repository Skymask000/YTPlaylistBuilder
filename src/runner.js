import { parseSongList } from "./parser.js";
import { searchYouTube } from "./ytSearch.js";
import { createPlaylist, addVideoToPlaylist } from "./ytApi.js";

const SEARCH_DELAY_MIN_MS = 1000;
const SEARCH_DELAY_MAX_MS = 1600;
const BLOCKED_RETRY_WAIT_MS = 5000;
const MAX_CONSECUTIVE_BLOCKED = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

async function searchOnce(artist, song) {
  try {
    return await searchYouTube({ artist, song });
  } catch {
    return { videoId: null, matchedTitle: "", channelName: "", lowConfidence: false, noMatch: true, blocked: true };
  }
}

export async function runSearchPhase(text, onProgress) {
  const parsed = parseSongList(text);
  const results = [];
  let consecutiveBlocked = 0;
  for (let i = 0; i < parsed.length; i++) {
    if (i > 0) await sleep(jitter(SEARCH_DELAY_MIN_MS, SEARCH_DELAY_MAX_MS));
    const { artist, song } = parsed[i];
    const query = artist ? `${artist} - ${song}` : song;
    let match = await searchOnce(artist, song);
    if (match.blocked) {
      await sleep(BLOCKED_RETRY_WAIT_MS);
      match = await searchOnce(artist, song);
    }
    if (match.blocked) {
      consecutiveBlocked++;
      if (consecutiveBlocked >= MAX_CONSECUTIVE_BLOCKED) {
        throw Object.assign(new Error(`YouTube blocked ${consecutiveBlocked} searches in a row. Stopped at song ${i + 1} of ${parsed.length}. Wait 5-10 minutes and re-run.`), {
          throttled: true,
          stoppedAtIndex: i,
          partialResults: results,
        });
      }
    } else {
      consecutiveBlocked = 0;
    }
    const entry = { artist, song, query, ...match, selected: true };
    results.push(entry);
    if (onProgress) onProgress(i + 1, parsed.length, entry);
  }
  return results;
}

export async function runInsertPhase({
  token,
  target,
  entries,
  onProgress,
  onPlaylistCreated,
  onEntryProcessed,
  onComplete,
  startIndex = 0,
  seedReport = null,
}) {
  let playlistId;
  if (target.mode === "create") {
    playlistId = await createPlaylist(token, {
      title: target.title,
      privacyStatus: target.privacyStatus,
    });
    if (onPlaylistCreated) await onPlaylistCreated(playlistId);
  } else {
    playlistId = target.playlistId;
  }

  const report = seedReport
    ? { ...seedReport, failed: [...seedReport.failed] }
    : { added: 0, alreadyInPlaylist: 0, noMatch: 0, failed: [] };

  let processedIndex = startIndex - 1;

  async function afterEntry(i, entry, meta) {
    processedIndex = i;
    if (onEntryProcessed) await onEntryProcessed(i, entry, meta, report);
    if (onProgress) onProgress(i + 1, entries.length, entry, meta);
  }

  for (let i = startIndex; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.noMatch || !entry.videoId) {
      report.noMatch++;
      await afterEntry(i, entry, { status: "no-match" });
      continue;
    }
    const res = await addVideoToPlaylist(token, playlistId, entry.videoId);
    if (res.ok) {
      report.added++;
      await afterEntry(i, entry, { status: "added" });
    } else if (res.alreadyInPlaylist) {
      report.alreadyInPlaylist++;
      await afterEntry(i, entry, { status: "already" });
    } else if (res.quotaExceeded) {
      if (onProgress) onProgress(i + 1, entries.length, entry, { status: "quota" });
      throw Object.assign(new Error(`Quota exceeded at song ${i + 1} of ${entries.length}`), {
        quotaExceeded: true,
        stoppedAtIndex: i,
        playlistId,
      });
    } else {
      report.failed.push({ query: entry.query, reason: res.reason });
      await afterEntry(i, entry, { status: "failed", reason: res.reason });
    }
  }

  if (onComplete) await onComplete(playlistId, report);
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
