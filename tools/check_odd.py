"""检查可疑节点 BezierCurve / Cylinder.013 / Cylinder.015 的局部包围盒与实际顶点范围。"""
import json
import struct
import numpy as np

path = r'C:\Users\huang\Kyle_Projects\apache_web\assets\apache.glb'
buf = open(path, 'rb').read()
off = 12
gj = None
bin_ = None
while off < len(buf):
    ln, kind = struct.unpack_from('<I4s', buf, off)
    off += 8
    if kind == b'JSON':
        gj = json.loads(buf[off:off + ln].decode('utf-8'))
    elif kind == b'BIN\x00':
        bin_ = buf[off:off + ln]
    off += ln + ((4 - ln % 4) % 4 if ln % 4 else 0)

AC, BV = gj['accessors'], gj['bufferViews']


def read_vec3(ai):
    a = AC[ai]
    bv = BV[a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or 12
    out = np.empty((a['count'], 3), dtype=np.float32)
    for k in range(a['count']):
        out[k] = struct.unpack_from('<3f', bin_, base + k * stride)
    return out


for nm in ['BezierCurve', 'Cylinder.013', 'Cylinder.015', 'Cylinder.019', 'Cylinder.014']:
    i = next(i for i, n in enumerate(gj['nodes']) if n.get('name') == nm)
    n = gj['nodes'][i]
    me = gj['meshes'][n['mesh']]
    print('---', nm, 'mesh=', me.get('name'))
    for p in me['primitives']:
        a = AC[p['attributes']['POSITION']]
        print('   count=%d accessor min=%s max=%s' % (
            a['count'], ['%.4f' % v for v in a['min']], ['%.4f' % v for v in a['max']]))
        v = read_vec3(p['attributes']['POSITION'])
        print('   实测 min=%s max=%s 中位=%s' % (
            ['%.4f' % x for x in v.min(0)], ['%.4f' % x for x in v.max(0)],
            ['%.4f' % x for x in np.median(v, 0)]))
