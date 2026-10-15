"""统计每个节点的世界包围盒（用 accessor 的 POSITION min/max 做 8 角点变换），
用于确定地面高度、旋翼盘半径、相机取景范围。"""
import json
import struct
import itertools
import numpy as np

path = r'C:\Users\huang\Kyle_Projects\apache_web\assets\apache.glb'
buf = open(path, 'rb').read()
off = 12
gj = None
while off < len(buf):
    ln, kind = struct.unpack_from('<I4s', buf, off)
    off += 8
    if kind == b'JSON':
        gj = json.loads(buf[off:off + ln].decode('utf-8'))
    off += ln + ((4 - ln % 4) % 4 if ln % 4 else 0)

N = gj['nodes']
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
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
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


AC = gj['accessors']
tri_total = 0
gmin = np.array([1e9] * 3)
gmax = np.array([-1e9] * 3)
rows = []
for i, n in enumerate(N):
    if 'mesh' not in n:
        continue
    me = gj['meshes'][n['mesh']]
    lo = np.array([1e9] * 3)
    hi = np.array([-1e9] * 3)
    tris = 0
    for p in me['primitives']:
        a = AC[p['attributes']['POSITION']]
        lo = np.minimum(lo, a['min'])
        hi = np.maximum(hi, a['max'])
        cnt = AC[p['indices']]['count'] if 'indices' in p else a['count']
        tris += cnt // 3
    tri_total += tris
    M = world(i)
    corners = np.array([[x, y, z, 1] for x, y, z in itertools.product(*zip(lo, hi))])
    w = (M @ corners.T).T[:, :3]
    wlo, whi = w.min(0), w.max(0)
    gmin = np.minimum(gmin, wlo)
    gmax = np.maximum(gmax, whi)
    rows.append((tris, n.get('name'), wlo, whi))

rows.sort(reverse=True)
print('%-32s %6s  %-24s %-24s' % ('node', 'tris', 'world min', 'world max'))
for tris, name, wlo, whi in rows:
    print('%-32s %6d  %-24s %-24s' % (name, tris,
                                      ','.join('%.2f' % v for v in wlo),
                                      ','.join('%.2f' % v for v in whi)))
print()
print('总三角面:', tri_total)
print('整机世界包围盒 min=%s max=%s size=%s' % (
    ['%.4f' % v for v in gmin], ['%.4f' % v for v in gmax],
    ['%.4f' % v for v in (gmax - gmin)]))
