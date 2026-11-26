export interface RepoHit {
  nameWithOwner: string;
  isPrivate: boolean;
}

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_CHARS = 2;

const SEARCH_QUERY = `query($q: String!) { search(type: REPOSITORY, query: $q, first: 10) { nodes { ... on Repository { nameWithOwner isPrivate } } } }`;

/** Turn what the user typed into a GitHub search query; null when it is too short to search. */
export function buildRepoSearchQuery(text: string): string | null {
  const t = text.trim();
  if (t.length < SEARCH_MIN_CHARS) return null;
  const slash = t.indexOf("/");
  const owner = slash === -1 ? "" : t.slice(0, slash).trim();
  const name = (slash === -1 ? t : t.slice(slash + 1)).trim();
  const parts: string[] = [];
  if (owner) parts.push(`user:${owner}`);
  if (name) parts.push(`${name} in:name`);
  parts.push("fork:true");
  return parts.join(" ");
}

export async function searchRepos(token: string, text: string, signal: AbortSignal): Promise<RepoHit[]> {
  const q = buildRepoSearchQuery(text);
  if (q === null) return [];
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: SEARCH_QUERY, variables: { q } }),
    signal,
  });
  if (res.status === 401) throw new Error("Invalid GitHub token");
  if (res.status === 403) throw new Error("GitHub search is busy, try again in a moment");
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);

  const json = await res.json();
  const nodes: unknown[] = Array.isArray(json.data?.search?.nodes) ? json.data.search.nodes : [];
  const hits = nodes
    .filter((n): n is RepoHit => typeof (n as Partial<RepoHit> | null)?.nameWithOwner === "string")
    .map((n) => ({ nameWithOwner: n.nameWithOwner, isPrivate: Boolean(n.isPrivate) }));
  // Errors can be per node (e.g. a null node for an org behind SAML): keep the repos that came
  // back, and only report the error when nothing usable did.
  if (hits.length === 0 && json.errors?.length) throw new Error(json.errors[0].message);
  return hits;
}

export interface DebouncedSearchOptions {
  delayMs: number;
  minChars: number;
  run: (text: string, signal: AbortSignal) => Promise<RepoHit[]>;
  onResults: (text: string, hits: RepoHit[]) => void;
  onError: (text: string, err: Error) => void;
}

/** Debounces input, aborts the in-flight search when a newer one starts, and drops stale results. */
export function createDebouncedSearch(opts: DebouncedSearchOptions): { input(text: string): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function cancel(): void {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  return {
    input(text) {
      cancel();
      if (text.trim().length < opts.minChars) {
        opts.onResults(text, []);
        return;
      }
      timer = setTimeout(() => {
        const ctl = new AbortController();
        controller = ctl;
        opts.run(text, ctl.signal).then(
          (hits) => {
            if (!ctl.signal.aborted) opts.onResults(text, hits);
          },
          (err) => {
            if (!ctl.signal.aborted) opts.onError(text, err instanceof Error ? err : new Error(String(err)));
          },
        );
      }, opts.delayMs);
    },
    cancel,
  };
}
