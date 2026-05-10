// Project/App: GSD-2
// File Purpose: Worktree Lifecycle Module — typed-result contract tests for enterMilestone (ADR-016).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorktreeLifecycle,
  resolvePausedResumeBasePath,
  type WorktreeLifecycleDeps,
  type NotifyCtx,
} from "../worktree-lifecycle.js";
import { WorktreeStateProjection } from "../worktree-state-projection.js";
import { type TaskCommitContext } from "../worktree.js";
import { AutoSession } from "../auto/session.js";
import { openDatabase, closeDatabase, insertMilestone } from "../gsd-db.js";
import { registerAutoWorker } from "../db/auto-workers.js";
import { claimMilestoneLease } from "../db/milestone-leases.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CallLog {
  fn: string;
  args: unknown[];
}

type LegacyTestDeps = WorktreeLifecycleDeps & {
  autoCommitCurrentBranch?: (
    basePath: string,
    unitType: string,
    unitId: string,
    taskContext?: TaskCommitContext,
  ) => string | null;
  getCurrentBranch?: (basePath: string) => string;
  checkoutBranch?: (basePath: string, branch: string) => void;
  readFileSync?: (path: string, encoding: BufferEncoding) => string;
};

function makeSession(overrides?: Partial<AutoSession>): AutoSession {
  const s = new AutoSession();
  s.basePath = overrides?.basePath ?? "/project";
  s.originalBasePath = overrides?.originalBasePath ?? "/project";
  Object.assign(s, overrides);
  return s;
}

function makeDeps(
  overrides?: Partial<LegacyTestDeps>,
): LegacyTestDeps & { calls: CallLog[] } {
  const calls: CallLog[] = [];
  const deps: LegacyTestDeps & { calls: CallLog[] } = {
    calls,
    enterAutoWorktree: (basePath, milestoneId) => {
      calls.push({ fn: "enterAutoWorktree", args: [basePath, milestoneId] });
      return `/project/.gsd/worktrees/${milestoneId}`;
    },
    createAutoWorktree: (basePath, milestoneId) => {
      calls.push({ fn: "createAutoWorktree", args: [basePath, milestoneId] });
      return `/project/.gsd/worktrees/${milestoneId}`;
    },
    enterBranchModeForMilestone: (basePath, milestoneId) => {
      calls.push({
        fn: "enterBranchModeForMilestone",
        args: [basePath, milestoneId],
      });
    },
    getAutoWorktreePath: (basePath, milestoneId) => {
      calls.push({ fn: "getAutoWorktreePath", args: [basePath, milestoneId] });
      return null;
    },
    getIsolationMode: () => {
      calls.push({ fn: "getIsolationMode", args: [] });
      return "worktree";
    },
    invalidateAllCaches: () => {
      calls.push({ fn: "invalidateAllCaches", args: [] });
    },
    GitServiceImpl: class MockGitService {
      basePath: string;
      gitConfig: unknown;
      constructor(basePath: string, gitConfig: unknown) {
        calls.push({ fn: "GitServiceImpl", args: [basePath, gitConfig] });
        this.basePath = basePath;
        this.gitConfig = gitConfig;
      }
    } as unknown as WorktreeLifecycleDeps["GitServiceImpl"],
    loadEffectiveGSDPreferences: () => {
      calls.push({ fn: "loadEffectiveGSDPreferences", args: [] });
      return { preferences: { git: {} } };
    },
    // Slice 7 widened WorktreeLifecycleDeps with merge/exit-side fields.
    // These tests focus on enter; merge-side helpers are no-op stubs.
    worktreeProjection: new WorktreeStateProjection(),
    isInAutoWorktree: () => false,
    autoCommitCurrentBranch: (
      basePath: string,
      unitType: string,
      unitId: string,
      taskContext?: TaskCommitContext,
    ) => {
      calls.push({ fn: "autoCommitCurrentBranch", args: [basePath, unitType, unitId, taskContext] });
      return null;
    },
    autoWorktreeBranch: (mid: string) => `milestone/${mid}`,
    teardownAutoWorktree: () => {},
    mergeMilestoneToMain: () => ({ pushed: false, codeFilesChanged: true }),
    getCurrentBranch: () => "main",
    checkoutBranch: () => {},
    resolveMilestoneFile: () => null,
    readFileSync: () => "",
    ...overrides,
  };
  return deps;
}

function makeCtx(): NotifyCtx & {
  messages: Array<{ msg: string; level?: string }>;
} {
  const messages: Array<{ msg: string; level?: string }> = [];
  return {
    messages,
    notify: (msg, level) => {
      messages.push({ msg, level });
    },
  };
}

function makeDbBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-lifecycle-"));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  return base;
}

function cleanupDbBase(base: string): void {
  try { closeDatabase(); } catch { /* noop */ }
  try { rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
}

// ─── enterMilestone — typed-result contract ──────────────────────────────────

test("enterMilestone returns ok:true mode:worktree on successful create", () => {
  const s = makeSession();
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "worktree");
    assert.equal(result.path, "/project/.gsd/worktrees/M001");
  }
  assert.equal(s.basePath, "/project/.gsd/worktrees/M001");
  assert.equal(
    deps.calls.filter((c) => c.fn === "invalidateAllCaches").length,
    1,
  );
});

test("enterMilestone returns ok:true mode:branch on successful branch fallback", () => {
  const s = makeSession();
  const deps = makeDeps({ getIsolationMode: () => "branch" });
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "branch");
    assert.equal(result.path, "/project");
  }
  // Branch mode does not mutate s.basePath
  assert.equal(s.basePath, "/project");
});

test("enterMilestone returns ok:true mode:none when isolation disabled", () => {
  const s = makeSession();
  const deps = makeDeps({ getIsolationMode: () => "none" });
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "none");
    assert.equal(result.path, "/project");
  }
  assert.equal(s.basePath, "/project");
});

test("enterMilestone returns ok:false reason:isolation-degraded when session degraded", () => {
  const s = makeSession({ isolationDegraded: true });
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "isolation-degraded");
  }
  // No worktree primitives invoked
  assert.equal(deps.calls.filter((c) => c.fn === "createAutoWorktree").length, 0);
  assert.equal(deps.calls.filter((c) => c.fn === "enterAutoWorktree").length, 0);
});

test("enterMilestone returns ok:false reason:creation-failed and degrades session on worktree throw", () => {
  const s = makeSession();
  const deps = makeDeps({
    createAutoWorktree: () => {
      throw new Error("boom");
    },
  });
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "creation-failed");
    assert.ok(result.cause instanceof Error);
  }
  assert.equal(s.isolationDegraded, true);
  // s.basePath unchanged on failure
  assert.equal(s.basePath, "/project");
});

test("enterMilestone returns ok:false reason:creation-failed when branch mode throws", () => {
  const s = makeSession();
  const deps = makeDeps({
    getIsolationMode: () => "branch",
    enterBranchModeForMilestone: () => {
      throw new Error("branch checkout failed");
    },
  });
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "creation-failed");
  }
  assert.equal(s.isolationDegraded, true);
});

test("enterMilestone enters existing worktree when path resolves", () => {
  const s = makeSession();
  const deps = makeDeps({
    getAutoWorktreePath: () => "/project/.gsd/worktrees/M001",
  });
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, true);
  assert.equal(deps.calls.filter((c) => c.fn === "enterAutoWorktree").length, 1);
  assert.equal(deps.calls.filter((c) => c.fn === "createAutoWorktree").length, 0);
});

test("enterMilestone returns ok:false reason:lease-conflict when another worker holds the lease", (t) => {
  const base = makeDbBase();
  t.after(() => cleanupDbBase(base));
  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "Test", status: "active" });
  const holder = registerAutoWorker({ projectRootRealpath: base });
  const contender = registerAutoWorker({ projectRootRealpath: base });
  const claim = claimMilestoneLease(holder, "M001");
  assert.equal(claim.ok, true);

  const s = makeSession({ basePath: base, originalBasePath: base, workerId: contender });
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "lease-conflict");
  }
  assert.equal(s.isolationDegraded, false);
  assert.equal(deps.calls.filter((c) => c.fn === "createAutoWorktree").length, 0);
  assert.equal(deps.calls.filter((c) => c.fn === "enterAutoWorktree").length, 0);
});

test("enterMilestone is idempotent when already in the milestone worktree", () => {
  const s = makeSession({
    basePath: "/project/.gsd/worktrees/M001",
    originalBasePath: "/project",
    currentMilestoneId: "M001",
  });
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const result = lifecycle.enterMilestone("M001", ctx);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "worktree");
    assert.equal(result.path, "/project/.gsd/worktrees/M001");
  }
  assert.equal(s.basePath, "/project/.gsd/worktrees/M001");
  assert.equal(deps.calls.filter((c) => c.fn === "createAutoWorktree").length, 0);
  assert.equal(deps.calls.filter((c) => c.fn === "enterAutoWorktree").length, 0);
});

test("enterMilestone returns ok:false reason:invalid-milestone-id on path traversal", () => {
  const s = makeSession();
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  const traversal = lifecycle.enterMilestone("../escape", ctx);
  const separator = lifecycle.enterMilestone("a/b", ctx);

  assert.equal(traversal.ok, false);
  if (!traversal.ok) {
    assert.equal(traversal.reason, "invalid-milestone-id");
  }
  assert.equal(separator.ok, false);
  if (!separator.ok) {
    assert.equal(separator.reason, "invalid-milestone-id");
  }
});

// ─── exitMilestone — typed-result contract ────────────────────────────────────
//
// The delegation-shape tests that lived here were retired in slice 7 / step
// D of ADR-016: Lifecycle no longer takes a `resolverFactory`. The merge
// behaviour they covered now runs inside Lifecycle directly and is exercised
// end-to-end by the merge-mode tests in worktree-resolver.test.ts (which
// drive Lifecycle through Resolver delegation until step E retires the
// Resolver class entirely). When that retirement lands, those tests move
// here verbatim.

// ─── Queries (issue #5587) ────────────────────────────────────────────────────

test("isInMilestone returns true when session matches milestone id", () => {
  const s = makeSession();
  s.currentMilestoneId = "M001";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  assert.equal(lifecycle.isInMilestone("M001"), true);
  assert.equal(lifecycle.isInMilestone("M002"), false);
});

test("isInMilestone returns false when session has no active milestone", () => {
  const s = makeSession();
  s.currentMilestoneId = null;
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  assert.equal(lifecycle.isInMilestone("M001"), false);
});

test("getCurrentMilestoneIfAny returns the active milestone id or null", () => {
  const s = makeSession();
  s.currentMilestoneId = "M042";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  assert.equal(lifecycle.getCurrentMilestoneIfAny(), "M042");

  s.currentMilestoneId = null;
  assert.equal(lifecycle.getCurrentMilestoneIfAny(), null);
});

// ─── degradeToBranchMode (issue #5587) ────────────────────────────────────────

test("degradeToBranchMode sets isolationDegraded and invokes branch-mode helper", () => {
  const s = makeSession();
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.degradeToBranchMode("M001", ctx);

  assert.equal(s.isolationDegraded, true);
  assert.equal(
    deps.calls.filter((c) => c.fn === "enterBranchModeForMilestone").length,
    1,
  );
  assert.equal(deps.calls.filter((c) => c.fn === "invalidateAllCaches").length, 1);
});

test("degradeToBranchMode is no-op when isolationDegraded is already true", () => {
  const s = makeSession();
  s.isolationDegraded = true;
  const deps = makeDeps();
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.degradeToBranchMode("M001", ctx);

  assert.equal(
    deps.calls.filter((c) => c.fn === "enterBranchModeForMilestone").length,
    0,
  );
});

test("degradeToBranchMode marks degraded and notifies on branch-mode failure", () => {
  const s = makeSession();
  const deps = makeDeps({
    enterBranchModeForMilestone: () => {
      throw new Error("checkout failed");
    },
  });
  const ctx = makeCtx();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.degradeToBranchMode("M001", ctx);

  assert.equal(s.isolationDegraded, true);
  assert.ok(
    ctx.messages.some(
      (m) => m.level === "warning" && m.msg.includes("Branch isolation setup"),
    ),
  );
});

// ─── restoreToProjectRoot (issue #5587) ───────────────────────────────────────

test("restoreToProjectRoot restores basePath to originalBasePath and rebuilds git service", () => {
  const s = makeSession();
  s.originalBasePath = "/project";
  s.basePath = "/project/.gsd/worktrees/M001";
  const deps = makeDeps();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.restoreToProjectRoot();

  assert.equal(s.basePath, "/project");
  assert.equal(deps.calls.filter((c) => c.fn === "GitServiceImpl").length, 1);
  assert.equal(deps.calls.filter((c) => c.fn === "invalidateAllCaches").length, 1);
});

test("restoreToProjectRoot is no-op when originalBasePath is empty", () => {
  const s = makeSession();
  s.originalBasePath = "";
  s.basePath = "/some/path";
  const deps = makeDeps();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.restoreToProjectRoot();

  assert.equal(s.basePath, "/some/path"); // unchanged
  assert.equal(deps.calls.filter((c) => c.fn === "GitServiceImpl").length, 0);
});

// ─── adoptSessionRoot (ADR-016 phase 2 / B2, issue #5620) ─────────────────────

test("adoptSessionRoot sets basePath and seeds originalBasePath on a fresh session", () => {
  const s = makeSession();
  s.basePath = "";
  s.originalBasePath = "";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  lifecycle.adoptSessionRoot("/project");

  assert.equal(s.basePath, "/project");
  assert.equal(s.originalBasePath, "/project");
});

test("adoptSessionRoot preserves a pre-existing originalBasePath when no override is passed", () => {
  // Resume-from-paused path (auto.ts:2148 after meta-restore at 2003/2055):
  // s.originalBasePath was already restored from paused metadata; the verb
  // must NOT overwrite that value.
  const s = makeSession();
  s.basePath = "";
  s.originalBasePath = "/persisted/project-root";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  lifecycle.adoptSessionRoot("/project");

  assert.equal(s.basePath, "/project");
  assert.equal(s.originalBasePath, "/persisted/project-root");
});

test("adoptSessionRoot honors an explicit originalBase override", () => {
  const s = makeSession();
  s.basePath = "";
  s.originalBasePath = "/old-root";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  lifecycle.adoptSessionRoot("/project", "/explicit-original");

  assert.equal(s.basePath, "/project");
  assert.equal(s.originalBasePath, "/explicit-original");
});

test("adoptSessionRoot does not chdir, rebuild git service, or invalidate caches", () => {
  // The verb is a pure session-state mutation. Side effects (chdir, git
  // service rebuild, cache invalidation) belong to other Lifecycle verbs
  // (`enterMilestone`, `restoreToProjectRoot`).
  const s = makeSession();
  s.basePath = "";
  s.originalBasePath = "";
  const deps = makeDeps();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.adoptSessionRoot("/project");

  assert.equal(deps.calls.filter((c) => c.fn === "GitServiceImpl").length, 0);
  assert.equal(deps.calls.filter((c) => c.fn === "invalidateAllCaches").length, 0);
});

// ─── resumeFromPausedSession (ADR-016 phase 2 / B3, issue #5621) ──────────────

test("resumeFromPausedSession adopts the persisted worktree path when it exists", () => {
  const s = makeSession();
  s.basePath = "/some/old/path";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  // Inject a pathExists stub via the pure helper export so the verb's
  // existence check returns true without touching the filesystem.
  // The verb doesn't accept a stub directly, so we exercise it through
  // the pure helper to keep the test free of disk side effects.
  const wt = "/persisted/worktree/M001";
  // Verify the pure helper's contract first (folded in from the legacy
  // _resolvePausedResumeBasePathForTest)
  assert.equal(
    resolvePausedResumeBasePath("/project", wt, () => true),
    wt,
  );

  // Now exercise the verb with a real path that exists (the test cwd).
  lifecycle.resumeFromPausedSession("/project", process.cwd());
  assert.equal(s.basePath, process.cwd());
});

test("resumeFromPausedSession falls back to base when persisted worktree is null", () => {
  const s = makeSession();
  s.basePath = "/old";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  lifecycle.resumeFromPausedSession("/project", null);
  assert.equal(s.basePath, "/project");
});

test("resumeFromPausedSession falls back to base when persisted worktree does not exist", () => {
  const s = makeSession();
  s.basePath = "/old";
  const lifecycle = new WorktreeLifecycle(s, makeDeps());

  lifecycle.resumeFromPausedSession(
    "/project",
    "/this/path/does/not/exist/abc/xyz",
  );
  assert.equal(s.basePath, "/project");
});

test("resumeFromPausedSession does not chdir, rebuild git service, or invalidate caches", () => {
  const s = makeSession();
  const deps = makeDeps();
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.resumeFromPausedSession("/project", null);

  assert.equal(deps.calls.filter((c) => c.fn === "GitServiceImpl").length, 0);
  assert.equal(deps.calls.filter((c) => c.fn === "invalidateAllCaches").length, 0);
});

// ─── adoptOrphanWorktree (ADR-016 phase 2 / B4, issue #5622) ──────────────────

test("adoptOrphanWorktree swaps to worktree path and reverts to base on !merged", () => {
  const s = makeSession();
  s.basePath = "/old";
  s.originalBasePath = "/old";
  s.active = true;
  const deps = makeDeps({
    getAutoWorktreePath: () => "/project/.gsd/worktrees/M001",
  });
  const lifecycle = new WorktreeLifecycle(s, deps);

  let basePathInsideCallback = "";
  const result = lifecycle.adoptOrphanWorktree("M001", "/project", () => {
    basePathInsideCallback = s.basePath;
    return { merged: false as const, reason: "synthetic" };
  });

  // Inside callback: swap was applied
  assert.equal(basePathInsideCallback, "/project/.gsd/worktrees/M001");
  // After failed merge: reverted to base
  assert.equal(s.basePath, "/project");
  assert.equal(s.originalBasePath, "/project");
  assert.equal(result.merged, false);
});

test("adoptOrphanWorktree holds the swap on merged && active", () => {
  const s = makeSession();
  s.basePath = "/old";
  s.originalBasePath = "/old";
  s.active = true;
  const deps = makeDeps({
    getAutoWorktreePath: () => "/project/.gsd/worktrees/M001",
  });
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.adoptOrphanWorktree("M001", "/project", () => ({
    merged: true as const,
  }));

  // Merged && active — swap held
  assert.equal(s.basePath, "/project/.gsd/worktrees/M001");
  assert.equal(s.originalBasePath, "/project");
});

test("adoptOrphanWorktree restores prior paths on merged && !active", () => {
  const s = makeSession();
  s.basePath = "/prior";
  s.originalBasePath = "/prior-original";
  s.active = false;
  const deps = makeDeps({
    getAutoWorktreePath: () => "/project/.gsd/worktrees/M001",
  });
  const lifecycle = new WorktreeLifecycle(s, deps);

  lifecycle.adoptOrphanWorktree("M001", "/project", () => ({
    merged: true as const,
  }));

  // Merged but session inactive — restore the snapshotted prior paths
  assert.equal(s.basePath, "/prior");
  assert.equal(s.originalBasePath, "/prior-original");
});

test("adoptOrphanWorktree falls back to base when getAutoWorktreePath returns null", () => {
  const s = makeSession();
  s.basePath = "/old";
  s.active = true;
  const deps = makeDeps({
    getAutoWorktreePath: () => null,
  });
  const lifecycle = new WorktreeLifecycle(s, deps);

  let basePathInsideCallback = "";
  lifecycle.adoptOrphanWorktree("M001", "/project", () => {
    basePathInsideCallback = s.basePath;
    return { merged: true as const };
  });

  // Inside callback: basePath is project root (no worktree available)
  assert.equal(basePathInsideCallback, "/project");
});

test("adoptOrphanWorktree restores prior paths and cwd when the callback throws", () => {
  const originalCwd = process.cwd();
  const base = mkdtempSync(join(tmpdir(), "gsd-orphan-rollback-base-"));
  const worktree = mkdtempSync(join(tmpdir(), "gsd-orphan-rollback-wt-"));
  const s = makeSession({
    basePath: "/prior",
    originalBasePath: originalCwd,
    active: true,
  });
  const deps = makeDeps({
    getAutoWorktreePath: () => worktree,
  });
  const lifecycle = new WorktreeLifecycle(s, deps);
  const thrown = new Error("synthetic callback failure");

  try {
    assert.throws(
      () =>
        lifecycle.adoptOrphanWorktree<{ merged: boolean }>("M001", base, () => {
          assert.equal(s.basePath, worktree);
          assert.equal(s.originalBasePath, base);
          throw thrown;
        }),
      thrown,
    );

    assert.equal(s.basePath, "/prior");
    assert.equal(s.originalBasePath, originalCwd);
    assert.equal(process.cwd(), originalCwd);
  } finally {
    process.chdir(originalCwd);
    rmSync(base, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("adoptOrphanWorktree rejects traversal-style milestone ids before path resolution", () => {
  const s = makeSession({
    basePath: "/prior",
    originalBasePath: "/prior-original",
    active: true,
  });
  const deps = makeDeps({
    getAutoWorktreePath: () => {
      throw new Error("getAutoWorktreePath should not be called");
    },
  });
  const lifecycle = new WorktreeLifecycle(s, deps);

  assert.throws(
    () =>
      lifecycle.adoptOrphanWorktree("../M001", "/project", () => ({
        merged: true as const,
      })),
    /Invalid milestoneId: \.\.\/M001/,
  );

  assert.equal(s.basePath, "/prior");
  assert.equal(s.originalBasePath, "/prior-original");
  assert.equal(
    deps.calls.filter((c) => c.fn === "getAutoWorktreePath").length,
    0,
  );
});

test("adoptOrphanWorktree forwards the callback's return value", () => {
  const s = makeSession();
  s.active = true;
  const lifecycle = new WorktreeLifecycle(
    s,
    makeDeps({ getAutoWorktreePath: () => null }),
  );

  const result = lifecycle.adoptOrphanWorktree("M001", "/project", () => ({
    merged: true as const,
    customField: "preserved",
  }));

  assert.equal(result.merged, true);
  assert.equal(result.customField, "preserved");
});

test("adoptOrphanWorktree leaves session unchanged when getAutoWorktreePath throws", () => {
  const s = makeSession();
  s.basePath = "/prior";
  s.originalBasePath = "/prior-original";
  s.active = true;
  const lifecycle = new WorktreeLifecycle(
    s,
    makeDeps({
      getAutoWorktreePath: () => {
        throw new Error("git state unavailable");
      },
    }),
  );

  assert.throws(
    () =>
      lifecycle.adoptOrphanWorktree("M001", "/project", () => ({
        merged: true as const,
      })),
    /git state unavailable/,
  );
  assert.equal(s.basePath, "/prior");
  assert.equal(s.originalBasePath, "/prior-original");
});

test("adoptOrphanWorktree restores prior paths when callback throws", () => {
  const s = makeSession();
  s.basePath = "/prior";
  s.originalBasePath = "/prior-original";
  s.active = true;
  const lifecycle = new WorktreeLifecycle(
    s,
    makeDeps({
      getAutoWorktreePath: () => "/project/.gsd/worktrees/M001",
    }),
  );

  assert.throws(
    () =>
      lifecycle.adoptOrphanWorktree("M001", "/project", () => {
        assert.equal(s.basePath, "/project/.gsd/worktrees/M001");
        assert.equal(s.originalBasePath, "/project");
        throw new Error("merge exploded");
      }),
    /merge exploded/,
  );
  assert.equal(s.basePath, "/prior");
  assert.equal(s.originalBasePath, "/prior-original");
});
