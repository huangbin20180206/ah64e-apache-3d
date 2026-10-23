import sys, json, time
from playwright.sync_api import sync_playwright
LV=sys.argv[2:]; port=sys.argv[1]
BOT="""(lim)=>{ const d=__dbg, T=d.targets, F=d.FLY, S=d.S; const m=S._mission; const log={kills:0, path:0, dmgAt:[]};
 const t0=S.time; let guard=0; log.sw0=d.samwar?d.samwar.launchN:0; let sw=S._swSeen||0, pend=[];
 const st=(x)=>{ d.step(x); const EA=d.enemyAir; if(EA&&EA.active){ const a0=d.apache.root.position; for(const u of EA.units){ if(!u.on||u.phase==='down'){u._bt=0;continue;} if(Math.hypot(u.x-a0.x,u.z-a0.z)<70){ u._bt=(u._bt||0)+x; if(u._bt>=5){ EA.hitTest({x:u.x,y:u.y,z:u.z},999); log.air=(log.air||0)+1; } } } } const sw2=d.samwar; if(!sw2) return; const a=d.apache.root.position; let near=1e9; for(const m of sw2.missiles) if(m.on){ const p=m.g?m.g.position:m; near=Math.min(near, Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z)); } if(near<24 && sw2._flareCool<=0 && sw2.flares>0){ dispatchEvent(new KeyboardEvent('keydown',{key:'j',code:'KeyJ'})); log.fl=(log.fl||0)+1; } };
 while (S.time - t0 < lim && m.phase==='active' && guard++<400) {
   const N=d.narrative, SW=d.samwar; const rad=N&&N.strikes?N.strikes.find(s=>s.key==='radar'&&s.alive):null;
   if(rad && SW && SW.launchN>(log.sw0||0)) { for(let k=0;k<400;k++){ const dx=rad.pos.x-F.x, dz=rad.pos.z-F.z, dd=Math.hypot(dx,dz); if(dd<=25.5) break; const s=Math.min(dd-25,4); F.x+=dx/dd*s; F.z+=dz/dd*s; F.yaw=Math.atan2(dx,dz); log.path+=s; st(0.25); if(m.phase!=='active') break; } for(let q=0;q<12;q++) st(0.25); N.hitTest({x:rad.pos.x,y:1,z:rad.pos.z},99); log.radar=Math.round(S.time-t0); continue; }
   const al=T.targets.filter(t=>t.alive && !t.benched); if(!al.length) break;
   al.sort((a,b)=>Math.hypot(a.pos.x-F.x,a.pos.z-F.z)-Math.hypot(b.pos.x-F.x,b.pos.z-F.z)); const t=al[0];
   // fly at 16u/s to a 25u standoff
   for(let k=0;k<400;k++){ const dx=t.pos.x-F.x, dz=t.pos.z-F.z, dd=Math.hypot(dx,dz); if(dd<=25.5) break; const s=Math.min(dd-25, 16*0.25); F.x+=dx/dd*s; F.z+=dz/dd*s; F.yaw=Math.atan2(dx,dz); log.path+=s; st(0.25); if(m.phase!=='active') break; }
   if(m.phase!=='active') break;
   for(let q=0;q<12;q++) st(0.25);   // aim + time of flight
   if(m.phase!=='active') break;
   if(t.alive) { T.destroy(t,2); log.kills++; }
   st(0.25); st(0.25);
   log.dmgAt.push([Math.round(S.time-t0), +(T._heliDmg||0).toFixed(1)]);
 }
 d.step(2);
 return {lvl:m.levelId, phase:m.phase, t:Math.round(S.time-t0), dmg:+(T._heliDmg||0).toFixed(1), alive:T.aliveCount, total:T.totalCount, kills:log.kills, radar:log.radar, sam:(d.samwar?d.samwar.launchN:0)-log.sw0, air:log.air||0, fl:log.fl||0, path:Math.round(log.path), lim:m.timeout||null, curve:log.dmgAt.slice(0,30)};
}"""
with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium', args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'])
  pg=b.new_page(viewport={'width':960,'height':540}); errs=[]
  pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
  pg.goto('http://localhost:%s/index.html?nocine=1&nocut=1#play'%port)
  pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.step && __dbg.progress)", timeout=150000)
  pg.evaluate("() => { __dbg.progress.isUnlocked = () => true; }")
  for lid in LV:
    t0=time.time()
    pg.evaluate("(id)=>{__dbg.startLevel(id); __dbg.step(0.5);}", lid); pg.wait_for_timeout(500)
    pg.evaluate("() => { __dbg.beginMission(); __dbg.step(1); }")
    pg.keyboard.press('t'); pg.evaluate("() => __dbg.step(12)")
    pg.evaluate('''()=>{ const T=__dbg.targets; let v=T._heliDmg||0; window.__src={}; Object.defineProperty(T,'_heliDmg',{configurable:true,get(){return v},set(n){ const dd=n-v; if(dd>0){ const st=(new Error().stack.split('\\n')[2]||'').replace(/.*:(\\d+):\\d+\\)?$/,'$1'); __src[st]=+((__src[st]||0)+dd).toFixed(1);} v=n; }}); }''')
    r=pg.evaluate(BOT, 600); r['src']=pg.evaluate('()=>__src'); r['sam']=pg.evaluate('()=>__dbg.samwar?__dbg.samwar.launchN:0'); r['lim']=pg.evaluate('()=>{const m=__dbg.S._mission; return m.timeout||m.limit||null}'); r.pop('curve')
    r['fly']=pg.evaluate("()=>__dbg.FLY.state"); r['wall']=round(time.time()-t0)
    print(json.dumps(r, ensure_ascii=False), flush=True)
  print('ERRS', errs[:4]); b.close()
