const { randomUUID } = require('node:crypto');
const { createPool } = require('./db-pool');
const { currentActor } = require('./audit-context');

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function noteOf(value) { if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail('请填写说明，最多 2000 个字符'); return value.trim(); }
function createPortalStore(connectionString) {
  const pool = createPool(connectionString, { max: 3, connectionTimeoutMillis: 10000 });
  async function transaction(action, target, fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('INSERT INTO audit_log(actor,action,target,after_json) VALUES($1,$2,$3,$4)', [currentActor(), action, target, JSON.stringify(result)]);
      await c.query('COMMIT'); return result;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  const requestFields = 'r.id,r.vin,r.note,r.status,r.decision_note AS "decisionNote",r.created_at AS "createdAt",r.reviewed_at AS "reviewedAt"';
  async function portalUser(c, id) {
    const user = (await c.query("SELECT id,role FROM app_users WHERE id=$1 AND enabled AND role IN ('owner','dealer') FOR SHARE", [id])).rows[0];
    if (!user) fail('门户账号不可用', 403); return user;
  }
  async function authorizedVehicle(c, user, vinId) {
    const row = (await c.query('SELECT v.id,v.vin FROM portal_vehicle_access a JOIN vins v ON v.id=a.vin_id JOIN app_users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.vin_id=$2 AND a.role=$3 AND a.revoked_at IS NULL AND u.enabled AND u.role=a.role FOR SHARE OF a,v,u', [user.id, vinId, user.role])).rows[0];
    if (!row) fail('车辆不可用或尚未获得授权', 403); return row;
  }
  return {
    async accounts() { return (await pool.query("SELECT u.id,u.username,u.role,u.enabled,r.note AS \"reviewNote\",r.reviewed_by AS \"reviewedBy\",r.reviewed_at AS \"reviewedAt\" FROM app_users u JOIN portal_account_reviews r ON r.user_id=u.id WHERE u.role IN ('owner','dealer') ORDER BY r.reviewed_at DESC")).rows; },
    async account(id) { return (await pool.query("SELECT id FROM app_users WHERE id=$1 AND role IN ('owner','dealer')", [id])).rows[0]; },
    async requests(user) {
      return (await pool.query(`SELECT ${requestFields}${user ? '' : ',u.username,u.role'} FROM portal_vehicle_requests r JOIN app_users u ON u.id=r.user_id ${user ? 'WHERE r.user_id=$1' : ''} ORDER BY r.created_at DESC`, user ? [user.id] : [])).rows;
    },
    async requestVehicle(user, input) {
      const vin = String(input.vin || '').trim().toUpperCase(), note = noteOf(input.note), id = randomUUID();
      if (!/^[A-HJ-NPR-Z0-9]{11,20}$/.test(vin)) fail('VIN 格式无效');
      // Do not look up the VIN before review: a request must not reveal whether a vehicle exists.
      return transaction('portal.vehicle.request', `portal-requests/${id}`, async c => {
        await portalUser(c, user.id);
        return (await c.query("INSERT INTO portal_vehicle_requests(id,user_id,vin,note) VALUES($1,$2,$3,$4) RETURNING id,vin,note,status,created_at AS \"createdAt\"", [id, user.id, vin, note])).rows[0];
      });
    },
    async review(id, input) {
      const decision = input.decision, note = noteOf(input.note);
      if (!['approve', 'reject', 'revoke'].includes(decision)) fail('审核操作无效');
      return transaction(`portal.vehicle.${decision}`, `portal-requests/${id}`, async c => {
        const request = (await c.query('SELECT id,user_id,vin,status FROM portal_vehicle_requests WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!request) fail('申请不存在', 404);
        if (decision === 'revoke') {
          if (request.status !== 'approved') fail('只有已批准申请可以撤销', 409);
          await c.query('UPDATE portal_vehicle_access SET revoked_at=now() WHERE request_id=$1', [id]);
        } else {
          if (request.status !== 'pending') fail('申请已被处理，请刷新', 409);
          if (decision === 'approve') {
            const user = await portalUser(c, request.user_id);
            const vin = (await c.query('SELECT id FROM vins WHERE vin=$1 FOR UPDATE', [request.vin])).rows[0];
            if (!vin) fail('车辆档案不存在，请先核实并建立档案');
            if (user.role === 'owner' && (await c.query("SELECT 1 FROM portal_vehicle_access WHERE vin_id=$1 AND role='owner' AND revoked_at IS NULL", [vin.id])).rowCount) fail('车辆已有车主授权，请先核实并撤销原授权', 409);
            await c.query('INSERT INTO portal_vehicle_access(request_id,user_id,vin_id,role) VALUES($1,$2,$3,$4)', [id, user.id, vin.id, user.role]);
          }
        }
        const status = { approve: 'approved', reject: 'rejected', revoke: 'revoked' }[decision];
        return (await c.query('UPDATE portal_vehicle_requests SET status=$1,decision_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING id,vin,status,decision_note AS "decisionNote"', [status, note, currentActor(), id])).rows[0];
      });
    },
    async vehicles(user) {
      return (await pool.query('SELECT v.id,v.vin,v.model,v.produced_at AS "producedAt" FROM portal_vehicle_access a JOIN vins v ON v.id=a.vin_id JOIN app_users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.role=$2 AND a.revoked_at IS NULL AND u.enabled AND u.role=a.role ORDER BY v.vin', [user.id, user.role])).rows;
    },
    async services(user) {
      const scope = user ? 'WHERE s.user_id=$1 AND EXISTS(SELECT 1 FROM portal_vehicle_access a WHERE a.user_id=$1 AND a.vin_id=s.vin_id AND a.role=$2 AND a.revoked_at IS NULL) AND u.enabled AND u.role=$2' : '';
      return (await pool.query(`SELECT s.id,s.vin_id AS "vinId",v.vin,s.description,s.status,s.reply_note AS "replyNote",s.created_at AS "createdAt",r.work_order_no AS "workOrderNo",r.status AS "repairStatus"${user ? '' : ',u.username,u.role'} FROM portal_service_requests s JOIN vins v ON v.id=s.vin_id JOIN app_users u ON u.id=s.user_id LEFT JOIN repairs r ON r.id=s.repair_id ${scope} ORDER BY s.created_at DESC`, user ? [user.id, user.role] : [])).rows;
    },
    async requestService(user, input) {
      const description = noteOf(input.description), id = String(input.id || '');
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) fail('申请编号无效，请刷新后重试');
      return transaction('portal.service.request', `portal-services/${id}`, async c => {
        await authorizedVehicle(c, user, input.vinId);
        await c.query('INSERT INTO portal_service_requests(id,user_id,vin_id,description) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [id, user.id, input.vinId, description]);
        const row = (await c.query('SELECT id,vin_id AS "vinId",description,status FROM portal_service_requests WHERE id=$1 AND user_id=$2', [id, user.id])).rows[0];
        if (!row || row.vinId !== input.vinId || row.description !== description) fail('申请编号已使用，请刷新后重试', 409);
        return row;
      });
    },
    async reviewService(id, input) {
      const note = noteOf(input.note), decision = input.decision;
      if (!['accept', 'reject'].includes(decision)) fail('审核操作无效');
      return transaction(`portal.service.${decision}`, `portal-services/${id}`, async c => {
        const old = (await c.query('SELECT s.*,u.role FROM portal_service_requests s JOIN app_users u ON u.id=s.user_id WHERE s.id=$1 FOR UPDATE OF s', [id])).rows[0];
        if (!old) fail('服务申请不存在', 404);
        if (old.status !== 'submitted') fail('申请已被处理，请刷新', 409);
        let repairId = null;
        if (decision === 'accept') {
          const vin = await authorizedVehicle(c, { id: old.user_id, role: old.role }, old.vin_id);
          repairId = `repair-${randomUUID()}`;
          await c.query("INSERT INTO repairs(id,work_order_no,vin,type,fault,quantity,status) VALUES($1,$2,$3,'售后服务',$4,1,'待收货')", [repairId, `WO-${randomUUID().slice(0, 8).toUpperCase()}`, vin.vin, old.description]);
        }
        return (await c.query('UPDATE portal_service_requests SET status=$1,reply_note=$2,repair_id=$3 WHERE id=$4 RETURNING id,status,reply_note AS "replyNote",repair_id AS "repairId"', [decision === 'accept' ? 'accepted' : 'rejected', note, repairId, id])).rows[0];
      });
    },
    close: () => pool.end(),
  };
}
function registerPortalRoutes(app, { portal, auth }) {
  function route(method, url, handler, external = false) {
    app.route({ method, url, config: external ? { portalRoles: ['owner', 'dealer'] } : {}, bodyLimit: 16 * 1024, handler: async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!external && req.user?.role !== 'admin') return reply.code(403).send({ error: '仅管理员可审核门户权限' });
      if (!portal || !auth) return reply.code(503).send({ error: '门户服务暂时不可用' });
      try { return await handler(req, reply); }
      catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: '账号、待处理申请或授权已存在，请刷新查看' });
        const known = ['请输入有效邮箱或 3–64 位字母、数字、. _ - 账号', '密码须为 8–20 个字符', '请填写已核实身份或合作资格的审核说明', '角色无效', '状态无效', '原密码不正确'];
        return reply.code(e.statusCode || (known.includes(e.message) ? 400 : 500)).send({ error: e.statusCode || known.includes(e.message) ? e.message : '门户操作失败' });
      }
    } });
  }
  route('GET', '/api/portal-management/accounts', () => portal.accounts());
  route('POST', '/api/portal-management/accounts', (req, reply) => auth.createPortalUser(req.body || {}, req.user.username).then(user => reply.code(201).send(user)));
  route('PATCH', '/api/portal-management/accounts/:id', async req => {
    if (!(await portal.account(req.params.id))) fail('门户账号不存在', 404);
    if (typeof req.body?.enabled !== 'boolean') fail('状态无效');
    return auth.updateUser(req.params.id, { enabled: req.body.enabled }, req.user.username);
  });
  route('POST', '/api/portal-management/accounts/:id/password', async req => {
    if (!(await portal.account(req.params.id))) fail('门户账号不存在', 404);
    await auth.setPassword(req.params.id, req.body?.newPassword, req.user.username);
    return { ok: true };
  });
  route('GET', '/api/portal-management/vehicle-requests', () => portal.requests());
  route('POST', '/api/portal-management/vehicle-requests/:id/review', req => portal.review(req.params.id, req.body || {}));
  route('GET', '/api/portal/vehicle-requests', req => portal.requests(req.user), true);
  route('POST', '/api/portal/vehicle-requests', (req, reply) => portal.requestVehicle(req.user, req.body || {}).then(row => reply.code(201).send(row)), true);
  route('GET', '/api/portal/vehicles', req => portal.vehicles(req.user), true);
  route('GET', '/api/portal-management/service-requests', () => portal.services());
  route('POST', '/api/portal-management/service-requests/:id/review', req => portal.reviewService(req.params.id, req.body || {}));
  route('GET', '/api/portal/service-requests', req => portal.services(req.user), true);
  route('POST', '/api/portal/service-requests', (req, reply) => portal.requestService(req.user, req.body || {}).then(row => reply.code(201).send(row)), true);
  route('POST', '/api/portal/password', async (req, reply) => {
    if (typeof req.body?.oldPassword !== 'string') fail('请输入原密码');
    await auth.setPassword(req.user.id, req.body.newPassword, req.user.username, req.body.oldPassword);
    // The session is deleted server-side, including sessions on other portal hosts.
    return { ok: true };
  }, true);
}
module.exports = { createPortalStore, registerPortalRoutes };
