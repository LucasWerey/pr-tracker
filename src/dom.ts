// Generic DOM helpers shared by the side-panel views. No module-level DOM access.

// Static, trusted markup only (no user data is ever interpolated into these).
export const svg = (inner: string, size = 16, extra = "") =>
  `<svg ${extra} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function ago(ts: string | number): string {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * Wraps "load, then paint" so overlapping calls can't interleave: all awaiting happens in `load`,
 * `paint` is synchronous, and a call whose load finishes after a newer call started never paints.
 */
export function latestOnly<T>(load: () => Promise<T>, paint: (value: T) => void): () => Promise<void> {
  let seq = 0;
  return async () => {
    const mine = ++seq;
    const value = await load();
    if (mine === seq) paint(value);
  };
}

export function placeholder(title: string, text: string, withSettings = false): HTMLElement {
  const box = el("div", "placeholder");
  const logo = el("img");
  logo.src = "icons/icon-128.png";
  logo.width = 56;
  logo.height = 56;
  box.append(logo, el("h2", undefined, title), el("p", undefined, text));
  if (withSettings) {
    const btn = el("button", "primary", "Open settings");
    btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
    box.append(btn);
  }
  return box;
}
