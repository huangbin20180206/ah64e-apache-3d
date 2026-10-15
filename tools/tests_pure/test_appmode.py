# -*- coding: utf-8 -*-
# 70-appmode.js 初始模式决策（P1 主菜单 / 展示 / 游戏）——纯逻辑，无浏览器
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def test_app_mode_from_url():
    r = subprocess.run(["node", str(HERE / "appmode_drive.js")], capture_output=True, text=True,
                       timeout=60, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    # 无参数=主菜单；自动化(webdriver)=legacy all；nolaunch=all；launch=1 强制菜单；
    # #show/#play 直达（优先于一切）；未知 hash 回菜单
    assert json.loads(r.stdout) == ['menu', 'all', 'all', 'menu', 'show', 'play', 'menu', 'menu']
