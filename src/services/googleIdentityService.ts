const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptLoadingPromise: Promise<void> | null = null;
const SCRIPT_READY_TIMEOUT_MS = 10_000;

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  }) => void;
  error_callback?: (error: { type: string }) => void;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: "" | "none" | "consent" | "select_account" }) => void;
}

interface GoogleIdentityWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient;
        revoke: (token: string, done?: () => void) => void;
      };
    };
  };
}

function waitForGoogleOAuthReady(timeoutMs = SCRIPT_READY_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (getGoogleOAuth2FromWindow()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Timed out while waiting for Google OAuth2 client initialization."));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function getGoogleOAuth2FromWindow() {
  const typedWindow = window as GoogleIdentityWindow;
  return typedWindow.google?.accounts?.oauth2;
}

export async function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Google Identity Services can only be loaded in browser environments.");
  }

  if (getGoogleOAuth2FromWindow()) {
    return;
  }

  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_SRC}"]`,
    );

    if (existingScript) {
      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error("Timed out while waiting for Google Identity Services script."));
        }
      }, SCRIPT_READY_TIMEOUT_MS);

      const maybeResolve = () => {
        if (isSettled) {
          return;
        }
        if (getGoogleOAuth2FromWindow()) {
          isSettled = true;
          window.clearTimeout(timeoutId);
          resolve();
        }
      };

      const onError = () => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        window.clearTimeout(timeoutId);
        reject(new Error("Failed to load Google Identity Services script."));
      };

      existingScript.addEventListener("load", maybeResolve, { once: true });
      existingScript.addEventListener("error", onError, { once: true });
      maybeResolve();
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptLoadingPromise = null;
    throw error;
  });

  await scriptLoadingPromise;
  await waitForGoogleOAuthReady();
}

export async function requestGoogleAccessToken(params: {
  clientId: string;
  scope: string;
  prompt?: "" | "none" | "consent" | "select_account";
}): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}> {
  await loadGoogleIdentityScript();

  const oauth2 = getGoogleOAuth2FromWindow();
  if (!oauth2) {
    throw new Error("Google OAuth2 client is not available.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const tokenClient = oauth2.initTokenClient({
      client_id: params.clientId,
      scope: params.scope,
      callback: (response) => {
        if (settled) {
          return;
        }
        settled = true;
        if (
          !response.access_token ||
          !response.expires_in ||
          !response.scope ||
          !response.token_type
        ) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                "Google OAuth token response is missing required fields.",
            ),
          );
          return;
        }
        resolve({
          access_token: response.access_token,
          expires_in: response.expires_in,
          scope: response.scope,
          token_type: response.token_type,
        });
      },
      error_callback: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`Google OAuth request failed: ${error.type}`));
      },
    });

    tokenClient.requestAccessToken({ prompt: params.prompt ?? "consent" });
  });
}

export async function revokeGoogleAccessToken(accessToken: string): Promise<void> {
  await loadGoogleIdentityScript();
  const oauth2 = getGoogleOAuth2FromWindow();
  if (!oauth2) {
    throw new Error("Google OAuth2 client is not available.");
  }
  await new Promise<void>((resolve) => {
    oauth2.revoke(accessToken, resolve);
  });
}
