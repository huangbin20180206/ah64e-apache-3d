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

def _balanced_seg(js, start_marker):
    """取 start_marker 之后到对应花括号平衡（计 0）的片段——
    固定字符窗口会随对象增长漏守尾部键（2026-10-26 审核修正 305dc4f 的 6000 字符窗口）。"""
    i = js.index(start_marker)
    j = js.index('{', i)
    depth = 0
    for k in range(j, len(js)):
        if js[k] == '{': depth += 1
        elif js[k] == '}':
            depth -= 1
            if depth == 0: return js[j:k+1]
    return js[j:]

def test_no_duplicate_dbg_keys():
    """__dbg 对象不得有重复 getter（JS 重复键不报错，易藏错）。窗口=整个对象（花括号平衡），非固定长度。"""
    seg = _balanced_seg(_r('72-uibind.js'), 'window.__dbg = {')
    names = re.findall(r"get (\w+)\(\)", seg)
    assert len(names) == len(set(names)), [n for n in names if names.count(n) > 1]
    assert 'get samwar()' in seg   # 反向验证锚点：确认窗口确实覆盖到对象尾部既有键

def test_scenery_chunk_guard():
    assert "map_fragment" in _r('31-scenery.js') and 'console.warn' in _r('31-scenery.js')
