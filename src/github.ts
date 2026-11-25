import type { Author, CiState, Mergeable, PrScope, PullRequest, QueueEntry, ReviewDecision, Viewer } from "./types";

const PR_FIELDS = `number
        title
        url
        isDraft
        updatedAt
        mergeable
        reviewDecision
        author { login avatarUrl(size: 32) }
        repository { nameWithOwner }
        mergeQueueEntry { position state }
        reviewThreads(first: 100) { nodes { isResolved } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

/**
 * One aliased `repository` lookup per configured repo (null when the token can't see it).
 * "mine": the viewer's 100 latest open PRs carry the data. "all": each repo carries its own
 * 20 latest open PRs and the viewer block only lists repo names to count the viewer's PRs.
 */
export function buildPrQuery(repos: string[], scope: PrScope): string {
  const checks = repos
    .map((r, i) => {
      const [owner, name] = r.split("/");
      const head = `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)})`;
      return scope === "all"
        ? `${head} {
    nameWithOwner
    pullRequests(states: OPEN, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        ${PR_FIELDS}
      }
    }
  }`
        : `${head} { nameWithOwner }`;
    })
    .join("\n  ");
  const body = scope === "all" ? "repository { nameWithOwner }" : PR_FIELDS;
  return `query {
  ${checks}
  viewer {
    login
    avatarUrl
    url
    pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        ${body}
      }
    }
  }
}`;
}

interface Node {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  mergeable: Mergeable;
  reviewDecision: Exclude<ReviewDecision, "NONE"> | null;
  author: Author | null;
  repository: { nameWithOwner: string };
  mergeQueueEntry: QueueEntry | null;
  reviewThreads: { nodes: { isResolved: boolean }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: CiState } | null } }[] };
}

export interface FetchResult {
  viewer: Viewer;
  prs: PullRequest[];
  /** Configured repos the token cannot see (wrong name, repo not granted, or org hasn't approved the app). */
  inaccessible: string[];
  /** Viewer's open PRs in followed repos. */
  myCount: number;
  /** Open PR count per followed repo, keyed by the configured string ("all" scope only). */
  totals?: Record<string, number>;
}

function toPullRequest(n: Node): PullRequest {
  return {
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    isDraft: n.isDraft,
    updatedAt: n.updatedAt,
    mergeable: n.mergeable,
    review: n.reviewDecision ?? "NONE",
    ci: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "NONE",
    unresolvedThreads: n.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    author: n.author ?? { login: "ghost", avatarUrl: "" },
    queue: n.mergeQueueEntry ?? undefined,
  };
}

interface RepoAlias {
  pullRequests: { totalCount: number; nodes: Node[] };
}

/** Turn the GraphQL `data` payload into PRs, counts and inaccessible repos. */
export function parsePrData(data: unknown, repos: string[], scope: PrScope): FetchResult {
  const d = data as Record<string, unknown> & {
    viewer: { login: string; avatarUrl: string; url: string; pullRequests: { nodes: Node[] } };
  };
  const inaccessible = repos.filter((_, i) => !d[`r${i}`]);
  const wanted = new Set(repos.map((r) => r.toLowerCase()));
  const mine = d.viewer.pullRequests.nodes.filter((n) => wanted.has(n.repository.nameWithOwner.toLowerCase()));
  const { login, avatarUrl, url } = d.viewer;
  const viewer = { login, avatarUrl, url };

  if (scope === "mine") {
    return { viewer, prs: mine.map(toPullRequest), inaccessible, myCount: mine.length };
  }

  const prs: PullRequest[] = [];
  const totals: Record<string, number> = {};
  repos.forEach((repo, i) => {
    const alias = d[`r${i}`] as RepoAlias | null;
    if (!alias) return;
    totals[repo] = alias.pullRequests.totalCount;
    prs.push(...alias.pullRequests.nodes.map(toPullRequest));
  });
  return { viewer, prs, inaccessible, myCount: mine.length, totals };
}

/** Fetch open PRs for the given repos: the viewer's own ("mine") or the latest of everyone ("all"). */
export async function fetchPrs(token: string, repos: string[], scope: PrScope): Promise<FetchResult> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildPrQuery(repos, scope) }),
  });
  if (res.status === 401) throw new Error("Invalid GitHub token");
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);

  const json = await res.json();
  // A repo the token can't see comes back as NOT_FOUND with a null alias: reported, not fatal.
  const fatal = (json.errors ?? []).filter((e: { type?: string }) => e.type !== "NOT_FOUND");
  if (fatal.length) throw new Error(fatal[0].message);

  return parsePrData(json.data, repos, scope);
}

/** Login of the account the token belongs to, or null if the token is rejected. */
export async function fetchViewerLogin(token: string): Promise<string | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  return (await res.json()).login;
}
