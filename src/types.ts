/** Whose PRs to track: only the signed-in user's, or everyone's in the tracked repos. */
export type PrScope = "mine" | "all";

export interface Settings {
  token: string;
  repos: string[];
  prScope: PrScope;
}

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | "NONE";
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "NONE";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type QueueState = "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED";

export interface QueueEntry {
  position: number;
  state: QueueState;
}

export interface Author {
  login: string;
  avatarUrl: string;
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  ci: CiState;
  review: ReviewDecision;
  mergeable: Mergeable;
  unresolvedThreads: number;
  author: Author;
  /** Set when the PR is in the repository's merge queue. */
  queue?: QueueEntry;
}

export interface Viewer {
  login: string;
  avatarUrl: string;
  /** Link to the user's GitHub profile. */
  url: string;
}

export interface Snapshot {
  fetchedAt: number;
  viewer?: Viewer;
  /** Scope the PRs were fetched with; snapshots saved before "all" existed lack it and are "mine". */
  scope?: PrScope;
  prs: PullRequest[];
  /** Open PRs authored by the viewer in followed repos (drives the badge). */
  myCount?: number;
  /** Open PR count per followed repo (key = configured repo string); set in "all" mode. */
  totals?: Record<string, number>;
  /** Configured repos the token could not see. */
  inaccessible?: string[];
  error?: string;
}

export interface InboxItem {
  id: string;
  title: string;
  /** GitHub subject type, e.g. "PullRequest". */
  type: string;
  /** owner/name */
  repo: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
  /** Browser-friendly link (never an api.github.com URL). */
  url: string;
}

export interface InboxState {
  /** Short hash of the token the items were fetched with (never the token itself). */
  account: string;
  fetchedAt: number;
  /** Time of the last unconditional (200) fetch. */
  fullFetchedAt: number;
  lastModified?: string;
  items: InboxItem[];
  error?: string;
  errorKind?: "fine-grained";
}
