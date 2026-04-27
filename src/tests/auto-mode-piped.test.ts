/**
 * Tests for `gsd auto` routing — verifies that `auto` is recognized as a
 * subcommand alias for `headless auto` only when stdin or stdout are not TTYs.
 *
 * Regression test for #2732.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldRedirectAutoToHeadless } from '../cli-auto-routing.js'

test('routes `gsd auto` with piped stdout to headless mode (#2732)', () => {
  assert.equal(shouldRedirectAutoToHeadless('auto', true, false), true)
})

test('routes `gsd auto` with piped stdin to headless mode', () => {
  assert.equal(shouldRedirectAutoToHeadless('auto', false, true), true)
})

test('keeps terminal `gsd auto` on the interactive path', () => {
  assert.equal(shouldRedirectAutoToHeadless('auto', true, true), false)
})

test('does not route non-auto subcommands through auto headless mode', () => {
  assert.equal(shouldRedirectAutoToHeadless('headless', true, false), false)
  assert.equal(shouldRedirectAutoToHeadless('config', true, false), false)
  assert.equal(shouldRedirectAutoToHeadless(undefined, false, false), false)
})
