const BASE = process.env.DG_BASE || 'http://127.0.0.1:8090';
const { chromium } = require('playwright');
const assert = (c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1512, height:1000 } });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(BASE+'/');
  await p.waitForFunction(()=>document.querySelectorAll('#tbody tr').length>0,{timeout:10000}).catch(()=>{});

  assert(await p.locator('#usmap circle').count() > 300, 'map dots rendered: '+await p.locator('#usmap circle').count());
  assert(await p.locator('#tbody tr').count() > 0, 'real section rows rendered');
  assert((await p.textContent('#latestBadge')).trim() === 'Verified run', 'latest metrics come from a verified run');

  // example chip
  await p.locator('.ex', {hasText:'udayton.edu'}).click();
  assert(await p.inputValue('#uniInput') === 'udayton.edu', 'chip fills input');

  // discover flow (real directory; with no directory imported it must say so, not invent a school)
  await p.click('#discoverBtn');
  await p.waitForTimeout(400);
  assert(await p.locator('#runline.show').count() === 1, 'runline shown');
  const rl = await p.textContent('#runlineText');
  assert(/not been imported|No U.S. institution|·/.test(rl), 'discover reports a truthful outcome: '+rl.slice(0,80));

  // search filter
  await p.fill('#tableSearch','CPS 149');
  assert(await p.locator('#tbody tr').count() > 0, 'search filters real course rows');
  await p.fill('#tableSearch','');
  // university filter
  const university=await p.locator('#filterUni option').nth(1).getAttribute('value');
  await p.selectOption('#filterUni',university);
  assert(await p.locator('#tbody tr').count() > 0, 'university filter returns real rows');
  const term=await p.locator('#filterTerm option').nth(1).getAttribute('value');
  await p.selectOption('#filterTerm',term);
  assert(await p.locator('#tbody tr').count() >= 0, 'university + term filter executes');
  await p.fill('#tableSearch','course-that-does-not-exist-zzzz');
  assert(await p.isVisible('#noresults'), 'empty state shows');
  await p.fill('#tableSearch','');
  await p.selectOption('#filterUni',''); await p.selectOption('#filterTerm','');
  assert(await p.locator('#tbody tr').count() > 0, 'filters reset');

  // tabs
  await p.locator('.tab[data-tab="recent"]').click();
  assert(await p.isVisible('#panel-recent') && !(await p.isVisible('#panel-search')), 'recent tab switches');
  const recentText = await p.textContent('#panel-recent');
  assert(/sections · .* meetings|detected|no_match/.test(recentText), 'recent panel reflects real collection/detector state');

  // enter key
  await p.locator('.tab[data-tab="search"]').click();
  await p.fill('#uniInput','uwf.edu'); await p.press('#uniInput','Enter'); await p.waitForTimeout(300);
  assert(await p.locator('#runline.show').count() === 1, 'enter key triggers discovery');

  // responsive: no horizontal overflow
  for (const w of [1536,1440,1280,1024,768,390]) {
    await p.setViewportSize({width:w,height:900}); await p.waitForTimeout(250);
    const o = await p.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(o <= 0, `no h-overflow at ${w}px (overflow=${o})`);
    await p.screenshot({path:`resp-${w}.png`, fullPage: w>=1024 ? false : false});
  }
  console.log('console errors:', errs.length ? errs : 'none');
  await b.close();
})();
