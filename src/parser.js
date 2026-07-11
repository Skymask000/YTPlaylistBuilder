const ARTIST_HEADER = /^\d+\.\s+(.+)$/;

export function parseSongList(text) {
  const out = [];
  const seen = new Set();
  let currentArtist = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(ARTIST_HEADER);
    if (header) {
      currentArtist = header[1].trim();
      continue;
    }

    let entry;
    if (line.includes(" - ")) {
      const idx = line.indexOf(" - ");
      entry = {
        artist: line.slice(0, idx).trim(),
        song: line.slice(idx + 3).trim(),
      };
    } else {
      entry = { artist: currentArtist, song: line };
    }

    const key = `${entry.artist.toLowerCase()}||${entry.song.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }

  return out;
}
