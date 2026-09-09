import { runSearchPhase, runInsertPhase } from "./src/runner.js";
import { parseSongList } from "./src/parser.js";
import { getAuthToken } from "./src/auth.js";

const KEY = "pendingRun";
const SCHEMA_VERSION = 2;

// Incremented whenever a phase starts or the run is reset. A phase runner captures the
// value at start; once it no longer matches, that runner belongs to a discarded run and
// MUST unwind without writing — its progress callbacks would otherwise keep clobbering
// the run that replaced it with rows from the dead one.
let currentRunId = 0;

function staleRun() {
  return Object.assign(new Error("run discarded"), { stale: true });
}

function migrateFromV1(old) {
  // v0.1.3 pendingRun only covered the insert phase. Fill in v0.2.0 fields.
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: "insert",
    textInput: "",
    entries: old.entries ?? [],
    searchIndex: (old.entries ?? []).length,
    searchTotal: (old.entries ?? []).length,
    insertTotal: (old.entries ?? []).length,
    processedIndex: old.processedIndex ?? -1,
    target: old.target ?? null,
    playlistId: old.playlistId ?? null,
    report: old.report ?? null,
    lastStatus: {
      text: "Interrupted run recovered — click Add all to continue.",
      isError: false,
    },
    throttled: false,
    quotaExceeded: false,
    running: false,
  };
}

async function readState() {
  const { [KEY]: state } = await chrome.storage.local.get(KEY);
  if (!state) return null;
  if (state.schemaVersion !== SCHEMA_VERSION) {
    const migrated = migrateFromV1(state);
    await chrome.storage.local.set({ [KEY]: migrated });
    return migrated;
  }
  return state;
}

async function writeState(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

async function patchState(patch) {
  const current = (await readState()) || {};
  await writeState({ ...current, ...patch });
}

function initialState(text) {
  return {
    schemaVersion: 2,
    phase: "search",
    textInput: text,
    entries: [],
    searchIndex: 0,
    // Denominators for the progress bar. searchTotal is known before the first
    // search returns; insertTotal is only fixed once the user commits a selection.
    searchTotal: 0,
    insertTotal: 0,
    // When the current phase started, for the "~Xs remaining" estimate. Measured
    // rather than derived from the delay constants: a blocked search costs an extra
    // 5s retry, so a constant-based estimate would mislead exactly when a run stalls.
    phaseStartedAt: 0,
    // How many were already done when the phase started — 0 for a search, but a
    // resumed insert picks up mid-list.
    phaseStartDone: 0,
    processedIndex: -1,
    target: null,
    playlistId: null,
    report: null,
    lastStatus: { text: "Parsing...", isError: false },
    throttled: false,
    quotaExceeded: false,
    running: false,
  };
}

async function handleStartSearch(text) {
  const runId = ++currentRunId;
  // Parsed here as well as inside runSearchPhase so the bar has a denominator from
  // the first frame instead of staying blank until the first result lands. Same pure
  // function, same input — and it dedupes, so this matches what actually gets searched.
  await writeState({
    ...initialState(text),
    running: true,
    searchTotal: parseSongList(text).length,
    phaseStartedAt: Date.now(),
  });

  try {
    const results = await runSearchPhase(text, async (i, total, entry) => {
      if (runId !== currentRunId) throw staleRun();
      const state = (await readState()) || {};
      const entries = [...(state.entries || []), entry];
      const suffix = entry.blocked
        ? " (blocked)"
        : entry.noMatch
          ? " (no match)"
          : "";
      await writeState({
        ...state,
        entries,
        searchIndex: i,
        lastStatus: {
          text: `Searching ${i} / ${total} — ${entry.query}${suffix}`,
          isError: false,
        },
      });
    });
    if (runId !== currentRunId) return;
    await patchState({
      entries: results,
      searchIndex: results.length,
      running: false,
      lastStatus: {
        text: `Search complete — ${results.length} entries.`,
        isError: false,
      },
    });
  } catch (e) {
    // A discarded run must not write: `pendingRun` now belongs to whoever replaced it.
    if (e.stale || runId !== currentRunId) return;
    if (e.throttled) {
      await patchState({
        throttled: true,
        running: false,
        lastStatus: { text: e.message, isError: true },
      });
    } else {
      await patchState({
        running: false,
        lastStatus: { text: `Error: ${e.message}`, isError: true },
      });
    }
  }
}

// The line the user is left with. Only non-zero outcomes are mentioned — a clean run
// is the common case, and trailing zeroes bury the number that matters.
function completionText(report, playlistTitle) {
  const n = report.added;
  const where = playlistTitle ? ` to "${playlistTitle}"` : " to the playlist";
  const extras = [];
  if (report.alreadyInPlaylist) extras.push(`${report.alreadyInPlaylist} already there`);
  if (report.noMatch) extras.push(`${report.noMatch} no match`);
  if (report.failed.length) extras.push(`${report.failed.length} failed`);
  const tail = extras.length ? ` (${extras.join(", ")})` : "";
  return `${n} song${n === 1 ? "" : "s"} added${where}.${tail}`;
}

async function handleStartInsert(target) {
  const runId = ++currentRunId;
  const state = await readState();
  if (!state || !state.entries?.length) return;
  const selectedEntries = state.entries.filter((e) => e.selected !== false);
  if (!selectedEntries.length) {
    await patchState({
      lastStatus: { text: "Nothing selected to add.", isError: true },
    });
    return;
  }

  // Reusing the stored playlistId is what stops a RESUMED run from creating a second
  // playlist. But once a run is finished, clicking Add-all again means the user picked
  // a new destination — honouring the old id would silently re-add to the first
  // playlist and ignore their choice. So a committed run starts over against `target`.
  // Captured before the state write because `target` gets overwritten with
  // {mode:"existing", playlistId} once the playlist exists, which throws the name away
  // before the final "N songs added to X" line needs it.
  const playlistTitle = target?.title || state.playlistTitle || "";

  const isRerun = state.phase === "done";
  const effectiveTarget =
    state.playlistId && !isRerun
      ? { mode: "existing", playlistId: state.playlistId }
      : target;

  // Computed before the state write so the progress estimate knows where this phase
  // picked up: a resumed insert starts with songs already done, and dividing elapsed
  // time by the total done (rather than done-this-phase) would badly under-estimate.
  const startIndex =
    !isRerun && state.playlistId && state.processedIndex >= 0
      ? state.processedIndex + 1
      : 0;

  await patchState({
    phase: "insert",
    target: effectiveTarget,
    quotaExceeded: false,
    running: true,
    // A re-run must not inherit the finished run's playlist, cursor or tallies.
    ...(isRerun ? { playlistId: null, processedIndex: -1, report: null } : {}),
    // Fixed at commit time: processedIndex is an index into this same selected list,
    // so deriving the total later from a live checkbox count could disagree with it.
    insertTotal: selectedEntries.length,
    playlistTitle,
    phaseStartedAt: Date.now(),
    phaseStartDone: startIndex,
    lastStatus: { text: "Signing in...", isError: false },
  });

  try {
    const token = await getAuthToken({ interactive: false });
    await patchState({
      lastStatus: { text: "Adding songs...", isError: false },
    });

    await runInsertPhase({
      token,
      target: effectiveTarget,
      entries: selectedEntries,
      startIndex,
      // `state` is the pre-write snapshot, so a re-run would otherwise seed the new
      // tallies with the finished run's counts and report 16 added instead of 8.
      seedReport: isRerun ? null : state.report,
      onPlaylistCreated: async (playlistId) => {
        if (runId !== currentRunId) throw staleRun();
        await patchState({
          playlistId,
          target: { mode: "existing", playlistId },
        });
      },
      onEntryProcessed: async (i, entry, meta, report) => {
        if (runId !== currentRunId) throw staleRun();
        const suffix =
          meta.status === "added"
            ? "✓"
            : meta.status === "already"
              ? "already in playlist"
              : meta.status === "no-match"
                ? "no match — skipping"
                : meta.status === "failed"
                  ? `failed: ${meta.reason}`
                  : meta.status;
        await patchState({
          processedIndex: i,
          report: {
            added: report.added,
            alreadyInPlaylist: report.alreadyInPlaylist,
            noMatch: report.noMatch,
            failed: report.failed,
          },
          lastStatus: {
            text: `Adding ${i + 1} / ${selectedEntries.length} — ${entry.query} — ${suffix}`,
            isError: false,
          },
        });
      },
      onComplete: async (playlistId, report) => {
        if (runId !== currentRunId) throw staleRun();
        await patchState({
          phase: "done",
          playlistId,
          report,
          running: false,
          lastStatus: { text: completionText(report, playlistTitle), isError: false },
        });
      },
    });
  } catch (e) {
    // A discarded run must not write: `pendingRun` now belongs to whoever replaced it.
    if (e.stale || runId !== currentRunId) return;
    if (e.quotaExceeded) {
      await patchState({
        quotaExceeded: true,
        running: false,
        lastStatus: {
          text: e.message + ". Retry tomorrow.",
          isError: true,
        },
      });
    } else {
      await patchState({
        running: false,
        lastStatus: { text: `Error: ${e.message}`, isError: true },
      });
    }
  }
}

async function handleReset() {
  currentRunId++;
  await chrome.storage.local.remove(KEY);
}

// A cold module evaluation means any phase that was mid-run died with its previous
// execution context, so a persisted running:true is a lie. Reconcile it once, before
// serving any message — the listener awaits this so it cannot race a fresh startSearch.
const reconcileReady = (async () => {
  try {
    const state = await readState();
    if (state?.running) {
      await writeState({
        ...state,
        running: false,
        lastStatus: {
          text:
            state.phase === "insert"
              ? "Run interrupted — click Add all to continue."
              : "Search interrupted — click Search YouTube to run it again.",
          isError: true,
        },
      });
    }
  } catch {
    // Storage unavailable at wake time; the flag reconciles on the next wake.
  }
})();

async function handleSetSelected(index, selected) {
  const state = await readState();
  if (!state?.entries?.[index]) return;
  state.entries[index].selected = selected;
  await writeState(state);
}

async function handleSetSelectedAll(selected) {
  const state = await readState();
  if (!state?.entries) return;
  for (const entry of state.entries) entry.selected = selected;
  await writeState(state);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      await reconcileReady;
      switch (msg.type) {
        case "startSearch":
          handleStartSearch(msg.text);
          sendResponse({ ok: true });
          break;
        case "startInsert":
          handleStartInsert(msg.target);
          sendResponse({ ok: true });
          break;
        case "reset":
          await handleReset();
          sendResponse({ ok: true });
          break;
        case "setSelected":
          await handleSetSelected(msg.index, msg.selected);
          sendResponse({ ok: true });
          break;
        case "setSelectedAll":
          await handleSetSelectedAll(msg.selected);
          sendResponse({ ok: true });
          break;
        case "getState": {
          const state = await readState();
          sendResponse({ state });
          break;
        }
        default:
          sendResponse({ ok: false, error: `unknown message type: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});
