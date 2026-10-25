# -*- coding: utf-8 -*-
"""
体检修复回归守护（2026-10-25 第二轮：全库体检发现的问题）

与 test_audit_2026_10_25_fixes.py 的分工：
  · 那一个守护「审核另一个 AI 的 13 个提交」时发现的 4 个 bug；
  · 本文件守护「全库体检」发现的另一批问题（评级参数、挂架、单位、重置语义、aniso…）。

为什么用源码结构断言而非浏览器测试：结论与那一份相同——这批问题的验证点集中在
「参数是否真的传进去了」「两条路径是否共用同一份逻辑」「字段是否真被消费」，
用源码断言 + 数值仿真可离线执行、可反向验证，比有头回归更稳定。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src" / "app"


def _read(name):
    return (SRC / name).read_text(encoding="utf-8")


# ============================================================
# 🔴 P0-1：结算评级参数 ammoDry / damage 被行尾注释吞掉
#   发现：70-mission.js 的 campaign.grade({...}) 里 `ammoDry, damage: dmgLv,`
#         写在了 `// P3：…折算用时` 的行尾注释里 = 从未传参。
#         90-campaign.js 里 `ctx.damage || 0` 恒 0、`ctx.ammoDry` 恒 undefined，
#         「机体损伤降档」「弹药耗尽降档」两条规则静默失效。
# ============================================================

def test_grade_receives_ammo_dry_and_damage():
    """campaign.grade 的实参对象里必须真的含 ammoDry 与 damage（未被注释吞掉）。

    判定方式（刻意复刻原 bug 的发现手法）：
      1. 截取 campaign.grade({ ... }) 的实参体；
      2. **逐行剥掉行尾注释**——原 bug 就是键名被 `//` 吃掉了；
      3. 在剥完注释的代码里找键名。
    截取用花括号配对而非正则非贪婪（实参里有对象字面量，非贪婪会截断）。
    """
    js = _read("70-mission.js")
    i = js.find("campaign.grade({")
    assert i != -1, "未找到 campaign.grade({ 调用"
    j = js.index("{", i + len("campaign.grade(") - 1)
    depth, k = 0, j
    while k < len(js):
        if js[k] == "{":
            depth += 1
        elif js[k] == "}":
            depth -= 1
            if depth == 0:
                break
        k += 1
    body = js[j + 1:k]
    assert len(body) > 50, f"实参体截取异常（{len(body)} 字符）"

    code = "\n".join(re.sub(r"//.*$", "", ln) for ln in body.split("\n"))
    assert re.search(r"\bammoDry\b", code), (
        "campaign.grade 的实参里没有 ammoDry（可能又被写进行尾注释）——"
        "弹药耗尽降档规则会静默失效"
    )
    assert re.search(r"\bdamage\s*:\s*dmgLv\b", code), (
        "campaign.grade 的实参里没有 damage: dmgLv（可能又被写进行尾注释）——"
        "机体损伤降档规则会静默失效"
    )


def test_grade_consumer_actually_uses_them():
    """消费方 90-campaign.js 必须真的读 ctx.damage / ctx.ammoDry（双向确认）。"""
    js = _read("90-campaign.js")
    assert re.search(r"ctx\.damage", js), "90-campaign 未读 ctx.damage"
    assert re.search(r"ctx\.ammoDry", js), "90-campaign 未读 ctx.ammoDry"


# ============================================================
# 🔴 P0-2：地狱火挂架用完重开任务不可恢复
#   发现：launchHf 只挑 `o.visible && !launched.has(o)`；8 发打完后挂架全 invisible
#         且全在 launched；applyVariantAmmo 只写 hfAmmo=8，不碰挂架 → 新任务打不出去。
# ============================================================

def test_variant_ammo_goes_through_reload():
    """applyVariantAmmo 必须走 rig.reload 通道（它会清 launched 并恢复挂架可见性）。"""
    js = _read("70-mission.js")
    m = re.search(r"function applyVariantAmmo\(\)\s*\{([\s\S]{0,900}?)\n\}", js)
    assert m, "未找到 applyVariantAmmo 定义"
    body = m.group(1)
    assert "rig.reload(" in body, (
        "applyVariantAmmo 未调用 rig.reload——"
        "只写 hfAmmo 数字会导致挂架仍 invisible/在 launched 里，launchHf 永远返回 false"
    )


def test_reload_clears_launched_and_restores_visibility():
    """reload 必须清 launched 集合并恢复挂架可见性（这是修复依赖的核心契约）。"""
    js = _read("65-weapons.js")
    m = re.search(r"reload\(mountOn\)\s*\{([\s\S]{0,400}?)\n  \}", js)
    assert m, "未找到 reload 定义"
    body = m.group(1)
    assert "this.launched.delete(o)" in body, "reload 应清 launched 集合"
    assert re.search(r"o\.visible\s*=", body), "reload 应恢复挂架可见性"


def test_launchhf_still_requires_visible_and_not_launched():
    """反证前提：launchHf 的挑选条件未变（否则本修复的前提不成立）。"""
    js = _read("65-weapons.js")
    assert "if (o.visible && !this.launched.has(o))" in js, (
        "launchHf 的挑选条件已变——若不再依赖 visible/launched，本修复需重新评估"
    )


def _sim_hf(use_reload: bool):
    """仿真：8 发打光后开新任务，看还能不能发射。

    dict 不可哈希，不能用 set 存挂架对象——改用 id() 模拟 launched 集合。
    """
    class Rig:
        def __init__(self):
            self.hfList = [{"visible": True} for _ in range(8)]
            self.launched = set()          # 存 id()
            self.hfAmmo = 8

        def launch(self):
            for o in self.hfList:
                if o["visible"] and id(o) not in self.launched:
                    self.launched.add(id(o))
                    o["visible"] = False
                    self.hfAmmo -= 1
                    return True
            return False

        def reload(self, mount_on=True):
            self.hfAmmo = 8
            for o in self.hfList:
                self.launched.discard(id(o))
                o["visible"] = mount_on

    r = Rig()
    for _ in range(8):
        assert r.launch() is True, "仿真前提错误：8 发应能连续打光"
    assert r.hfAmmo == 0, "仿真前提错误：8 发应已打光"
    # 开新任务
    if use_reload:
        r.reload(True)
    else:
        r.hfAmmo = 8          # 旧行为：只写数字
    return r.launch()


def test_simulation_reload_path_can_fire_again():
    assert _sim_hf(use_reload=True) is True, "走 reload 通道后应能重新发射"


def test_simulation_old_path_cannot_fire():
    """反证：旧行为（只写 hfAmmo）确实打不出去——说明这个测试抓得住问题。"""
    assert _sim_hf(use_reload=False) is False, (
        "旧行为应表现为「显示有弹但打不出去」——若此处为 True，反证前提不成立"
    )


# ============================================================
# 🟡 P1-1：单位换算统一到 U2M
#   发现：1u=2m 与 1u=2.27m 两套值混用，同一 HUD 上高度与距离读数差 12%。
# ============================================================

def test_u2m_constant_defined_once():
    js = _read("05-config.js")
    assert re.search(r"const U2M\s*=\s*2\.27\s*;", js), "05-config.js 应有 const U2M = 2.27"
    assert re.search(r"const U2M_INV\s*=\s*1\s*/\s*U2M\s*;", js), "05-config.js 应有 U2M_INV = 1/U2M"


def test_no_stale_two_meter_conversion_in_hud_paths():
    """HUD/FPV 等显示路径不得再出现 `* 2` 形式的米制换算。

    注意：`(PI * 2)` / `* 2` 用于角度、索引等非米制场景是合法的，
    所以判定收紧为「与米制读数相关的行」——含 'm' 单位字符串或明确的高度/距离变量。
    """
    bad = []
    for f in ("46-fpview.js", "70-hud.js", "18-audio.js", "48-rescue.js"):
        for n, line in enumerate(_read(f).split("\n"), 1):
            code = re.sub(r"//.*$", "", line)          # 剥掉行尾注释
            if not re.search(r"\*\s*2(?![.\d])", code):
                continue
            # 排除角度/索引等其他语义：只看与米制读数绑定的行
            if re.search(r"PI\s*\*\s*2|\*\s*Math\.PI|% \(|\bidx\b|\bi\s*\*", code):
                continue
            if re.search(r'" m"|\' m\'|m ·|米|dist|alt|agl|rimGap|lockD|\bspd\b', code):
                bad.append(f"{f}:{n}: {code.strip()[:100]}")
    assert not bad, "以下位置仍用字面量 2 做 u→m 换算（应改用 U2M）：\n" + "\n".join(bad)


def test_no_raw_2_27_literals_outside_comments():
    """代码里不得再出现 2.27 / 1/2.27 的字面量（应走 U2M / U2M_INV）。"""
    bad = []
    for p in sorted(SRC.glob("*.js")):
        if p.name == "05-config.js":
            continue            # 常量定义处本身
        for n, line in enumerate(p.read_text(encoding="utf-8").split("\n"), 1):
            code = re.sub(r"//.*$", "", line)
            if re.search(r"2\.27", code):
                bad.append(f"{p.name}:{n}: {code.strip()[:100]}")
    assert not bad, "以下位置仍硬编码 2.27：\n" + "\n".join(bad)


def test_u2m_consumed_by_key_paths():
    """关键显示路径必须真的引用 U2M。"""
    for f in ("46-fpview.js", "70-hud.js", "18-audio.js"):
        assert "U2M" in _read(f), f"{f} 未引用 U2M"


# ============================================================
# 🟡 P1-2：两条重开路径共用同一份场景清理
#   发现：startMission 复位树/步兵/平民/照明弹，resetRange 不复位 → "重置"语义不一致。
# ============================================================

def test_reset_scenario_state_exists_and_exported():
    js = _read("70-mission.js")
    assert re.search(r"function resetScenarioState\(\)", js), "70-mission 应有 resetScenarioState()"
    assert re.search(r"HOST\.resetScenario\s*=\s*resetScenarioState", js), (
        "resetScenarioState 应注册到 HOST.resetScenario 供 72-uibind 调用"
    )


def test_reset_scenario_covers_all_previously_missing_items():
    """曾漏掉的四项必须都在公共清理函数里。"""
    js = _read("70-mission.js")
    m = re.search(r"function resetScenarioState\(\)\s*\{([\s\S]{0,1400}?)\n\}", js)
    assert m, "未找到 resetScenarioState 定义"
    body = m.group(1)
    for item, why in [
        ("scenery.resetTrees", "炸倒/烧焦的树"),
        ("infantry.reset", "死亡/开火中的步兵"),
        ("life.reset", "平民/摩托"),
        ("resetNightOps", "照明弹"),
    ]:
        assert item in body, f"resetScenarioState 缺少 {item}（{why}）的复位"


def test_start_mission_uses_shared_cleanup():
    """startMission 必须改调公共清理，避免两处再分叉。"""
    js = _read("70-mission.js")
    m = re.search(r"function startMission\([\s\S]*?\n\}", js)
    assert m, "未找到 startMission 定义"
    assert "resetScenarioState()" in m.group(0), (
        "startMission 未调用 resetScenarioState——两条重开路径会再次分叉"
    )


def test_reset_range_uses_host_slot():
    """72-uibind 的 resetRange 必须经 HOST.resetScenario 走公共清理。"""
    js = _read("72-uibind.js")
    m = re.search(r"const resetRange\s*=\s*\(\)\s*=>\s*\{([\s\S]{0,900}?)\n  \};", js)
    assert m, "未找到 resetRange 定义"
    body = m.group(1)
    assert "HOST.resetScenario" in body, (
        "resetRange 未走 HOST.resetScenario——此处正是原 bug（漏清树/步兵/照明弹）的发生地"
    )


# ============================================================
# 🟡 P1-3：画质档 aniso 真接入（particles 字段删除）
#   发现（修正后）：aniso 全库无消费（各贴图硬编码 8）；particles 与 effects 语义重复。
# ============================================================

def test_aniso_is_actually_applied():
    js = _read("70-app.js")
    m = re.search(r"function applyQuality\(q\)\s*\{([\s\S]{0,900}?)\n\}", js)
    assert m, "未找到 applyQuality 定义"
    assert "applySceneAniso" in m.group(0), (
        "applyQuality 未调 applySceneAniso——aniso 又变回死配置了"
    )


def test_apply_scene_aniso_defined():
    js = _read("05-config.js")
    assert re.search(r"function applySceneAniso\(", js), "05-config.js 应有 applySceneAniso"
    body = js[js.index("function applySceneAniso("):]
    assert "getMaxAnisotropy" in body, "applySceneAniso 应按 GPU 上限钳制（否则高值在弱卡上无效）"
    assert "traverse" in body, "applySceneAniso 应遍历场景统一设置"


def test_redundant_particles_field_removed():
    """particles 与 effects 语义重复，已删——防止有人再加回来造成双重压降。"""
    js = _read("05-config.js")
    m = re.search(r"const QUALITY_PRESETS\s*=\s*\{([\s\S]*?)\n\};", js)
    assert m, "未找到 QUALITY_PRESETS"
    assert "particles" not in m.group(1), (
        "QUALITY_PRESETS 里又出现了 particles 字段——它与 effects 语义重复，"
        "同时生效会导致低画质档粒子量被压两次"
    )
    assert "effects" in m.group(1), "effects 才是粒子量的真实控制字段，不应被删除"


# ============================================================
# 🟢 P2：damp 守卫 / 死常量 / manifest 标记
# ============================================================

def test_damp_guards_rate():
    js = _read("00-utils.js")
    m = re.search(r"const damp\s*=\s*\(rate,\s*dt\)\s*=>\s*([^;]+);", js)
    assert m, "未找到 damp 定义"
    body = m.group(1)
    assert "clamp(rate" in body, (
        "damp 未对 rate 做钳制——rate ≥ 1 会得负底数的非整数次幂 = NaN（曾只靠注释约定）"
    )


def _damp(rate, dt):
    r = min(max(rate, 0), 0.999)
    return 1 - (1 - r) ** (dt * 60)


def test_damp_simulation_no_nan():
    """仿真：越界 rate 不再产生 NaN。"""
    for bad_rate in (1.0, 1.5, 5.0, -1.0):
        v = _damp(bad_rate, 1 / 60)
        assert v == v, f"rate={bad_rate} 得到 NaN"
        assert 0 <= v <= 1, f"rate={bad_rate} 得到越界值 {v}"


def test_damp_normal_range_unchanged():
    """正常区间行为必须不变（避免修 bug 引入手感变化）。"""
    for rate in (0.05, 0.10, 0.22, 0.30):
        assert abs(_damp(rate, 1 / 60) - (1 - (1 - rate) ** 1.0)) < 1e-12, (
            f"rate={rate} 的常规结果被改变了——不应影响既有调参手感"
        )


def test_mission_timeout_dead_const_removed():
    js = _read("70-mission.js")
    assert not re.search(r"^const MISSION_TIMEOUT\s*=", js, re.M), (
        "MISSION_TIMEOUT 是零引用死常量（实际超时走 MISSION_VARIANTS[].timeout），"
        "留着会误导维护者改它"
    )


def test_manifest_pillow_flag_for_test_desert():
    """test_desert 不用 PIL，manifest 不应标 pillow: true。"""
    mf = json.loads((ROOT / "tools" / "tests" / "test-manifest.json").read_text(encoding="utf-8"))
    for t in mf.get("tests", []):
        if t.get("name") == "test_desert":
            assert not t.get("pillow"), (
                "test-manifest.json 把 test_desert 标为 pillow: true，但该测试不 import PIL"
            )
            return
    raise AssertionError("manifest 里找不到 test_desert")
