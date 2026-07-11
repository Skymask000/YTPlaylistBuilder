import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseSongList } from "../src/parser.js";

test("parses block form with numbered artist headers", () => {
  const input = [
    "1. Black Sabbath",
    "",
    "Paranoid",
    "Iron Man",
    "War Pigs",
    "",
    "2. Metallica",
    "",
    "Master of Puppets",
    "One",
  ].join("\n");
  const out = parseSongList(input);
  assert.deepEqual(out, [
    { artist: "Black Sabbath", song: "Paranoid" },
    { artist: "Black Sabbath", song: "Iron Man" },
    { artist: "Black Sabbath", song: "War Pigs" },
    { artist: "Metallica", song: "Master of Puppets" },
    { artist: "Metallica", song: "One" },
  ]);
});

test("parses flat 'Artist - Song' lines", () => {
  const input = "Black Sabbath - Iron Man\nMetallica - One";
  assert.deepEqual(parseSongList(input), [
    { artist: "Black Sabbath", song: "Iron Man" },
    { artist: "Metallica", song: "One" },
  ]);
});

test("dedupes repeated entries", () => {
  const input = "1. Metallica\n\nOne\nOne\nMetallica - One";
  assert.deepEqual(parseSongList(input), [
    { artist: "Metallica", song: "One" },
  ]);
});

test("song with no artist header and no dash keeps empty artist", () => {
  const input = "Mystery Song\nAnother Mystery";
  assert.deepEqual(parseSongList(input), [
    { artist: "", song: "Mystery Song" },
    { artist: "", song: "Another Mystery" },
  ]);
});

test("empty and whitespace-only input returns empty list", () => {
  assert.deepEqual(parseSongList(""), []);
  assert.deepEqual(parseSongList("   \n\n\n   "), []);
});

test("mixed block + flat in same input", () => {
  const input = "1. Black Sabbath\n\nIron Man\n\nMetallica - One";
  assert.deepEqual(parseSongList(input), [
    { artist: "Black Sabbath", song: "Iron Man" },
    { artist: "Metallica", song: "One" },
  ]);
});

test("trims stray whitespace from lines", () => {
  const input = "1. Metallica   \n\n   One\n  Two  ";
  assert.deepEqual(parseSongList(input), [
    { artist: "Metallica", song: "One" },
    { artist: "Metallica", song: "Two" },
  ]);
});
