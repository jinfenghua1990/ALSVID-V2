function createNetworkPolicy({ port, bindHost = '127.0.0.1', publicOrigins = '' }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  if (!['127.0.0.1', '0.0.0.0'].includes(bindHost)) throw Error('Invalid bind host');
  const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const publicHosts = new Map();
  for (const value of String(publicOrigins).split(',').map(x => x.trim()).filter(Boolean)) {
    let url; try { url = new URL(value); } catch (_) { throw Error('Invalid public origin'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) throw Error('Public origins must be exact HTTPS origins');
    if (localHosts.has(url.host.toLowerCase())) throw Error('Public origin conflicts with loopback');
    publicHosts.set(url.host.toLowerCase(), url.origin);
  }
  if (bindHost === '0.0.0.0' && publicHosts.size === 0) throw Error('Public bind requires HTTPS origins');
  const isPublicHost = host => publicHosts.has(String(host || '').toLowerCase());
  function allows(host, origin, method) {
    host = String(host || '').toLowerCase();
    if (localHosts.has(host)) return bindHost === '127.0.0.1' && (!origin || origin === `http://${host}`);
    const expected = publicHosts.get(host);
    if (!expected) return false;
    if (origin) return origin === expected;
    return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
  }
  return { bindHost, allows, isPublicHost };
}
module.exports = { createNetworkPolicy };
