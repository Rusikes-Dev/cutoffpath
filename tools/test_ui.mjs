/* Runs index.html + app.js inside jsdom against the real data files and
   drives the UI the way a student would. */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve('site');
const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => problems.push('jsdomError: ' + e.message));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"[^>]*><\/script>/g, '')   // drop CDN scripts
  .replace('<script src="/assets/app.js" defer></script>', '');

const dom = new JSDOM(html, {
  url: 'https://cutoffpath.test/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const { window } = dom;

/* --- stub the network: serve local files, fake the API --- */
const apiCalls = [];
window.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('/api/')) {
    apiCalls.push(u.split('?')[0]);
    if (u.startsWith('/api/me')) {
      return resp(200, { access: false });
    }
    return resp(200, { ok: true });
  }
  const file = path.join(ROOT, u.split('?')[0]);
  if (!fs.existsSync(file)) return resp(404, { error: 'not found' });
  return resp(200, JSON.parse(fs.readFileSync(file, 'utf8')));
};
function resp(status, body) {
  return {
    ok: status < 400, status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}
const beacons = [];
window.navigator.sendBeacon = (url, body) => { beacons.push(url); return true; };
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.confirm = () => true;

/* --- run app.js --- */
const app = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
window.eval(app);

const $ = s => window.document.querySelector(s);
const $$ = s => [...window.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  → ' + extra : ''}`);
  if (!cond) problems.push(name);
}

const run = async () => {
  await sleep(400);   // let init() finish

  console.log('\n1. Boot');
  check('university dropdown populated', $('#univ').options.length > 10, $('#univ').options.length);
  check('region dropdown populated', $('#region').options.length > 3, $('#region').options.length);
  check('access pill shows free preview', $('#accessPill').textContent.includes('Free'));
  check('visit event tracked', beacons.includes('/api/track'), JSON.stringify(beacons));

  console.log('\n2. Validation');
  click($('#findBtn'));
  await sleep(50);
  check('empty score is rejected', $('#flash') && !$('#flash').hidden, 'no flash shown');
  $('#score').value = '150';
  click($('#findBtn'));
  await sleep(50);
  check('percentile above 100 is rejected', $('#flash').textContent.includes('between 0 and 100'));

  console.log('\n3. Search hits the paywall');
  $('#score').value = '93.4';
  click($('#findBtn'));
  await sleep(900);
  check('pay sheet opened', !$('#paySheet').hidden);
  check('pay sheet shows the match count',
    /found \d+ colleges/.test($('#payTitle').textContent), $('#payTitle').textContent);
  check('results stayed hidden before payment', $('#resultsWrap').hidden);
  check('search event tracked', beacons.filter(c => c === '/api/track').length >= 2, beacons.length + ' beacons');

  console.log('\n4. Payment form validation');
  click($('#payBtn'));
  await sleep(50);
  check('blank name rejected', !$('#payError').hidden && /full name/i.test($('#payError').textContent));
  $('#payName').value = 'Test Student';
  $('#payEmail').value = 'bad-email';
  click($('#payBtn'));
  await sleep(50);
  check('bad email rejected', /valid email/i.test($('#payError').textContent));
  $('#payEmail').value = 'test@example.com';
  $('#payPhone').value = '12345';
  click($('#payBtn'));
  await sleep(50);
  check('short phone rejected', /10-digit/i.test($('#payError').textContent));

  console.log('\n5. Results after access is granted');
  click($('#payClose'));
  window.localStorage.setItem('cp_token', 'test-token');
  window.fetch = (u, o) => {
    const s = String(u);
    if (s.startsWith('/api/me')) return resp(200, { access: true, name: 'Test Student' });
    if (s.startsWith('/api/')) return resp(200, { ok: true });
    const f = path.join(ROOT, s.split('?')[0]);
    return fs.existsSync(f) ? resp(200, JSON.parse(fs.readFileSync(f, 'utf8'))) : resp(404, {});
  };
  // force the access flag the way checkAccess would
  click($('#findBtn'));
  await sleep(200);
  click($('#payClose'));
  await sleep(50);

  // simulate a successful unlock by re-running with access on
  const rerun = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
  const dom2 = new JSDOM(html, { url: 'https://cutoffpath.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const w2 = dom2.window;
  w2.fetch = window.fetch;
  w2.navigator.sendBeacon = () => true;
  w2.scrollTo = () => {};
  w2.HTMLElement.prototype.scrollIntoView = () => {};
  w2.confirm = () => true;
  w2.localStorage.setItem('cp_token', 'test-token');
  w2.eval(rerun);
  await sleep(500);

  const q = s => w2.document.querySelector(s);
  const qq = s => [...w2.document.querySelectorAll(s)];
  const clk = el => el.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));

  check('access pill flipped to full access', q('#accessPill').textContent.includes('Full'), q('#accessPill').textContent);
  q('#score').value = '93.4';
  clk(q('#findBtn'));
  await sleep(1200);

  check('results panel is visible', !q('#resultsWrap').hidden);
  check('form collapsed after search', q('#formCard').hidden);
  const cards = qq('.result');
  check('result cards rendered', cards.length > 0, cards.length);
  check('page size capped at 25', cards.length <= 25, cards.length);
  check('summary shows a match count', /\d+ matches/.test(q('#summaryCard').textContent));
  check('tier chips present', qq('.result .tier').length === cards.length);
  check('percentile ruler drawn', qq('.result .ruler').length > 0);
  check('round badges drawn', qq('.result .rd').length > 0);
  check('college info link points at a real page',
    fs.existsSync(path.join(ROOT, cards[0].querySelector('a').getAttribute('href'))),
    cards[0].querySelector('a').getAttribute('href'));

  console.log('\n6. Paging and sorting');
  const before = qq('.result').length;
  clk(q('#showMore'));
  await sleep(100);
  check('show more appends results', qq('.result').length > before, `${before} → ${qq('.result').length}`);
  const firstBefore = qq('.result h3')[0].textContent;
  q('#sortBy').value = 'safe';
  q('#sortBy').dispatchEvent(new w2.Event('change', { bubbles: true }));
  await sleep(150);
  check('sorting reorders the list', qq('.result h3')[0].textContent !== firstBefore);

  console.log('\n7. Choice list');
  clk(qq('.result .js-add')[0]);
  await sleep(80);
  clk(qq('.result .js-add')[2]);
  await sleep(80);
  check('choice panel appeared', !q('#choiceWrap').hidden);
  check('two colleges in the list', qq('.choice').length === 2, qq('.choice').length);
  const firstName = qq('.choice .body b')[0].textContent;
  clk(qq('.choice .js-down')[0]);
  await sleep(80);
  check('reorder moves the row down', qq('.choice .body b')[1].textContent === firstName);
  check('numbering stays sequential',
    qq('.choice .ord').map(o => o.textContent).join(',') === '1,2');
  clk(qq('.choice .js-remove')[0]);
  await sleep(80);
  check('remove drops one row', qq('.choice').length === 1);
  check('choices persisted to storage',
    JSON.parse(w2.localStorage.getItem('cp_choices')).length === 1);

  console.log('\n8. Tabs');
  clk(qq('.nav button')[1]);
  await sleep(400);
  check('colleges tab visible', !q('#tab-colleges').hidden);
  check('finder tab hidden', q('#tab-finder').hidden);
  check('college list rendered', qq('#collegeList .list-item').length > 0, qq('#collegeList .list-item').length);
  check('region chips rendered', qq('#regionChips .chip').length > 3);
  q('#collegeSearch').value = 'COEP';
  q('#collegeSearch').dispatchEvent(new w2.Event('input', { bubbles: true }));
  await sleep(350);
  check('college search filters', qq('#collegeList .list-item').length < 50 && qq('#collegeList .list-item').length > 0,
    qq('#collegeList .list-item').length);
  clk(qq('.nav button')[2]);
  await sleep(100);
  check('hostel tab visible', !q('#tab-hostel').hidden);
  check('hostel shows coming soon', /coming soon/i.test(q('#tab-hostel').textContent));

  console.log('\n9. Search restored from last session');
  check('last search saved', JSON.parse(w2.localStorage.getItem('cp_last_search')).value === 93.4);

  console.log('\n' + (problems.length ? `${problems.length} PROBLEM(S):\n - ` + problems.join('\n - ')
    : 'All UI checks passed.'));
  process.exit(problems.length ? 1 : 0);
};

run().catch(e => { console.error('CRASH', e); process.exit(1); });
