import { readFileSync } from "node:fs";
import { context, getOctokit } from "@actions/github";
import * as actionsCore from "@actions/core";
import { INLINE_MARKER, STICKY_MARKER, type PostPlan } from "./plan.js";

/**
 * Applies the code-review post plan to a PR and posts the merge-gate commit
 * status. This is the GitHub-I/O shell that used to live inline in
 * `code-review.yml`'s `actions/github-script` step; extracting it here makes the
 * 422-prone, fail-closed orchestration type-checked and unit-testable (the YAML
 * could neither). The workflow now runs `tsx src/apply.ts` like the rest of the
 * package — no build step.
 *
 * Behaviour is preserved exactly: ensure labels → run-start label lifecycle →
 * branch on empty-diff / infra-failure / success → **always** post the
 * `code-review/gate` status (fail-closed: any I/O error blocks the gate).
 */

/** The bot identity whose comments/labels this workflow owns (for dedup). */
const BOT = "github-actions[bot]";

/** Default placeholder when no stderr was captured from the reviewer. */
const NO_ERROR_OUTPUT = "(no error output captured)";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** HTTP status off an Octokit error, or `undefined` when it isn't shaped like one. */
const httpStatus = (e: unknown): number | undefined =>
  typeof e === "object" && e !== null && "status" in e && typeof (e as { status: unknown }).status === "number"
    ? (e as { status: number }).status
    : undefined;

// --- Pure body builders (unit-tested) -------------------------------------------------

/** Last `maxLines` lines of captured stderr, or the placeholder when empty. */
export const errorTail = (raw: string, maxLines = 15): string => {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.split("\n").slice(-maxLines).join("\n") : NO_ERROR_OUTPUT;
};

/** Sticky body for the empty-diff short-circuit (no billable AI call ran). */
export const emptyDiffStickyBody = (): string =>
  `${STICKY_MARKER}\n## Code review summary\n\n**Verdict:** \`approve\`\n\n_No reviewable changes in this PR._`;

/** Sticky body for the infra-failure path (reviewer exited non-zero). */
export const infraErrorStickyBody = (pkgCode: string, tail: string): string =>
  [
    STICKY_MARKER,
    "## Code review — infrastructure error",
    "",
    `The automated review did not complete (exit code \`${pkgCode || "n/a"}\`). This is **not** a code verdict — the merge gate is **blocked** until a clean run.`,
    "",
    "Re-run it by adding the `cr:revalidate` label once the cause is resolved.",
    "",
    "<details><summary>Error output</summary>",
    "",
    "```",
    tail,
    "```",
    "",
    "</details>",
  ].join("\n");

/** Sticky body for an I/O error while posting results (the fail-closed catch). */
export const ioErrorStickyBody = (message: string): string =>
  `${STICKY_MARKER}\n## Code review — error\n\nThe review step failed while posting results: \`${message}\`\n\nAdd \`cr:revalidate\` to retry.`;

// --- Injected GitHub surface (narrow structural types; mockable in tests) -------------

interface CommentLike {
  id: number;
  user: { login: string } | null;
  body?: string;
}

/** The subset of the Octokit client this module touches. */
export interface GitHubApi {
  rest: {
    issues: {
      getLabel(params: { owner: string; repo: string; name: string }): Promise<unknown>;
      createLabel(params: {
        owner: string;
        repo: string;
        name: string;
        color: string;
        description: string;
      }): Promise<unknown>;
      removeLabel(params: { owner: string; repo: string; issue_number: number; name: string }): Promise<unknown>;
      addLabels(params: { owner: string; repo: string; issue_number: number; labels: string[] }): Promise<unknown>;
      createComment(params: { owner: string; repo: string; issue_number: number; body: string }): Promise<unknown>;
      updateComment(params: { owner: string; repo: string; comment_id: number; body: string }): Promise<unknown>;
      listComments: unknown;
    };
    pulls: {
      deleteReviewComment(params: { owner: string; repo: string; comment_id: number }): Promise<unknown>;
      createReview(params: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        event: "COMMENT";
        body: string;
        comments: { path: string; line: number; side: "RIGHT"; body: string }[];
      }): Promise<unknown>;
      listReviewComments: unknown;
    };
    repos: {
      createCommitStatus(params: {
        owner: string;
        repo: string;
        sha: string;
        context: string;
        state: "success" | "failure";
        target_url: string;
        description: string;
      }): Promise<unknown>;
    };
  };
  paginate<T>(route: unknown, params: Record<string, unknown>): Promise<T[]>;
}

/** The subset of `@actions/github`'s context this module reads. */
export interface ReviewContext {
  payload: { pull_request?: { number: number; head: { sha: string } } };
  repo: { owner: string; repo: string };
  runId: number;
}

/** The subset of `@actions/core` this module logs through. */
export interface CoreApi {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

export interface ApplyDeps {
  github: GitHubApi;
  context: ReviewContext;
  core: CoreApi;
  /** Process env (reads `GITHUB_WORKSPACE`, `PKG_CODE`, `DIFF_EMPTY`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`). */
  env: Record<string, string | undefined>;
  /** Reads a workspace file as UTF-8 (injected so tests need no filesystem). */
  readFile(path: string): string;
}

/**
 * Apply the post plan and post the gate status. Always posts `code-review/gate`
 * (fail-closed) so a reviewed head SHA is never left statusless because of an I/O
 * error.
 */
export const apply = async ({ github, context: ctx, core, env, readFile }: ApplyDeps): Promise<void> => {
  const pr = ctx.payload.pull_request;
  if (pr === undefined) throw new Error("No pull_request in the event payload");

  const prNumber = pr.number;
  const headSha = pr.head.sha;
  const { owner, repo } = ctx.repo;
  const ws = env.GITHUB_WORKSPACE ?? ".";
  const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${ctx.runId}`;
  const pkgCode = env.PKG_CODE ?? "";
  const isEmpty = env.DIFF_EMPTY === "true";

  const ensureLabel = async (name: string, color: string, description: string): Promise<void> => {
    try {
      await github.rest.issues.getLabel({ owner, repo, name });
    } catch (e) {
      if (httpStatus(e) === 404) {
        await github.rest.issues.createLabel({ owner, repo, name, color, description });
      } else {
        throw e;
      }
    }
  };

  const removeLabelSafe = async (name: string): Promise<void> => {
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name });
    } catch (e) {
      if (httpStatus(e) !== 404) throw e;
    }
  };

  const upsertSticky = async (body: string): Promise<void> => {
    const comments = await github.paginate<CommentLike>(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });
    const existing = comments.find(
      (c) => c.user !== null && c.user.login === BOT && c.body !== undefined && c.body.includes(STICKY_MARKER),
    );
    if (existing) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    } else {
      await github.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    }
  };

  const setStatus = async (state: "success" | "failure", description: string): Promise<void> => {
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      context: "code-review/gate",
      state,
      target_url: runUrl,
      description,
    });
  };

  let finalState: "success" | "failure" = "failure";
  let finalDescription = "Code review blocked";

  try {
    await ensureLabel("cr:pass", "0e8a16", "AI code-review gate passed");
    await ensureLabel("cr:fail", "d93f0b", "AI code-review gate failed");
    await ensureLabel("cr:revalidate", "fbca04", "Re-run the AI code review on the current commit");

    // Run-start label lifecycle: consume cr:revalidate, clear stale verdict labels.
    for (const name of ["cr:revalidate", "cr:pass", "cr:fail"]) {
      await removeLabelSafe(name);
    }

    if (isEmpty) {
      finalState = "success";
      finalDescription = "No reviewable changes";
      await upsertSticky(emptyDiffStickyBody());
      await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: ["cr:pass"] });
    } else if (pkgCode !== "0") {
      finalState = "failure";
      finalDescription = "Review did not run (infra error)";
      let tail = NO_ERROR_OUTPUT;
      try {
        tail = errorTail(readFile(`${ws}/review.err`));
      } catch (e) {
        core.info(`no review.err: ${errMsg(e)}`);
      }
      await upsertSticky(infraErrorStickyBody(pkgCode, tail));
      // No verdict label on the infra path.
    } else {
      const plan = JSON.parse(readFile(`${ws}/cr-output.json`)) as PostPlan;
      finalState = plan.state;
      finalDescription = plan.state === "success" ? "Code review passed" : "Code review requested changes";

      // Remove prior bot inline comments so a re-run does not duplicate.
      const reviewComments = await github.paginate<CommentLike>(github.rest.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      for (const c of reviewComments) {
        if (c.user !== null && c.user.login === BOT && c.body !== undefined && c.body.includes(INLINE_MARKER)) {
          await github.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c.id });
        }
      }

      // Sticky first so the summary survives even if the inline review 422s.
      await upsertSticky(plan.stickyBody);

      await github.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: headSha,
        event: "COMMENT",
        body: plan.reviewBody,
        comments: plan.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
      });

      await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [plan.label] });
    }
  } catch (e) {
    // Fail-closed: any I/O error blocks the gate.
    core.error(`code-review apply failed: ${errMsg(e)}`);
    finalState = "failure";
    finalDescription = "Code review I/O error";
    try {
      await upsertSticky(ioErrorStickyBody(errMsg(e)));
    } catch (inner) {
      core.warning(`could not upsert error sticky: ${errMsg(inner)}`);
    }
  } finally {
    await setStatus(finalState, finalDescription);
  }
};

/** Framework edge: build the real Octokit/context/core and run once. */
const main = async (): Promise<void> => {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    actionsCore.setFailed("GITHUB_TOKEN is not set");
    return;
  }
  const github = getOctokit(token);
  await apply({
    github: github as unknown as GitHubApi,
    context: context as unknown as ReviewContext,
    core: actionsCore,
    env: process.env,
    readFile: (path) => readFileSync(path, "utf8"),
  });
};

// Only auto-run as a script, not when imported by tests.
if (process.env.VITEST === undefined) {
  void main().catch((e: unknown) => {
    actionsCore.setFailed(e instanceof Error ? e.message : String(e));
  });
}
