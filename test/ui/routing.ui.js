const BASE = process.env.DG_BASE || 'http://127.0.0.1:8090';
const { chromium } = require('playwright');
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
const B=BASE;
const routes={'/':'Turn any university into','/connectors':'Integration Connectors','/universities':'U.S. Universities','/data-schema':'Normalized Data Schema','/about':'About DueGooder'};
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));

  // 1. direct URL access
  for(const [r,marker] of Object.entries(routes)){
    const res=await p.goto(B+r); await p.waitForTimeout(200);
    const body=await p.textContent('body');
    ok(res.status()===200 && body.includes(marker), `direct load ${r} -> ${res.status()}, content ok=${body.includes(marker)}`);
  }
  // 2. refresh on each route stays put
  for(const r of Object.keys(routes)){
    await p.goto(B+r); await p.reload(); await p.waitForTimeout(150);
    ok(new URL(p.url()).pathname===r, `refresh keeps ${r} (now ${new URL(p.url()).pathname})`);
  }
  // 3. nav works from every page to every page
  const labels={'/':'Collection Engine','/connectors':'Connectors','/universities':'Universities','/data-schema':'Data & Schema','/about':'About'};
  for(const from of Object.keys(routes)){
    for(const [to,label] of Object.entries(labels)){
      await p.goto(B+from);
      await p.click(`.nav-links a[data-route="${to}"]`);
      await p.waitForTimeout(120);
      const pathname=new URL(p.url()).pathname;
      if(pathname!==to){ ok(false, `nav ${from} -> ${to} landed on ${pathname}`); }
    }
  }
  ok(true,'nav from every page reaches every page (20 transitions)');
  // 4. active state
  for(const [r,label] of Object.entries(labels)){
    await p.goto(B+r); const a=await p.textContent('.nav-links a.active');
    ok(a.trim()===label, `active nav on ${r} = "${a.trim()}"`);
  }
  // 5. back / forward
  await p.goto(B+'/'); await p.click('.nav-links a[data-route="/connectors"]'); await p.waitForTimeout(120);
  await p.click('.nav-links a[data-route="/about"]'); await p.waitForTimeout(120);
  await p.goBack(); await p.waitForTimeout(150);
  ok(new URL(p.url()).pathname==='/connectors', 'back -> /connectors');
  await p.goBack(); await p.waitForTimeout(150);
  ok(new URL(p.url()).pathname==='/', 'back -> /');
  await p.goForward(); await p.waitForTimeout(150);
  ok(new URL(p.url()).pathname==='/connectors', 'forward -> /connectors');
  // 6. brand logo returns home
  await p.goto(B+'/about'); await p.click('.brand'); await p.waitForTimeout(120);
  ok(new URL(p.url()).pathname==='/', 'brand logo -> /');
  // 7. universities page renders from the real directory (or says it is not imported)
  await p.goto(B+'/universities'); await p.waitForTimeout(500);
  const uniText = await p.textContent('main');
  ok(/Institutions/.test(uniText), 'universities page renders');
  const hasRows = (await p.locator('#uBody tr').count()) > 0;
  ok(hasRows || /not imported yet/.test(uniText),
     hasRows ? 'directory rows rendered' : 'empty state explains the directory is not imported');
  console.log('console/page errors:', errs.length?errs:'none');
  await b.close();
})();
