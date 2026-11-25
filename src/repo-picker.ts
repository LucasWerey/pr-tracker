import {
  createDebouncedSearch,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_CHARS,
  searchRepos,
  type RepoHit,
} from "./repo-search";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function addRepo(list: string[], name: string): string[] {
  return list.some((r) => same(r, name)) ? list : [...list, name];
}

export function removeRepo(list: string[], name: string): string[] {
  return list.filter((r) => !same(r, name));
}

/** The typed text as an "Add owner/name" candidate when it is well formed and search did not return it. */
export function exactFallback(text: string, hits: RepoHit[]): string | null {
  const t = text.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(t)) return null;
  return hits.some((h) => same(h.nameWithOwner, t)) ? null : t;
}

const LOCK_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor"><path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7zm1.5 0h5V5a2.5 2.5 0 0 0-5 0z"/></svg>`;

export interface RepoPicker {
  getRepos(): string[];
  setRepos(repos: string[]): void;
  setToken(token: string): void;
}

export function createRepoPicker(
  els: { input: HTMLInputElement; results: HTMLElement; list: HTMLElement; hint: HTMLElement },
  onChange: () => void,
): RepoPicker {
  const { input, results, list, hint } = els;
  let repos: string[] = [];
  let token = "";
  let tokenKnown = false;
  let lastText = "";
  let hits: RepoHit[] = [];

  const search = createDebouncedSearch({
    delayMs: SEARCH_DEBOUNCE_MS,
    minChars: SEARCH_MIN_CHARS,
    run: (text, signal) => searchRepos(token, text, signal),
    onResults(text, found) {
      lastText = text;
      hits = found;
      hint.textContent = found.length || exactFallback(text, found) ? "" : "No matching repositories";
      renderResults();
    },
    onError(text, err) {
      lastText = text;
      hits = [];
      hint.textContent = err.message;
      renderResults();
    },
  });

  function add(name: string) {
    const next = addRepo(repos, name);
    if (next === repos) return;
    repos = next;
    renderList();
    renderResults();
    onChange();
  }

  function remove(name: string) {
    repos = removeRepo(repos, name);
    renderList();
    renderResults();
    onChange();
  }

  function renderList() {
    list.replaceChildren(
      ...repos.map((name) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = name;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "icon-btn";
        btn.textContent = "✕";
        btn.setAttribute("aria-label", `Remove ${name}`);
        btn.addEventListener("click", () => remove(name));
        li.append(label, btn);
        return li;
      }),
    );
  }

  function resultRow(name: string, isPrivate: boolean, fallback: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    const label = document.createElement("span");
    label.className = "result-name";
    label.textContent = fallback ? `Add ${name}` : name;
    li.append(label);
    if (isPrivate) {
      const lock = document.createElement("span");
      lock.className = "lock";
      lock.title = "Private";
      lock.setAttribute("aria-label", "Private");
      lock.innerHTML = LOCK_SVG;
      li.append(lock);
    }
    const following = repos.some((r) => same(r, name));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = following ? "Following" : "+ Add";
    btn.disabled = following;
    btn.setAttribute("aria-label", following ? `Following ${name}` : `Add ${name}`);
    btn.addEventListener("click", () => add(name));
    li.append(btn);
    return li;
  }

  function renderResults() {
    const rows = hits.map((h) => resultRow(h.nameWithOwner, h.isPrivate, false));
    const fallback = exactFallback(lastText, hits);
    if (fallback && input.value.trim() === lastText.trim()) rows.push(resultRow(fallback, false, true));
    results.replaceChildren(...rows);
    results.hidden = rows.length === 0;
    results.querySelector("li")?.classList.add("active");
  }

  function clearResults() {
    hits = [];
    lastText = "";
    hint.textContent = "";
    results.replaceChildren();
    results.hidden = true;
  }

  input.addEventListener("input", () => {
    const text = input.value;
    if (text.trim().length < SEARCH_MIN_CHARS) {
      search.cancel();
      clearResults();
      return;
    }
    // Typed text that already looks like owner/name can be added right away, before the search answers.
    lastText = text;
    hits = [];
    hint.textContent = "";
    renderResults();
    search.input(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const btn = results.querySelector<HTMLButtonElement>("li.active button:not(:disabled)");
    btn?.click();
  });

  return {
    getRepos: () => [...repos],
    setRepos(next) {
      repos = [...next];
      renderList();
      renderResults();
    },
    setToken(next) {
      if (tokenKnown && next === token) return;
      tokenKnown = true;
      token = next;
      search.cancel();
      input.disabled = !token;
      clearResults();
      if (!token) {
        input.value = "";
        hint.textContent = "Sign in first to search repositories";
      }
    },
  };
}
