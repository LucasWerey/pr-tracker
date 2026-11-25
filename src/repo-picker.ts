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

export interface ResultRow {
  name: string;
  isPrivate: boolean;
  following: boolean;
  fallback: boolean;
}

/** Rows to show for the search box. The typed-text fallback only appears once the search for `text` has settled (results or error). */
export function resultRows(text: string, hits: RepoHit[], settled: boolean, following: string[]): ResultRow[] {
  const isFollowing = (name: string) => following.some((r) => same(r, name));
  const rows: ResultRow[] = hits.map((h) => ({
    name: h.nameWithOwner,
    isPrivate: h.isPrivate,
    following: isFollowing(h.nameWithOwner),
    fallback: false,
  }));
  const fallback = settled ? exactFallback(text, hits) : null;
  if (fallback) rows.push({ name: fallback, isPrivate: false, following: isFollowing(fallback), fallback: true });
  return rows;
}

/** The row Enter acts on: the first addable row, and nothing while the search is unsettled. */
export function enterTarget(rows: ResultRow[], settled: boolean): ResultRow | null {
  if (!settled) return null;
  return rows.find((r) => !r.following) ?? null;
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
  let settled = false;

  const search = createDebouncedSearch({
    delayMs: SEARCH_DEBOUNCE_MS,
    minChars: SEARCH_MIN_CHARS,
    run: (text, signal) => searchRepos(token, text, signal),
    onResults(text, found) {
      lastText = text;
      hits = found;
      settled = true;
      hint.textContent = found.length || exactFallback(text, found) ? "" : "No matching repositories";
      renderResults();
    },
    onError(text, err) {
      lastText = text;
      hits = [];
      settled = true;
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
        btn.className = "repo-remove";
        btn.textContent = "✕";
        btn.setAttribute("aria-label", `Remove ${name}`);
        btn.addEventListener("click", () => remove(name));
        li.append(label, btn);
        return li;
      }),
    );
  }

  function resultRow(row: ResultRow, active: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    if (active) li.classList.add("active");
    const label = document.createElement("span");
    label.className = "result-name";
    label.textContent = row.fallback ? `Add ${row.name}` : row.name;
    li.append(label);
    if (row.isPrivate) {
      const lock = document.createElement("span");
      lock.className = "lock";
      lock.title = "Private";
      lock.setAttribute("aria-label", "Private");
      lock.innerHTML = LOCK_SVG;
      li.append(lock);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = row.following ? "Following" : "+ Add";
    btn.disabled = row.following;
    btn.setAttribute("aria-label", row.following ? `Following ${row.name}` : `Add ${row.name}`);
    btn.addEventListener("click", () => add(row.name));
    li.append(btn);
    return li;
  }

  function currentRows(): ResultRow[] {
    return resultRows(lastText, hits, settled, repos);
  }

  function renderResults() {
    const rows = currentRows();
    const target = enterTarget(rows, settled);
    results.replaceChildren(...rows.map((r) => resultRow(r, r === target)));
    results.hidden = rows.length === 0;
  }

  function clearResults() {
    hits = [];
    lastText = "";
    settled = false;
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
    // Keep the previous hits on screen until the new answer arrives; no fallback until then.
    lastText = text;
    settled = false;
    hint.textContent = "";
    renderResults();
    search.input(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const target = enterTarget(currentRows(), settled);
    if (target) add(target.name);
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
