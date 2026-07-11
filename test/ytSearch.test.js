import { test } from "node:test";
import { strict as assert } from "node:assert";
import { pickBest, extractResults } from "../src/ytSearch.js";

const R = (over = {}) => ({
  videoId: "abc123",
  title: "Iron Man",
  channelName: "Black Sabbath - Topic",
  durationSeconds: 360,
  ...over,
});

test("pickBest prefers channel matching artist", () => {
  const results = [
    R({ videoId: "wrong", channelName: "Random Cover Channel" }),
    R({ videoId: "right", channelName: "Black Sabbath - Topic" }),
  ];
  const pick = pickBest(results, {
    artist: "Black Sabbath",
    song: "Iron Man",
    query: "Black Sabbath - Iron Man",
  });
  assert.equal(pick.videoId, "right");
  assert.equal(pick.lowConfidence, false);
  assert.equal(pick.noMatch, false);
});

test("pickBest prefers VEVO channel", () => {
  const results = [
    R({ videoId: "cover", channelName: "SomeCoverBand" }),
    R({ videoId: "vevo", channelName: "MetallicaVEVO" }),
  ];
  const pick = pickBest(results, {
    artist: "Metallica",
    song: "One",
    query: "Metallica - One",
  });
  assert.equal(pick.videoId, "vevo");
});

test("pickBest rejects live/cover/reaction titles", () => {
  const results = [
    R({ videoId: "live", title: "Iron Man (Live at Ozzfest)" }),
    R({ videoId: "cover", title: "Iron Man COVER" }),
    R({ videoId: "reaction", title: "Iron Man REACTION" }),
    R({ videoId: "studio", title: "Iron Man" }),
  ];
  const pick = pickBest(results, {
    artist: "Black Sabbath",
    song: "Iron Man",
    query: "Black Sabbath - Iron Man",
  });
  assert.equal(pick.videoId, "studio");
});

test("pickBest keeps 'live' hits when query contains 'live'", () => {
  const results = [
    R({ videoId: "live1", title: "Live aus Berlin" }),
    R({ videoId: "studio", title: "Studio Version" }),
  ];
  const pick = pickBest(results, {
    artist: "Rammstein",
    song: "Live aus Berlin",
    query: "Rammstein - Live aus Berlin",
  });
  assert.equal(pick.videoId, "live1");
});

test("pickBest rejects Shorts (<60s) and long compilations (>900s)", () => {
  const results = [
    R({ videoId: "short", durationSeconds: 45 }),
    R({ videoId: "compilation", durationSeconds: 1200 }),
    R({ videoId: "song", durationSeconds: 360 }),
  ];
  const pick = pickBest(results, {
    artist: "Black Sabbath",
    song: "Iron Man",
    query: "Black Sabbath - Iron Man",
  });
  assert.equal(pick.videoId, "song");
});

test("pickBest returns first raw result with lowConfidence when all filtered out", () => {
  const results = [
    R({ videoId: "first", title: "Iron Man LIVE COVER" }),
    R({ videoId: "second", title: "Iron Man REACTION" }),
  ];
  const pick = pickBest(results, {
    artist: "Black Sabbath",
    song: "Iron Man",
    query: "Black Sabbath - Iron Man",
  });
  assert.equal(pick.videoId, "first");
  assert.equal(pick.lowConfidence, true);
});

test("pickBest returns noMatch when results is empty", () => {
  const pick = pickBest([], {
    artist: "Nobody",
    song: "Nothing",
    query: "Nobody - Nothing",
  });
  assert.equal(pick.noMatch, true);
});

test("pickBest falls back to first filtered result when no preferred channel", () => {
  const results = [
    R({ videoId: "generic1", channelName: "SomeRandomUploader" }),
    R({ videoId: "generic2", channelName: "AnotherRandomUploader" }),
  ];
  const pick = pickBest(results, {
    artist: "Nonexistent Artist",
    song: "Iron Man",
    query: "Nonexistent Artist - Iron Man",
  });
  assert.equal(pick.videoId, "generic1");
  assert.equal(pick.lowConfidence, false);
});

test("extractResults pulls videoId/title/channel/duration from ytInitialData JSON", () => {
  const yid = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: "vid001",
                        title: { runs: [{ text: "Iron Man" }] },
                        ownerText: { runs: [{ text: "Black Sabbath - Topic" }] },
                        lengthText: { simpleText: "6:00" },
                      },
                    },
                    { channelRenderer: { title: "not a video" } },
                    {
                      videoRenderer: {
                        videoId: "vid002",
                        title: { runs: [{ text: "Iron Man (Live)" }] },
                        ownerText: { runs: [{ text: "Someone Else" }] },
                        lengthText: { simpleText: "8:30" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  const html = `<html><body><script>var ytInitialData = ${JSON.stringify(yid)};</script></body></html>`;
  const results = extractResults(html);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    videoId: "vid001",
    title: "Iron Man",
    channelName: "Black Sabbath - Topic",
    durationSeconds: 360,
  });
  assert.equal(results[1].durationSeconds, 510);
});

test("extractResults returns [] when ytInitialData is missing", () => {
  assert.deepEqual(extractResults("<html>no data here</html>"), []);
});

test("pickBest does not reject word-boundary collisions like 'delivered' for 'live'", () => {
  const results = [
    R({ videoId: "collision", title: "Songs Delivered Right To You" }),
  ];
  const pick = pickBest(results, {
    artist: "Some Artist",
    song: "Something",
    query: "Some Artist - Something",
  });
  assert.equal(pick.videoId, "collision");
  assert.equal(pick.lowConfidence, false);
});
