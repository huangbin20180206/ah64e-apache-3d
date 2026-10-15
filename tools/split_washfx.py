# 一次性工具：把 17-washfx.js 按类边界拆成三个模块（P0-1 重构）
# 拆分映射基于 grep 确认的行号（1-based，含头尾）：
#   17-washfx 保留 = [1-423] + [748-907]（头/WASH/makeWashSprite/WashParticles/WashDecal/WashFX）
#   23-washmedia   = [424-614](GrassField) + [908-1191](SpraySurfaceFX+WaterRipples)
#   21-washground  = [615-747](DuneSandFX) + [1192-1267](GrassDebrisFX) + [1268-EOF](WashTracks)
import io, os

SRC = r'C:\Users\huang\Kyle_Projects\apache_web\src\app\17-washfx.js'
OUT_MEDIA = r'C:\Users\huang\Kyle_Projects\apache_web\src\app\23-washmedia.js'
OUT_GROUND = r'C:\Users\huang\Kyle_Projects\apache_web\src\app\21-washground.js'

lines = open(SRC, encoding='utf-8').read().split('\n')
n = len(lines)
print('源文件行数:', n)

def seg(a, b):
    """1-based 闭区间切片"""
    return '\n'.join(lines[a-1:min(b, n)])

HEAD_MEDIA = '''// ============================================================
// 23-washmedia.js — 介质表现类：草地 / 水面 spray / 涟漪
// ============================================================
// 从 17-washfx.js 拆出（P0 重构）：这三个类负责"介质长什么样"——
// 草叶实例场（GrassField）、湖面泡沫/水花/凹陷（SpraySurfaceFX）、
// 悬停涟漪波环（WaterRipples）。总装在 17-washfx 的 WashFX，
// 依赖 00-utils（canvas2d/tex/rnd）与 15-terrain（duneH）。
// ============================================================

'''

HEAD_GROUND = '''// ============================================================
// 21-washground.js — 地面痕迹类：沙漠痕迹 / 沙脊吹雾 / 草屑碎片
// ============================================================
// 从 17-washfx.js 拆出（P0 重构）：这三个类负责"地面被吹了之后留下什么"——
// 沙漠吹蚀痕迹盖章（WashTracks）、沙脊贴地沙雾（DuneSandFX）、
// 草屑碎片实体（GrassDebrisFX）。依赖 00-utils 与 15-terrain（duneH）。
// 注意 setMedium 配对：离开所属场地必须清空粒子池（否则冻结残留）。
// ============================================================

'''

media = HEAD_MEDIA + seg(424, 614) + '\n' + seg(908, 1191) + '\n'
ground = HEAD_GROUND + seg(615, 747) + '\n' + seg(1192, 1267) + '\n' + seg(1268, n) + '\n'
keep = seg(1, 423) + '\n' + seg(748, 907) + '\n'

# 17-washfx 头注释补一行拆分说明
keep = keep.replace(
    '// ============================================================\n// 17-washfx.js',
    '// ============================================================\n// 17-washfx.js — 旋翼下洗核心（总装见文件尾 WashFX）\n// [P0 拆分] 介质类→23-washmedia.js，地面痕迹类→21-washground.js',
    1)

open(OUT_MEDIA, 'w', encoding='utf-8', newline='\n').write(media)
open(OUT_GROUND, 'w', encoding='utf-8', newline='\n').write(ground)
open(SRC, 'w', encoding='utf-8', newline='\n').write(keep)

for f in [SRC, OUT_MEDIA, OUT_GROUND]:
    print(f, len(open(f, encoding='utf-8').read().split('\n')), '行')
