# -*- coding: utf-8 -*-
"""Phase 13 evidence-loop A/B 自动汇总（复核一轮项三）：由不可覆盖原始 JSON 计算。

- 全量聚合：3 组 impl + 3 组 base 的 main/dof_on/dof_off 各自的所有逐帧样本扁平化，
  不遇到第一组后 break；
- 报告 median / p10 / worst（draws、triangles、frame_ms、fps）；
- 每组样本的 cam_identical 必须为 true；最终 impl/base 各侧所有组 cam_identical
  全 true 才输出汇总（否则抛错——A/B 失败）；
- 只报告受控场景的帧时间/draw calls/triangles，**不把 ON/OFF 差值解释为单 pass
  成本**（DOF pass 成本结论已撤回）。
- 写 PERF-AB-SUMMARY.json（附自身 sha256）。
"""

import glob
import hashlib
import json
import os
import sys


def _flat(rows_by_kind, key):
    """把某 kind 的所有样本的某逐帧数组拉平并排序。"""
    vals = []
    for row in rows_by_kind:
        vals.extend(row.get(key, []))
    return sorted(vals)


def _med_p10_worst(vals):
    if not vals:
        return None, None, None
    return vals[len(vals) // 2], vals[int(len(vals) * 0.1)], vals[0]


def _cam_close(a, b, tol=0.02):
    return len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def main(root):
    sys.stdout.reconfigure(encoding='utf-8')
    OUT = os.path.join(root, 'docs', 'ai-reviews', 'cinematic-pack-3-final', 'ab')
    files = sorted(glob.glob(os.path.join(OUT, 'PERF-*.json')))
    print('A/B 原始样本数:', len(files))
    if not files:
        print('无样本')
        return

    by_tag = {}
    for f in files:
        d = json.load(open(f, encoding='utf-8'))
        by_tag.setdefault(d['tag'], []).append(d)

    all_cam_ok = True
    payload_rows = []

    for tag in ['impl', 'base']:
        samples = by_tag.get(tag, [])
        if not samples:
            print('%s: 无样本' % tag)
            all_cam_ok = False
            continue
        print('--- %s: %d 组样本 ---' % (tag, len(samples)))
        kv = {'main': [], 'dof_on': [], 'dof_off': []}
        for s in samples:
            for r in s['rows']:
                kv.setdefault(r['kind'], []).append(r)

        for kind, label in [('main', '主场景 desert q=1'), ('dof_on', 'DOF ON'),
                            ('dof_off', 'DOF OFF')]:
            rows = kv.get(kind, [])
            if not rows:
                print('%s %s: 无样本' % (tag, label))
                all_cam_ok = False
                continue
            draws = _flat(rows, 'draws_raw') or _flat(rows, 'draws_sorted')
            tris = _flat(rows, 'tri_raw') or _flat(rows, 'tri_sorted')
            fms = _flat(rows, 'frame_ms_raw') or _flat(rows, 'frame_ms_sorted')
            fps = sorted([1000.0 / m for m in fms if m > 0]) if fms else []
            dm, dp, dw = _med_p10_worst(draws)
            tm, tp, tw = _med_p10_worst(tris)
            fm_, fp, fw = _med_p10_worst(fps)
            print('%s %s: n=%d draws med/p10/worst=%s/%s/%s tri med/p10/worst=%s/%s/%s fps med/p10/worst=%.1f/%.1f/%.1f' % (
                tag, label, len(rows), dm, dp, dw, tm, tp, tw,
                (fm_ or 0), (fp or 0), (fw or 0)))
            payload_rows.append({
                'tag': tag, 'kind': kind, 'n': len(rows),
                'draws_median': dm, 'draws_p10': dp, 'draws_worst': dw,
                'tri_median': tm, 'tri_p10': tp, 'tri_worst': tw,
                'fps_median': round(fm_, 1) if fm_ else None,
                'fps_p10': round(fp, 1) if fp else None,
                'fps_worst': round(fw, 1) if fw else None,
                'frame_ms_median': round(_med_p10_worst(fms)[0], 3) if fms else None,
            })

        # 每组样本的 cam_identical 校验：ON/OFF 相机必须在容差内一致
        #（FPV 中相机逐帧缓追，精确相等必然 False——项三要求"容差内一致"）
        cam_flags = []
        for s in samples:
            on = next((r for r in s['rows'] if r['kind'] == 'dof_on'), None)
            off = next((r for r in s['rows'] if r['kind'] == 'dof_off'), None)
            if on and off:
                same = _cam_close(on['camera_matrix'], off['camera_matrix'], tol=0.02)
                cam_flags.append(same)
                if not same:
                    all_cam_ok = False
                    print('%s 组内 cam_identical=False（OFF 与 ON 相机差异超容差）' % s.get('run_id'))
        if cam_flags:
            payload_rows.append({'tag': tag, 'kind': 'cam_check', 'n': len(cam_flags),
                                 'cam_identical_all': all(cam_flags)})
            print('%s 各组 cam_identical（容差 0.02）: %s -> all=%s' % (
                tag, cam_flags, all(cam_flags)))

    if not all_cam_ok:
        raise SystemExit('A/B 失败：存在 cam_identical=False 的样本组（受控场景相机被改动）')

    sums = [r for r in payload_rows if r['kind'] == 'main']
    print('A/B 主场景全量: ' + ' | '.join(
        '%s fps_med=%s draws_med=%s tri_med=%s' % (r['tag'], r['fps_median'], r['draws_median'], r['tri_median'])
        for r in sums))
    print('结论（仅报告受控场景总帧时间/draw calls/triangles，不解释单 pass 成本；DOF pass 增量结论已撤回）')

    summ_path = os.path.join(root, 'docs', 'ai-reviews', 'cinematic-pack-3-final', 'PERF-AB-SUMMARY.json')
    payload = {
        'computed_from': [os.path.basename(f) for f in files],
        'note': '全量聚合（3 impl + 3 base 所有逐帧样本扁平化）；median/p10/worst；' +
                'DOF ON/OFF 差值不解释为单 pass 成本',
        'rows': payload_rows,
        'all_cam_identical': all_cam_ok,
    }
    h = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
    payload['summary_sha256'] = h
    with open(summ_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print('汇总:', summ_path, 'sha256:', h)


if __name__ == '__main__':
    main(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))