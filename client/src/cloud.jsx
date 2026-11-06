import React, { useEffect, useState } from 'react';

/* 云端对象存储的"连接状态"提示
   背景：图片不在数据库里，而在对象存储（S3 兼容）。库和 bucket 必须成套，
   否则产品文字能看到、图片全部 404。这里统一把"等待云端对象存储"这件事显性化，
   避免只看到一个破图标。
   探测只做一次（结果缓存在模块作用域），失败不阻塞界面。 */

let cached = null;   // { configured: boolean }
let pending = null;

export function probeStorage() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch('/api/health', { headers: { Accept: 'application/json' } })
    .then(async (r) => {
      const data = await r.json().catch(() => null);
      return !!(data && data.objectStorageConfigured);
    })
    .catch(() => false)
    .then((configured) => { cached = { configured }; return cached; })
    .finally(() => { pending = null; });
  return pending;
}

export function useStorageStatus() {
  const [status, setStatus] = useState(() => cached
    ? { phase: 'done', configured: cached.configured }
    : { phase: 'loading', configured: false });
  useEffect(() => {
    if (cached) { setStatus({ phase: 'done', configured: cached.configured }); return; }
    let alive = true;
    probeStorage().then((c) => { if (alive) setStatus({ phase: 'done', configured: c.configured }); });
    return () => { alive = false; };
  }, []);
  return status;
}

/* 顶栏指示灯：连接中 / 已连接 / 未连接 */
export function StorageBadge() {
  const s = useStorageStatus();
  const phase = s.phase === 'loading' ? 'pending' : s.configured ? 'ready' : 'off';
  const label = phase === 'pending' ? '对象存储 · 连接中' : phase === 'ready' ? '对象存储 · 已连接' : '对象存储 · 未连接';
  const title = phase === 'ready'
    ? '已按 Secret Manager 中的配置连上云端对象存储，图片可正常读写'
    : phase === 'off'
      ? '未读到对象存储配置或服务不可用：图片位置会显示占位提示，产品文字信息不受影响'
      : '正在确认云端对象存储是否可用';
  return (
    <span className={`cloud-badge is-${phase}`} title={title} role="status" aria-live="polite">
      <span className="cloud-badge__dot" aria-hidden="true" />{label}
    </span>
  );
}

/* 云端图片：加载中显示"正在连接云端对象存储…"，失败给可点的重试 */
export function CloudImage({ src, alt = '', height = 220, fit = 'contain', className = '', style }) {
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [attempt, setAttempt] = useState(0);
  const storage = useStorageStatus();
  useEffect(() => { setPhase('loading'); }, [src, attempt]);
  const offline = storage.phase === 'done' && !storage.configured;
  const url = attempt > 0 ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;
  return (
    <div className={`cloud-image ${className}`.trim()} style={style}>
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onLoad={() => setPhase('ready')}
        onError={() => setPhase('error')}
        style={{ display: phase === 'ready' ? 'block' : 'none', maxWidth: '100%', maxHeight: height, objectFit: fit }}
      />
      {phase !== 'ready' && (
        <div className={`cloud-image__state${phase === 'error' ? ' is-error' : ''}`} style={{ minHeight: Math.min(height, 180) }}>
          {phase === 'loading' ? (
            <>
              <span className="cloud-image__dot" aria-hidden="true" />
              <span>正在连接云端对象存储…</span>
            </>
          ) : (
            <>
              <strong>{offline ? '云端对象存储未连接' : '图片未能从对象存储加载'}</strong>
              <span className="cloud-image__hint">
                {offline ? '配置缺失时图片不可见，产品文字信息不受影响' : '可能是网络波动或文件已被清理，可重试一次'}
              </span>
              <button type="button" className="btn small" onClick={() => setAttempt((a) => a + 1)}>重试</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
