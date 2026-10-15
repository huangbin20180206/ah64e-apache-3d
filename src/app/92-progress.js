// ============================================================
// 92-progress.js — 游戏模式存档 v2（星级 / 解锁 / 迁移）（P2，2026-10-13）
// ============================================================
// 纯逻辑：零 THREE、零 DOM；storage 依赖注入（缺省 localStorage，失败内存降级）。
//   键 ah64_progress：{ schema_version: 2, levels: { '2-1': {stars,bestGrade,bestScore,clears,diff} },
//                       extraUnlocked: ['2-3', …], migratedFrom: 1|null }
//   解锁：沿 ready 关序列——第一个 ready 关恒解锁；其余关在「前一个 ready 关 ≥1 星」
//        或出现在 extraUnlocked（旧档迁移带来的已解锁进度，只增不减）时解锁。
//   迁移：首次创建 v2 档时读旧 ah64_campaign（v1，6 关链）——旧关号按变体映射到
//        新关 id（0→2-1 1→2-2 2→2-3 3→2-1 4→2-2 5→3-1），评级/分数取最优，
//        星级按新关门槛重算（旧档没有 bonus 记录 → 最多 2 星）；旧 unlocked 覆盖到
//        的关写入 extraUnlocked。旧档原样保留（legacy 战役 chips 继续读它）。
//   容错：损坏 JSON / 未来版本 / 非对象 → 全新档（不炸页面）。
// 拓扑：70 层经 HOST.makeProgress() 取用；关卡数据读 HOST.levels（91 注册）。
// ============================================================

const PROGRESS_KEY = 'ah64_progress';
const PROGRESS_SCHEMA = 2;
const PROGRESS_V1_MAP = ['2-1', '2-2', '2-3', '2-1', '2-2', '3-1'];
const _PG_RANK = { S: 0, A: 1, B: 2, C: 3 };

class ProgressModule {
  constructor(opts = {}) {
    this.L = opts.levels || HOST.levels;
    this.storage = opts.storage !== undefined ? opts.storage
      : (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined);
    this.last = null;                  // 最近一次 record() 结果（结算面板读）
    this._load();
  }
  _fresh() { return { schema_version: PROGRESS_SCHEMA, levels: {}, extraUnlocked: [], migratedFrom: null }; }
  _get(k) { try { return this.storage && this.storage.getItem ? this.storage.getItem(k) : null; } catch (e) { return null; } }
  _sanitize(raw) {
    const out = this._fresh();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    if (raw.schema_version !== PROGRESS_SCHEMA) return out;
    if (raw.levels && typeof raw.levels === 'object') {
      for (const id of Object.keys(raw.levels)) {
        if (!this.L.byId(id)) continue;
        const r = raw.levels[id] || {};
        const st = parseInt(r.stars, 10);
        out.levels[id] = {
          stars: Number.isFinite(st) ? Math.max(0, Math.min(3, st)) : 0,
          bestGrade: (r.bestGrade in _PG_RANK) ? r.bestGrade : '',
          bestScore: Math.max(0, parseInt(r.bestScore, 10) || 0),
          clears: Math.max(0, parseInt(r.clears, 10) || 0),
          diff: typeof r.diff === 'string' ? r.diff : '',
        };
      }
    }
    if (Array.isArray(raw.extraUnlocked)) out.extraUnlocked = raw.extraUnlocked.filter(id => !!this.L.byId(id));
    out.migratedFrom = raw.migratedFrom === 1 ? 1 : null;
    return out;
  }
  // v1（90-campaign 的 ah64_campaign）→ v2
  migrateV1(v1) {
    const out = this._fresh();
    if (!v1 || typeof v1 !== 'object' || !Array.isArray(v1.levels)) return out;
    out.migratedFrom = 1;
    v1.levels.forEach((old, i) => {
      const id = PROGRESS_V1_MAP[i];
      const L = id && this.L.byId(id);
      if (!L || !old || typeof old !== 'object') return;
      const g = (old.bestGrade in _PG_RANK) ? old.bestGrade : '';
      const cur = out.levels[id] || { stars: 0, bestGrade: '', bestScore: 0, clears: 0, diff: '' };
      if (g && (!cur.bestGrade || _PG_RANK[g] < _PG_RANK[cur.bestGrade])) cur.bestGrade = g;
      cur.bestScore = Math.max(cur.bestScore, parseInt(old.bestScore, 10) || 0);
      if (g) { cur.clears = Math.max(cur.clears, 1); cur.stars = Math.max(cur.stars, this.L.stars(L, g, false)); }
      out.levels[id] = cur;
    });
    const u = parseInt(v1.unlocked, 10);
    if (Number.isFinite(u)) {
      for (let i = 0; i < Math.min(u, PROGRESS_V1_MAP.length); i++) {
        const id = PROGRESS_V1_MAP[i];
        if (!out.extraUnlocked.includes(id)) out.extraUnlocked.push(id);
      }
    }
    return out;
  }
  _load() {
    const s = this._get(PROGRESS_KEY);
    if (s) {
      let raw = null;
      try { raw = JSON.parse(s); } catch (e) { raw = null; }
      this._mem = this._sanitize(raw);
      return;
    }
    // 无 v2 档：尝试从 v1 迁移（一次性，写回 v2）
    let v1 = null;
    try { const t = this._get('ah64_campaign'); if (t) v1 = JSON.parse(t); } catch (e) { v1 = null; }
    this._mem = v1 ? this.migrateV1(v1) : this._fresh();
    if (v1) this._persist();
  }
  _persist() {
    try { if (this.storage && this.storage.setItem) this.storage.setItem(PROGRESS_KEY, JSON.stringify(this._mem)); }
    catch (e) { /* 内存降级 */ }
  }
  rec(id) { return this._mem.levels[id] || { stars: 0, bestGrade: '', bestScore: 0, clears: 0, diff: '' }; }
  isUnlocked(id) {
    const L = this.L.byId(id);
    if (!L || !L.ready) return false;
    const prev = this.L.prevReady(id);
    if (!prev) return true;
    return this.rec(prev.id).stars >= 1 || this._mem.extraUnlocked.includes(id);
  }
  // 下一个 ready 关（结算面板的「下一关」）
  nextOf(id) {
    const R = this.L.ready();
    const i = R.findIndex(L => L.id === id);
    return i >= 0 && i < R.length - 1 ? R[i + 1] : null;
  }
  // 结算记档：ctx = 关卡 bonus 判定输入（levelBonus），grade = 90-campaign 评级
  record(id, grade, score, ctx, diff) {
    const L = this.L.byId(id);
    if (!L) return null;
    const bonus = this.L.bonus(L, ctx);
    const allOk = bonus.length > 0 && bonus.every(b => b.ok);
    const stars = this.L.stars(L, grade, allOk);
    const r = Object.assign({}, this.rec(id));
    const nxt = this.nextOf(id);
    const wasLocked = nxt ? !this.isUnlocked(nxt.id) : false;
    const prevStars = r.stars;
    r.stars = Math.max(r.stars, stars);
    if (grade in _PG_RANK && (!r.bestGrade || _PG_RANK[grade] < _PG_RANK[r.bestGrade])) r.bestGrade = grade;
    r.bestScore = Math.max(r.bestScore, Math.round(score || 0));
    r.clears += 1;
    if (diff) r.diff = diff;
    this._mem.levels[id] = r;
    this._persist();
    const unlockedNext = !!(nxt && wasLocked && this.isUnlocked(nxt.id));
    this.last = { id, stars, bestStars: r.stars, newBest: r.stars > prevStars, bonus, unlockedNext,
      next: nxt ? nxt.id : null };
    return this.last;
  }
  totals() {
    const R = this.L.ready();
    let stars = 0, cleared = 0;
    for (const L of R) { const s = this.rec(L.id).stars; stars += s; if (s > 0) cleared++; }
    return { stars, maxStars: R.length * 3, cleared, ready: R.length, total: this.L.list.length };
  }
  get save_data() { return JSON.parse(JSON.stringify(this._mem)); }
  reset() { this._mem = this._fresh(); this._persist(); }
}

HOST.makeProgress = (opts) => new ProgressModule(opts);
