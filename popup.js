import { runSearchPhase } from "./src/runner.js";

const inputEl = document.getElementById("songs-input");
const goBtn = document.getElementById("go-btn");
const progressSection = document.getElementById("progress-section");
const progressLine = document.getElementById("progress-line");
const resultsSection = document.getElementById("results-section");
const resultsBody = document.querySelector("#results-table tbody");
const statusEl = document.getElementById("status");

function renderRow(i, entry) {
  const tr = document.createElement("tr");
  const status = entry.noMatch
    ? "NO MATCH"
    : entry.lowConfidence
      ? "low confidence"
      : "ok";
  if (entry.noMatch) tr.classList.add("no-match");
  if (entry.lowConfidence) tr.classList.add("low-confidence");
  tr.innerHTML = `
    <td>${i}</td>
    <td>${escapeHtml(entry.query)}</td>
    <td>${escapeHtml(entry.matchedTitle) || "—"}</td>
    <td>${escapeHtml(entry.channelName) || "—"}</td>
    <td>${status}</td>
  `;
  resultsBody.appendChild(tr);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
      progressLine.textContent = `Searching ${i} / ${total} — ${entry.query}`;
      renderRow(i, entry);
    });
    progressLine.textContent = `Search complete — ${results.length} entries.`;
    const noMatch = results.filter((r) => r.noMatch).length;
    const lowConf = results.filter((r) => r.lowConfidence).length;
    statusEl.textContent = `${results.length} songs matched (${lowConf} low-confidence, ${noMatch} no match).`;
    window.__lastResults = results; // exposed for the next task's insert phase
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  } finally {
    goBtn.disabled = false;
  }
});
