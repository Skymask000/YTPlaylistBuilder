import { getAuthToken } from "./src/auth.js";
import { listMyPlaylists } from "./src/ytApi.js";

const statusEl = document.getElementById("status");

document.getElementById("debug-list").addEventListener("click", async () => {
  statusEl.textContent = "Signing in...";
  try {
    const token = await getAuthToken({ interactive: true });
    statusEl.textContent = "Signed in. Fetching playlists...";
    const playlists = await listMyPlaylists(token);
    statusEl.textContent =
      playlists.length === 0
        ? "Signed in, but you have no playlists."
        : "Playlists:\n" + playlists.map((p) => `  ${p.title} (${p.itemCount} items)`).join("\n");
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
});
