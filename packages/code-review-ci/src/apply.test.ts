import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apply,
  emptyDiffStickyBody,
  errorTail,
  infraErrorStickyBody,
  ioErrorStickyBody,
  type ApplyDeps,
  type GitHubApi,
} from "./apply.js";
import { INLINE_MARKER, STICKY_MARKER, type PostPlan } from "./plan.js";

// --- Mock builders --------------------------------------------------------------------

interface MockGitHub {
  rest: {
    issues: {
      getLabel: ReturnType<typeof vi.fn>;
      createLabel: ReturnType<typeof vi.fn>;
      removeLabel: ReturnType<typeof vi.fn>;
      addLabels: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
      updateComment: ReturnType<typeof vi.fn>;
      listComments: { __route: "listComments" };
    };
    pulls: {
      deleteReviewComment: ReturnType<typeof vi.fn>;
      createReview: ReturnType<typeof vi.fn>;
      listReviewComments: { __route: "listReviewComments" };
    };
    repos: { createCommitStatus: ReturnType<typeof vi.fn> };
  };
  paginate: ReturnType<typeof vi.fn>;
}

const makeGithub = (): MockGitHub => {
  const gh: MockGitHub = {
    rest: {
      issues: {
        getLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
        listComments: { __route: "listComments" },
      },
      pulls: {
        deleteReviewComment: vi.fn().mockResolvedValue({}),
        createReview: vi.fn().mockResolvedValue({}),
        listReviewComments: { __route: "listReviewComments" },
      },
      repos: { createCommitStatus: vi.fn().mockResolvedValue({}) },
    },
    paginate: vi.fn().mockResolvedValue([]),
  };
  return gh;
};

const makeCore = () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), setOutput: vi.fn() });

const context: ApplyDeps["context"] = {
  payload: { pull_request: { number: 7, head: { sha: "headsha123" } } },
  repo: { owner: "acme", repo: "snapchef" },
  runId: 42,
};

const baseEnv = {
  GITHUB_WORKSPACE: "/ws",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/snapchef",
};

const samplePlan: PostPlan = {
  state: "success",
  label: "cr:pass",
  verdict: "comment",
  reviewBody: "review body",
  comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: `inline ${INLINE_MARKER}` }],
  stickyBody: `${STICKY_MARKER}\nsticky`,
};

const run = (over: {
  github?: MockGitHub;
  core?: ReturnType<typeof makeCore>;
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => string;
}): Promise<void> => {
  const github = over.github ?? makeGithub();
  const core = over.core ?? makeCore();
  return apply({
    github: github as unknown as GitHubApi,
    context,
    core,
    env: { ...baseEnv, ...over.env },
    readFile: over.readFile ?? (() => ""),
  });
};

// --- Pure helpers ---------------------------------------------------------------------

describe("errorTail", () => {
  it("returns the placeholder for empty/whitespace input", () => {
    expect(errorTail("")).toBe("(no error output captured)");
    expect(errorTail("   \n  ")).toBe("(no error output captured)");
  });
  it("returns the last N lines", () => {
    const raw = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(errorTail(raw, 3)).toBe("line 18\nline 19\nline 20");
  });
});

describe("sticky body builders", () => {
  it("each carries the sticky marker", () => {
    expect(emptyDiffStickyBody()).toContain(STICKY_MARKER);
    expect(infraErrorStickyBody("1", "boom")).toContain(STICKY_MARKER);
    expect(ioErrorStickyBody("kaboom")).toContain(STICKY_MARKER);
  });
  it("infra body embeds the exit code and error tail", () => {
    const body = infraErrorStickyBody("137", "OOM killed");
    expect(body).toContain("exit code `137`");
    expect(body).toContain("OOM killed");
    expect(body).toContain("cr:revalidate");
  });
});

// --- apply orchestration --------------------------------------------------------------

describe("apply — label lifecycle (every path)", () => {
  let github: MockGitHub;
  beforeEach(async () => {
    github = makeGithub();
    await run({ github, env: { DIFF_EMPTY: "true" } });
  });

  it("ensures the three managed labels exist", () => {
    const ensured = github.rest.issues.getLabel.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(ensured).toEqual(["cr:pass", "cr:fail", "cr:revalidate"]);
  });
  it("clears revalidate + stale verdict labels at run start", () => {
    const removed = github.rest.issues.removeLabel.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(removed).toEqual(["cr:revalidate", "cr:pass", "cr:fail"]);
  });
});

describe("apply — empty-diff path", () => {
  it("posts success + cr:pass, an empty-diff sticky, and no review", async () => {
    const github = makeGithub();
    await run({ github, env: { DIFF_EMPTY: "true" } });

    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "headsha123", context: "code-review/gate", state: "success" }),
    );
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: ["cr:pass"] }));
    expect(github.rest.pulls.createReview).not.toHaveBeenCalled();
    const sticky = github.rest.issues.createComment.mock.calls[0]?.[0] as { body: string };
    expect(sticky.body).toContain("No reviewable changes");
  });
});

describe("apply — infra-failure path", () => {
  it("blocks (failure), posts an error sticky with the stderr tail, and sets NO verdict label", async () => {
    const github = makeGithub();
    await run({
      github,
      env: { DIFF_EMPTY: "false", PKG_CODE: "1" },
      readFile: (p) => (p.endsWith("review.err") ? "rate limited\nretry later" : ""),
    });

    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failure", description: "Review did not run (infra error)" }),
    );
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.pulls.createReview).not.toHaveBeenCalled();
    const sticky = github.rest.issues.createComment.mock.calls[0]?.[0] as { body: string };
    expect(sticky.body).toContain("retry later");
    expect(sticky.body).toContain("infrastructure error");
  });

  it("tolerates a missing review.err file", async () => {
    const github = makeGithub();
    const core = makeCore();
    await run({
      github,
      core,
      env: { DIFF_EMPTY: "false", PKG_CODE: "1" },
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    const sticky = github.rest.issues.createComment.mock.calls[0]?.[0] as { body: string };
    expect(sticky.body).toContain("(no error output captured)");
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "failure" }));
  });
});

describe("apply — success path", () => {
  it("posts the review, sticky, verdict label, and a passing status", async () => {
    const github = makeGithub();
    await run({
      github,
      env: { DIFF_EMPTY: "false", PKG_CODE: "0" },
      readFile: () => JSON.stringify(samplePlan),
    });

    expect(github.rest.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ commit_id: "headsha123", event: "COMMENT", body: "review body" }),
    );
    const review = github.rest.pulls.createReview.mock.calls[0]?.[0] as { comments: unknown[] };
    expect(review.comments).toHaveLength(1);
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: ["cr:pass"] }));
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "success", description: "Code review passed" }),
    );
  });

  it("maps a request_changes plan to a blocking status", async () => {
    const github = makeGithub();
    await run({
      github,
      env: { DIFF_EMPTY: "false", PKG_CODE: "0" },
      readFile: () => JSON.stringify({ ...samplePlan, state: "failure", label: "cr:fail" } satisfies PostPlan),
    });
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failure", description: "Code review requested changes" }),
    );
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: ["cr:fail"] }));
  });

  it("deletes prior bot inline comments (and only those) before posting", async () => {
    const github = makeGithub();
    github.paginate.mockImplementation(async (route: { __route: string }) => {
      if (route.__route === "listReviewComments") {
        return [
          { id: 1, user: { login: "github-actions[bot]" }, body: `old ${INLINE_MARKER}` }, // delete
          { id: 2, user: { login: "github-actions[bot]" }, body: "human-ish, no marker" }, // keep
          { id: 3, user: { login: "someone" }, body: `not bot ${INLINE_MARKER}` }, // keep
        ];
      }
      return [];
    });
    await run({
      github,
      env: { DIFF_EMPTY: "false", PKG_CODE: "0" },
      readFile: () => JSON.stringify(samplePlan),
    });
    expect(github.rest.pulls.deleteReviewComment).toHaveBeenCalledTimes(1);
    expect(github.rest.pulls.deleteReviewComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 1 }));
  });
});

describe("apply — sticky upsert", () => {
  it("updates an existing bot sticky instead of creating a new one", async () => {
    const github = makeGithub();
    github.paginate.mockImplementation(async (route: { __route: string }) => {
      if (route.__route === "listComments") {
        return [{ id: 99, user: { login: "github-actions[bot]" }, body: `${STICKY_MARKER}\nold summary` }];
      }
      return [];
    });
    await run({
      github,
      env: { DIFF_EMPTY: "false", PKG_CODE: "0" },
      readFile: () => JSON.stringify(samplePlan),
    });
    expect(github.rest.issues.updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 99 }));
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });
});

describe("apply — fail-closed", () => {
  it("posts a blocking status even when posting results throws", async () => {
    const github = makeGithub();
    const core = makeCore();
    // First paginate (sticky for success path) blows up.
    github.paginate.mockRejectedValue(new Error("network down"));
    await run({
      github,
      core,
      env: { DIFF_EMPTY: "false", PKG_CODE: "0" },
      readFile: () => JSON.stringify(samplePlan),
    });
    expect(core.error).toHaveBeenCalled();
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failure", description: "Code review I/O error" }),
    );
  });

  it("always posts the gate status (finally)", async () => {
    const github = makeGithub();
    await run({ github, env: { DIFF_EMPTY: "true" } });
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledTimes(1);
  });
});

describe("apply — outputs (gate-state + verdict, every branch)", () => {
  it("emits the plan's state + verdict on the success path", async () => {
    const core = makeCore();
    await run({
      core,
      env: { DIFF_EMPTY: "false", PKG_CODE: "0" },
      readFile: () =>
        JSON.stringify({ ...samplePlan, state: "failure", label: "cr:fail", verdict: "request_changes" } satisfies PostPlan),
    });
    expect(core.setOutput).toHaveBeenCalledWith("gate-state", "failure");
    expect(core.setOutput).toHaveBeenCalledWith("verdict", "request_changes");
  });

  it("emits success + approve on the empty-diff path", async () => {
    const core = makeCore();
    await run({ core, env: { DIFF_EMPTY: "true" } });
    expect(core.setOutput).toHaveBeenCalledWith("gate-state", "success");
    expect(core.setOutput).toHaveBeenCalledWith("verdict", "approve");
  });

  it("emits failure + error on the infra-failure path (no verdict produced)", async () => {
    const core = makeCore();
    await run({ core, env: { DIFF_EMPTY: "false", PKG_CODE: "1" }, readFile: () => "" });
    expect(core.setOutput).toHaveBeenCalledWith("gate-state", "failure");
    expect(core.setOutput).toHaveBeenCalledWith("verdict", "error");
  });
});

describe("apply — status context", () => {
  it("uses a custom STATUS_CONTEXT when provided", async () => {
    const github = makeGithub();
    await run({ github, env: { DIFF_EMPTY: "true", STATUS_CONTEXT: "code-review/custom" } });
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ context: "code-review/custom" }),
    );
  });

  it("defaults to code-review/gate when STATUS_CONTEXT is unset", async () => {
    const github = makeGithub();
    await run({ github, env: { DIFF_EMPTY: "true" } });
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ context: "code-review/gate" }),
    );
  });
});

describe("apply — ensureLabel", () => {
  it("creates a label that does not yet exist (404)", async () => {
    const github = makeGithub();
    github.rest.issues.getLabel.mockRejectedValueOnce({ status: 404 });
    await run({ github, env: { DIFF_EMPTY: "true" } });
    expect(github.rest.issues.createLabel).toHaveBeenCalledWith(expect.objectContaining({ name: "cr:pass" }));
  });

  it("rethrows a non-404 getLabel error (→ fail-closed)", async () => {
    const github = makeGithub();
    github.rest.issues.getLabel.mockRejectedValueOnce({ status: 500 });
    await run({ github, env: { DIFF_EMPTY: "true" } });
    // The 500 propagates to the catch → blocking status, no created label.
    expect(github.rest.issues.createLabel).not.toHaveBeenCalled();
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failure", description: "Code review I/O error" }),
    );
  });
});
