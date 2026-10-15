"""解析 GLB 的 JSON 块，输出节点层级 / 变换 / 材质名，供网页端绑定使用。"""
import json
import struct
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\huang\Kyle_Projects\apache_web\assets\apache.glb'
buf = open(path, 'rb').read()
assert buf[:4] == b'glTF', '不是 GLB'
off = 12
gj = None
while off < len(buf):
    ln, kind = struct.unpack_from('<I4s', buf, off)
    off += 8
    if kind == b'JSON':
        gj = json.loads(buf[off:off + ln].decode('utf-8'))
    off += ln + ((4 - ln % 4) % 4 if ln % 4 else 0)

nodes = gj['nodes']
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent[c] = i


def depth(i):
    d = 0
    while i in parent:
        i = parent[i]
        d += 1
    return d


print('=== 场景根节点 ===', gj['scenes'][0]['nodes'])
print('=== 节点 (%d) ===' % len(nodes))
for i, n in enumerate(nodes):
    t = n.get('translation')
    r = n.get('rotation')
    s = n.get('scale')
    m = n.get('matrix')
    bits = []
    if t:
        bits.append('T=' + ','.join('%.4f' % v for v in t))
    if r:
        bits.append('R=' + ','.join('%.4f' % v for v in r))
    if s:
        bits.append('S=' + ','.join('%.4f' % v for v in s))
    if m:
        bits.append('M=' + ','.join('%.3f' % v for v in m))
    print('%3d %s%-26s mesh=%-4s %s' % (i, '  ' * depth(i), n.get('name', '?'),
                                        n.get('mesh', '-'), ' '.join(bits)))

print('=== 材质 (%d) ===' % len(gj['materials']))
for i, m in enumerate(gj['materials']):
    p = m.get('pbrMetallicRoughness', {})
    bc = p.get('baseColorFactor', [1, 1, 1, 1])
    print('%3d %-28s bc=%s M=%s R=%s tex=%s' % (
        i, m.get('name', '?'), ','.join('%.3f' % v for v in bc),
        p.get('metallicFactor'), p.get('roughnessFactor'),
        p.get('baseColorTexture', {}).get('index')))

print('=== 图片 ===')
for i, im in enumerate(gj.get('images', [])):
    print(i, im.get('name'), im.get('mimeType'))

print('=== mesh -> 材质 ===')
for i, me in enumerate(gj['meshes']):
    print(i, me.get('name'), [p.get('material') for p in me['primitives']])
