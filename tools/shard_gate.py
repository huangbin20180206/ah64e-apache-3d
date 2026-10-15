# -*- coding: utf-8 -*-
"""shard_gate.py — 分片并行门禁总控（2026-09-10，用户要求节省门禁时间）

串行 run_tests.ps1 全量 ~13 分钟且对 CLI 重启零容错（后台门禁被杀即从头再跑）。
本工具三招省钱：
  1) K=2 分片并发：46 项按清单顺序交错装箱成两片，片内串行、两片并发
    （共享同一个 8642 静态服务，只读无竞争；并发=2 个 Chromium——与历史
     串行轮"机器有其他负载"的失败场景同量级，负载风险可控）
  2) 断点续跑：--resume 读上轮 gate_result.json，跳过已 PASS 项——CLI 重启
     杀掉门禁后，重跑只补剩余尾巴（本轮真正的痛点：本会话已损失 3 轮完整门禁）
  3) FAIL 单跑定性内建：分片跑完的失败项自动串行单跑复验（既有"环境性失败
     按单跑 PASS 定性"方法论固化进工具，结果如实标 isolated_recheck）

互斥安全：
  - 清场（kill_stale_pw_chromium）只由总控在起分片前做一次。2026-09-17 去耦后
    pw_harness 不再每测自动清场，worker 无需再设 APACHE_SKIP_STALE_KILL 跳过
  - 每个分片独立 APACHE_TEST_OUT / APACHE_PW_RESULT，结果文件互不覆盖
产物：shardA.txt / shardB.txt / isolated.txt（分片与单跑日志）+ gate_result.json
退出码：0=全 PASS（含单跑定性）；1=存在未定性失败；2=环境失败（构建/服务）
用法：uv run --with playwright --with pillow python tools/shard_gate.py [--resume]
权威门禁入口 run_tests.ps1 保留不变（CI/最严格证据用串行版）。
"""
import json, os, subprocess, sys, threading, time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'tools', 'tests', 'test-manifest.json')
# 稳定目录（不带时间戳）——--resume 才能跨运行找到上轮 gate_result.json；
# 需要留存多轮证据时用 APACHE_SHARD_OUT 指定独立目录
OUT_ROOT = os.environ.get('APACHE_SHARD_OUT') or os.path.join(
    os.environ.get('TEMP', '/tmp'), 'apache_pw', 'shardgate')
RESUME_PATH = os.path.join(OUT_ROOT, 'gate_result.json')
PORT = 8642

# ---------------------------------------------------------------- 子进程工具
def run_live(cmd, log_path, env=None):
    """跑命令，stdout/stderr 逐行 tee 进日志文件并回显（utf-8/replace 容错）。"""
    e = dict(os.environ)
    if env:
        e.update(env)
    with open(log_path, 'a', encoding='utf-8') as log:
        log.write('\n===== %s =====\n$ %s\n' % (time.strftime('%H:%M:%S'), ' '.join(cmd)))
        log.flush()
        p = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=e, text=True, encoding='utf-8', errors='replace')
        for line in p.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            log.write(line)
        p.wait()
        return p.returncode

def uv_cmd(name, pillow):
    cmd = ['uv', 'run', '--with', 'playwright']
    if pillow:
        cmd += ['--with', 'pillow']
    cmd += ['python', os.path.join(ROOT, 'tools', 'tests', name + '.py')]
    return cmd

# ---------------------------------------------------------------- 主流程
def main():
    resume = '--resume' in sys.argv
    os.makedirs(OUT_ROOT, exist_ok=True)
    print('===== SHARD GATE =====')
    print('out dir  :', OUT_ROOT)
    print('resume   :', resume)
    print('started  :', time.strftime('%Y-%m-%d %H:%M:%S'))

    # ---- 1. 构建 + 静态检查（与 run_tests.ps1 第 1 段同集合）----
    statics = [
        (['node', 'build.mjs'], 'BUILD FAILED'),
        (['node', '--check', 'build.mjs'], 'BUILD SYNTAX CHECK FAILED'),
        (['node', '--check', os.path.join('dist', 'app-check.mjs')], 'APP SYNTAX CHECK FAILED'),
        (['node', 'tools/check_dom_ids.mjs'], 'DOM ID CONTRACT FAILED'),
        (['node', 'tools/check_topology_selftest.mjs'], 'TOPOLOGY CHECKER SELFTEST FAILED'),
    ]
    for cmd, failmsg in statics:
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode != 0:
            print('FATAL:', failmsg)
            json.dump({'status': 'ENV_FAIL', 'reason': failmsg, 'items': []},
                      open(RESUME_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            sys.exit(2)

    # ---- 2. 清场一次（分片 worker 会跳过——防互杀）----
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'tests'))
    import pw_harness as H
    H.kill_stale_pw_chromium()
    kill_port()
    # 离线缓存探测（同 run_tests.ps1：本机 VPN 下 pypi 抖动会误伤）
    if subprocess.run(['uv', 'run', '--with', 'playwright', '--with', 'pillow',
                       '--offline', 'python', '-c', 'pass'],
                      cwd=ROOT, capture_output=True).returncode == 0:
        os.environ['UV_OFFLINE'] = '1'
        print('uv offline cache OK -> tests run in offline mode')

    # ---- 3. 清单 + 续跑裁剪 + 交错分片 ----
    tests = [(t['name'], bool(t.get('pillow'))) for t in
             json.load(open(MANIFEST, encoding='utf-8'))['tests']]
    prior = {}
    if resume and os.path.exists(RESUME_PATH):
        try:
            d = json.load(open(RESUME_PATH, encoding='utf-8'))
            prior = {it['name']: it for it in d.get('items', []) if it.get('pass')}
            print('resume: 跳过上轮已 PASS %d 项' % len(prior))
        except Exception as e:
            print('WARN: resume 读取失败，全量重跑：', e)
    todo = [(n, p) for n, p in tests if n not in prior]
    shards = [[], []]
    for i, t in enumerate(todo):
        shards[i % 2].append(t)      # 交错装箱：类型天然打散、时长均衡
    for k, s in enumerate(shards):
        print('shard %d: %d 项 ->' % (k, len(s)), ', '.join(n for n, _ in s))

    # ---- 4. 起服务（单例共享，只读静态服务无竞争）----
    server = subprocess.Popen(['uv', 'run', 'python', '-m', 'http.server',
                              str(PORT), '--directory', 'dist'],
                             cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ready = False
        for _ in range(30):
            time.sleep(0.5)
            r = subprocess.run(['curl', '--noproxy', '*', '-s', '-o', 'NUL', '-w', '%{http_code}',
                                'http://localhost:%d/index.html' % PORT],
                               capture_output=True, text=True)
            if r.stdout.strip() == '200':
                ready = True
                break
        if not ready:
            print('FATAL: SERVER NOT READY')
            sys.exit(2)
        print('server ready (pid %d)' % server.pid)

        # ---- 5. 两分片并发（threading + 各自日志/结果文件/产物目录）----
        results = {}
        lock = threading.Lock()

        def persist():
            """逐项增量落盘：CLI 中途杀掉门禁后，--resume 仍能续上已 PASS 项。"""
            with lock:
                json.dump({'status': 'PARTIAL', 'resumed': resume,
                           'items': list(results.values())},
                          open(RESUME_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

        def worker(k, shard):
            env = {
                'APACHE_TEST_OUT': os.path.join(OUT_ROOT, 'shard%d_out' % k),
                'APACHE_PW_RESULT': os.path.join(OUT_ROOT, 'shard%d_result.json' % k),
            }
            os.makedirs(env['APACHE_TEST_OUT'], exist_ok=True)
            log = os.path.join(OUT_ROOT, 'shard%d.txt' % k)
            for n, pil in shard:
                code = run_live(uv_cmd(n, pil), log, env)
                with lock:
                    results[n] = {'name': n, 'exit': code, 'pass': code == 0, 'isolated_recheck': False}
                    persist()
                print('--- shard%d %s -> %s (exit %d) ---' % (k, n, 'PASS' if code == 0 else 'FAIL', code))

        threads = [threading.Thread(target=worker, args=(k, s)) for k, s in enumerate(shards) if s]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # ---- 6. FAIL 单跑定性（串行、清场一次、标准环境）----
        fails = [r['name'] for r in results.values() if not r['pass']]
        # 续跑轮：上轮已 PASS 的项直接计入
        for n, it in prior.items():
            results.setdefault(n, {'name': n, 'exit': 0, 'pass': True, 'isolated_recheck': False})
        if fails:
            print('===== 分片失败项单跑定性 =====')
            H.kill_stale_pw_chromium()
            iso_log = os.path.join(OUT_ROOT, 'isolated.txt')
            env = {'APACHE_TEST_OUT': os.path.join(OUT_ROOT, 'isolated_out'),
                   'APACHE_PW_RESULT': os.path.join(OUT_ROOT, 'isolated_result.json')}
            os.makedirs(env['APACHE_TEST_OUT'], exist_ok=True)
            for n in fails:
                pil = dict(tests)[n]
                code = run_live(uv_cmd(n, pil), iso_log, env)
                r = results[n]
                r['isolated_exit'] = code
                r['isolated_recheck'] = True
                if code == 0:
                    r['isolated_pass'] = True    # 单跑 PASS → 环境性定性（既有方法论）
                persist()
                print('--- isolated %s -> %s (exit %d) ---' % (n, 'PASS' if code == 0 else 'FAIL', code))

        # ---- 7. 汇总 + 落盘 + 退出码 ----
        items = [results[n] for n, _ in tests if n in results]
        npass = sum(1 for it in items if it['pass'])
        nfail = len(items) - npass
        unqual = [it['name'] for it in items if not it['pass'] and not it.get('isolated_pass')]
        print('\n===== SHARD GATE SUMMARY =====')
        for it in items:
            tag = 'PASS' if it['pass'] else ('FAIL(单跑PASS定性)' if it.get('isolated_pass') else 'FAIL')
            print('%-28s %s (exit %d)%s' % (it['name'], tag, it['exit'],
                  ' isolated_exit=%d' % it['isolated_exit'] if it.get('isolated_recheck') else ''))
        print('TOTAL: %d/%d PASS（未定性失败 %d）' % (npass, len(items), len(unqual)))
        print('finished :', time.strftime('%Y-%m-%d %H:%M:%S'))
        json.dump({'status': 'PASS' if not nfail else ('PASS_WITH_WARNINGS' if not unqual else 'FAIL'),
                   'resumed': resume, 'items': items},
                  open(RESUME_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        sys.exit(0 if not unqual else 1)
    finally:
        server.terminate()
        kill_port()

def kill_port():
    """杀 8642 残留监听（uv 父死 python 子孤儿占端口——taskkill /F /T 杀树）。"""
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-Command',
                              "(Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue)"
                              ".Select-Object -ExpandProperty OwningProcess -Unique" % PORT],
                             capture_output=True, text=True, timeout=20).stdout
        for pid in out.split():
            if pid.strip().isdigit():
                subprocess.run(['taskkill', '/F', '/T', '/PID', pid.strip()], capture_output=True)
    except Exception:
        pass
    time.sleep(0.4)

if __name__ == '__main__':
    main()
