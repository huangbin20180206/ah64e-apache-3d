# -*- coding: utf-8 -*-
"""本地静态服务 + gzip / brotli 动态压缩（P2-1 选项 A 落地，2026-11-08）。

背景：dist/index.html 是 2 MB 级的单文件内联包，标准库 http.server 原样传输，
本地打开一次的下载量就是 2 MB。线上 GitHub Pages 由 CDN 自动对 text/html 做
gzip/brotli，本地却享受不到，于是「本地测的加载耗时」和线上不是一回事。

用法：
    py -3 tools/serve_dist.py                     # 默认 dist / 8642
    py -3 tools/serve_dist.py --port 8642 --root dist
    py -3 tools/serve_dist.py --no-compress      # 对照：退回原样传输，便于 A/B 比对

实现要点：
  · 只压缩可压缩的文本类型；GLB / 图片 / 音频等已经压过的二进制走父类原样传输
    （它们本来就是 meshopt / JPEG / WebP / MP3，再压纯属浪费 CPU）。
  · 按 Accept-Encoding 选 br > gzip > identity；brotli 是可选依赖，没装就只给 gzip。
  · 结果按 (路径, 编码, mtime) 缓存在内存里，重复请求不再重复压缩。
  · 正确带 Content-Encoding / Vary: Accept-Encoding，避免代理缓存串味。
"""
import argparse
import gzip
import os
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    import brotli as _brotli
except ImportError:
    _brotli = None

COMPRESSIBLE = {
    '.html', '.htm', '.js', '.mjs', '.css', '.json', '.txt', '.svg', '.xml', '.map',
}
_CACHE = {}
_CACHE_MAX = 64


def _enc_body(raw, enc):
    if enc == 'br':
        return _brotli.compress(raw, quality=5)
    if enc == 'gzip':
        return gzip.compress(raw, compresslevel=6)
    return raw


class CompressingHandler(SimpleHTTPRequestHandler):
    compress = True

    def _pick_encoding(self):
        if not self.compress:
            return ''
        want = (self.headers.get('Accept-Encoding') or '').lower()
        if 'br' in want and _brotli is not None:
            return 'br'
        if 'gzip' in want:
            return 'gzip'
        return ''

    def _serve_compressed(self, method):
        path = self.translate_path(self.path.split('?', 1)[0])
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if not os.path.isfile(path) or os.path.splitext(path)[1].lower() not in COMPRESSIBLE:
            return False
        enc = self._pick_encoding()
        try:
            mtime = os.path.getmtime(path)
            key = (path, enc, mtime)
            body = _CACHE.get(key)
            if body is None:
                with open(path, 'rb') as f:
                    body = _enc_body(f.read(), enc)
                if len(_CACHE) >= _CACHE_MAX:
                    _CACHE.clear()
                _CACHE[key] = body
        except OSError:
            return False
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(path))
        if enc:
            self.send_header('Content-Encoding', enc)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Vary', 'Accept-Encoding')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if method == 'GET':
            self.wfile.write(body)
        return True

    def do_GET(self):
        if not self._serve_compressed('GET'):
            super().do_GET()

    def do_HEAD(self):
        if not self._serve_compressed('HEAD'):
            super().do_HEAD()

    def log_message(self, fmt, *args):
        if '--verbose' in sys.argv:
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description='dist 静态服务（gzip/brotli）')
    ap.add_argument('--port', type=int, default=8642)
    ap.add_argument('--root', default='dist')
    ap.add_argument('--no-compress', action='store_true', help='关闭压缩用于 A/B 对照')
    ap.add_argument('--verbose', action='store_true')
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    if not os.path.isfile(os.path.join(root, 'index.html')):
        print('[serve_dist] 找不到 %s，先跑 node build.mjs' % os.path.join(root, 'index.html'))
        return 1
    CompressingHandler.compress = not a.no_compress
    handler = partial(CompressingHandler, directory=root)
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), handler)
    print('[serve_dist] http://localhost:%d  root=%s  压缩=%s (brotli=%s)' % (
        a.port, root, 'on' if CompressingHandler.compress else 'off',
        'yes' if _brotli else 'no，仅 gzip'))
    print('[serve_dist] Ctrl+C 停止')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
