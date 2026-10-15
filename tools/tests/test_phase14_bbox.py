# -*- coding: utf-8 -*-
# Phase 14-C：world-space bounding box 检查（穿地/悬空/尺寸失控）
# 覆盖 narrative 基地静态件（雷达/防空车/弹药堆/探照灯/巡逻编队）：
#   B1 地面系 mesh 不穿地（world minY >= -0.05）
#   B2 探照灯头有支撑（灯柱 pole 存在且贴地）——曾悬浮 1.22m 的回归防护
#   B3 空中系（巡逻编队）不低于地形（合法空中件，检查高度 >5 而非贴地）
#   B4 无尺寸失控（除巡逻编队外单轴 <= 30u）
# evaluate 内禁 THREE 构造器（IIFE）——手工矩阵乘法求世界 AABB。
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.narrative && __dbg.apache", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.targets.enabled = true")
    pg.wait_for_timeout(500)

    meshes = pg.evaluate("""() => {
      function worldBox(o) {
        o.updateMatrixWorld(true);
        const b = (o.geometry.boundingBox) || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        if (!b) return null;
        const e = o.matrixWorld.elements;
        const x=b.min.x,y=b.min.y,z=b.min.z,X=b.max.x,Y=b.max.y,Z=b.max.z;
        const pts=[[x,y,z],[X,y,z],[x,Y,z],[x,y,Z],[X,Y,z],[X,y,Z],[x,Y,Z],[X,Y,Z]];
        let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
        for (const p of pts) {
          const wx=e[0]*p[0]+e[4]*p[1]+e[8]*p[2]+e[12];
          const wy=e[1]*p[0]+e[5]*p[1]+e[9]*p[2]+e[13];
          const wz=e[2]*p[0]+e[6]*p[1]+e[10]*p[2]+e[14];
          if (wx<mn[0])mn[0]=wx; if (wy<mn[1])mn[1]=wy; if (wz<mn[2])mn[2]=wz;
          if (wx>mx[0])mx[0]=wx; if (wy>mx[1])mx[1]=wy; if (wz>mx[2])mx[2]=wz;
        }
        return { mn, mx };
      }
      const out = [];
      __dbg.narrative.group.traverse(o => {
        if (!o.isMesh) return;
        const b = worldBox(o);
        if (!b) return;
        out.push({ name: o.geometry.type,
          minY: +b.mn[1].toFixed(3), maxY: +b.mx[1].toFixed(3),
          cy: +((b.mn[1] + b.mx[1]) / 2).toFixed(2),
          size: +Math.max(b.mx[0]-b.mn[0], b.mx[1]-b.mn[1], b.mx[2]-b.mn[2]).toFixed(2) });
      });
      return out;
    }""")
    print('narrative meshes:', len(meshes))
    # B1 地面系不穿地（中心高 < 3 且 maxY < 6 视为地面件——排除巡逻机 12u 与烟柱）
    ground_bad = [m for m in meshes if m['cy'] < 3 and m['maxY'] < 6 and m['minY'] < -0.05]
    assert not ground_bad, ('B1: 地面件穿地（minY < -0.05）', ground_bad)
    # 支座与地形接触：地面系 mesh 最低点应落在 -0.05..0.05（贴地）或以建筑堆叠形式
    #   （顶部箱 0.55 起不要求贴地——只禁止负）
    # B2 探照灯支撑（P14-C+R5）：按稳定语义 name 定位 lamp 组与 pole/head mesh，
    #    分别计算 world bbox——贴地/顶底间隙/不穿地，不止断言 position.y
    lamp = pg.evaluate("""() => {
      function worldBox(o) {
        o.updateMatrixWorld(true);
        const b = (o.geometry.boundingBox) || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        if (!b) return null;
        const e = o.matrixWorld.elements;
        const x=b.min.x,y=b.min.y,z=b.min.z,X=b.max.x,Y=b.max.y,Z=b.max.z;
        const pts=[[x,y,z],[X,y,z],[x,Y,z],[x,y,Z],[X,Y,z],[X,y,Z],[x,Y,Z],[X,Y,Z]];
        let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
        for (const p of pts) {
          const wx=e[0]*p[0]+e[4]*p[1]+e[8]*p[2]+e[12];
          const wy=e[1]*p[0]+e[5]*p[1]+e[9]*p[2]+e[13];
          const wz=e[2]*p[0]+e[6]*p[1]+e[10]*p[2]+e[14];
          if (wx<mn[0])mn[0]=wx; if (wy<mn[1])mn[1]=wy; if (wz<mn[2])mn[2]=wz;
          if (wx>mx[0])mx[0]=wx; if (wy>mx[1])mx[1]=wy; if (wz>mx[2])mx[2]=wz;
        }
        return { mn, mx };
      }
      const out = {};
      __dbg.narrative.group.traverse(o => {
        if (o.isGroup && o.name === 'narrative-lamp') out.groupFound = true;
        if (o.isMesh && o.name === 'narrative-lamp-pole') {
          const b = worldBox(o); out.pole = b ? { minY:+b.mn[1].toFixed(3), maxY:+b.mx[1].toFixed(3) } : null;
        }
        if (o.isMesh && o.name === 'narrative-lamp-head') {
          const b = worldBox(o); out.head = b ? { minY:+b.mn[1].toFixed(3), maxY:+b.mx[1].toFixed(3) } : null;
        }
      });
      return out;
    }""")
    print('lamp bbox:', lamp)
    assert lamp.get('groupFound'), ('B2: 应能找到 narrative-lamp 组（name 标记）', lamp)
    assert lamp.get('pole') and lamp.get('head'), ('B2: 应有 pole/head 语义标记 mesh', lamp)
    # 灯柱贴地：pole.minY 在贴地容差内（|minY|<=0.05）
    assert abs(lamp['pole']['minY']) <= 0.05, ('B2: 灯柱应贴地（minY 容差 0.05）', lamp)
    # 灯柱顶部与灯头底部：柱顶支撑球底（嵌入球下部）是合理设计——
    # 判据 = 不悬空（pole 顶不低于 head 底 >0.1）且不穿入超过球半径（>0.25 深）：
    #   实测 pole.maxY=1.401、head.minY=1.218 → gap=-0.183（柱顶嵌进灯头球 ~0.18，
    #   球半径 0.18——柱顶恰好到达球心下方，视觉贴合无悬浮无穿出）
    gap = lamp['head']['minY'] - lamp['pole']['maxY']
    assert gap <= 0.1 and gap >= -0.25, ('B2: 灯柱顶与灯头底衔接异常（悬空或穿出）', round(gap, 3), lamp)
    # 整体不穿地：灯头 minY >= -0.05
    assert lamp['head']['minY'] >= -0.05, ('B2: 灯头不穿地', lamp)
    print('B2 探照灯支撑 OK: pole 贴地 minY=%.3f、顶-底间隙 %.3f、head 不穿地' % (
        lamp['pole']['minY'], gap))
    # B3 空中系（巡逻编队 12u 高度）——合法空中件，须显著高于地面（>5）
    air = [m for m in meshes if m['cy'] > 5]
    assert all(m['minY'] > 5 for m in air), ('B3: 空中件高度异常（应 >5）', air)
    # B4 尺寸失控（巡逻机编队除外：其 bbox 为环形轨道上单机，尺寸正常；
    #   烟柱/光锥为效果件排除——只查实体件中单轴 >30 者）
    big = [m for m in meshes if m['size'] > 30 and not (m['cy'] > 5)]
    assert not big, ('B4: 地面系尺寸失控（单轴 >30u）', big)
    print('B-box PASS: 地面件贴地/探照灯有支撑/空中件合格/尺寸正常')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=120)
print('PASS')