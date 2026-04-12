import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initNotificationStore, appendNotification, _resetNotificationStore } from "../notification-store.js";
import { buildNotificationWidgetLines } from "../notification-widget.js";

test("buildNotificationWidgetLines includes slash-command fallback for unread notifications", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-notification-widget-"));
  try {
    mkdirSync(join(tmp, ".gsd"), { recursive: true });
    _resetNotificationStore();
    initNotificationStore(tmp);
    appendNotification("Need attention", "warning");

    const lines = buildNotificationWidgetLines();
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /\/gsd notifications/);
  } finally {
    _resetNotificationStore();
    rmSync(tmp, { recursive: true, force: true });
  }
});
