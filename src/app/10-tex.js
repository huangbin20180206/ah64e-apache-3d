// ============================================================
// 10-tex.js — 程序化地面贴图：停机坪 / 接地阴影
// ============================================================

// 停机坪：混凝土基底 + fBm 脏污 + 白色圆环与 H 标 + 法线/粗糙度
function makeHelipad(N = 1536) {
  const { c, x } = canvas2d(N);
  const R = N * 0.5;

  // 混凝土基色
  x.fillStyle = '#4a4d50';
  x.fillRect(0, 0, N, N);
  fbmInto(x, N, N, { octaves: 6, base: 3, alpha: 0.42 });

  // 径向渐暗，让边缘融入远景
  const vg = x.createRadialGradient(R, R, R * 0.2, R, R, R);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  x.fillStyle = vg;
  x.fillRect(0, 0, N, N);

  // 铺装分块缝
  x.strokeStyle = 'rgba(20,22,24,0.55)';
  x.lineWidth = Math.max(1, N / 640);
  const step = N / 8;
  for (let i = 1; i < 8; i++) {
    x.beginPath(); x.moveTo(i * step, 0); x.lineTo(i * step, N); x.stroke();
    x.beginPath(); x.moveTo(0, i * step); x.lineTo(N, i * step); x.stroke();
  }

  // 白色双圆环（手动反馈第 2 批：0.86 高对比完整实线环在俯视像"靶标"——
  // 降为 0.42 半透明、线宽收细、配合下方加强的磨损，保留停机坪识别性但不再抢眼）
  x.strokeStyle = 'rgba(226,230,232,0.42)';
  x.lineWidth = N * 0.016;
  x.beginPath(); x.arc(R, R, R * 0.60, 0, TAU); x.stroke();
  x.lineWidth = N * 0.009;
  x.beginPath(); x.arc(R, R, R * 0.70, 0, TAU); x.stroke();

  // H 标
  const hw = R * 0.40, hh = R * 0.52, bar = R * 0.115;
  x.fillStyle = 'rgba(230,234,236,0.90)';
  x.fillRect(R - hw * 0.5, R - hh * 0.5, bar, hh);
  x.fillRect(R + hw * 0.5 - bar, R - hh * 0.5, bar, hh);
  x.fillRect(R - hw * 0.5, R - bar * 0.5, hw, bar);

  // 轮胎痕与油渍
  x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 26; i++) {
    const a = rnd(TAU), d = rnd(R * 0.15, R * 0.78);
    const px = R + Math.cos(a) * d, py = R + Math.sin(a) * d, rr = rnd(N * 0.012, N * 0.055);
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, `rgba(28,26,24,${rnd(0.20, 0.45).toFixed(3)})`);
    g.addColorStop(1, 'rgba(28,26,24,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill();
  }
  x.globalCompositeOperation = 'source-over';

  // 圆环外磨损，让白漆不那么新（0.14→0.22：配合双环降对比，标线更旧更自然）
  x.globalCompositeOperation = 'destination-out';
  const worn = noiseCanvas(96);
  x.globalAlpha = 0.22;
  x.drawImage(worn, 0, 0, N, N);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  // 高度图 -> 法线：只取混凝土颗粒，不含漆面
  const hcv = fbmCanvas(512, { octaves: 5, base: 4, alpha: 0.55 });
  const nrm = heightToNormal(hcv, 1.1);

  // 粗糙度：漆面略光滑，混凝土粗糙
  const rq = canvas2d(512);
  rq.x.drawImage(c, 0, 0, 512, 512);
  const id = rq.x.getImageData(0, 0, 512, 512), pd = id.data;
  for (let i = 0; i < pd.length; i += 4) {
    // 亮的地方是白漆 -> 粗糙度低
    const lum = (pd[i] * 0.3 + pd[i + 1] * 0.59 + pd[i + 2] * 0.11) / 255;
    const r = clamp(0.94 - lum * 0.30, 0.55, 0.97) * 255;
    pd[i] = pd[i + 1] = pd[i + 2] = r;
  }
  rq.x.putImageData(id, 0, 0);

  return {
    map: tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping, aniso: 8 }),
    normalMap: tex(nrm, { repeat: 6 }),
    roughnessMap: tex(rq.c, { wrap: THREE.ClampToEdgeWrapping }),
  };
}

// 机身正下方的软接地阴影贴片
function makeContactShadow(N = 256) {
  const { c, x } = canvas2d(N);
  const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0.00, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.10)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

// 远景地面：低频起伏的灰绿色，避免大片纯色
function makeFarGround(N = 512) {
  const { c, x } = canvas2d(N);
  x.fillStyle = '#3b423c';
  x.fillRect(0, 0, N, N);
  fbmInto(x, N, N, { octaves: 6, base: 2, alpha: 0.5 });
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = 'rgba(120,132,110,0.55)';
  x.fillRect(0, 0, N, N);
  x.globalCompositeOperation = 'source-over';
  return tex(c, { srgb: true, repeat: 8 });
}
