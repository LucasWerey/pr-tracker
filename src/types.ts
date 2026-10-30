export interface Settings {
  token: string;
  repos: string[];
}

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | "NONE";
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "NONE";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type QueueState = "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED";

export interface QueueEntry {
  position: number;
  state: QueueState;
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
  /** Set when the PR is in the repository's merge queue. */
  queue?: QueueEntry;
}

export interface Snapshot {
  fetchedAt: number;
  prs: PullRequest[];
  /** Configured repos the token could not see. */
  inaccessible?: string[];
  error?: string;
}
