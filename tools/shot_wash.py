"""下洗特效视觉验证：有头 Chromium 抓图。
用法：uv run --with playwright python tools/shot_wash.py
输出：shot_wash_<场地>_<高度>.jpg
注意：必须有头模式，headless 走 SwiftShader 只有 ~2FPS，rAF 页面时间远慢于墙上时间。
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8097/"
# (场地键, 机位索引 0=斜后全景 / 1=高俯角, 离地高度 u, 文件名后缀)
# 场地键用 TERRAINS 的键（desert，不是介质名 sand）
SHOTS = [
    ("pad",    0, 0.8,  "pad_low"),
    ("grass",  0, 0.8,  "grass_low"),
    ("grass",  1, 0.8,  "grass_top"),
    ("desert", 0, 1.0,  "sand_low"),
    ("desert", 1, 1.0,  "sand_top"),
    ("desert", 0, 3.0,  "sand_mid"),
    ("water",  0, 0.9,  "water_low"),
    ("water",  1, 0.9,  "water_top"),
]

SETUP = """
() => {
  const d = window.__dbg;
  const panel = document.getElementById('btn-panel');
  if (panel) panel.click();                           // 收起面板露出画面
  const ld = document.getElementById('loading');
  if (ld) ld.style.display = 'none';
  const hint = document.getElementById('hint');       // 首访会自动弹操作说明，挡画面
  if (hint) hint.classList.remove('show');
  const start = document.getElementById('btn-start');
  if (!d.S.running && start) start.click();
  d.S.spin = 1;                                       // 转速直接拉满
  d.FLY.VY = 0.0001;                                  // 冻结爬升，停在指定高度
  window.dispatchEvent(new Event('resize'));          // 确保 canvas 铺满实际视口
  return {
    inner: [innerWidth, innerHeight],
    canvas: [d.renderer.domElement.width, d.renderer.domElement.height],
    terrains: [...document.querySelectorAll('#terrain-row .chip')].map(c => c.dataset.terrain),
    views: document.querySelectorAll('#views div').length,
  };
}
"""

POSE = """
([terrain, view, alt]) => {
  const d = window.__dbg;
  [...document.querySelectorAll('#terrain-row .chip')]
    .find(c => c.dataset.terrain === terrain).click();
  d.FLY.state = 'up';
  d.FLY.alt = alt;
  // 手动设机位：拉远 + 压低俯角，把地面效应完整收进画面
  // view 0 = 斜后方全景（看得到涡环与地面刷痕）；view 1 = 高俯角（看辐条/波环形状）
  const cams = [
    { theta: 0.85, phi: 1.30, dist: 22.0, target: [0, 1.0 + alt * 0.35, 0] },
    { theta: 0.55, phi: 0.62, dist: 26.0, target: [0, 0.6, 0] },
  ];
  d.orbit.flyTo({ ...cams[view], fov: 38 }, 0.01);
  return { medium: d.washfx.medium, alt: d.FLY.alt };
}
"""

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling",
                "--window-position=0,0",
            ],
        )
        page = browser.new_page(viewport={"width": 1366, "height": 820})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(URL)
        # 等 __dbg 出现（GLB 载入完成后才 bindUI）
        page.wait_for_function("() => !!window.__dbg && !!window.__dbg.washfx", timeout=60000)
        print("setup:", page.evaluate(SETUP))
        page.wait_for_timeout(1200)

        for terrain, view, alt, tag in SHOTS:
            page.evaluate(POSE, [terrain, view, alt])
            # 等下洗强度爬满（上升沿 damp 0.16，约 1.5s 到位）+ 机位飞到
            page.wait_for_function(
                "() => window.__dbg.washfx.strength > 0.93", timeout=15000)
            page.wait_for_timeout(1500)
            out = f"shot_wash_{tag}.jpg"
            page.screenshot(path=out, type="jpeg", quality=80)
            st = page.evaluate("() => ({s: window.__dbg.washfx.strength, "
                               "fps: document.querySelector('#hud-fps').textContent})")
            print(f"{out}  strength={st['s']:.3f}  fps={st['fps']}")

        browser.close()
        if errors:
            print("!! console errors:", file=sys.stderr)
            for e in errors[:10]:
                print("  ", e, file=sys.stderr)
            return 1
        print("no console errors")
        return 0

if __name__ == "__main__":
    sys.exit(main())
