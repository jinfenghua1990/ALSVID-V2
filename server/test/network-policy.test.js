const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkPolicy } = require('../network-policy');

test('network policy keeps local mode loopback-only', () => {
  const policy = createNetworkPolicy({ port: 8089 });
  assert.equal(policy.allows('localhost:8089', undefined, 'GET'), true);
  assert.equal(policy.allows('127.0.0.1:8089', 'http://127.0.0.1:8089', 'POST'), true);
  assert.equal(policy.allows('192.168.1.20:8089', undefined, 'GET'), false);
  assert.equal(policy.allows('localhost:8089', 'https://evil.example', 'GET'), false);
});
test('public mode requires exact HTTPS origins and protects unsafe cross-origin requests', () => {
  const policy = createNetworkPolicy({ port: 8089, bindHost: '0.0.0.0', publicOrigins: 'https://www.example.com,https://my.example.com' });
  assert.equal(policy.allows('www.example.com', undefined, 'GET'), true);
  assert.equal(policy.allows('www.example.com', 'https://www.example.com', 'POST'), true);
  assert.equal(policy.allows('www.example.com', 'https://my.example.com', 'POST'), false);
  assert.equal(policy.allows('unknown.example.com', undefined, 'GET'), false);
  assert.equal(policy.isPublicHost('www.example.com'), true);
  assert.throws(() => createNetworkPolicy({ port: 8089, bindHost: '0.0.0.0' }), /requires HTTPS origins/);
  assert.throws(() => createNetworkPolicy({ port: 8089, bindHost: '0.0.0.0', publicOrigins: 'http://www.example.com' }), /exact HTTPS origins/);
  assert.throws(() => createNetworkPolicy({ port: 8089, bindHost: '0.0.0.0', publicOrigins: 'https://www.example.com/path' }), /exact HTTPS origins/);
});
