"""对照 Blender 真实包围盒 与 GLB 解析出的包围盒，找出差异（几何被错误变换的节点）。"""
import json
import struct
import sys
import numpy as np

T = r'C:\Users\huang\AppData\Local\Temp'
raw = open(T + r'\truebounds.txt', encoding='utf-8').read()
bl = json.loads(raw.split('===JSON_START===')[1].split('===JSON_END===')[0].strip())

path = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\huang\Kyle_Projects\apache_web\assets\apache.glb'
buf = open(path, 'rb').read()
off = 12
gj = bin_ = None
while off < len(buf):
    ln, kind = struct.unpack_from('<I4s', buf, off)
    off += 8
    if kind == b'JSON':
        gj = json.loads(buf[off:off + ln].decode('utf-8'))
    elif kind == b'BIN\x00':
        bin_ = buf[off:off + ln]
    off += ln + ((4 - ln % 4) % 4 if ln % 4 else 0)

N, AC, BV = gj['nodes'], gj['accessors'], gj['bufferViews']
par = {}
for i, n in enumerate(N):
    for c in n.get('children', []):
        par[c] = i


def mat_of(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0])
    q = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * np.array(s)[None, :]
    M[:3, 3] = t
    return M


WM = {}


def world(i):
    if i not in WM:
        m = mat_of(N[i])
        WM[i] = world(par[i]) @ m if i in par else m
    return WM[i]


def verts(ai):
    a = AC[ai]
    bv = BV[a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or 12
    if stride == 12:
        return np.frombuffer(bin_, dtype='<f4', count=a['count'] * 3,
                             offset=base).reshape(-1, 3).astype(np.float64)
    r = np.frombuffer(bin_, dtype=np.uint8, count=a['count'] * stride, offset=base)
    return r.reshape(-1, stride)[:, :12].copy().view('<f4').reshape(-1, 3).astype(np.float64)


print('%-32s %-8s %s' % ('node', 'maxErr', '说明'))
bad = []
for i, n in enumerate(N):
    if 'mesh' not in n:
        continue
    nm = n.get('name')
    if nm not in bl:
        print('%-32s   -      Blender 侧缺失' % nm)
        continue
    M = world(i)
    lo = np.full(3, 1e18)
    hi = np.full(3, -1e18)
    for p in gj['meshes'][n['mesh']]['primitives']:
        v = verts(p['attributes']['POSITION'])
        w = v @ M[:3, :3].T + M[:3, 3]
        lo = np.minimum(lo, w.min(0))
        hi = np.maximum(hi, w.max(0))
    b = np.array(bl[nm], dtype=np.float64)
    err = max(np.abs(lo - b[0]).max(), np.abs(hi - b[1]).max())
    if err > 0.02:
        bad.append((err, nm, b, lo, hi))

for err, nm, b, lo, hi in sorted(bad, reverse=True):
    print('%-32s %7.3f' % (nm, err))
    print('%34s blender lo=%s hi=%s' % ('', ['%.3f' % v for v in b[0]], ['%.3f' % v for v in b[1]]))
    print('%34s glb     lo=%s hi=%s' % ('', ['%.3f' % v for v in lo], ['%.3f' % v for v in hi]))
print()
print('偏差 >0.02 的节点数:', len(bad), '/ 总 mesh 节点', sum(1 for n in N if 'mesh' in n))
