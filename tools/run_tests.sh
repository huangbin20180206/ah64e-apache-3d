#!/usr/bin/env bash
# Linux 测试入口（opt1，2026-10-20）：无 Windows/GPU 时的自证门禁。
#   build + 语法 + DOM id 契约 + 拓扑自测 + 纯逻辑 pytest；有 playwright 时再跑 CI 冒烟。
# 权威全量门禁仍是 GPU 机上的 tools/run_tests.ps1（软渲染下实时断言不可信）。
# 用法：bash tools/run_tests.sh [--smoke]
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== build";            node build.mjs
echo "== syntax";           node --check build.mjs; node --check dist/app-check.mjs
echo "== dom ids";          node tools/check_dom_ids.mjs
echo "== topology selftest"; node tools/check_topology_selftest.mjs
echo "== pure pytest";      python3 -m pytest -q tools/tests_pure
if [ "${1:-}" = "--smoke" ]; then
  echo "== ci smoke (headless, frame-rate independent)"
  python3 -m http.server 8642 --directory dist >/dev/null 2>&1 & SRV=$!
  trap 'kill $SRV 2>/dev/null || true' EXIT
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8642/index.html >/dev/null && break; sleep 1; done
  APACHE_TEST_URL='http://127.0.0.1:8642/?nocine=1&nocut=1' python3 tools/tests/test_ci_smoke.py
fi
echo "ALL OK"
