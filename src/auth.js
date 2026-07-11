export class NotSignedInError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotSignedInError";
  }
}

export function getAuthToken({ interactive } = { interactive: true }) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const msg = chrome.runtime.lastError?.message ?? "no token returned";
        reject(new NotSignedInError(`Google sign-in failed: ${msg}`));
        return;
      }
      resolve(token);
    });
  });
}

export function clearAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}
