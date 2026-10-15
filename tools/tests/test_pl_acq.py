# -*- coding: utf-8 -*-
# 确定性回归：Pointer Lock acquisition generation 状态机（修复一·真实拒绝版）
# mock canvas.requestPointerLock() 返回可控 Promise，直接驱动 rejection 路径：
#   A) 当前请求 rejection 后，对应 acquisition 被清空（enter 路径）
#   B) 请求 A 尚未 rejection 时建立请求 B（重新捕获按钮），随后 A 迟到
#      rejection，不得清除 B
#   C) B 的 rejection 只清除 B
#   D) 重新捕获按钮走相同规则（按钮请求 rejection 也按 gen 匹配清理本次
#      acquisition）
#   E) 保留 mousemove/change 两种事件顺序（先 move 后 change / 先 change 后
#      move）与"同次 acquisition 不二次 re-arm"断言
# 测试不使用"直接写 _plAcq=null"代替 rejection catch——所有 acquisition 状态
# 变化一律经 产品路径（enter/_armPlAcq/按钮/mock rejection/pointerlockchange）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

SENS = 0.004   # 默认灵敏度（enter 时 sens = 0.004 * (S.fpSens||1)；测试前置 fpSens=1）

def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.fp && __dbg.apache", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 前置：强制悬停 + 显式 sens
    pg.evaluate("""() => {
      __dbg.S.running = true; __dbg.S.fpSens = 1;
      __dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true;
      __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0;
      __dbg.FLY.comp=0; __dbg.S._alt=0;
    }""")
    pg.wait_for_timeout(400)

    # ============ mock：canvas.requestPointerLock 返回可控 Promise ============
    # 每次调用记录 {acq（调用瞬间 _plAcq=本次 token）, acqGen, reject/resolve}，
    # 测试按索引 resolve/reject 该请求；promise 保持 pending 时不触发任何
    # rejection 路径（不 resolve 就不产生 pointerlockchange 副作用）。
    pg.evaluate("""() => {
      if (window.__plMockInstalled) return;
      const canvas = document.querySelector('canvas');
      window.__plMock = [];
      canvas.requestPointerLock = () => {
        const rec = { acq: null, acqGen: null, promise: null, reject: null, resolve: null };
        rec.acq = __dbg.fp ? __dbg.fp._plAcq : null;   // 调用瞬间的 acquisition token
        rec.acqGen = rec.acq ? rec.acq.gen : null;
        rec.promise = new Promise((res, rej) => { rec.resolve = res; rec.reject = rej; });
        window.__plMock.push(rec);
        return rec.promise;
      };
      window.__plMockInstalled = true;
    }""")
    # 伪造 pointerLockElement 为可写（供 E 场景 dispatch pointerlockchange）
    pg.evaluate("""() => {
      Object.defineProperty(document, 'pointerLockElement', {
        configurable: true, enumerable: true, get: () => window.__fakePL || null });
    }""")

    def set_pl(v):
        pg.evaluate("window.__fakePL = %s" % ('document.querySelector("canvas")' if v else 'null'))

    def read():
        return pg.evaluate("""() => {
          const fp = __dbg.fp;
          return { acq: fp._plAcq ? {state: fp._plAcq.state, gen: fp._plAcq.gen} : null,
                   vYaw: +fp.vYaw.toFixed(4), vPitch: +fp.vPitch.toFixed(4),
                   gen: fp._plGen, mockN: window.__plMock ? window.__plMock.length : 0 };
        }""")

    def click_recapture():
        pg.evaluate("document.getElementById('fp-recapture').click()")

    def pl_reject(idx):
        # reject 触发产品 catch（gen 匹配才清）；rejection handler 在微任务
        # 执行，调用后由调用方 wait_for 断言结果
        pg.evaluate("window.__plMock[%d].reject(new DOMException('denied','SecurityError'))" % idx)

    def dispatch_pl(locked):
        set_pl(locked)
        pg.evaluate("document.dispatchEvent(new Event('pointerlockchange'))")

    def assert_acq_null(label):
        pg.wait_for_function("() => !__dbg.fp._plAcq", timeout=3000)
        assert read()['acq'] is None, label

    def assert_acq_gen(gen, label):
        pg.wait_for_function("g => __dbg.fp._plAcq && __dbg.fp._plAcq.gen === g", arg=gen, timeout=3000)
        assert read()['acq'] and read()['acq']['gen'] == gen, (label, read())

    # ============ 进入 FPV（enter 走 mock 请求 idx0，pending 不拒绝）============
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_timeout(400)
    s0 = read()
    assert s0['acq'] and s0['acq']['state'] == 'armed', ('enter 预 arm 应 armed', s0)
    assert s0['mockN'] == 1, ('enter 应产生 1 次 requestPointerLock', s0)
    assert s0['acq']['gen'] == s0['gen'], ('enter 的 token gen 应等于 _plGen', s0)

    # ============ E1) mousemove 先于 pointerlockchange（保留原 A 段）============
    vYaw0, vPitch0 = s0['vYaw'], s0['vPitch']
    pg.evaluate("__dbg.fp.mouse(-640, -640)")          # 首条大幅异常 mousemove：隔离+consumed
    s1 = read()
    assert s1['acq']['state'] == 'consumed', ('E1: 首帧后应 consumed', s1)
    assert abs(s1['vYaw'] - vYaw0) < 1e-9 and abs(s1['vPitch'] - vPitch0) < 1e-9, (
        'E1: 巨幅首帧应被隔离（vYaw/vPitch 不变）', s0, s1)
    dispatch_pl(True)                                   # pointerlockchange：已 consumed 不得重 arm
    s2 = read()
    assert s2['acq']['state'] == 'consumed', ('E1: pointerlockchange 不得重新 arm', s2)
    pg.evaluate("__dbg.fp.mouse(150, -100)")           # 合法但 >120px 快速输入：必须生效
    s3 = read()
    expYaw = vYaw0 - 150 * SENS
    expPitch = max(-1.05, min(1.55, vPitch0 - (-100) * SENS))
    assert abs(s3['vYaw'] - expYaw) < 0.001, ('E1: 合法 >120px 输入应改变 vYaw', s3, expYaw)
    assert abs(s3['vPitch'] - expPitch) < 0.001, ('E1: 合法输入应改变 vPitch', s3, expPitch)
    print('E1(mousemove先于change) OK: 巨幅隔离→consumed→不重arm→合法150px生效')

    # ============ E2) change 先于 mousemove（保留原 B 段；新 acq 经按钮建立）============
    dispatch_pl(False)                                  # 释放锁定 → unlocked 清理（语义不变）
    assert_acq_null('E2: 释放后 acq 应清空')
    click_recapture()                                   # 按钮新请求（mock idx1）
    pg.wait_for_function("() => window.__plMock.length === 2", timeout=3000)
    s0b = read()
    assert s0b['acq'] and s0b['acq']['state'] == 'armed', ('E2: 应 armed', s0b)
    genB = s0b['acq']['gen']
    dispatch_pl(True)                                   # change 先到：保持 armed
    s1b = read()
    assert s1b['acq']['state'] == 'armed', ('E2: change先到保持 armed', s1b)
    assert s1b['acq']['gen'] == genB, ('E2: 同一次 acquisition gen 不变', s1b)
    pg.evaluate("__dbg.fp.mouse(640, 300)")            # 巨幅 mousemove：隔离+consumed
    s2b = read()
    assert s2b['acq']['state'] == 'consumed', ('E2: 首帧后应 consumed', s2b)
    assert abs(s2b['vYaw'] - s1b['vYaw']) < 1e-9, ('E2: 巨幅应隔离', s1b, s2b)
    dispatch_pl(True)                                   # 重复 change：不得重新 arm
    s3b = read()
    assert s3b['acq']['state'] == 'consumed', ('E2: 重复 change 不得重 arm', s3b)
    pg.evaluate("__dbg.fp.mouse(80, 0)")               # 合法输入生效
    s4b = read()
    assert abs(s4b['vYaw'] - (s3b['vYaw'] - 80 * SENS)) < 0.001, ('E2: 合法输入生效', s3b, s4b)
    print('E2(change先到) OK: armed保持→巨幅隔离→重复change不重arm→合法80px生效')

    # ============ A) 当前请求 rejection → 对应 acquisition 清空（enter 路径）============
    # enter 的请求 idx0 此刻仍在 pending（mock 未 resolve/reject）——迟到拒绝它：
    # 当前 _plAcq 已因 E2 的按钮请求（idx1）成为新 gen，idx0 属"旧请求迟到
    # rejection"——必须先验证旧请求迟到 rejection 不清新 acquisition（B 场景），
    # 再单独构造"当前请求 rejection"场景（A）。
    # —— B) A 迟到 rejection 不清更新的 B（idx0=请求A，idx1=请求B，B 未拒绝）——
    pl_reject(0)                                        # 拒绝请求 A（enter 的 idx0）
    assert_acq_gen(genB, 'B: A 迟到 rejection 不得清除 B')
    print('B(迟到rejection) OK: 请求A(idx0) 迟到拒绝后 acquisition B 仍存在(gen=%d)' % genB)

    # —— C) B 的 rejection 只清 B ——
    pl_reject(1)                                        # 拒绝请求 B（idx1 = 当前 acquisition）
    assert_acq_null('C: B rejection 后 acquisition 清空')
    print('C(B rejection) OK: 当前请求(idx1) rejection 后 acquisition 清空')

    # —— A) 当前请求 rejection 后清空（新请求构造，enter 路径语义）——
    click_recapture()                                   # 新请求 idx2（gen 递增）
    pg.wait_for_function("() => window.__plMock.length === 3", timeout=3000)
    sA = read()
    assert sA['acq'] and sA['acq']['state'] == 'armed', ('A: 新请求应 armed', sA)
    genA = sA['acq']['gen']
    pl_reject(2)                                        # 拒绝当前请求
    assert_acq_null('A: 当前请求 rejection 后 acquisition 清空')
    assert read()['gen'] == genA, ('A: gen 不因 rejection 回退', read())
    print('A(当前rejection) OK: 请求 idx2(gen=%d) 拒绝后 acquisition 清空' % genA)

    # —— D) 重新捕获按钮 rejection 同规则（按钮请求即 idx2，已被清；再验一次）——
    click_recapture()                                   # 新请求 idx3
    pg.wait_for_function("() => window.__plMock.length === 4", timeout=3000)
    sD = read()
    assert sD['acq'] and sD['acq']['state'] == 'armed', ('D: 按钮新请求应 armed', sD)
    genD = sD['acq']['gen']
    pl_reject(3)                                        # 按钮请求 rejection
    assert_acq_null('D: 按钮请求 rejection 后 acquisition 清空')
    assert read()['gen'] == genD, ('D: gen 不因 rejection 回退', read())
    print('D(按钮rejection) OK: 重新捕获按钮请求(gen=%d) 拒绝后 acquisition 清空' % genD)

    # ============ E3) 释放清空 + 重新 request 建立新 acq（gen 递增，新 acq 隔离自己首帧）============
    dispatch_pl(False)                                  # 释放：unlocked 清理（此时本就 null，幂等）
    click_recapture()                                   # 新请求 idx4
    pg.wait_for_function("() => window.__plMock.length === 5", timeout=3000)
    s0c = read()
    assert s0c['acq'] and s0c['acq']['state'] == 'armed', ('E3: 新 acq 应 armed', s0c)
    assert s0c['acq']['gen'] > genD, ('E3: gen 应递增', genD, s0c['acq']['gen'])
    v0c = s0c['vYaw']
    pg.evaluate("__dbg.fp.mouse(-500, 0)")             # 新 acq 自己的巨幅首帧仍被隔离
    s1c = read()
    assert s1c['acq']['state'] == 'consumed', ('E3: 新 acq 首帧后 consumed', s1c)
    assert abs(s1c['vYaw'] - v0c) < 1e-9, ('E3: 新 acq 巨幅首帧应隔离', s1c)
    pg.evaluate("__dbg.fp.mouse(40, 0)")               # 随后合法输入生效
    s2c = read()
    assert abs(s2c['vYaw'] - (v0c - 40 * SENS)) < 0.001, ('E3: 合法输入生效', s1c, s2c)
    print('E3(释放/重新request) OK: 释放清空→gen 递增→新 acq 隔离自己首帧')

    # 退出 FPV：exit 清理 acquisition 语义不变
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=8000)
    assert_acq_null('exit 后 acq 应清空')
    print('exit 清空 OK')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')
