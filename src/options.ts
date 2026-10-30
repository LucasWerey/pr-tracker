import { pollForToken, requestDeviceCode } from "./auth";
import { fetchViewerLogin } from "./github";
import { getClientId, getSettings, saveClientId, saveSettings } from "./storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const clientId = $<HTMLInputElement>("client-id");
const repos = $<HTMLTextAreaElement>("repos");
const status = $("status");
const connText = $("conn-text");
const signin = $<HTMLButtonElement>("signin");
const signout = $<HTMLButtonElement>("signout");
const device = $("device");
const codeBox = $("code");
const deviceStatus = $("device-status");

let flow: AbortController | undefined;

function setStatus(text: string, kind: "ok" | "error") {
  status.textContent = text;
  status.className = kind;
}

async function showConnection() {
  const { token: current } = await getSettings();
  const id = await getClientId();
  signin.hidden = true;
  signout.hidden = true;

  if (current) {
    const login = await fetchViewerLogin(current);
    connText.textContent = login ? `Connected as @${login}` : "Saved token is invalid or expired";
    connText.className = login ? "ok" : "error";
    signout.hidden = false;
    if (!login) signin.hidden = false;
  } else {
    connText.textContent = "Not connected";
    connText.className = "muted";
    signin.hidden = false;
  }
  signin.title = id ? "" : "Add an OAuth App Client ID under Advanced first";
}

async function startSignIn() {
  const id = clientId.value.trim();
  if (!id) {
    document.querySelector<HTMLDetailsElement>("details.advanced")!.open = true;
    clientId.focus();
    setStatus("Paste your OAuth App Client ID first.", "error");
    return;
  }
  await saveClientId(id);
  setStatus("", "ok");
  signin.disabled = true;
  flow = new AbortController();

  try {
    const code = await requestDeviceCode(id);
    codeBox.textContent = code.userCode;
    device.hidden = false;
    deviceStatus.textContent = "Waiting for approval…";
    void navigator.clipboard.writeText(code.userCode).catch(() => {});
    window.open(code.verificationUri, "_blank");

    const accessToken = await pollForToken(id, code, flow.signal);
    const { repos: current } = await getSettings();
    await saveSettings({ token: accessToken, repos: current });
    setStatus("Signed in ✓", "ok");
  } catch (e) {
    if ((e as Error).name !== "AbortError") setStatus((e as Error).message, "error");
  } finally {
    device.hidden = true;
    signin.disabled = false;
    flow = undefined;
    await showConnection();
  }
}

signin.addEventListener("click", () => void startSignIn());
$("cancel").addEventListener("click", () => flow?.abort());
signout.addEventListener("click", async () => {
  const { repos: current } = await getSettings();
  await saveSettings({ token: "", repos: current });
  setStatus("Signed out", "ok");
  await showConnection();
});

$("save").addEventListener("click", async () => {
  const list = repos.value
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const invalid = list.find((r) => !/^[\w.-]+\/[\w.-]+$/.test(r));
  if (invalid) {
    setStatus(`Invalid repo: ${invalid}`, "error");
    return;
  }
  await saveClientId(clientId.value.trim());
  const { token } = await getSettings();
  await saveSettings({ token, repos: list });
  setStatus("Saved ✓", "ok");
  await showConnection();
});

void (async () => {
  const s = await getSettings();
  repos.value = s.repos.join("\n");
  clientId.value = await getClientId();
  await showConnection();
})();
