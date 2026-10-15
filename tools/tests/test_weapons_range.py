# -*- coding: utf-8 -*-
# 机炮 / 地狱火对空射程回归（对应 2026-09-15 用户反馈"这两个飞行打击物我永远都打不到"）
#   R1 曳光射程：vel*life 必须 ≥ 150u
#        （旧值 vel=95 / life=0.55 ⇒ 52u；实测 30/45u 可击落、60/75u 0 命中）
#   R2 60u：机头精确对准、连发 3s 必须击落四轴无人机（旧：0 命中）
#   R3 90u：同上（远距交战包线）
#   R4 地狱火：回收阈值 ≥ 5.0s，且 120u 处发射必须击落（旧 3.2s×34u/s≈100u）
# 说明：这四条都直接在页面上做"值级/行为级"断言，不依赖截图判读。
import sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def aim_at(pg, idx, back):
    """把机体摆到与目标同高度、目标正前方 back 单位处，机头精确对准目标。

    注意：本用例只考察【空中目标射程】，因此关闭地面靶场
    （`targets.enabled=false`）。否则当机体被摆在"原点→无人机"的连线上时，
    基地地面目标会与无人机落在同一条视线上，角偏移竞争会把锁定判给地面车
    （实测：120u 处导弹去打了装甲靶车）——那是架场几何问题，不是产品缺陷。
    """
    return pg.evaluate("""(a) => {
        const d = window.__dbg;
        if (d.air.reset) d.air.reset();
        d.targets.enabled = false;                  // 隔离空中射程，排除地面目标抢锁
        const t = d.air.list[a.i];
        const tp = t.pos;
        const len = Math.hypot(tp.x, tp.z) || 1;
        const ux = tp.x / len, uz = tp.z / len;
        const px = tp.x - ux * a.back, pz = tp.z - uz * a.back;
        d.FLY.state = 'hover'; d.FLY.fp = true; d.FLY.comp = 0;
        d.FLY.alt = tp.y; d.S._alt = 0; d.FLY.x = px; d.FLY.z = pz;
        d.FLY.yaw = Math.atan2(tp.x - px, tp.z - pz); d.FLY.pitch = 0;
        d.apache.root.position.set(px, tp.y, pz);
        d.apache.root.rotation.set(0, d.FLY.yaw, 0);
        d.apache.root.updateMatrixWorld(true);
        d.S.running = true;
        return { back: a.back, hp: t.hp, alive: t.alive,
                 dist: +t.pos.distanceTo(d.apache.root.position).toFixed(1) };
    }""", {'i': idx, 'back': back})


def gun_state(pg):
    return pg.evaluate("""() => { const t = __dbg.rig.tracers.find(x => x.m.visible) || __dbg.rig.tracers[0];
        return { vel: t.vel, life: t.life, range: +(t.vel * t.life).toFixed(1) }; }""")


def hf_state(pg):
    return pg.evaluate("""() => { const r = __dbg.rig;
        return { ammo: r.hfAmmo, flying: r.flying.length }; }""")


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.rig && __dbg.air)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close')?.click()")
    pg.evaluate("window.__dbg.audio.enabled = false")
    pg.wait_for_timeout(400)

    # ---- R1 曳光射程（在"发射瞬间"捕获 vel/life——读可见曳光会拿到已衰减的 life）----
    pg.evaluate("""() => {
        const r = __dbg.rig;
        window.__cap = {};
        const orig = r._tracer.bind(r);
        r._tracer = function (from, dir, precise) {
            orig(from, dir, precise);
            const t = r.tracers.find(x => x.m.visible);
            if (t) window.__cap.r = { vel: t.vel, life: t.life, range: +(t.vel * t.life).toFixed(1) };
        };
    }""")
    pg.evaluate("__dbg.rig.gunOn = true")
    # 条件等待发射真发生（帧率无关）：固定 200ms 窗在低帧环境（如无头
    # --use-angle=d3d11）gunOn 后 loop 可能一帧未跑、发射未发生——全量门禁
    # 两轮实测 __cap 空（vel/life/range 全 0）。发射链本身探针实证正常。
    pg.wait_for_function("() => !!(window.__cap && window.__cap.r)", timeout=5000)
    pg.evaluate("__dbg.rig.gunOn = false")
    g = pg.evaluate("window.__cap.r || { vel: 0, life: 0, range: 0 }")
    print('R1 曳光参数（发射瞬间）:', g, flush=True)
    assert g['range'] >= 150.0, ('R1: 曳光射程不足 150u（空中目标会被"射程上限"卡死）', g)

    # ---- R2/R3 机炮长距击落 ----
    for back, tag in ((60, 'R2'), (90, 'R3')):
        st = aim_at(pg, 0, back)
        print('%s 机位: %s' % (tag, st), flush=True)
        assert st['alive'], ('%s: 目标不应处于非存活态' % tag, st)
        pg.wait_for_timeout(500)
        pg.evaluate("__dbg.rig.gunOn = true")
        pg.wait_for_timeout(3000)
        pg.evaluate("__dbg.rig.gunOn = false")
        pg.wait_for_timeout(300)
        after = pg.evaluate("""() => { const t = __dbg.air.list[0];
            return { hp: t.hp, alive: t.alive, mode: t.mode,
                     dist: +t.pos.distanceTo(__dbg.apache.root.position).toFixed(1) }; }""")
        print('%s %du 连发 3s 后:' % (tag, back), after, flush=True)
        assert (not after['alive']), ('%s: %du 处精确瞄准连发仍未击落（射程/穿隧回归）' % (tag, back), after)

    # ---- R4 地狱火远程击落（120u）----
    # 锁定时是"角偏移竞争"：同一锥内可能由别的空中目标（靶机/气球）赢下锁定。
    # 因此不断言"某架无人机死"，而是断言【被锁定的那个目标】确实被击落——
    # 这正是"地狱火 120u 能否打到"的准确表述（旧值航程 ~100u 时打不到）。
    st = aim_at(pg, 1, 120)
    print('R4 机位:', st, flush=True)
    assert st['alive'], ('R4: 目标不应处于非存活态', st)
    pg.wait_for_timeout(500)
    fire = pg.evaluate("""() => {
        const r = __dbg.rig;
        r.hfAmmo = Math.max(r.hfAmmo, 1);
        const n0 = r.flying.length;
        const ok = r.launchHf();
        const f = r.flying[r.flying.length - 1];
        return { ok: ok, added: r.flying.length - n0, air: !!(f && f.air),
                 label: f && f.tgt ? f.tgt.label : null,
                 idx: f && f.tgt ? __dbg.air.list.indexOf(f.tgt) : -1 };
    }""")
    print('R4 发射:', fire, flush=True)
    assert fire['ok'] and fire['added'] == 1, ('R4: 地狱火未发射', fire)
    assert fire['air'] and fire['idx'] >= 0, ('R4: 未锁定空中目标', fire)
    pg.wait_for_timeout(6000)          # 120u / 34u/s ≈ 3.6s + 加速段
    after = pg.evaluate("""(i) => { const t = __dbg.air.list[i];
        return { label: t.label, hp: t.hp, alive: t.alive, mode: t.mode }; }""", fire['idx'])
    print('R4 被锁目标 %s 在 120u 发射 6s 后: %s' % (fire['label'], after), flush=True)
    assert (not after['alive']), ('R4: 120u 处地狱火仍未击落被锁目标（回收阈值回归）', after)


H.guarded_main(run, hard_timeout=240)
