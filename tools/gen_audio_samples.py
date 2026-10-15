# -*- coding: utf-8 -*-
"""Phase 13-A1 音频样本生成器（纯标准库，免版权自合成）

为电影镜头包第 2 阶段生成 4 个 WAV 样本（22050Hz 单声道 16-bit PCM）：
  engine.wav   3.5s  涡轴发动机轰鸣（涡轮啸叫谐波 + 桨叶拍击脉冲串 + 布朗隆隆）
  wind.wav     4.0s  环境风（粉噪 + 不规则阵风幅度调制）
  brass.wav    1.4s  短促铜管（谐波堆 + 快起音 + 迟发颤音，击毁 cue）
  pad.wav      4.0s  氛围垫乐（Am7 和弦 = 4 音 × 3 失谐锯齿 + 慢 LFO 滤波，可循环）

Web Audio 合成为默认路径，真实样本只用于"合成做不出来的手感"——引擎轰鸣 /
风声 / 短促铜管 / 环境音场四类（约束 A1）。全部自合成 = 零版权风险、可复现。
用法：uv run python tools/gen_audio_samples.py   （输出到 assets/audio/）
"""
import math
import os
import random
import struct
import wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'audio')


def write_wav(name, samples, peak=0.9):
    """samples: iterable of floats；peak 归一化目标。返回字节数。"""
    m = max(1e-6, max(abs(s) for s in samples))
    k = peak / m
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(
            struct.pack('<h', int(max(-1.0, min(1.0, s * k)) * 32767)) for s in samples))
    return os.path.getsize(path)


def harmonics(f0, n, amp_fn, detune=0.0, phase0=0.0):
    """n 次谐波叠加正弦（相位连续增量式，避免逐样本重算 2πft）。"""
    freqs = [f0 * i * (1.0 + detune) for i in range(1, n + 1)]
    amps = [amp_fn(i) for i in range(1, n + 1)]
    ph = [phase0] * n
    dph = [2 * math.pi * f / SR for f in freqs]

    def gen(dur):
        samples = int(dur * SR)
        for _ in range(samples):
            v = 0.0
            for i in range(n):
                ph[i] += dph[i]
                v += amps[i] * math.sin(ph[i])
            yield v
    return gen


def noise_buf(kind, dur):
    """kind: 'white' | 'brown' | 'pink'（Paul Kellet 经济粉噪）。返回生成器。"""
    n = int(dur * SR)
    rnd = random.Random(0xA1B2C3D)
    if kind == 'white':
        for _ in range(n):
            yield rnd.uniform(-1, 1)
    elif kind == 'brown':
        acc = 0.0
        for _ in range(n):
            acc = (acc + rnd.uniform(-1, 1) * 0.08) * 0.997
            yield acc * 12.0
    else:  # pink：三个泄漏积分器
        b0 = b1 = b2 = 0.0
        for _ in range(n):
            w = rnd.uniform(-1, 1)
            b0 = 0.997 * b0 + 0.029591 * w
            b1 = 0.985 * b1 + 0.032534 * w
            b2 = 0.950 * b2 + 0.048056 * w
            yield (b0 + b1 + b2 + w * 0.05) * 3.0


def one_pole_lp(samples, cutoff_hz):
    """一阶低通（迭代器），返回 list。"""
    a = math.exp(-2 * math.pi * cutoff_hz / SR)
    out = []
    prev = 0.0
    for s in samples:
        prev = (1 - a) * s + a * prev
        out.append(prev)
    return out


def gen_engine():
    """涡轮啸叫(110Hz 谐波, 0.5Hz 转速呼吸) + 桨叶拍击(18.7Hz 脉冲) + 布朗隆隆。"""
    dur = 3.5
    n = int(dur * SR)
    out = [0.0] * n
    # 涡轮啸叫：f0 缓慢呼吸 ±2%（0.5Hz LFO）+ 高频微颤
    whine = harmonics(110.0, 8, lambda i: 1.0 / i ** 1.25)
    wh = list(whine(dur))
    for i in range(n):
        t = i / SR
        lfo = 1.0 + 0.02 * math.sin(2 * math.pi * 0.5 * t) + 0.004 * math.sin(2 * math.pi * 6.3 * t + 1.1)
        out[i] += wh[i] * lfo * 0.32
    # 桨叶拍击：18.7Hz 脉冲串（4 叶 × 280RPM），每拍=95Hz 基频+谐波的快衰减爆点
    slap_p = 1.0 / 18.7
    for start in range(0, n, int(slap_p * SR)):
        plen = int(0.055 * SR)
        for j in range(min(plen, n - start)):
            t = j / SR
            env = math.exp(-t * 90.0)
            v = (math.sin(2 * math.pi * 95 * t) * 0.6
                 + math.sin(2 * math.pi * 190 * t) * 0.3
                 + math.sin(2 * math.pi * 285 * t) * 0.15) * env
            out[start + j] += v * 0.42
    # 布朗隆隆（低通到 110Hz）
    rum = one_pole_lp(noise_buf('brown', dur), 110.0)
    for i in range(n):
        out[i] += rum[i] * 0.5
    return out


def gen_wind():
    """粉噪 + 不规则阵风 AM（主阵风 2.6s 周期 + 1.3s 次级起伏）+ 低通柔和。"""
    dur = 4.0
    n = int(dur * SR)
    pink = list(noise_buf('pink', dur))
    pink = one_pole_lp(pink, 2400.0)
    out = []
    for i in range(n):
        t = i / SR
        gust = (0.52 + 0.42 * (0.5 + 0.5 * math.sin(2 * math.pi * t / 2.6))
                + 0.16 * math.sin(2 * math.pi * t / 1.3 + 2.1)
                + 0.10 * math.sin(2 * math.pi * t / 0.73 + 0.7))
        out.append(pink[i] * gust)
    return out


def gen_brass():
    """短促铜管：110Hz 谐波堆（奇次强、偶次弱，双份轻微失谐）快起音 + 迟发颤音。"""
    dur = 1.4
    n = int(dur * SR)
    f0 = 110.0
    parts = []
    for det in (-0.002, 0.002):
        g = harmonics(f0, 12, lambda i: (1.35 if i % 2 else 0.75) / i ** 0.85, detune=det)
        parts.append(list(g(dur)))
    # 起音噪声爆点
    atk = list(noise_buf('white', dur))
    out = []
    for i in range(n):
        t = i / SR
        vib = 1.0 + (0.004 * math.sin(2 * math.pi * 5.5 * max(0.0, t - 0.4)) if t > 0.4 else 0.0)
        attack = min(1.0, t / 0.008)
        body = (parts[0][i] + parts[1][i]) * attack * math.exp(-t * 2.0)
        release = min(1.0, (dur - t) / 0.30)
        noise = atk[i] * math.exp(-t * 55.0) * 0.10
        out.append((body * vib + noise) * release)
    return out


def gen_pad():
    """氛围垫乐：Am7 = A3/C4/E4/G4，各 3 份失谐锯齿（谐波和），900Hz 低通，慢 LFO 滤波。"""
    dur = 4.0
    n = int(dur * SR)
    notes = [220.0, 261.63, 329.63, 392.0]          # A3 C4 E4 G4
    detunes = (-0.003, 0.0, 0.005)
    layers = []
    for f0 in notes:
        for det in detunes:
            g = harmonics(f0, 8, lambda i: 1.0 / i, detune=det, phase0=random.Random(int(f0 * 1000)).random() * 6.28)
            layers.append(list(g(dur)))
    # 慢 LFO 调制低通截止（1400Hz 中心 ±35%）
    raw = [0.0] * n
    for i in range(n):
        t = i / SR
        lfo = 1.0 + 0.35 * math.sin(2 * math.pi * t / 7.3)
        cutoff = 1400.0 * lfo
        a = math.exp(-2 * math.pi * cutoff / SR)
        v = sum(ly[i] for ly in layers) / (len(notes) * 3)
        raw[i] = v
    lp = one_pole_lp(raw, 1400.0)                    # 初滤一次去齿音
    # 循环无缝：前后 0.35s 线性淡入淡出（掩盖循环点咔哒）
    fade = int(0.35 * SR)
    out = []
    for i in range(n):
        f = 1.0
        if i < fade:
            f = i / fade
        elif i > n - fade:
            f = (n - i) / fade
        out.append(lp[i] * f)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    specs = [
        ('engine.wav', gen_engine(), 0.9),
        ('wind.wav', gen_wind(), 0.85),
        ('brass.wav', gen_brass(), 0.9),
        ('pad.wav', gen_pad(), 0.65),
    ]
    total = 0
    for name, gen, peak in specs:
        size = write_wav(name, gen, peak)
        total += size
        print('%s  %5.1f KB' % (name, size / 1024))
    print('total %5.1f KB (limit 1500)' % (total / 1024))


if __name__ == '__main__':
    main()
