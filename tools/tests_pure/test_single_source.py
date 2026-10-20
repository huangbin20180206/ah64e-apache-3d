# -*- coding: utf-8 -*-
# opt1（2026-10-20）：业务规则"只写一份"守护——源码级断言，防止规则再被抄成两份
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "src" / "app"


def _src(name):
    return (APP / name).read_text(encoding="utf-8")


def _variant_keys():
    s = _src("70-mission.js")
    body = s[s.index("const MISSION_VARIANTS = {"):]
    body = body[:body.index("\n};")]
    return set(re.findall(r"^  ([a-z_]+):\s*\{", body, re.M))


def test_arcade_variant_keys_subset_of_mission_variants():
    keys = _variant_keys()
    m = re.search(r"const MISSION_VARIANT_KEYS = \[([^\]]*)\]", _src("83-arcade.js"))
    arc = set(re.findall(r"'([a-z_]+)'", m.group(1)))
    assert arc and arc <= keys, arc - keys


def test_rating_curve_single_source():
    s = _src("70-mission.js")
    fn = s[s.index("function missionRating("):]
    fn = fn[:fn.index("\n}")]
    assert "HOST.baseGrade" in fn
    assert not re.search(r"elapsed\s*<\s*\d", fn), "missionRating 又写死了曲线数字"
    assert "HOST.baseGrade = baseGrade" in _src("90-campaign.js")


def test_variant_goal_single_source():
    s = _src("70-mission.js")
    cm = s[s.index("function completeMission()"):]
    cm = cm[:cm.index("m.done = true;")]
    assert "variantGoalMet(m)" in cm
    assert "m.variant ===" not in cm, "completeMission 又出现逐变体判定，应写进 variantGoalMet"
    goal = s[s.index("function variantGoalMet("):]
    goal = goal[:goal.index("\n}")]
    keys = _variant_keys()
    for k in re.findall(r"case '([a-z_]+)'", goal):
        assert k in keys, k
