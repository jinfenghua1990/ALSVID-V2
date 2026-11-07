'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uuidv7 } = require('../uuidv7');

test('UUID v7 has a valid timestamp, version and variant', () => {
  const before = Date.now();
  const id = uuidv7();
  const after = Date.now();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const timestamp = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  assert.ok(timestamp >= before && timestamp <= after);
});

test('generated IDs do not repeat in a sample', () => {
  const ids = new Set(Array.from({ length: 10000 }, uuidv7));
  assert.equal(ids.size, 10000);
});
