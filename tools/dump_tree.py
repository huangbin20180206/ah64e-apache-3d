"""dump GLB 父子关系 + 关键节点世界坐标（Y-up 空间）。"""
import json
import struct

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

print('=== 父子关系 ===')
for i, n in enumerate(N):
    chain = []
    j = i
    while j in par:
        j = par[j]
        chain.append(N[j].get('name'))
    print('%3d %-32s <- %s' % (i, n.get('name'), ' <- '.join(chain) or '(scene root)'))

print()
print('=== 各节点的直接子节点 ===')
for i, n in enumerate(N):
    ch = n.get('children')
    if ch:
        print('%3d %-32s : %s' % (i, n.get('name'), [N[c].get('name') for c in ch]))


# 手算世界位置（TRS 链）
def mat_of(n):
    import numpy as np
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


import numpy as np

WM = {}


def world(i):
    if i in WM:
        return WM[i]
    m = mat_of(N[i])
    if i in par:
        m = world(par[i]) @ m
    WM[i] = m
    return m


print()
print('=== 关键节点世界矩阵 ===')
for name in ['Cylinder.010', 'Cylinder.012', 'Cylinder.016', 'Cylinder.011',
             'Longbow_v2_Root', 'BODY', 'BODY.001', 'CamTarget']:
    idx = next((i for i, n in enumerate(N) if n.get('name') == name), None)
    if idx is None:
        print(name, '缺失')
        continue
    m = world(idx)
    print('%-18s pos=%s' % (name, ['%.4f' % v for v in m[:3, 3]]))
    print('%18s  col X=%s Y=%s Z=%s' % ('', ['%.4f' % v for v in m[:3, 0]],
                                        ['%.4f' % v for v in m[:3, 1]],
                                        ['%.4f' % v for v in m[:3, 2]]))
