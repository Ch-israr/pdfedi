/**
 * Tests for the 30-minute local-save TTL (Sejda-style expiry).
 *
 * loadDocument() must drop (and delete) snapshots older than
 * LOCAL_SAVE_TTL_MS so expired saves never reach the recovery prompt.
 * The expiry rule itself is the pure predicate isSaveExpired(savedAt, now).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSaveExpired, LOCAL_SAVE_TTL_MS } from '../lib/persistence.ts';

const MIN = 60_000;

describe('local-save TTL', () => {
  it('TTL constant is 30 minutes', () => {
    assert.equal(LOCAL_SAVE_TTL_MS, 30 * 60 * 1000);
  });

  it('keeps a 29-minute-old save', () => {
    const now = Date.now();
    assert.equal(isSaveExpired(now - 29 * MIN, now), false);
  });

  it('drops a 31-minute-old save', () => {
    const now = Date.now();
    assert.equal(isSaveExpired(now - 31 * MIN, now), true);
  });

  it('keeps a save exactly at the TTL boundary (strictly greater)', () => {
    const now = Date.now();
    assert.equal(isSaveExpired(now - LOCAL_SAVE_TTL_MS, now), false);
    assert.equal(isSaveExpired(now - LOCAL_SAVE_TTL_MS - 1, now), true);
  });

  it('keeps fresh saves and future-dated saves', () => {
    const now = Date.now();
    assert.equal(isSaveExpired(now, now), false);
    assert.equal(isSaveExpired(now + MIN, now), false);
  });
});
