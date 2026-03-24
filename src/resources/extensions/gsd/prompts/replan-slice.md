You are executing GSD auto-mode.

## UNIT: Replan Slice {{sliceId}} ("{{sliceTitle}}") — Milestone {{milestoneId}}

## Working Directory

Your working directory is `{{workingDirectory}}`. All file reads, writes, and shell commands MUST operate relative to this directory. Do NOT `cd` to any other directory.

A completed task reported `blocker_discovered: true`, meaning the current slice plan cannot be executed as-is. Your job is to rewrite the remaining tasks in the slice plan to address the blocker while preserving all completed work.

All relevant context has been preloaded below — the roadmap, current slice plan, the blocker task summary, and decisions are inlined. Start working immediately without re-reading these files.

{{inlinedContext}}

## Capture Context

The following user-captured thoughts triggered or informed this replan:

{{captureContext}}

Consider these captures when rewriting the remaining tasks — they represent the user's real-time insights about what needs to change.

## Hard Constraints

- **Do NOT renumber or remove completed tasks.** All `[x]` tasks and their IDs must remain exactly as they are in the plan.
- **Do NOT change completed task descriptions, estimates, or metadata.** They are historical records.
- **Preserve completed task summaries.** Do not modify any `T0x-SUMMARY.md` files for completed tasks.
- Only modify `[ ]` (incomplete) tasks. You may rewrite, reorder, add, or remove incomplete tasks as needed to address the blocker.
- New tasks must follow the existing ID numbering sequence (e.g., if T01–T03 exist, new tasks start at T04 or continue from the highest existing ID).

## Instructions

1. Read the blocker task summary carefully. Understand exactly what was discovered and why it blocks the current plan.
2. Analyze the remaining `[ ]` tasks in the slice plan. Determine which are still valid, which need modification, and which should be replaced.
3. **Persist replan state through `gsd_replan_slice`.** Call it with the following parameters: `milestoneId`, `sliceId`, `blockerTaskId`, `blockerDescription`, `whatChanged`, `updatedTasks` (array of task objects with taskId, title, description, estimate, files, verify, inputs, expectedOutput), `removedTaskIds` (array of task ID strings). The tool structurally enforces preservation of completed tasks, writes replan history to the DB, re-renders PLAN.md, and renders REPLAN.md. Skip steps 4–5 when this tool succeeds.
4. **Degraded fallback — direct file writes:** If `gsd_replan_slice` is not available, fall back to writing files directly. Write `{{replanPath}}` documenting:
   - What blocker was discovered and in which task
   - What changed in the plan and why
   - Which incomplete tasks were modified, added, or removed
   - Any new risks or considerations introduced by the replan
5. If using the degraded fallback, rewrite `{{planPath}}` with the updated slice plan:
   - Keep all `[x]` tasks exactly as they were (same IDs, same descriptions, same checkmarks)
   - Update the `[ ]` tasks to address the blocker
   - Ensure the slice Goal and Demo sections are still achievable with the new tasks, or update them if the blocker fundamentally changes what the slice can deliver
   - Update the Files Likely Touched section if the replan changes which files are affected
   - If a DB-backed planning tool exists for this phase, use it as the source of truth and make any rewritten `PLAN.md` reflect that persisted state rather than bypassing it
6. If any incomplete task had a `T0x-PLAN.md`, remove or rewrite it to match the new task description.
7. Do not commit manually — the system auto-commits your changes after this unit completes.

When done, say: "Slice {{sliceId}} replanned."
