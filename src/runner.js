import { parseSongList } from "./parser.js";
import { searchYouTube } from "./ytSearch.js";

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
