# asset1（2026-10-21）：gltfpack 压缩后按节点名把原网格名写回（16-targetprops 的 pick 按网格名取单栋楼/摩托）
import json, struct, sys

def R(f):
    b = open(f, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
    return b, json.loads(b[20:20 + n]), n

src, dst = sys.argv[1], sys.argv[2]
_, a, _ = R(src); b, c, n = R(dst)
an = {nd.get('name'): nd for nd in a.get('nodes', []) if nd.get('name')}
for nd in c.get('nodes', []):
    o = an.get(nd.get('name'))
    if o is not None and 'mesh' in o and 'mesh' in nd:
        nm = a['meshes'][o['mesh']].get('name')
        if nm and not c['meshes'][nd['mesh']].get('name'):
            c['meshes'][nd['mesh']]['name'] = nm
js = json.dumps(c, separators=(',', ':'), ensure_ascii=False).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
rest = b[20 + n:]
open(dst, 'wb').write(b[:8] + struct.pack('<I', 20 + len(js) + len(rest)) + struct.pack('<I', len(js)) + b'JSON' + js + rest)
