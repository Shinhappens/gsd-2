// Project/App: GSD-2
// File Purpose: Regression tests for auto-mode stop notification formatting.

import test from "node:test";
import assert from "node:assert/strict";

import { formatAutoStopNotification } from "../auto.ts";

test("auto stop notification keeps session totals on a separate line", () => {
  const message = formatAutoStopNotification(
    "Auto-mode stopped",
    { cost: 0.652, tokens: { total: 87000 } },
    2,
  );

  assert.equal(
    message,
    "Auto-mode stopped.\nSession: $0.652 · 87.0k tokens · 2 units",
  );
});
