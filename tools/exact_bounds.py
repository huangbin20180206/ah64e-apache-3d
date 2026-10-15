"""精确世界包围盒：实际变换每个顶点（而不是 AABB 8 角点），避免旋转造成的高估。
纯标准库实现（无 numpy），uv run python tools/exact_bounds.py [glb路径]"""
import json
import struct
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\huang\Kyle_Projects\apache_web\assets\apache_v2.glb'
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


def mat_mul(a, b):
    """4x4 行主序矩阵乘"""
    out = [[0.0] * 4 for _ in range(4)]
    for i in range(4):
        for j in range(4):
            out[i][j] = sum(a[i][k] * b[k][j] for k in range(4))
    return out


def mat_of(n):
    """glTF node -> 4x4 行主序（变换作用于列向量 v' = M @ v）"""
    if 'matrix' in n:
        m = n['matrix']
        # glTF matrix 按列主序存储
        return [[m[0], m[4], m[8], m[12]],
                [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]],
                [m[3], m[7], m[11], m[15]]]
    t = n.get('translation', [0, 0, 0])
    q = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    M = [[R[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)]
    M.append([0.0, 0.0, 0.0, 1.0])
    return M


WM = {}


def world(i):
    if i not in WM:
        m = mat_of(N[i])
        WM[i] = mat_mul(world(par[i]), m) if i in par else m
    return WM[i]


def verts(ai):
    a = AC[ai]
    bv = BV[a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or 12
    if stride == 12:
        n = a['count']
        return [struct.unpack_from('<3f', bin_, base + k * 12) for k in range(n)]
    out = []
    for k in range(a['count']):
        out.append(struct.unpack_from('<3f', bin_, base + k * stride))
    return out


gmin = [1e18] * 3
gmax = [-1e18] * 3
rows = []
for i, n in enumerate(N):
    if 'mesh' not in n:
        continue
    M = world(i)
    lo = [1e18] * 3
    hi = [-1e18] * 3
    for p in gj['meshes'][n['mesh']]['primitives']:
        for v in verts(p['attributes']['POSITION']):
            wx = M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2] + M[0][3]
            wy = M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2] + M[1][3]
            wz = M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2] + M[2][3]
            lo[0] = min(lo[0], wx); hi[0] = max(hi[0], wx)
            lo[1] = min(lo[1], wy); hi[1] = max(hi[1], wy)
            lo[2] = min(lo[2], wz); hi[2] = max(hi[2], wz)
    for k in range(3):
        gmin[k] = min(gmin[k], lo[k])
        gmax[k] = max(gmax[k], hi[k])
    rows.append((n.get('name'), lo, hi))

for name, lo, hi in sorted(rows, key=lambda r: r[1][2]):
    print('%-32s Y[%7.3f,%7.3f]  Z[%7.3f,%7.3f]  X[%7.3f,%7.3f]' % (
        name, lo[1], hi[1], lo[2], hi[2], lo[0], hi[0]))
print()
print('精确整机 min=%s' % ['%.4f' % v for v in gmin])
print('精确整机 max=%s' % ['%.4f' % v for v in gmax])
print('尺寸      =%s' % ['%.4f' % v for v in (gmax[k] - gmin[k] for k in range(3))])
