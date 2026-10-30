import type { CiState, Mergeable, PullRequest, QueueEntry, ReviewDecision } from "./types";

/** One aliased `repository` lookup per configured repo: null when the token can't see it. */
function buildQuery(repos: string[]): string {
  const checks = repos
    .map((r, i) => {
      const [owner, name] = r.split("/");
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner }`;
    })
    .join("\n  ");
  return `query {\n  ${checks}\n${VIEWER_QUERY}`;
}

const VIEWER_QUERY = `  viewer {
    pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        updatedAt
        mergeable
        reviewDecision
        repository { nameWithOwner }
        mergeQueueEntry { position state }
        reviewThreads(first: 100) { nodes { isResolved } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

interface Node {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  mergeable: Mergeable;
  reviewDecision: Exclude<ReviewDecision, "NONE"> | null;
  repository: { nameWithOwner: string };
  mergeQueueEntry: QueueEntry | null;
  reviewThreads: { nodes: { isResolved: boolean }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: CiState } | null } }[] };
}

export interface FetchResult {
  prs: PullRequest[];
  /** Configured repos the token cannot see (wrong name, repo not granted, or org hasn't approved the app). */
  inaccessible: string[];
}

/** Fetch the viewer's open PRs, keeping only those in the given repos (case-insensitive). */
export async function fetchMyPrs(token: string, repos: string[]): Promise<FetchResult> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildQuery(repos) }),
  });
  if (res.status === 401) throw new Error("Invalid GitHub token");
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);

  const json = await res.json();
  // A repo the token can't see comes back as NOT_FOUND with a null alias: reported, not fatal.
  const fatal = (json.errors ?? []).filter((e: { type?: string }) => e.type !== "NOT_FOUND");
  if (fatal.length) throw new Error(fatal[0].message);

  const inaccessible = repos.filter((_, i) => !json.data[`r${i}`]);

  const wanted = new Set(repos.map((r) => r.toLowerCase()));
  const nodes: Node[] = json.data.viewer.pullRequests.nodes;

  const prs: PullRequest[] = nodes
    .filter((n) => wanted.has(n.repository.nameWithOwner.toLowerCase()))
    .map((n) => ({
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
      queue: n.mergeQueueEntry ?? undefined,
    }));

  return { prs, inaccessible };
}

/** Login of the account the token belongs to, or null if the token is rejected. */
export async function fetchViewerLogin(token: string): Promise<string | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  return (await res.json()).login;
}
