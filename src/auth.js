export class NotSignedInError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotSignedInError";
  }
}

const SCOPE = "https://www.googleapis.com/auth/youtube";
const CACHE_KEY = "authToken";
const CACHE_LEEWAY_MS = 60_000;

function getClientId() {
  const cid = chrome.runtime.getManifest().oauth2?.client_id;
  if (!cid || cid.startsWith("REPLACE_")) {
    throw new NotSignedInError("OAuth client_id is not set in manifest.json");
  }
  return cid;
}

function redirectUri() {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

async function getCachedToken() {
  const { [CACHE_KEY]: entry } = await chrome.storage.local.get(CACHE_KEY);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt - CACHE_LEEWAY_MS) return null;
  return entry.token;
}

async function cacheToken(token, expiresInSec) {
  await chrome.storage.local.set({
    [CACHE_KEY]: { token, expiresAt: Date.now() + expiresInSec * 1000 },
  });
}

function launchWebAuthFlow(url, interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        const msg = chrome.runtime.lastError?.message ?? "auth window closed";
        reject(new NotSignedInError(`Google sign-in failed: ${msg}`));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

function parseTokenFromRedirect(redirectUrl) {
  const url = new URL(redirectUrl);
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  const token = params.get("access_token");
  const expiresIn = parseInt(params.get("expires_in") ?? "3600", 10);
  if (!token) {
    const err = params.get("error") ?? url.searchParams.get("error");
    throw new NotSignedInError(err ? `Google returned: ${err}` : "no access_token in redirect");
  }
  return { token, expiresIn };
}

export async function getAuthToken({ interactive, switchAccount } = { interactive: true }) {
  if (!switchAccount) {
    const cached = await getCachedToken();
    if (cached) return cached;
  }

  const clientId = getClientId();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri());
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("scope", SCOPE);
  // switchAccount → force Google's account picker (shows all signed-in accounts on device).
  // Otherwise, force consent screen once so scope grants are explicit.
  authUrl.searchParams.set("prompt", switchAccount ? "select_account" : "consent");

  const redirectUrl = await launchWebAuthFlow(authUrl.toString(), interactive);
  const { token, expiresIn } = parseTokenFromRedirect(redirectUrl);
  await cacheToken(token, expiresIn);
  return token;
}

export function clearAuthToken() {
  return chrome.storage.local.remove(CACHE_KEY);
}
