import { formatReport } from "./src/runner.js";
import { getAuthToken, clearAuthToken, NotSignedInError } from "./src/auth.js";
import { listMyPlaylists, getMyChannel } from "./src/ytApi.js";

const inputEl = document.getElementById("songs-input");
const goBtn = document.getElementById("go-btn");
const progressSection = document.getElementById("progress-section");
const progressLine = document.getElementById("progress-line");
const progressBar = document.getElementById("progress-bar");
const progressFill = document.getElementById("progress-fill");
const progressEta = document.getElementById("progress-eta");
const resultsSection = document.getElementById("results-section");
const resultsBody = document.querySelector("#results-table tbody");
const statusEl = document.getElementById("status");
const createFields = document.getElementById("create-fields");
const existingFields = document.getElementById("existing-fields");
const newTitleEl = document.getElementById("new-title");
const newPrivacyEl = document.getElementById("new-privacy");
const existingPlaylistEl = document.getElementById("existing-playlist");
const loadPlaylistsBtn = document.getElementById("load-playlists-btn");
const commitSection = document.getElementById("commit-section");
const addAllBtn = document.getElementById("add-all-btn");
const reportSection = document.getElementById("report-section");
const reportTextEl = document.getElementById("report-text");
const copyReportBtn = document.getElementById("copy-report-btn");
const resetSection = document.getElementById("reset-section");
const resetBtn = document.getElementById("reset-btn");
const signoutBtn = document.getElementById("signout-btn");
const addAccountBtn = document.getElementById("addaccount-btn");
const accountStatusEl = document.getElementById("account-status");
const accountAvatarEl = document.getElementById("account-avatar");
const confirmDialog = document.getElementById("confirm-dialog");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmWarningEl = document.getElementById("confirm-warning");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmProceedBtn = document.getElementById("confirm-proceed-btn");

const IDENTITY_KEY = "authIdentity";

function renderIdentity(identity) {
  const signedIn = !!(identity && identity.title);
  signoutBtn.hidden = !signedIn;
  if (signedIn) {
    accountStatusEl.textContent = identity.title;
    if (identity.thumbnailUrl) {
      accountAvatarEl.src = identity.thumbnailUrl;
      accountAvatarEl.hidden = false;
    } else {
      accountAvatarEl.hidden = true;
    }
  } else {
    accountStatusEl.textContent = "Not signed in";
    accountAvatarEl.hidden = true;
    accountAvatarEl.removeAttribute("src");
  }
}

async function refreshIdentity() {
  try {
    const token = await getAuthToken({ interactive: false });
    const channel = await getMyChannel(token);
    if (channel) {
      await chrome.storage.local.set({ [IDENTITY_KEY]: channel });
      renderIdentity(channel);
    } else {
      // Google account with no YouTube channel.
      const fallback = { title: "Signed in (no YouTube channel)", thumbnailUrl: null };
      await chrome.storage.local.set({ [IDENTITY_KEY]: fallback });
      renderIdentity(fallback);
    }
  } catch (e) {
    // Silent: not signed in, or transient network/API error. Leave last cached identity if any.
  }
}

async function clearIdentity() {
  await chrome.storage.local.remove(IDENTITY_KEY);
  renderIdentity(null);
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderRow(i, entry) {
  const tr = document.createElement("tr");
  const status = entry.noMatch
    ? "NO MATCH"
    : entry.lowConfidence
      ? "low confidence"
      : "ok";
  if (entry.noMatch) tr.classList.add("no-match");
  if (entry.lowConfidence) tr.classList.add("low-confidence");
  if (entry.selected === false) tr.classList.add("deselected");
  const checked = entry.selected !== false ? "checked" : "";
  tr.innerHTML = `
    <td><input type="checkbox" class="row-checkbox" data-index="${i - 1}" ${checked} aria-label="Include ${escapeHtml(entry.query)}"></td>
    <td>${i}</td>
    <td>${escapeHtml(entry.query)}</td>
    <td>${escapeHtml(entry.matchedTitle) || "—"}</td>
    <td>${escapeHtml(entry.channelName) || "—"}</td>
    <td>${status}</td>
  `;
  const cb = tr.querySelector(".row-checkbox");
  cb.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "setSelected",
      index: i - 1,
      selected: cb.checked,
    });
  });
  resultsBody.appendChild(tr);
}

function updateSummary(entries) {
  const noMatch = entries.filter((r) => r.noMatch).length;
  const lowConf = entries.filter((r) => r.lowConfidence).length;
  const selected = entries.filter((r) => r.selected !== false).length;
  statusEl.textContent = `${selected} of ${entries.length} selected — ${lowConf} low-confidence, ${noMatch} no match.`;
  const selectAll = document.getElementById("select-all");
  if (selectAll) selectAll.checked = selected === entries.length && entries.length > 0;
}

function setTargetSelection(target) {
  if (!target) return;
  const mode = target.mode || "create";
  const radio = document.querySelector(`input[name="target"][value="${mode}"]`);
  if (!radio) return;
  radio.checked = true;
  createFields.hidden = mode !== "create";
  existingFields.hidden = mode !== "existing";
  if (mode === "create") {
    if (target.title !== undefined) newTitleEl.value = target.title;
    if (target.privacyStatus) newPrivacyEl.value = target.privacyStatus;
  } else if (mode === "existing" && target.playlistId) {
    // Only set if the option is already loaded in the dropdown; otherwise it silently
    // becomes an empty selection. The user can click Load to see the playlist's name.
    const optionExists = Array.from(existingPlaylistEl.options).some(
      (o) => o.value === target.playlistId,
    );
    if (optionExists) existingPlaylistEl.value = target.playlistId;
  }
}

// How far through the current phase we are, or null when there's nothing to show.
// Search counts songs scraped; insert counts songs written to the playlist.
function phaseProgress(state) {
  if (!state) return null;
  if (state.phase === "search") {
    return { done: state.searchIndex || 0, total: state.searchTotal || 0 };
  }
  if (state.phase === "insert" || state.phase === "done") {
    const total = state.insertTotal || 0;
    // "done" is terminal, so the bar reads full regardless of where the last
    // processedIndex landed (skipped and failed songs still count as processed).
    const done =
      state.phase === "done" ? total : Math.max(0, (state.processedIndex ?? -1) + 1);
    return { done, total };
  }
  return null;
}

// Rough time-to-finish from the rate this phase has actually achieved, rather than
// from the delay constants — a blocked search costs an extra 5s retry, so a constant
// would read as confidently wrong precisely when a run is struggling.
function etaText(state, done, total) {
  if (!state.running || !state.phaseStartedAt) return "";
  const doneThisPhase = done - (state.phaseStartDone || 0);
  // One sample is enough. Requiring two meant a 2-song run finished before the
  // estimate ever qualified, so short lists never saw it at all.
  if (doneThisPhase < 1 || done >= total) return "";
  const msPer = (Date.now() - state.phaseStartedAt) / doneThisPhase;
  const secs = Math.round((msPer * (total - done)) / 1000);
  if (secs < 60) return `~${Math.max(5, Math.round(secs / 5) * 5)}s remaining`;
  const mins = Math.round(secs / 60);
  return `~${mins} min remaining`;
}

function renderProgressBar(state) {
  const p = phaseProgress(state);
  if (!p || !p.total) {
    progressBar.hidden = true;
    progressEta.hidden = true;
    return;
  }
  progressBar.hidden = false;
  progressFill.style.width = `${Math.round((p.done / p.total) * 100)}%`;

  // Colour is meaningful: blue while working, green once finished, red only when the
  // phase actually stopped short. A run that ends part-way keeps the bar on screen —
  // hiding it would drop the one piece of evidence showing how far it got.
  const failed = Boolean(state.lastStatus?.isError) && !state.running;
  progressFill.classList.toggle("failed", failed);
  progressFill.classList.toggle("complete", !failed && p.done >= p.total);

  const eta = etaText(state, p.done, p.total);
  progressEta.textContent = eta;
  progressEta.hidden = !eta;
}

// Single render entry point. Called on load and on every pendingRun change.
function renderFromState(state) {
  if (!state) {
    // Idle — hide run-state UI, but preserve textarea and target selection so
    // the user can retype/re-run without losing their in-progress work.
    resultsSection.hidden = true;
    resultsBody.innerHTML = "";
    progressSection.hidden = true;
    reportSection.hidden = true;
    commitSection.hidden = true;
    resetSection.hidden = true;
    return;
  }

  resetSection.hidden = false;

  // Restore textarea and target selection so the popup looks IDENTICAL to what
  // the user saw before closing it.
  if (state.textInput !== undefined) inputEl.value = state.textInput;
  setTargetSelection(state.target);

  const entries = state.entries || [];
  if (entries.length) {
    resultsSection.hidden = false;
    resultsBody.innerHTML = "";
    for (let i = 0; i < entries.length; i++) renderRow(i + 1, entries[i]);
    updateSummary(entries);
  } else {
    resultsSection.hidden = true;
    resultsBody.innerHTML = "";
  }

  if (state.lastStatus) {
    progressSection.hidden = false;
    progressLine.textContent = state.lastStatus.text;
  }
  renderProgressBar(state);

  if (state.phase === "search" && entries.length && state.searchIndex >= entries.length) {
    // Search finished but user hasn't started insert yet — expose Add-all.
    commitSection.hidden = false;
  } else if (state.phase === "insert" || state.phase === "done") {
    commitSection.hidden = false;
  } else {
    commitSection.hidden = true;
  }

  if (state.phase === "done" && state.report) {
    reportSection.hidden = false;
    reportTextEl.textContent = formatReport(state.report, entries);
  } else {
    reportSection.hidden = true;
  }
}

// Wire the "select all" master checkbox
document.getElementById("select-all").addEventListener("change", async (e) => {
  await chrome.runtime.sendMessage({
    type: "setSelectedAll",
    selected: e.target.checked,
  });
});

// Wire the radio-mode toggle
for (const radio of document.querySelectorAll('input[name="target"]')) {
  radio.addEventListener("change", (e) => {
    const mode = e.target.value;
    createFields.hidden = mode !== "create";
    existingFields.hidden = mode !== "existing";
  });
}
existingFields.hidden = true;

loadPlaylistsBtn.addEventListener("click", async () => {
  loadPlaylistsBtn.disabled = true;
  loadPlaylistsBtn.textContent = "Loading...";
  statusEl.textContent = "Loading your playlists...";
  try {
    const token = await getAuthToken({ interactive: true });
    const playlists = await listMyPlaylists(token);
    existingPlaylistEl.innerHTML = "";
    if (!playlists.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— you have no playlists —";
      existingPlaylistEl.appendChild(opt);
    } else {
      for (const p of playlists) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.title} (${p.itemCount} items)`;
        existingPlaylistEl.appendChild(opt);
      }
    }
    loadPlaylistsBtn.textContent = "Reload";
    statusEl.textContent = `Loaded ${playlists.length} playlist${playlists.length === 1 ? "" : "s"}.`;
    // Refresh the visible identity in case this was the first sign-in for this account.
    refreshIdentity();
  } catch (e) {
    const prefix = e instanceof NotSignedInError ? "Sign-in error" : "API error";
    statusEl.textContent = `${prefix}: ${e.message}`;
    loadPlaylistsBtn.textContent = "Load my playlists";
  } finally {
    loadPlaylistsBtn.disabled = false;
  }
});

function getTarget() {
  const mode = document.querySelector('input[name="target"]:checked').value;
  if (mode === "create") {
    return {
      mode: "create",
      title: newTitleEl.value.trim(),
      privacyStatus: newPrivacyEl.value,
    };
  }
  return { mode: "existing", playlistId: existingPlaylistEl.value };
}

// What a new search would cost the user, given the run currently on screen.
// null = nothing worth protecting, so Search just proceeds and replaces the state.
function describeCostOfNewSearch(state) {
  if (!state) return null;

  if (state.running) {
    return {
      message:
        state.phase === "insert"
          ? "A run is still adding songs to your playlist."
          : "A search is still running.",
      warning: "Starting a new search will stop the run in progress.",
      proceedLabel: "Stop and search",
    };
  }

  // Committed: the songs are already in a playlist on YouTube, so there is nothing
  // left on screen that a new search could destroy. Replace it silently.
  if (state.phase === "done") return null;

  const n = (state.entries || []).length;
  if (!n) return null;

  // An insert that stopped part-way — some songs made it to YouTube, the rest didn't.
  if (state.playlistId) {
    return {
      message: "A part-finished run is on screen — some songs were added to a playlist, the rest weren't.",
      warning: "Starting a new search will discard what's left of it.",
      proceedLabel: "Discard and search",
    };
  }

  // Search finished, nothing written to YouTube. Worth protecting: those rows cost
  // minutes of deliberately-throttled scraping to produce.
  return {
    message: `${n} search result${n === 1 ? "" : "s"} on screen haven't been added to a playlist yet.`,
    warning: "Starting a new search will discard them.",
    proceedLabel: "Discard and search",
  };
}

// In-popup confirm. A native confirm() can't render the warning in red, and the popup
// is short enough that an overlay would be overkill — this is just a section that
// sits directly above the Search button, so the answer appears where the user clicked.
let confirmResolve = null;

function askConfirm({ message, warning, proceedLabel }) {
  confirmMessageEl.textContent = message;
  confirmWarningEl.textContent = warning;
  confirmProceedBtn.textContent = proceedLabel;
  confirmDialog.hidden = false;
  confirmDialog.scrollIntoView({ block: "nearest" });
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function closeConfirm(answer) {
  confirmDialog.hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(answer);
}

confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
confirmProceedBtn.addEventListener("click", () => closeConfirm(true));

goBtn.addEventListener("click", async () => {
  const text = inputEl.value;
  if (!text.trim()) {
    statusEl.textContent = "Paste at least one song.";
    return;
  }

  // Asked before the quota prompt: no point warning about cost for a search the
  // user may be about to cancel.
  const cost = describeCostOfNewSearch(
    (await chrome.runtime.sendMessage({ type: "getState" })).state,
  );
  if (cost && !(await askConfirm(cost))) return;

  const roughCount = text.split(/\r?\n/).filter((l) => l.trim() && !/^\d+\.\s/.test(l.trim())).length;
  if (roughCount > 100) {
    const proceed = confirm(
      `About ${roughCount} songs — insert cost is ~${roughCount * 50} quota units (daily limit is 10,000). Proceed?`
    );
    if (!proceed) return;
  }

  statusEl.textContent = "";
  // startSearch writes a fresh initialState and bumps the SW's run id, which both
  // clears the old rows and unwinds any loop still running — no reset call needed.
  await chrome.runtime.sendMessage({ type: "startSearch", text });
});

addAllBtn.addEventListener("click", async () => {
  const target = getTarget();
  if (target.mode === "create" && !target.title) {
    statusEl.textContent = "Enter a playlist name.";
    return;
  }
  if (target.mode === "existing" && !target.playlistId) {
    statusEl.textContent = "Pick an existing playlist (or click Load my playlists).";
    return;
  }
  const { state } = await chrome.runtime.sendMessage({ type: "getState" });
  const entries = (state?.entries || []).filter((e) => e.selected !== false);
  if (!entries.length) {
    statusEl.textContent = state?.entries?.length ? "Nothing selected to add." : "Search first.";
    return;
  }

  addAllBtn.disabled = true;
  statusEl.textContent = "Signing in...";
  try {
    // Seed the token cache with a user-gesture-triggered interactive flow;
    // the SW then reads it non-interactively during the run.
    await getAuthToken({ interactive: true });
    await chrome.runtime.sendMessage({ type: "startInsert", target });
  } catch (e) {
    const prefix = e instanceof NotSignedInError ? "Sign-in error" : "Error";
    statusEl.textContent = `${prefix}: ${e.message}`;
  } finally {
    addAllBtn.disabled = false;
  }
});

copyReportBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(reportTextEl.textContent);
    copyReportBtn.textContent = "Copied!";
  } catch (e) {
    copyReportBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyReportBtn.textContent = "Copy report"), 1500);
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("Clear the current run and start over?")) return;
  // A confirm asking about a run that no longer exists would be nonsense.
  closeConfirm(false);
  await chrome.runtime.sendMessage({ type: "reset" });
  statusEl.textContent = "Reset.";
});

signoutBtn.addEventListener("click", async () => {
  await clearAuthToken();
  await clearIdentity();
  // Clear the loaded-playlists dropdown too — it belongs to the signed-out account.
  existingPlaylistEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = "— sign in to load your playlists —";
  existingPlaylistEl.appendChild(opt);
  loadPlaylistsBtn.textContent = "Load my playlists";
  statusEl.textContent = "Signed out.";
});

addAccountBtn.addEventListener("click", async () => {
  addAccountBtn.disabled = true;
  const prevLabel = addAccountBtn.textContent;
  addAccountBtn.textContent = "Signing in...";
  statusEl.textContent = "Signing in...";
  try {
    await clearAuthToken();
    await clearIdentity();
    const token = await getAuthToken({ interactive: true, switchAccount: true });
    // Fetch and cache identity for the newly signed-in account.
    const channel = await getMyChannel(token);
    if (channel) {
      await chrome.storage.local.set({ [IDENTITY_KEY]: channel });
      renderIdentity(channel);
    }
    // Reset the playlists dropdown; user will Load to see this account's playlists.
    existingPlaylistEl.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— click 'Load my playlists' —";
    existingPlaylistEl.appendChild(opt);
    loadPlaylistsBtn.textContent = "Load my playlists";
    statusEl.textContent = channel
      ? `Signed in as ${channel.title}.`
      : "Signed in (no YouTube channel on this account).";
  } catch (e) {
    const prefix = e instanceof NotSignedInError ? "Sign-in error" : "Error";
    statusEl.textContent = `${prefix}: ${e.message}`;
  } finally {
    addAccountBtn.disabled = false;
    addAccountBtn.textContent = prevLabel;
  }
});

// Live-update: re-render whenever the SW writes new state.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("pendingRun" in changes)) return;
  renderFromState(changes.pendingRun.newValue ?? null);
});

// Initial render on popup open.
(async () => {
  try {
    // Fast path: paint cached identity immediately for a responsive open.
    // Always call renderIdentity so signed-out branch also runs (hides Sign out button).
    const { [IDENTITY_KEY]: cachedIdentity } = await chrome.storage.local.get(IDENTITY_KEY);
    renderIdentity(cachedIdentity ?? null);

    const { state } = await chrome.runtime.sendMessage({ type: "getState" });
    renderFromState(state ?? null);

    // Background refresh so the display corrects itself if a different account
    // was signed into (or out of) since last popup close.
    refreshIdentity();
  } catch (e) {
    statusEl.textContent = `State error: ${e.message}`;
  }
})();
