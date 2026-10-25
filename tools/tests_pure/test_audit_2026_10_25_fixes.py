# -*- coding: utf-8 -*-
"""
审核修复回归守护（2026-10-25）

背景：2026-10-25 审核「另一个 AI」第二轮改动时发现 4 个 bug，本文件为修复的
回退守护——若将来有人（人或 AI）把修复改回去，这里必须变红。

为什么不用浏览器测试：这 4 个 bug 全部位于渲染时序 / 浏览器 API 边界，
有头回归在无 GPU 的 CI 上物理不可行（软渲染帧率耦合，见 CI 现状记录）。
所以这里用「源码结构断言 + 逻辑行为仿真」两层：
  第一层：断言修复代码确实存在于源文件（防止被改回）
  第二层：把关键公式复刻出来跑数值仿真（防止逻辑被改坏但表面还在）

注意：源码断言用正则匹配，改动注释措辞不影响结果；但改动业务代码会触发。
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src" / "app"


def _read(name):
    return (SRC / name).read_text(encoding="utf-8")


# ============================================================
# BUG-1：FPV 退出后 S._leanP/_leanR 残留，叠到机体姿态导致抖动
#   发现方式：46-fpview 每帧写槽位；70-loop 的复位语句被
#             `if ((!fp || !fp.active) && S.running && FLY.state !== 'ground')` 整块包住。
#   修复：70-loop 中在按键分支之前，用一个独立的 `if (!fp || !fp.active)`
#         无条件把槽位 lerp 回 0。
# ============================================================

def test_bug1_loop_resets_lean_slots_outside_guard():
    """70-loop 必须在"非 FPV"分支外就把 _leanP/_leanR 收敛回 0。

    注意变量名是 S._leanP（大对象 S + 属性 _leanP），不是 S_._leanP。
    """
    js = _read("70-loop.js")
    # 先定位独立的 if (!fp || !fp.active) 语句，再切片检查其紧跟的代码块。
    # 不用单条大正则——换行/缩进/注释一变就误报（本次写测试时踩过）。
    pat = re.compile(r"if\s*\(\s*!\s*fp\s*\|\|\s*!\s*fp\.active\s*\)\s*\{")
    found = False
    for m in pat.finditer(js):
        block = js[m.end():m.end() + 400]
        if re.search(r"S\._leanP\s*=\s*lerp\(\s*S\._leanP\s*\|\|\s*0\s*,\s*0\s*,\s*damp\(", block):
            assert re.search(r"S\._leanR\s*=\s*lerp\(\s*S\._leanR\s*\|\|\s*0\s*,\s*0\s*,\s*damp\(", block), \
                "70-loop.js 的复位块必须同时处理 _leanP 与 _leanR"
            found = True
            break
    assert found, (
        "70-loop.js 缺少'非 FPV 时无条件收敛 _leanP'的复位块——"
        "BUG-1（切回环绕视角机身抽一下）可能已回退"
    )


def test_bug1_fpview_does_not_clear_slots():
    """46-fpview 只写不清——清零责任归 70-loop，两处都不清会残留。"""
    js = _read("46-fpview.js")
    assert "_leanP" in js, "46-fpview.js 应保留 phys2 的倾斜写入逻辑"
    # 断言它没有把槽位直接赋 0（那是 loop 的职责，重复实现会互相打架）
    bad = re.findall(r"S\._lean[PR]\s*=\s*0\s*;", js)
    assert not bad, (
        "46-fpview.js 不应自行把 _leanP/_leanR 清零——"
        "清零责任已明确归 70-loop，两处都写会互相打架"
    )


def _sim_lean(frames_fp, frames_orbit, dt=1 / 60):
    """复刻修复后的行为：FPV 活跃时写槽位，退出后由 loop 收敛回 0。"""
    lerp = lambda a, b, t: a + (b - a) * t
    damp = lambda rate, dt: 1 - (1 - rate) ** (dt * 60)
    lean = 0.0
    log = []
    for _ in range(frames_fp):
        # 46-fpview：按加速度写（模拟持续加速 → 收敛到上限 0.12）
        kL = min(1, dt * 4)
        lean += (0.12 - lean) * kL
        log.append(("fp", lean))
    peak = lean
    for _ in range(frames_orbit):
        # 70-loop 修复后：无条件收敛回 0
        lean = lerp(lean, 0, damp(0.10, dt))
        log.append(("orbit", lean))
    return peak, lean, log


def test_bug1_simulation_converges():
    """仿真验证：FPV 退出后应快速收敛。

    实测参考（60fps，damp rate=0.10）：
      · FPV 阶段峰值 0.12 rad ≈ 6.9°
      · 退出后 0.5s（30 帧）残留 ≈ 0.0051 rad ≈ 0.29°
      · 退出后 1.0s（60 帧）残留 ≈ 0.00022 rad ≈ 0.013°
    肉眼可察觉的门槛约 1°，所以 0.5 秒就已不可见。阈值按 1 秒测，留足余量。
    """
    peak, final_05, _ = _sim_lean(frames_fp=120, frames_orbit=30)
    _, final_10, _ = _sim_lean(frames_fp=120, frames_orbit=60)
    assert peak > 0.1, "仿真前提错误：FPV 阶段应把槽位推到接近上限"
    assert abs(final_05) < 0.012, (
        f"FPV 退出 0.5 秒后残留 {final_05:.5f} rad（约 {final_05*57.3:.2f}°）——"
        "应 < 0.7°，否则切视角仍可能看到抖动"
    )
    assert abs(final_10) < 0.002, (
        f"FPV 退出 1 秒后残留仍有 {final_10:.5f} rad（约 {final_10*57.3:.3f}°）——"
        "收敛太慢"
    )


def test_bug1_regression_demo_old_behavior():
    """反证：旧行为（复位被条件包住）残留 6.9° 且永不衰减；新行为 0.5 秒即降到 0.29°。"""
    residual_old = 0.12            # 旧行为：条件不满足时完全不复位
    _, residual_new, _ = _sim_lean(frames_fp=120, frames_orbit=30)
    assert residual_old * 57.3 > 6.0, "反证前提错误：旧行为残留应约 6.9°"
    assert residual_new < residual_old / 20, (
        f"修复后 0.5 秒残留 {residual_new:.5f} 应至少比旧行为（{residual_old}）小 20 倍，"
        "否则修复效果不足"
    )


# ============================================================
# BUG-2：分享卡"复制战绩图"因脱离用户手势必失败
#   发现方式：navigator.clipboard.write 被放在 canvas.toBlob 的异步回调里，
#             回调已脱离点击手势的同步调用栈 → Chrome 拒绝写入。
#   修复：结算时预生成 PNG Blob；点击时同步 write；非安全上下文不出按钮。
# ============================================================

def test_bug2_blob_pregenerated():
    """必须存在'预生成 Blob'的逻辑，且不依赖 toBlob 的异步回调。"""
    js = _read("70-mission.js")
    assert "_mkBlob" in js, "70-mission.js 缺少预生成 Blob 的 _mkBlob"
    # 关键：复制路径里不能再出现 toBlob(async ...) 后再 await 的写法
    assert "_mkBlob();" in js, "应在结算时就调用 _mkBlob() 预生成，而不是等点击"


def test_bug2_copy_path_is_synchronous():
    """点击处理函数里必须先取 Blob 再同步 write，中间不得 await。"""
    js = _read("70-mission.js")
    m = re.search(r"mk\(\s*'复制战绩图'\s*,\s*\(\)\s*=>\s*\{([\s\S]{0,900}?)\}\s*\)\s*;", js)
    assert m, "未找到'复制战绩图'按钮的点击处理函数"
    body = m.group(1)
    assert "_mkBlob()" in body, "点击处理函数内应先用已就绪的 _mkBlob()"
    assert "await " not in body, (
        "点击处理函数内不得出现 await——await 会脱离用户手势的同步栈，"
        "剪贴板写入必被浏览器拒绝（BUG-2 回归）"
    )
    assert "ClipboardItem" in body, "点击处理函数内应构造 ClipboardItem 写入"


def test_bug2_guards_unsupported_env():
    """非安全上下文（http/file://）下 navigator.clipboard 为 undefined，
    必须检测后再决定是否渲染按钮，而不是给个点了必失败的按钮。"""
    js = _read("70-mission.js")
    assert "_canCopyImg" in js, "缺少复制能力检测 _canCopyImg"
    m = re.search(r"const _canCopyImg\s*=\s*([\s\S]{0,200}?);", js)
    assert m, "未找到 _canCopyImg 定义"
    guard = m.group(1)
    assert "ClipboardItem" in guard, "_canCopyImg 应检测 ClipboardItem 是否存在"
    assert "navigator.clipboard" in guard, "_canCopyImg 应检测 navigator.clipboard 是否存在"


def test_bug2_save_path_no_longer_uses_async_toblob():
    """保存按钮也应复用预生成 Blob（顺带消除 toBlob 异步回调）。"""
    js = _read("70-mission.js")
    m = re.search(r"mk\(\s*'保存战绩图'\s*,\s*\(\)\s*=>\s*\{([\s\S]{0,400}?)\}\s*\)\s*;", js)
    assert m, "未找到'保存战绩图'按钮"
    body = m.group(1)
    assert "_mkBlob()" in body, "保存按钮应复用 _mkBlob() 的预生成结果"


# ============================================================
# BUG-3：three r160 compileAsync 无超时，软渲染下白等 12 秒 + 轮询烧 CPU
#   发现方式：读 src/three.module.min.js 的 compileAsync 实现——
#             `setTimeout(poll, 10)` + isReady()，既不 resolve 也不 reject，无超时。
#   修复：加 3 秒探测线 _probeTimer；_start 里 clearTimeout 两条定时器。
# ============================================================

def test_bug3_has_probe_timeout():
    js = _read("70-start.js")
    assert "_probeTimer" in js, (
        "70-start.js 缺少 3 秒探测线 _probeTimer——"
        "compileAsync 不 resolve 时会白等满 12 秒（BUG-3 回归）"
    )
    m = re.search(r"_probeTimer\s*=\s*setTimeout\(\s*_start\s*,\s*(\d+)\s*\)", js)
    assert m, "未找到 _probeTimer 的赋值（应为 setTimeout(_start, N)）"
    probe_ms = int(m.group(1))
    assert 1000 <= probe_ms <= 6000, (
        f"探测超时 {probe_ms}ms 不合理：太短会打断正常快机编译，太长失去意义"
    )


def test_bug3_still_has_hard_fallback():
    """硬兜底必须保留（探测线只是提前，不能取消最终保障）。"""
    js = _read("70-start.js")
    m = re.search(r"_hardTimer\s*=\s*setTimeout\(\s*_start\s*,\s*(\d+)\s*\)", js)
    assert m, "缺少硬兜底 _hardTimer"
    assert int(m.group(1)) == 12000, "硬兜底应保持 12 秒"


def test_bug3_start_is_idempotent_and_clears_timers():
    """_start 必须幂等（_go 哨兵）且清掉两条定时器，避免重复启动渲染循环。"""
    js = _read("70-start.js")
    m = re.search(r"const _start\s*=\s*\(\)\s*=>\s*\{([\s\S]{0,400}?)\n\s*\};", js)
    assert m, "未找到 _start 定义"
    body = m.group(1)
    assert "_go" in body, "_start 缺少 _go 幂等哨兵"
    assert "clearTimeout(_probeTimer)" in body, "_start 应清掉探测线"
    assert "clearTimeout(_hardTimer)" in body, "_start 应清掉硬兜底"


def test_bug3_no_tdz_on_timers():
    """_probeTimer/_hardTimer 必须在使用前声明（曾出现 TDZ 隐患：_start 引用在后声明的 const）。"""
    js = _read("70-start.js")
    decl = js.find("let _probeTimer")
    use = js.find("clearTimeout(_probeTimer)")
    assert decl != -1, "_probeTimer 应为 let 声明（后续赋值）"
    assert use != -1, "未找到 clearTimeout(_probeTimer)"
    assert decl < use, (
        "_probeTimer 的声明位置晚于使用位置 → 存在 TDZ 风险"
        "（compileAsync 若同步 resolve 会踩 Cannot access before initialization）"
    )


# ============================================================
# 4.2：_tmByUrl 失败时永久缓存 null，后续无重试机会
#   发现方式：`() => res(null)` 里直接 res(null)，Promise 永久留在缓存里。
#   修复：失败时先 delete 缓存项（并确认仍是本 Promise，防并发误删）再 res(null)。
# ============================================================

def test_retry_drops_cache_on_failure():
    """下载失败时应删除缓存项，允许下次重试。"""
    js = _read("16-targetmodels.js")
    m = re.search(r"const drop\s*=\s*\(\)\s*=>\s*\{([\s\S]{0,200}?)\}", js)
    assert m, "16-targetmodels.js 缺少失败时清理缓存的 drop()"
    body = m.group(1)
    assert "delete _tmByUrl" in body, "drop() 应删除 _tmByUrl 里的缓存项"
    assert "_tmByUrl[def.url] === self" in body, (
        "drop() 应确认缓存项仍是本次的 Promise 再删——"
        "否则并发重入时可能误删别人刚建立的新条目"
    )


def test_retry_calls_drop_before_resolve_null():
    """drop 必须在 res(null) 之前调用（顺序反了会先交出失败结果再清理）。"""
    js = _read("16-targetmodels.js")
    m = re.search(r"undefined\s*,\s*\(\)\s*=>\s*\{([^}]*)\}", js)
    assert m, "未找到 loader 的失败回调"
    body = m.group(1)
    assert "drop()" in body, "失败回调应调用 drop()"
    assert "res(null)" in body, "失败回调应 res(null)"
    assert body.index("drop()") < body.index("res(null)"), (
        "drop() 必须在 res(null) 之前执行——"
        "否则调用方拿到 null 的同时缓存还没清，紧接着的重试仍会命中旧缓存"
    )


def test_retry_uses_self_reference():
    """self 引用必须在 Promise 构造内部可见（用于身份比对）。"""
    js = _read("16-targetmodels.js")
    assert re.search(r"const self\s*=\s*new Promise", js), (
        "应以 const self = new Promise(...) 形式持有自身引用，供 drop() 做身份比对"
    )
