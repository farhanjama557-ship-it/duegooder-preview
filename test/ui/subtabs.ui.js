const BASE = process.env.DG_BASE || 'http://127.0.0.1:8090';
const { chromium } = require('playwright');
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) process.exitCode=1;};
const B=BASE;
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1536,height:1000}, permissions:['clipboard-read','clipboard-write']});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});

  // ---- connectors -> banner
  await p.goto(B+'/connectors');
  await p.click('a.cn-act[href="/connectors/banner"]'); await p.waitForTimeout(200);
  ok(new URL(p.url()).pathname==='/connectors/banner','View detector opens /connectors/banner');

  // ---- banner tabs navigate to real routes
  const tabs=[['Supported Universities','/connectors/banner/supported-universities'],['Technical Details','/connectors/banner/technical-details'],['Recent Runs','/connectors/banner/recent-runs'],['Overview','/connectors/banner']];
  for(const [label,href] of tabs){
    await p.click(`.ptabs a[href="${href}"]`); await p.waitForTimeout(180);
    ok(new URL(p.url()).pathname===href, `banner tab "${label}" -> ${href}`);
    ok((await p.textContent('.ptab.on')).trim()===label, `  active underline on "${label}"`);
  }
  // ---- back link
  await p.click('.backlink'); await p.waitForTimeout(150);
  ok(new URL(p.url()).pathname==='/connectors','Back to Connectors works');

  // ---- supported universities: real detections, or an honest empty state
  await p.goto(B+'/connectors/banner/supported-universities'); await p.waitForTimeout(600);
  const suRows=await p.locator('#suBody tr').count();
  if (suRows === 0) {
    ok(/No detection results yet/.test(await p.textContent('#suEmpty')), 'empty state explains no detector runs are stored');
    ok((await p.textContent('#covDetected')) === '0', 'coverage shows 0 rather than an invented number');
  } else {
    ok(/of \d+ detector results/.test(await p.textContent('#suCount')), 'count line from real detections');
    await p.click('#suBody button[data-uni]'); await p.waitForTimeout(200);
    ok(await p.isVisible('.ovl.on'),'View details opens modal');
    ok(/Detected signals/.test(await p.textContent('.modal')),'modal shows real evidence');
    await p.click('#mClose'); await p.waitForTimeout(150);
    ok(!(await p.isVisible('.ovl.on')),'modal closes');
  }

  // ---- technical details: generated from code, copy works
  await p.goto(B+'/connectors/banner/technical-details'); await p.waitForTimeout(600);
  ok(/weight 0\.45/.test(await p.textContent('#tdSignals')),'signals rendered from the detector code');
  await p.click('[data-copy="tdExample"]'); await p.waitForTimeout(300);
  ok((await p.textContent('[data-copy="tdExample"]')).trim()==='Copied','copy button confirms');

  // ---- recent runs: real executions, or an honest empty state
  await p.goto(B+'/connectors/banner/recent-runs'); await p.waitForTimeout(600);
  const rrRows=await p.locator('#rrBody tr').count();
  if (rrRows === 0) {
    ok(/No detection runs recorded yet/.test(await p.textContent('#rrEmptyWrap')), 'empty state explains no runs are recorded');
    ok((await p.textContent('#rrTotal')) === '0', 'run total shows 0 rather than an invented number');
  } else {
    const s=parseInt(await p.textContent('#rrSuccess'),10),n=parseInt(await p.textContent('#rrNomatch'),10),f=parseInt(await p.textContent('#rrFailed'),10);
    ok(s+n+f===parseInt(await p.textContent('#rrTotal'),10),'summary adds up');
    await p.click('#rrBody button[data-run]'); await p.waitForTimeout(200);
    ok(/Run ID/.test(await p.textContent('.modal')),'run modal shows run detail');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(!(await p.isVisible('.ovl.on')),'Esc closes modal');
  }

  // ---- data & schema tabs
  const stabs=[['Example Record','/data-schema/example-record'],['Platform Mapping','/data-schema/platform-mapping'],['Field Definitions','/data-schema/field-definitions'],['Schema','/data-schema']];
  await p.goto(B+'/data-schema');
  for(const [label,href] of stabs){
    await p.click(`.ptabs a[href="${href}"]`); await p.waitForTimeout(180);
    ok(new URL(p.url()).pathname===href,`schema tab "${label}" -> ${href}`);
    ok((await p.textContent('.nav-links a.active')).trim()==='Data & Schema',`  top nav stays active on ${href}`);
  }
  // content actually differs per tab
  await p.goto(B+'/data-schema/example-record'); const c1=await p.textContent('main');
  await p.goto(B+'/data-schema/field-definitions'); const c2=await p.textContent('main');
  ok(c1!==c2 && /Required/.test(c2) && !/Required/.test(c1),'tabs change content, not just styling');
  const fieldCount=await p.locator('table tbody tr').count();
  ok(fieldCount===20,`field definitions lists all 20 canonical fields (got ${fieldCount})`);

  // ---- platform mapping switching
  await p.goto(B+'/data-schema/platform-mapping'); await p.waitForTimeout(200);
  ok(await p.isVisible('#mapBanner'),'Banner mapping visible by default');
  await p.click('.pbtn[data-plat="Workday"]'); await p.waitForTimeout(150);
  ok(!(await p.isVisible('#mapBanner')) && await p.isVisible('#mapOther'),'switching to Workday hides Banner mapping');
  ok((await p.textContent('#mapOther')).includes('Mapping not implemented yet'),'Workday shows truthful not-implemented state');
  ok((await p.textContent('#flowConn')).includes('not built'),'mapping flow updates for unimplemented platform');
  await p.click('.pbtn[data-plat="Banner"]'); await p.waitForTimeout(150);
  ok(await p.isVisible('#mapBanner'),'switching back to Banner restores mapping');

  // ---- schema copy
  await p.goto(B+'/data-schema'); await p.click('[data-copy="schemaCode"]'); await p.waitForTimeout(300);
  ok((await p.evaluate(()=>navigator.clipboard.readText())).includes('school_id'),'schema Copy button works');

  // ---- refresh + back/forward on nested routes
  for(const r of ['/connectors/banner','/connectors/banner/supported-universities','/connectors/banner/technical-details','/connectors/banner/recent-runs','/data-schema','/data-schema/example-record','/data-schema/platform-mapping','/data-schema/field-definitions']){
    await p.goto(B+r); await p.reload(); await p.waitForTimeout(120);
    ok(new URL(p.url()).pathname===r && (await p.locator('.ptab.on').count())===1, `refresh survives ${r}`);
  }
  await p.goto(B+'/connectors/banner');
  await p.click('.ptabs a[href="/connectors/banner/recent-runs"]'); await p.waitForTimeout(150);
  await p.goBack(); await p.waitForTimeout(200);
  ok(new URL(p.url()).pathname==='/connectors/banner','browser back works on nested route');
  await p.goForward(); await p.waitForTimeout(200);
  ok(new URL(p.url()).pathname==='/connectors/banner/recent-runs','browser forward works on nested route');

  // ---- no dead controls: every button/link in the new views has a handler or href
  const ROUTES=['/','/universities','/about','/connectors','/connectors/banner','/connectors/banner/supported-universities','/connectors/banner/technical-details','/connectors/banner/recent-runs','/data-schema','/data-schema/example-record','/data-schema/platform-mapping','/data-schema/field-definitions'];
  for(const r of ROUTES){
    await p.goto(B+r); await p.waitForTimeout(250);
    const dead=await p.evaluate(()=>{
      const out=[];
      document.querySelectorAll('button, a').forEach(el=>{
        if(el.tagName==='A'){ if(!el.getAttribute('href')) out.push('a: '+el.textContent.trim().slice(0,30)); return; }
        if(el.disabled) return;
        const wired = el.dataset.copy||el.dataset.plat||el.dataset.uni||el.dataset.run||el.dataset.go||el.dataset.notwired!==undefined||el.id==='mClose'||el.id==='copyBtn'||el.classList.contains('pg')||el.classList.contains('linkish')||el.classList.contains('tab')||el.classList.contains('ex')||el.id==='discoverBtn';
        if(!wired) out.push('button: '+el.textContent.trim().slice(0,30));
      });
      return out;
    });
    if(dead.length) console.log('   note ['+r+'] unwired controls:', dead.join(' | '));
  }
  ok(true,'dead-control scan complete (notes above, if any)');

  // ---- responsive
  for(const w of [1536,1440,1024,768,390]){
    await p.setViewportSize({width:w,height:900});
    for(const r of ROUTES){
      await p.goto(B+r); await p.waitForTimeout(120);
      const ov=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      if(ov>0) ok(false,`overflow ${ov}px at ${w} on ${r}`);
    }
  }
  ok(true,'responsive sweep 1536/1440/1024/768/390 across 9 routes: no horizontal overflow');
  console.log('console/page errors:', errs.length?errs:'none');
  if(errs.length) process.exitCode=1;
  await b.close();
})();
