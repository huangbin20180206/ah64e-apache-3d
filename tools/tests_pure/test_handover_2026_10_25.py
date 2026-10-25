# 接手批（2026-10-25）回归守护
import re, pathlib
A = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'app'
def _r(f): return (A / f).read_text(encoding='utf-8')

def test_hf_mount_follows_checkbox():
    """地狱火打光后重开：挂载判据必须读面板勾选，不能读"挂架里还有没有未发射节点"（打光后恒为假）。"""
    m = re.search(r"function applyVariantAmmo\(\)\s*\{([\s\S]{0,1200}?)\n\}", _r('70-mission.js'))
    assert m and "UI('chk-hellfire')" in m.group(1)
    assert 'rig.launched.has' not in m.group(1)

def test_panel_shift_throttled():
    """展示模式面板偏移：getBoundingClientRect 只在 _panelWant 里，且按 0.1s 节流调用。"""
    js = _r('70-loop.js')
    body = re.search(r"function _panelShift\(dt\)\s*\{([\s\S]*?)\n\}", js).group(1)
    assert 'getBoundingClientRect' not in body and '_PS.acc >= 0.1' in body

def test_no_duplicate_dbg_keys():
    """__dbg 对象不得有重复 getter（JS 重复键不报错，易藏错）。"""
    js = _r('72-uibind.js')
    i = js.index('window.__dbg = {'); seg = js[i:i+6000]
    names = re.findall(r"get (\w+)\(\)", seg)
    assert len(names) == len(set(names)), [n for n in names if names.count(n) > 1]

def test_scenery_chunk_guard():
    assert "map_fragment" in _r('31-scenery.js') and 'console.warn' in _r('31-scenery.js')
