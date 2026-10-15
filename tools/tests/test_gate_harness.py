# -*- coding: utf-8 -*-
"""Phase 13 复核二轮：门禁证据绑定自测（快速失败路径 + 证据契约）。

用子进程调用 run_tests.ps1 验证：
  1) 非项目目录调用仍检查 apache_web（toplevel 匹配）；
  2) expected SHA 错误时立即失败；
  3) dirty tracked/untracked 业务文件时立即失败；
  4) 完整门禁产生 evidence-<run_id>.json（含 run_id/起止/逐项/hash）。
注意：本测试只验证前置检查快速路径（不做完整 56 项运行——那由发布门禁承担）。
"""
import json, os, locale, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/tests → tools → apache_web
PS = os.path.join(ROOT, 'tools', 'run_tests.ps1')

# 嵌套门禁的隔离参数（2026-09-17 D3）。此前嵌套门禁用默认 8642 + 权威清单：
#   ① 子门禁启动前"按端口杀残留监听"→ 杀掉**外层**门禁正在用的服务，外层后续
#      测试全部 ERR_CONNECTION_REFUSED 假失败；
#   ② 若脏树检测回归（历史 R28' 真实发生过），子门禁会跑满全量直到 subprocess
#      300s 超时，期间重建 dist/（外层浏览器正在读）、开一堆 Chromium。
# 现在固定换端口 + 空清单：最坏情况只做"构建+起服务+0 测试"（~15s、零浏览器）。
NESTED_PORT = '8651'
NESTED_MANIFEST = os.path.join(ROOT, 'tools', 'tests', 'test-manifest.empty.json')

# PowerShell 子进程的中文输出编码判定：子进程与 python 共享同一控制台时，
# 输出编码跟控制台输出页（GetConsoleOutputCP）走而非系统 ANSI 页（GetACP）
# ——两者在默认控制台会话（cp936）一致，但在 UTF-8 控制台会话（chcp 65001，
# 如某些工具链拉起的 pwsh7 会话）分叉：GetACP 仍回 936 而实际输出 UTF-8，
# 中文断言全部误报 FAIL（2026-09-18 实测：CLI 会话 CP=65001 下 PS5.1 子进程
# [Console]::OutputEncoding=utf-8，GBK 解码得"蹇呴』鎻愪緵"乱码）。先取
# ConsoleOutputCP（进程无控制台时 API 返回 0，回退 GetACP 保持原语义）。
if sys.platform == 'win32':
    import ctypes
    _cp = ctypes.windll.kernel32.GetConsoleOutputCP()
    _PROC_ENC = ('cp%d' % _cp) if _cp else ('cp%d' % ctypes.windll.kernel32.GetACP())
else:
    _PROC_ENC = locale.getpreferredencoding(False) or 'utf-8'


def git(args):
    return subprocess.run(['git'] + args, capture_output=True, text=True, cwd=ROOT)


def run_gate(env_extra, cwd):
    env = dict(os.environ)
    # 先剥掉父环境里的**运行模式**变量：本测试可能被"快跑模式"（APACHE_TEST_ONLY）
    # 或换端口的外层门禁间接拉起，若不剥掉，嵌套门禁会继承外层模式——实测事故：
    # 外层带 APACHE_TEST_ONLY 时嵌套门禁也进快跑模式、脏树被放行（WARN 而非 FATAL），
    # 于是下面的检查 4「脏树必须打回」误报 FAIL。
    for k in ('GATE_EXPECT_SHA', 'GATE_RUN_ID', 'APACHE_TEST_ONLY', 'APACHE_TEST_MANIFEST',
              'APACHE_TEST_PORT', 'APACHE_TEST_URL', 'APACHE_TEST_OUT'):
        env.pop(k, None)
    # 嵌套门禁一律隔离：换端口（不碰外层服务）+ 空清单（不跑测试、不开浏览器）
    env['APACHE_TEST_PORT'] = NESTED_PORT
    env['APACHE_TEST_MANIFEST'] = NESTED_MANIFEST
    env.update(env_extra)
    r = subprocess.run(['powershell', '-NoProfile', '-File', PS],
                       capture_output=True, text=True, encoding=_PROC_ENC, errors='replace',
                       cwd=cwd, env=env, timeout=300)
    return r


def main():
    head = git(['rev-parse', 'HEAD']).stdout.strip()
    assert len(head) == 40, 'HEAD 非 40 位'

    # 1) 非项目目录调用仍检查 apache_web：用错误 SHA 从非项目目录调用——
    #    若 toplevel 匹配失败会先 FATAL toplevel；能走到 "expected SHA" FATAL
    #    即证明 toplevel 精确匹配了 apache_web（快速退出，不触发完整门禁）
    tmp = tempfile.mkdtemp(prefix='gate_harness_')
    env = {'GATE_EXPECT_SHA': '0' * 40, 'APACHE_TEST_OUT': os.path.join(tmp, 'out')}
    r = run_gate(env, tmp)
    out = (r.stdout + r.stderr)
    if 'FATAL: git toplevel' in out:
        print('FAIL: 非项目目录调用未正确绑定 apache_web:', out[:400])
        return 1
    if 'FATAL: expected SHA' not in out or r.returncode == 0:
        print('FAIL: 非项目目录调用未进入 SHA 检查（toplevel 未匹配）:', out[:400])
        return 1
    print('1) 非项目目录调用 toplevel 绑定 OK')

    # 2) 错误 expected SHA → 立即失败
    r = run_gate({'GATE_EXPECT_SHA': '0' * 40, 'APACHE_TEST_OUT': os.path.join(tmp, 'out2')}, ROOT)
    out = r.stdout + r.stderr
    print('  [dbg] rc=%s out_head=%r' % (r.returncode, out[:200]))
    if 'FATAL: expected SHA' not in out or r.returncode == 0:
        print('FAIL: 错误 expected SHA 未失败', out[:400])
        return 1
    print('2) 错误 expected SHA 立即失败 OK')

    # 3) 缺失 expected SHA → 立即失败（强制）
    r = run_gate({'APACHE_TEST_OUT': os.path.join(tmp, 'out3')}, ROOT)
    out = r.stdout + r.stderr
    print('  [dbg3] rc=%s out_head=%r' % (r.returncode, out[:200]))
    if 'GATE_EXPECT_SHA 必须提供' not in out or r.returncode == 0:
        print('FAIL: 缺失 GATE_EXPECT_SHA 未失败', out[:400])
        return 1
    print('3) 缺失 GATE_EXPECT_SHA 强制失败 OK')

    # 4) dirty 业务文件 → 立即失败（未跟踪新文件模拟 dirty）
    #    注意：文件名不能用 _ 前缀——tools/_*.py 已被 .gitignore 接管（2026-09-13
    #    维护补全，含本测试曾用的 _gate_dirty_probe.py），下划线开头会被忽略，
    #    git status 不报脏 → run_tests.ps1 误跑全量 65 项直到 subprocess 300s
    #    超时（R28' 实测捕获此回归）。无下划线文件名不在任何忽略规则内。
    dirty_file = os.path.join(ROOT, 'tools', 'gate_dirty_probe.py')
    with open(dirty_file, 'w', encoding='utf-8') as f:
        f.write('# dirty probe\n')
    try:
        r = run_gate({'GATE_EXPECT_SHA': head, 'APACHE_TEST_OUT': os.path.join(tmp, 'out4')}, ROOT)
        out = r.stdout + r.stderr
        if 'working tree not clean' not in out or r.returncode == 0:
            print('FAIL: dirty 工作树未失败', out[:400])
            return 1
        print('4) dirty 工作树立即失败 OK')
    finally:
        os.remove(dirty_file)

    # 5) 复核一轮项五：dirty_before 快照不可变契约——
    #    a) 静态：run_tests.ps1 必须用 $script: 作用域捕获（不是 $env:），
    #       evidence 必须写 dirty_before_snapshot / dirty_capture_method；
    #    b) 动态：即使父环境设置 GATE_DIRTY_BEFORE 垃圾值，快速失败路径也不被
    #       该环境变量误导（仍走 expected-SHA FATAL，不产生 evidence；说明
    #       dirty 判定来自真实 git status 的 $script: 快照而非环境变量）。
    ps_src = open(os.path.join(ROOT, 'tools', 'run_tests.ps1'), encoding='utf-8').read()
    # 排除注释行（# 开头）：只断言实际代码不引用 $env:GATE_DIRTY_BEFORE
    ps_code = '\n'.join(l for l in ps_src.splitlines() if l.strip() and not l.strip().startswith('#'))
    checks = {
        'script_scope_capture': '$script:GateDirtyBefore = Get-CertDirtyTree' in ps_src,
        'no_env_dirty_before': '$env:GATE_DIRTY_BEFORE' not in ps_code,
        'evidence_snapshot': 'dirty_before_snapshot' in ps_src,
        'evidence_method_note': 'dirty_capture_method' in ps_src,
        # 脏树判据只覆盖被认证集合（src/ build.mjs tools/ dist）——范围外的活文档
        # （CODELY.md 是外部工具的活记忆系统）在运行期间被改，不得作废一轮测试
        'dirty_scoped_to_cert_set': "status --porcelain -- $CERT_PATHS" in ps_src,
        'out_of_scope_recorded': 'dirty_out_of_scope_snapshot' in ps_src,
    }
    print('5) dirty 快照契约:', checks)
    if not all(checks.values()):
        print('FAIL: dirty_before 快照契约缺失（须 $script: 捕获 + evidence 写快照/方法）', checks)
        return 1
    env_dirty = {'GATE_EXPECT_SHA': '0' * 40,
                 'GATE_DIRTY_BEFORE': 'FAKE-DIRTY-FROM-ENV',   # 故意污染环境变量
                 'APACHE_TEST_OUT': os.path.join(tmp, 'out5')}
    r = run_gate(env_dirty, ROOT)
    out = r.stdout + r.stderr
    if 'FATAL: expected SHA' not in out or 'FAKE-DIRTY-FROM-ENV' in out:
        print('FAIL: dirty_before 受环境变量污染影响（$script: 快照未生效）', out[:400])
        return 1
    print('5) dirty_before 环境变量污染免疫 OK（快照来自真实 git status，$script: 不可变）')

    print('门禁证据绑定自测 PASS（前置检查路径 + dirty 快照契约）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
