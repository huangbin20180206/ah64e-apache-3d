# -*- coding: utf-8 -*-
# probe_pixdiff.py — C 组合批"同画面"像素级自证（基线构建 vs 本批构建）
# 用法： uv run --with playwright --with pillow python tools/probe_pixdiff.py <base_url> <wt_url>
# 原理：两页独立加载同一资产（rnd 固定种子，贴图/布局逐位一致），悬停一律
# FLY.fp=true 让位钉死高度、orbit 目标量设死、S.time 对齐到同值后再截图——
# 剩余差异只剩 rAF 相位（水面微波/天空云的 uTime 高频项，量级 <1 帧相位差）。
# 判定：desert/pad 场景差异像素（|Δ灰度|>6/255）占比 <1.5%；
# water-night 场景放宽到 5%（信标脉冲相位 + 倒影微波），并输出拼接图人工复核。
import json
import sys

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

SCENES = [
    # (场地, 环境, 悬停高度, 容差%)
    ('desert', 'day', 14, 1.5),      # C2 靶标合批 + C3 残骸（无残骸态先测合批本体）
    ('pad', 'day', 14, 1.5),         # 基础场景（停机坪标线 + 机体 + 池隐藏态）
    ('water', 'day', 14, 2.5),       # C1 镜像合并（倒影波纹相位差宽 1%）
    ('water', 'night', 14, 5.0),     # C1 + bindMirror 灯珠倒影（信标脉冲相位）
]


def setup_page(pg, terrain, env, alt):
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terrain)
    pg.evaluate("document.querySelector('#env-row [data-env=\"%s\"]').click()" % env)
    pg.evaluate("""((alt) => { const F=__dbg.FLY; F.state='hover'; F.alt=alt; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=true;
      __dbg.S._alt=0; __dbg.S.running=true; __dbg.S._guide=0;
      const o=__dbg.orbit; o.tTheta=0.9; o.tPhi=1.25; o.tDist=64; o.auto=false; })()""", alt)


def main(base_url, wt_url, out='pixdiff_out.json'):
    report = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            '--use-angle=d3d11',
            '--disable-backgrounding-occluded-windows',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion'])
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        pa, pb = ctx.new_page(), ctx.new_page()
        for pg in (pa, pb):
            pg.goto((base_url if pg is pa else wt_url) + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.samwar)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
        for terrain, env, alt, tol in SCENES:
            for pg in (pa, pb):
                setup_page(pg, terrain, env, alt)
                pg.wait_for_timeout(1800)   # 场地/环境切换稳定
            # S.time 对齐后再各等 2 帧，把相位差压到一帧以内
            pa.evaluate("__dbg.S.time = 500")
            pb.evaluate("__dbg.S.time = 500")
            pa.wait_for_timeout(80)
            pb.wait_for_timeout(80)
            sa = pa.screenshot()
            sb = pb.screenshot()
            ia, ib = Image.frombuffer('RGB', (1280, 800), sa, 'raw', 'RGB', 0, 1), \
                     Image.frombuffer('RGB', (1280, 800), sb, 'raw', 'RGB', 0, 1)
            ga, gbb = ia.convert('L'), ib.convert('L')
            diff = ImageChops.difference(ga, gbb)
            hist = diff.histogram()
            total = 1280 * 800
            changed = sum(hist[7:])          # |Δ|>6/255
            pct = changed / total * 100
            # 拼接图：基线 | 本批 | 差异热区
            hot = diff.point(lambda v: v and min(255, v * 6))
            row = Image.new('RGB', (1280 * 3, 800))
            row.paste(ia, (0, 0)); row.paste(ib, (1280, 0)); row.paste(hot.convert('RGB'), (1280 * 2, 0))
            name = 'pixdiff_%s_%s.jpg' % (terrain, env)
            row.save(name, quality=80)
            report['%s-%s' % (terrain, env)] = {
                'diff_pct': round(pct, 3), 'tolerance_pct': tol,
                'pass': pct < tol, 'shot': name,
            }
            print('%s-%s: diff=%.3f%% (tol %.1f%%) -> %s' % (terrain, env, pct, tol, 'PASS' if pct < tol else 'FAIL'))
        browser.close()
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print('pixdiff ->', out)
    return 0 if all(v['pass'] for v in report.values()) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
