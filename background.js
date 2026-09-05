import { runSearchPhase, runInsertPhase } from "./src/runner.js";
import { getAuthToken } from "./src/auth.js";

const KEY = "pendingRun";
const SCHEMA_VERSION = 2;

function migrateFromV1(old) {
  // v0.1.3 pendingRun only covered the insert phase. Fill in v0.2.0 fields.
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: "insert",
    textInput: "",
    entries: old.entries ?? [],
    searchIndex: (old.entries ?? []).length,
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
    processedIndex: -1,
    target: null,
    playlistId: null,
    report: null,
    lastStatus: { text: "Parsing...", isError: false },
    throttled: false,
    quotaExceeded: false,
  };
}

async function handleStartSearch(text) {
  await writeState(initialState(text));

  try {
    const results = await runSearchPhase(text, async (i, total, entry) => {
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
    await patchState({
      searchIndex: results.length,
      lastStatus: {
        text: `Search complete — ${results.length} entries.`,
        isError: false,
      },
    });
  } catch (e) {
    if (e.throttled) {
      await patchState({
        throttled: true,
        lastStatus: { text: e.message, isError: true },
      });
    } else {
      await patchState({
        lastStatus: { text: `Error: ${e.message}`, isError: true },
      });
    }
  }
}

async function handleStartInsert(target) {
  const state = await readState();
  if (!state || !state.entries?.length) return;
  const selectedEntries = state.entries.filter((e) => e.selected !== false);
  if (!selectedEntries.length) {
    await patchState({
      lastStatus: { text: "Nothing selected to add.", isError: true },
    });
    return;
  }

  // If we've already created a playlist earlier in this run, target the existing one.
  const effectiveTarget = state.playlistId
    ? { mode: "existing", playlistId: state.playlistId }
    : target;

  await patchState({
    phase: "insert",
    target: effectiveTarget,
    quotaExceeded: false,
    lastStatus: { text: "Signing in...", isError: false },
  });

  try {
    const token = await getAuthToken({ interactive: false });
    await patchState({
      lastStatus: { text: "Adding songs...", isError: false },
    });

    const startIndex =
      state.playlistId && state.processedIndex >= 0
        ? state.processedIndex + 1
        : 0;

    await runInsertPhase({
      token,
      target: effectiveTarget,
      entries: selectedEntries,
      startIndex,
      seedReport: state.report,
      onPlaylistCreated: async (playlistId) => {
        await patchState({
          playlistId,
          target: { mode: "existing", playlistId },
        });
      },
      onEntryProcessed: async (i, entry, meta, report) => {
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
        await patchState({
          phase: "done",
          playlistId,
          report,
          lastStatus: { text: "Done.", isError: false },
        });
      },
    });
  } catch (e) {
    if (e.quotaExceeded) {
      await patchState({
        quotaExceeded: true,
        lastStatus: {
          text: e.message + ". Retry tomorrow.",
          isError: true,
        },
      });
    } else {
      await patchState({
        lastStatus: { text: `Error: ${e.message}`, isError: true },
      });
    }
  }
}

async function handleReset() {
  await chrome.storage.local.remove(KEY);
}

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
