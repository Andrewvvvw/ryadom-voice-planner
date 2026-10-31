import seed from '../data/events.json' with { type: 'json' };

export class Repository {
  constructor(db, tenant) { this.db = db; this.tenant = tenant; }
  sql(query, ...args) { return this.db.prepare(query).bind(...args); }
  async bootstrap() {
    await this.sql('INSERT OR IGNORE INTO tenants (id, created_at) VALUES (?,?)', this.tenant, new Date().toISOString()).run();
    const tenant = await this.sql('SELECT seeded FROM tenants WHERE id=?', this.tenant).first();
    if (tenant.seeded) return;
    const created = new Date().toISOString();
    // Idempotent chunks allow a safely resumed import after interruption.
    for (let offset = 0; offset < seed.length; offset += 80) {
      await this.db.batch(seed.slice(offset, offset + 80).map(row => {
        const type = /^(?:встреча|созвон|демо|совещание|интервью)/i.test(row.text) ? 'meeting' : /^напом/i.test(row.text) ? 'reminder' : 'task';
        return this.sql('INSERT OR IGNORE INTO events (id,tenant,type,title,date,time,duration,status,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,60,\'pending\',?,?,?)', `${this.tenant}:seed:${row.id}`, this.tenant, type, row.text, row.date, row.time, Number(row.id), created, created);
      }));
    }
    await this.sql('UPDATE tenants SET seeded=1 WHERE id=?', this.tenant).run();
  }
  async all() { return (await this.sql('SELECT * FROM events WHERE tenant=? ORDER BY date DESC, time DESC, id', this.tenant).all()).results; }
  async get(id) { return this.sql('SELECT * FROM events WHERE tenant=? AND id=?', this.tenant, id).first(); }
  async list({ start, end, type = null, status = null, limit = 100, offset = 0, includeUndated = false } = {}) {
    const filters = ['tenant=?'], args = [this.tenant];
    if (start) { filters.push(includeUndated ? '(date>=? OR date IS NULL)' : 'date>=?'); args.push(start); }
    if (end) { filters.push('date<?'); args.push(end); }
    if (type) { filters.push('type=?'); args.push(type); }
    if (status) { filters.push('status=?'); args.push(status); }
    const where = filters.join(' AND ');
    const count = await this.sql(`SELECT COUNT(*) AS total FROM events WHERE ${where}`, ...args).first();
    const rows = await this.sql(`SELECT * FROM events WHERE ${where} ORDER BY date IS NULL,date,time IS NULL,time,id LIMIT ? OFFSET ?`, ...args, limit, offset).all();
    return { events: rows.results, total: count.total, limit, offset };
  }
  async stats(today, end) {
    return this.sql(`SELECT COUNT(*) total, SUM(source_id IS NOT NULL) imported,
      SUM(status='completed') completed, SUM(date=? AND status='pending') today,
      SUM(date>=? AND date<? AND type='meeting' AND status='pending') meetings
      FROM events WHERE tenant=?`, today, today, end, this.tenant).first();
  }
  async conversation(id) {
    await this.sql('INSERT OR IGNORE INTO conversations(id,tenant) VALUES (?,?)', id, this.tenant).run();
    const row = await this.sql('SELECT * FROM conversations WHERE id=? AND tenant=?', id, this.tenant).first();
    if (!row) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
    return { ...row, state: JSON.parse(row.state) };
  }
  async history(id) {
    return (await this.sql('SELECT input,response,created_at FROM exchanges WHERE tenant=? AND conversation=? ORDER BY revision DESC LIMIT 50', this.tenant, id).all()).results.reverse().map(row => ({ ...row, response: JSON.parse(row.response) }));
  }
  async replay(id) {
    const row = await this.sql('SELECT response, input, conversation FROM exchanges WHERE id=? AND tenant=?', id, this.tenant).first();
    return row ? { ...row, response: JSON.parse(row.response) } : null;
  }
  insert(event) {
    return this.sql('INSERT INTO events(id,tenant,type,title,date,time,duration,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', event.id, this.tenant, event.type, event.title, event.date, event.time, event.duration, event.status, event.created_at, event.updated_at);
  }
  update(event) {
    return this.sql('UPDATE events SET title=?,date=?,time=?,duration=?,status=?,updated_at=? WHERE tenant=? AND id=?', event.title, event.date, event.time, event.duration, event.status, event.updated_at, this.tenant, event.id);
  }
  remove(id) { return this.sql('DELETE FROM events WHERE tenant=? AND id=?', this.tenant, id); }
  async commit({ requestId, text, conversation, response, state, operations = [] }) {
    await this.db.batch([
      this.sql('INSERT INTO exchanges(id,tenant,conversation,input,response,created_at,revision) VALUES (?,?,?,?,?,?,?)', requestId, this.tenant, conversation.id, text, JSON.stringify(response), new Date().toISOString(), conversation.revision + 1),
      ...operations,
      this.sql('UPDATE conversations SET state=?,revision=revision+1 WHERE id=? AND tenant=?', JSON.stringify(state), conversation.id, this.tenant),
    ]);
  }
}
