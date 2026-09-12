const BASE = process.env.DG_BASE || 'http://127.0.0.1:8090';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const collections = JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','assets/data/collections.json'),'utf8'));
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) process.exitCode=1;};
const B=BASE;
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1536,height:1000}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  const ready = async () => { await p.waitForFunction(()=>document.documentElement.getAttribute('data-dg-ready')==='1',{timeout:5000}).catch(()=>{}); };

  // This suite exercises the data pipeline end to end. It needs a populated
  // directory: run `npm run import:institutions` (and optionally `npm run detect`)
  // first. Without data it skips rather than failing, because the shipped empty
  // state is covered by subtabs.ui.js.
  const probe = await ctx.request.get(B + '/assets/data/institutions.json');
  const directory = probe.ok() ? await probe.json() : [];
  if (!directory.length) {
    console.log('SKIP phase2-data.ui.js - institution directory not imported (run: npm run import:institutions)');
    await b.close();
    return;
  }

  // homepage: real directory
  await p.goto(B+'/'); await ready();
  const count=(await p.textContent('#dgInstCount')).trim();
  ok(/^[\d,]+$/.test(count), 'hero shows measured institution count: '+count);
  await p.fill('#uniInput','appstate'); await p.waitForTimeout(250);
  ok(await p.isVisible('.dgres.on'), 'search shows a results panel');
  const first=(await p.textContent('.dgr .dgr-t b')).trim();
  ok(first==='Appalachian State University','name search returns the real record: '+first);
  await p.fill('#uniInput','louisville.edu'); await p.waitForTimeout(250);
  ok((await p.textContent('.dgr .dgr-t b')).includes('Louisville'),'domain search works');
  await p.fill('#uniInput','Kentucky'); await p.waitForTimeout(250);
  ok((await p.locator('.dgr').count())>0,'state search works');
  await p.fill('#uniInput','zzzzzzz'); await p.waitForTimeout(250);
  ok((await p.textContent('.dgres')).includes('No U.S. institution'),'invalid search says so instead of inventing a result');
  await p.fill('#uniInput','appstate.edu'); await p.waitForTimeout(200);
  await p.click('#discoverBtn'); await p.waitForTimeout(300);
  const runline=await p.textContent('#runline');
  ok(/Appalachian State University/.test(runline),'discover resolves the real institution: '+runline.slice(0,110));
  ok(!/PREVIEW/i.test(await p.textContent('#runlineBadge')),'discover result is not labelled preview');

  // universities page
  await p.goto(B+'/universities'); await ready();
  ok((await p.locator('#uBody tr').count())===25,'universities page renders one page of rows (25)');
  const totalTxt=await p.textContent('#uCount');
  ok(/of [\d,]+ institutions/.test(totalTxt),'count line from real data: '+totalTxt);
  ok((await p.textContent('#uSource')).includes('IPEDS'),'source line names IPEDS');
  // The default page is alphabetical, so it holds uncollected schools; a collected
  // school has to be searched for. Both states must render distinctly.
  const lastCol=await p.locator('#uBody tr td:nth-child(6)').allTextContents();
  ok(lastCol.every(t=>t.trim()==='—'), 'uncollected institutions show an empty Last collection');
  const collectedSchools=(collections.latest&&collections.latest.schools||[]).filter(s=>s.status==='complete');
  if (collectedSchools.length) {
    const school=collectedSchools[0];
    await p.fill('#uSearch',school.domain); await p.waitForTimeout(300);
    const row=(await p.locator('#uBody tr td:nth-child(6)').allTextContents())[0]||'';
    ok(/\d{4}-\d{2}-\d{2}/.test(row), `collected school ${school.domain} shows its collection date: ${row.trim()}`);
    const platform=(await p.locator('#uBody tr td:nth-child(4)').allTextContents())[0]||'';
    ok(/Banner/i.test(platform), `collected school ${school.domain} shows its detected platform`);
    await p.fill('#uSearch',''); await p.waitForTimeout(250);
  }
  await p.fill('#uSearch','appstate'); await p.waitForTimeout(250);
  ok((await p.locator('#uBody tr').count())>=1,'universities search filters');
  await p.fill('#uSearch','');
  await p.selectOption('#uState','KY'); await p.waitForTimeout(250);
  const kyStates=await p.locator('#uBody tr td:nth-child(3)').allTextContents();
  ok(kyStates.every(s=>s.trim()==='KY')&&kyStates.length>0,'state filter works');
  await p.selectOption('#uState','');
  await p.selectOption('#uStatus','live'); await p.waitForTimeout(250);
  const sup=await p.locator('#uBody tr td:nth-child(5)').allTextContents();
  ok(sup.length>0 && sup.every(t=>/Live/.test(t)),'status filter returns only live collection-verified schools');
  await p.selectOption('#uPlatform','banner'); await p.waitForTimeout(250);
  ok((await p.locator('#uBody tr').count())>0,'platform filter works');
  await p.selectOption('#uStatus',''); await p.selectOption('#uPlatform','');
  await p.waitForTimeout(200);
  const before=await p.textContent('#uBody tr:first-child');
  await p.click('#uPager button:has-text("2")'); await p.waitForTimeout(250);
  ok(before!==(await p.textContent('#uBody tr:first-child')),'pagination works');
  ok((await p.locator('#uBody tr').count())<=25,'never more than one page of rows in the DOM');
  await p.click('#uBody button[data-inst]'); await p.waitForTimeout(250);
  const modal=await p.textContent('.modal');
  ok(/UNITID/.test(modal)&&/IPEDS record/.test(modal),'institution modal shows the real IPEDS record');
  await p.keyboard.press('Escape');

  // banner supported universities: real detector output
  await p.goto(B+'/connectors/banner/supported-universities'); await p.waitForTimeout(700);
  ok((await p.locator('#suBody tr').count())>0,'supported universities renders real detections');
  ok(/of \d+ detector results/.test(await p.textContent('#suCount')),'count line: '+(await p.textContent('#suCount')));
  const cov=await p.textContent('#covDetected');
  ok(/^\d+$/.test(cov),'coverage detected computed from data: '+cov);
  await p.click('#suBody button[data-uni]'); await p.waitForTimeout(250);
  const dmodal=await p.textContent('.modal');
  ok(/Detected signals/.test(dmodal)&&/Requests made/.test(dmodal),'detection modal shows real evidence + request count');
  await p.keyboard.press('Escape');
  await p.selectOption('#suStatus','no_match'); await p.waitForTimeout(250);
  const nm=await p.locator('#suBody tr td:nth-child(4)').allTextContents();
  ok(nm.length>0 && nm.every(t=>/No match/.test(t)),'detection-status filter works');

  // recent runs: real executions
  await p.goto(B+'/connectors/banner/recent-runs'); await p.waitForTimeout(700);
  const total=parseInt(await p.textContent('#rrTotal'),10);
  const s=parseInt(await p.textContent('#rrSuccess'),10), n=parseInt(await p.textContent('#rrNomatch'),10), f=parseInt(await p.textContent('#rrFailed'),10);
  ok(total>0 && s+n+f===total,`run summary computed from real runs (${s}+${n}+${f}=${total})`);
  const pcts=[await p.textContent('#bdSuccessPct'),await p.textContent('#bdNomatchPct'),await p.textContent('#bdFailedPct')].map(t=>parseInt(t,10));
  ok(pcts.reduce((a,b)=>a+b,0)===100,'breakdown percentages total 100: '+pcts.join('/'));
  ok((await p.locator('#rrErrors tr').count())>0,'errors table populated from real errors');
  await p.click('#rrBody button[data-run]'); await p.waitForTimeout(250);
  ok(/HTTP requests/.test(await p.textContent('.modal')),'run modal shows the real request count');
  await p.keyboard.press('Escape');

  // technical details: generated from code
  await p.goto(B+'/connectors/banner/technical-details'); await p.waitForTimeout(700);
  const sigs=await p.textContent('#tdSignals');
  ok(/weight 0.45/.test(sigs)&&/structural/.test(sigs),'signals listed with real weights from code');
  ok(/10000ms/.test(await p.textContent('#tdLimits')),'rate limits come from the code');
  ok(/DueGooderBot/.test(await p.textContent('#tdUa')),'user agent shown from code');
  const ex=await p.textContent('#tdExample');
  ok(/"platform": "banner"/.test(ex)&&/"evidence"/.test(ex),'example detection is a real stored result');
  ok((await p.textContent('#tdExampleBadge')).trim()==='Detection result','example labelled as a detection result');

  // data & schema generated from lib/schema.js
  await p.goto(B+'/data-schema'); await p.waitForTimeout(500);
  ok(/"extraction_status": "complete"/.test(await p.textContent('#schemaCode')),'schema panel generated from the canonical schema');
  await p.goto(B+'/data-schema/example-record'); await p.waitForTimeout(500);
  ok((await p.locator('#recBody tr').count())===20,'example record lists all 20 canonical fields');
  await p.goto(B+'/data-schema/field-definitions'); await p.waitForTimeout(500);
  ok((await p.locator('#defBody tr').count())===20,'field definitions generated for all 20 fields');
  const req=await p.locator('#defBody tr td:nth-child(3) .req.yes').count();
  ok(req===12,'required markers match the schema (12 required): '+req);

  // connectors registry
  await p.goto(B+'/connectors'); await p.waitForTimeout(500);
  const cards=await p.textContent('#cnCards');
  ok(/Collector live/.test(cards)&&/Not implemented/.test(cards),'connector cards reflect real collection availability');
  ok((await p.locator('#cnCards .cn-card').count())===5,'five platforms listed');

  console.log('errors:', errs.length?errs:'none');
  await b.close();
})();
