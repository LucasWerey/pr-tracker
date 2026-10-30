// GitHub OAuth device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// Needs no client secret, so it runs entirely inside the extension.

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

async function post(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.json();
}

export async function requestDeviceCode(clientId: string, scope = "repo"): Promise<DeviceCode> {
  const json = await post(DEVICE_CODE_URL, { client_id: clientId, scope });
  if (json.error) {
    throw new Error(
      json.error === "device_flow_disabled"
        ? "Device flow is disabled: tick “Enable Device Flow” in the OAuth App settings."
        : json.error_description ?? json.error,
    );
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresIn: json.expires_in,
    interval: json.interval,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Poll until the user approves on github.com; resolves with the access token. */
export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  signal: AbortSignal,
): Promise<string> {
  let interval = code.interval;
  const deadline = Date.now() + code.expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000, signal);
    const json = await post(TOKEN_URL, {
      client_id: clientId,
      device_code: code.deviceCode,
      grant_type: GRANT_TYPE,
    });
    if (json.access_token) return json.access_token;

    switch (json.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5;
        break;
      case "access_denied":
        throw new Error("Authorization was denied.");
      case "expired_token":
        throw new Error("The code expired. Try again.");
      default:
        throw new Error(json.error_description ?? json.error ?? "Sign-in failed");
    }
  }
  throw new Error("The code expired. Try again.");
}
