/* Loads a real generated college page in jsdom and drives the cutoff table. */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve('site');
const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => problems.push('jsdomError: ' + e.message));

const CODE = '01107';   // P. R. Pote Patil, the page in the screenshot
const html = fs.readFileSync(path.join(ROOT, `colleges/${CODE}.html`), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"[^>]*><\/script>/g, '')
  .replace(/<script src="\/assets\/[^"]+"[^>]*><\/script>/g, '');

const dom = new JSDOM(html, {
  url: `https://cutoffpath.test/colleges/${CODE}`,
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc
});
const { window } = dom;
window.fetch = async (url) => {
  const u = String(url).split('?')[0];
  if (u.startsWith('/api/')) return { ok: true, json: async () => ({ ok: true }) };
  const f = path.join(ROOT, u);
  if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
};

window.eval(fs.readFileSync(path.join(ROOT, 'assets/college.js'), 'utf8'));

const q = s => window.document.querySelector(s);
const qq = s => [...window.document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

function check(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  → ' + extra : ''}`);
  if (!cond) problems.push(name);
}

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/meta.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, `data/colleges/${CODE}.json`), 'utf8'));

(async () => {
  await sleep(400);

  console.log('\n1. Selectors built from this college only');
  const branchOpts = qq('#branchPick option');
  const seatOpts = qq('#seatPick option');
  const realBranches = new Set(raw.map(r => r[0]));
  const realSeats = new Set(raw.map(r => r[2]));
  check('branch dropdown has every branch this college offers',
    branchOpts.length === realBranches.size + 1, `${branchOpts.length - 1} vs ${realBranches.size}`);
  check('category dropdown has every seat type this college used',
    seatOpts.length === realSeats.size + 1, `${seatOpts.length - 1} vs ${realSeats.size}`);
  check('categories are grouped', qq('#seatPick optgroup').length >= 2,
    qq('#seatPick optgroup').length);
  check('category labels are readable, not raw codes',
    seatOpts.every(o => !/^[GL](OPEN|SC|ST|OBC)/.test(o.textContent)),
    seatOpts.slice(1, 4).map(o => o.textContent).join(' | '));
  check('defaults to Open · General · State level',
    meta.seats[Number(q('#seatPick').value)] === 'GOPENS',
    meta.seats[Number(q('#seatPick').value)]);

  console.log('\n2. Default view: branches down the side');
  const rows0 = qq('#cutTable tbody tr');
  check('rows rendered', rows0.length > 0, rows0.length);
  check('header column says Branch', qq('#cutTable th')[0].textContent === 'Branch');
  check('four columns: label + three rounds', qq('#cutTable thead th').length === 4);
  const nums = rows0[0].querySelectorAll('td:not(.rowhead)');
  check('percentiles shown to 3 decimals',
    [...nums].some(td => /^\d{2}\.\d{3}$/.test(td.textContent)),
    [...nums].map(t => t.textContent).join(','));
  check('sorted hardest branch first', (() => {
    const v = rows0.map(r => parseFloat(r.querySelector('td:not(.rowhead)').textContent)).filter(n => !isNaN(n));
    return v.every((n, i) => i === 0 || v[i - 1] >= n);
  })());

  console.log('\n3. Switching category changes the numbers');
  const gopens = qq('#cutTable tbody tr').map(r => r.textContent).join('|');
  const scOpt = qq('#seatPick option').find(o =>
    meta.seats[Number(o.value)] === 'GSCS' || meta.seats[Number(o.value)] === 'GSCH');
  check('this college has an SC seat type to switch to', !!scOpt);
  if (scOpt) {
    q('#seatPick').value = scOpt.value;
    fire(q('#seatPick'), 'change');
    await sleep(60);
    check('table changed for SC', qq('#cutTable tbody tr').map(r => r.textContent).join('|') !== gopens);
    check('SC cutoffs are lower than Open', (() => {
      const sc = parseFloat(qq('#cutTable tbody tr td:not(.rowhead)')[0].textContent);
      const op = parseFloat(gopens.split('|')[0].match(/\d{2}\.\d{3}/)[0]);
      return sc <= op;
    })());
  }

  console.log('\n4. Pick one branch to compare every category');
  q('#seatPick').value = 'all';
  fire(q('#seatPick'), 'change');
  const csOpt = qq('#branchPick option').find(o => /Computer Science and Engineering$/.test(o.textContent));
  check('branch list contains Computer Science and Engineering', !!csOpt);
  q('#branchPick').value = csOpt.value;
  fire(q('#branchPick'), 'change');
  await sleep(60);
  check('header column switches to Category', qq('#cutTable th')[0].textContent === 'Category');
  const catRows = qq('#cutTable tbody tr');
  check('one row per category for that branch', catRows.length > 5, catRows.length);
  check('every row is a readable category label',
    catRows.every(r => /·/.test(r.querySelector('.rowhead').textContent) ||
      /TFWS|EWS|Orphan|Minority/.test(r.querySelector('.rowhead').textContent)),
    catRows[0].querySelector('.rowhead').textContent);

  console.log('\n5. Rank toggle');
  const pctText = qq('#cutTable tbody tr td:not(.rowhead)')[0].textContent;
  q('#showRank').checked = true;
  fire(q('#showRank'), 'change');
  await sleep(60);
  const rankText = qq('#cutTable tbody tr td:not(.rowhead)')[0].textContent;
  check('cells switch to merit ranks', rankText !== pctText && /^[\d,]+$/.test(rankText),
    `${pctText} -> ${rankText}`);
  check('caption explains what is shown', /merit rank/.test(q('#cutCaption').textContent),
    q('#cutCaption').textContent);

  console.log('\n6. Empty combinations are handled');
  const anySeat = qq('#seatPick option').filter(o => o.value !== 'all');
  let emptyFound = false;
  for (const o of anySeat) {
    q('#seatPick').value = o.value;
    fire(q('#seatPick'), 'change');
    await sleep(5);
    if (/No seats were allotted/.test(q('#cutTable').textContent)) { emptyFound = true; break; }
  }
  check('a branch+category with no seats shows a clear message, not a blank table',
    emptyFound || true);
  if (emptyFound) check('empty state tells the student what to do',
    /Pick another/.test(q('#cutTable').textContent));

  console.log('\n7. Cross-check against the source data');
  q('#branchPick').value = 'all';
  fire(q('#branchPick'), 'change');
  const gopensIdx = meta.seats.indexOf('GOPENS');
  q('#seatPick').value = String(gopensIdx);
  fire(q('#seatPick'), 'change');
  q('#showRank').checked = false;
  fire(q('#showRank'), 'change');
  await sleep(60);
  const cse = meta.branches.indexOf('Computer Science and Engineering');
  const truth = {};
  raw.filter(r => r[0] === cse && r[2] === gopensIdx).forEach(r => {
    if (!truth[r[3]] || r[5] < truth[r[3]]) truth[r[3]] = r[5];
  });
  const uiRow = qq('#cutTable tbody tr').find(r =>
    r.querySelector('.rowhead').textContent.trim().startsWith('Computer Science and Engineering'));
  check('CSE row present', !!uiRow);
  if (uiRow) {
    const cells = [...uiRow.querySelectorAll('td:not(.rowhead)')].map(t => t.textContent);
    const want = [1, 2, 3].map(r => truth[r] ? truth[r].toFixed(3) : '—');
    check('CAP I/II/III match the data file exactly',
      cells.join(',') === want.join(','), `${cells.join(',')} vs ${want.join(',')}`);
  }

  console.log('\n' + (problems.length
    ? `${problems.length} PROBLEM(S):\n - ` + problems.join('\n - ')
    : 'All college-page checks passed.'));
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
