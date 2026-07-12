import { runSearchPhase, runInsertPhase, formatReport } from "./src/runner.js";
import { getAuthToken, NotSignedInError } from "./src/auth.js";
import { listMyPlaylists } from "./src/ytApi.js";

const inputEl = document.getElementById("songs-input");
const goBtn = document.getElementById("go-btn");
const progressSection = document.getElementById("progress-section");
const progressLine = document.getElementById("progress-line");
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

const resumeSection = document.getElementById("resume-section");
const resumeMessage = document.getElementById("resume-message");
const resumeBtn = document.getElementById("resume-btn");
const discardBtn = document.getElementById("discard-btn");

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
    <td><input type="checkbox" class="row-checkbox" ${checked} aria-label="Include ${escapeHtml(entry.query)}"></td>
    <td>${i}</td>
    <td>${escapeHtml(entry.query)}</td>
    <td>${escapeHtml(entry.matchedTitle) || "—"}</td>
    <td>${escapeHtml(entry.channelName) || "—"}</td>
    <td>${status}</td>
  `;
  const cb = tr.querySelector(".row-checkbox");
  cb.addEventListener("change", () => {
    entry.selected = cb.checked;
    tr.classList.toggle("deselected", !cb.checked);
    updateSummary(window.__lastResults ?? []);
  });
  resultsBody.appendChild(tr);
}

function updateSummary(results) {
  const noMatch = results.filter((r) => r.noMatch).length;
  const lowConf = results.filter((r) => r.lowConfidence).length;
  const selected = results.filter((r) => r.selected !== false).length;
  statusEl.textContent = `${selected} of ${results.length} selected — ${lowConf} low-confidence, ${noMatch} no match.`;
  const selectAll = document.getElementById("select-all");
  if (selectAll) selectAll.checked = selected === results.length && results.length > 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Wire the "select all" master checkbox
document.getElementById("select-all").addEventListener("change", (e) => {
  const check = e.target.checked;
  for (const entry of window.__lastResults ?? []) entry.selected = check;
  for (const cb of resultsBody.querySelectorAll(".row-checkbox")) cb.checked = check;
  for (const tr of resultsBody.querySelectorAll("tr")) tr.classList.toggle("deselected", !check);
  updateSummary(window.__lastResults ?? []);
});

// Wire the radio-mode toggle
for (const radio of document.querySelectorAll('input[name="target"]')) {
  radio.addEventListener("change", (e) => {
    const mode = e.target.value;
    createFields.hidden = mode !== "create";
    existingFields.hidden = mode !== "existing";
  });
}
// Initial state — create mode is checked so hide existing block:
existingFields.hidden = true;

// Wire the "Load my playlists" button
loadPlaylistsBtn.addEventListener("click", async () => {
  loadPlaylistsBtn.disabled = true;
  loadPlaylistsBtn.textContent = "Loading...";
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
  } catch (e) {
    const prefix = e instanceof NotSignedInError ? "Sign-in error" : "API error";
    statusEl.textContent = `${prefix}: ${e.message}`;
    loadPlaylistsBtn.textContent = "Load my playlists";
  } finally {
    loadPlaylistsBtn.disabled = false;
  }
});

// Helper to get the target (create or existing playlist)
function getTarget() {
  const mode = document.querySelector('input[name="target"]:checked').value;
  if (mode === "create") {
    return {
      mode: "create",
      title: newTitleEl.value.trim(),
      privacyStatus: newPrivacyEl.value,
    };
  }
  return {
    mode: "existing",
    playlistId: existingPlaylistEl.value,
  };
}

async function checkPendingRun() {
  const { pendingRun } = await chrome.storage.local.get("pendingRun");
  if (!pendingRun) return;
  const remaining = pendingRun.entries.length - (pendingRun.processedIndex + 1);
  resumeMessage.textContent = `Previous run interrupted — ${remaining} of ${pendingRun.entries.length} remaining.`;
  resumeSection.hidden = false;

  resumeBtn.onclick = async () => {
    resumeBtn.disabled = true;
    discardBtn.disabled = true;
    statusEl.textContent = "Resuming — signing in...";
    try {
      const token = await getAuthToken({ interactive: true });
      const { report } = await runInsertPhase({
        token,
        target: pendingRun.target,
        entries: pendingRun.entries,
        startIndex: pendingRun.processedIndex + 1,
        seedReport: pendingRun.report ?? null,
        onProgress: (i, total, entry, meta) => {
          progressSection.hidden = false;
          progressLine.textContent = `Resuming ${i} / ${total} — ${entry.query} — ${meta.status}`;
        },
      });
      reportTextEl.textContent = formatReport(report, pendingRun.entries);
      reportSection.hidden = false;
      resumeSection.hidden = true;
      statusEl.textContent = "Resume complete.";
    } catch (e) {
      statusEl.textContent = e.quotaExceeded
        ? e.message + ". Retry tomorrow."
        : `Error: ${e.message}`;
    } finally {
      resumeBtn.disabled = false;
      discardBtn.disabled = false;
    }
  };

  discardBtn.onclick = async () => {
    await chrome.storage.local.remove("pendingRun");
    resumeSection.hidden = true;
    statusEl.textContent = "Discarded previous run.";
  };
}

goBtn.addEventListener("click", async () => {
  const text = inputEl.value;
  if (!text.trim()) {
    statusEl.textContent = "Paste at least one song.";
    return;
  }

  // Rough count for quota warning (before dedupe; conservative).
  const roughCount = text.split(/\r?\n/).filter((l) => l.trim() && !/^\d+\.\s/.test(l.trim())).length;
  if (roughCount > 100) {
    const proceed = confirm(
      `About ${roughCount} songs — insert cost is ~${roughCount * 50} quota units (daily limit is 10,000). Proceed?`
    );
    if (!proceed) return;
  }

  goBtn.disabled = true;
  resultsBody.innerHTML = "";
  progressSection.hidden = false;
  resultsSection.hidden = false;
  progressLine.textContent = "Parsing...";
  statusEl.textContent = "";

  try {
    const results = await runSearchPhase(text, (i, total, entry) => {
      const suffix = entry.blocked ? " (blocked)" : entry.noMatch ? " (no match)" : "";
      progressLine.textContent = `Searching ${i} / ${total} — ${entry.query}${suffix} — keep this popup open`;
      renderRow(i, entry);
    });
    progressLine.textContent = `Search complete — ${results.length} entries.`;
    window.__lastResults = results; // exposed for the next task's insert phase
    updateSummary(results);
    reportSection.hidden = true;
    commitSection.hidden = false;
  } catch (e) {
    if (e.throttled) {
      statusEl.textContent = e.message;
      progressLine.textContent = `Stopped after ${e.partialResults.length} songs. Wait a few minutes, then re-run remaining songs.`;
    } else {
      statusEl.textContent = `Error: ${e.message}`;
    }
  } finally {
    goBtn.disabled = false;
  }
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
  const allResults = window.__lastResults ?? [];
  const entries = allResults.filter((e) => e.selected !== false);
  if (!entries.length) {
    statusEl.textContent = allResults.length ? "Nothing selected to add." : "Search first.";
    return;
  }

  addAllBtn.disabled = true;
  statusEl.textContent = "Signing in...";

  try {
    const token = await getAuthToken({ interactive: true });
    statusEl.textContent = "Adding songs...";
    const { report } = await runInsertPhase({
      token,
      target,
      entries,
      onProgress: (i, total, entry, meta) => {
        const suffix =
          meta.status === "added" ? "✓"
          : meta.status === "already" ? "already in playlist"
          : meta.status === "no-match" ? "no match — skipping"
          : meta.status === "failed" ? `failed: ${meta.reason}`
          : meta.status;
        progressLine.textContent = `Adding ${i} / ${total} — ${entry.query} — ${suffix}`;
      },
    });
    reportTextEl.textContent = formatReport(report, entries);
    reportSection.hidden = false;
    statusEl.textContent = "Done.";
  } catch (e) {
    if (e.quotaExceeded) {
      statusEl.textContent = e.message + ". Retry tomorrow.";
    } else {
      statusEl.textContent = `Error: ${e.message}`;
    }
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

checkPendingRun().catch((e) => {
  statusEl.textContent = `Storage error: ${e.message}`;
});
