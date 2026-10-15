# tools/tests/run_all.py — 跨平台全量回归入口（本地/CI 共用 test-manifest.json）
# 用法: uv run --with playwright [--with pillow] python tools/tests/run_all.py
# 前置：静态服务已在 APACHE_TEST_URL（默认 http://localhost:8642）运行。
# 职责：按清单串行运行全部浏览器测试，汇总退出码，非零即门禁失败。
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, 'test-manifest.json')

def main():
    with open(MANIFEST, encoding='utf-8-sig') as f:   # utf-8-sig 兼容 BOM
        manifest = json.load(f)
    tests = manifest['tests']
    fail = []
    for t in tests:
        name = t['name']
        print(f'===== {name} =====', flush=True)
        code = subprocess.call([sys.executable, os.path.join(HERE, f'{name}.py')])
        status = 'PASS' if code == 0 else 'FAIL'
        print(f'--- {name} -> {status} (exit {code}) ---', flush=True)
        if code != 0:
            fail.append(name)
    print(f'\nREGRESSION RESULT: {len(tests) - len(fail)}/{len(tests)} PASS', flush=True)
    if fail:
        print('FAILED:', ', '.join(fail), flush=True)
        sys.exit(1)
    print('ALL PASS', flush=True)
    sys.exit(0)

if __name__ == '__main__':
    main()
