/* Ports the exact eligibility + matching logic out of site/assets/app.js and
   runs it against the real shards, so we can check the numbers make sense. */
import fs from 'node:fs';

const meta = JSON.parse(fs.readFileSync('site/data/meta.json', 'utf8'));
const shardCache = {};
const shard = f => shardCache[f] ??=
  JSON.parse(fs.readFileSync(`site/data/shards/${f}.json`, 'utf8'));

/* --- copied verbatim from app.js --- */
const seatCache = {};
function decodeSeat(code) {
  if (seatCache[code]) return seatCache[code];
  let out;
  if (code === 'TFWS') out = { fam: 'TFWS' };
  else if (code === 'EWS') out = { fam: 'EWS' };
  else if (code === 'MI') out = { fam: 'MI' };
  else if (code.indexOf('ORPHAN') === 0) out = { fam: 'ORPHAN' };
  else {
    let fam = 'GEN', rest = code, gender = null;
    if (code.indexOf('PWDR') === 0) { fam = 'PWD'; rest = code.slice(4); }
    else if (code.indexOf('PWD') === 0) { fam = 'PWD'; rest = code.slice(3); }
    else if (code.indexOf('DEFR') === 0) { fam = 'DEF'; rest = code.slice(4); }
    else if (code.indexOf('DEF') === 0) { fam = 'DEF'; rest = code.slice(3); }
    else { gender = code[0]; rest = code.slice(1); }
    const suf = rest.slice(-1);
    out = { fam, gender, base: rest.slice(0, -1), scope: suf };
  }
  seatCache[code] = out;
  return out;
}

function buildFilter(profile) {
  const bases = new Set(['OPEN']);
  if (profile.category) bases.add(profile.category);
  const genders = profile.gender === 'F' ? ['G', 'L'] : ['G'];
  const specials = profile.specials || [];
  const univIdx = profile.univIdx;
  return function (seatCode, collegeUnivIdx) {
    const s = decodeSeat(seatCode);
    if (s.fam === 'GEN') {
      if (!bases.has(s.base)) return false;
      if (genders.indexOf(s.gender) === -1) return false;
    } else if (s.fam === 'PWD' || s.fam === 'DEF') {
      if (specials.indexOf(s.fam) === -1) return false;
      if (s.base && s.base !== 'OPEN' && !bases.has(s.base)) return false;
    } else {
      if (specials.indexOf(s.fam) === -1) return false;
      return true;
    }
    if (!s.scope || s.scope === 'S') return true;
    if (univIdx === '' || univIdx === null || univIdx === undefined) return true;
    const isHome = String(collegeUnivIdx) === String(univIdx);
    return s.scope === 'H' ? isHome : !isHome;
  };
}

function familiesNeeded(p) {
  const f = new Set(['OPEN']);
  if (p.category && p.category !== 'OPEN') f.add(p.category);
  (p.specials || []).forEach(s => f.add(s));
  return [...f];
}
const clears = (p, c) => p.mode === 'rank'
  ? (c.rank && p.value <= c.rank) : p.value >= c.pct;
function tierOf(p, c) {
  if (p.mode === 'rank') {
    if (!c.rank) return null;
    if (p.value <= c.rank * 0.85) return 'safe';
    if (p.value <= c.rank) return 'likely';
    if (p.value <= c.rank * 1.18) return 'reach';
    return null;
  }
  const m = p.value - c.pct;
  if (m >= 1.0) return 'safe';
  if (m >= 0) return 'likely';
  if (m >= -0.9) return 'reach';
  return null;
}

function search(profile) {
  const allow = buildFilter(profile);
  const bag = new Map();
  for (const fam of familiesNeeded(profile)) {
    for (const r of shard(fam)) {
      const [ci, bi, sufi, si, rnd, rank, pct] = r;
      if (!profile.groups.has(meta.branchGroup[bi])) continue;
      const col = meta.colleges[ci];
      if (profile.region !== '' && String(col[4]) !== String(profile.region)) continue;
      if (!allow(meta.seats[si], col[3])) continue;
      const key = `${ci}|${bi}|${sufi}`;
      let e = bag.get(key);
      if (!e) bag.set(key, e = { ci, bi, sufi, rounds: {} });
      if (!e.rounds[rnd] || pct < e.rounds[rnd].pct)
        e.rounds[rnd] = { pct, rank, seat: meta.seats[si] };
    }
  }
  const out = [];
  bag.forEach(e => {
    let best = null, bestRound = null, firstClear = null;
    for (const rnd of [1, 2, 3]) {
      const c = e.rounds[rnd];
      if (!c) continue;
      if (!best || c.pct < best.pct) { best = c; bestRound = rnd; }
      if (firstClear === null && clears(profile, c)) firstClear = rnd;
    }
    if (!best) return;
    const tier = tierOf(profile, best);
    if (!tier) return;
    out.push({ ...e, best, bestRound, firstClear, tier });
  });
  out.sort((a, b) => b.best.pct - a.best.pct);
  return out;
}

/* ------------------------------------------------------------- test cases */
const P = (o) => ({
  mode: 'pct', gender: 'M', category: 'OPEN', univIdx: '', region: '',
  groups: new Set([0]), specials: [], ...o
});

function report(label, profile, n = 5) {
  const r = search(profile);
  const c = { safe: 0, likely: 0, reach: 0 };
  r.forEach(x => c[x.tier]++);
  console.log(`\n## ${label}`);
  console.log(`   ${r.length} matches  (safe ${c.safe} / likely ${c.likely} / borderline ${c.reach})`);
  r.slice(0, n).forEach(x => {
    console.log(`   ${x.best.pct.toFixed(4).padStart(9)}  R${x.firstClear ?? '-'}  ${x.best.seat.padEnd(9)} ` +
      `${meta.branches[x.bi].slice(0, 30).padEnd(31)} ${meta.colleges[x.ci][1].slice(0, 44)}`);
  });
  return r;
}

console.log('=== SANITY CHECKS ===');

const a = report('99.5 percentile, OPEN, male, technical', P({ value: 99.5 }));
const b = report('93.4 percentile, OPEN, male, technical', P({ value: 93.4 }));
const c = report('80.0 percentile, OPEN, male, technical', P({ value: 80 }));
const d = report('93.4 percentile, OBC, female, technical', P({ value: 93.4, category: 'OBC', gender: 'F' }));
const e = report('93.4 percentile, OPEN, male, technical, Mumbai Univ home',
  P({ value: 93.4, univIdx: String(meta.univs.indexOf('Mumbai University')) }));
const f = report('Merit rank 24536, OPEN, male, technical', P({ mode: 'rank', value: 24536 }));
const g = report('93.4, OPEN, male, ALL branch groups', P({ value: 93.4, groups: new Set([0, 1, 2]) }));

console.log('\n=== INVARIANTS ===');
const fails = [];
function assert(cond, msg) { console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); }

assert(a.length > b.length, '99.5 percentile unlocks more options than 93.4');
assert(b.length > c.length, '93.4 percentile unlocks more options than 80.0');
const safeOnes = b.filter(x => x.tier === 'safe');
assert(safeOnes.every(x => x.firstClear !== null), 'every safe match reports the round it becomes available');
assert(b.filter(x => x.tier === 'reach').every(x => x.firstClear === null), 'borderline matches are not marked as already cleared');
console.log('   sample safe match:', safeOnes[0].best.pct.toFixed(4), 'R' + safeOnes[0].firstClear,
  meta.branches[safeOnes[0].bi], '|', meta.colleges[safeOnes[0].ci][1].slice(0, 40));
assert(d.length >= b.length, 'female OBC sees at least as many options as male OPEN at same percentile');
assert(g.length > b.length, 'all branch groups returns more than technical only');
assert(b.every(x => x.best.pct <= 93.4 + 0.9), 'no match is more than 0.9 above the entered percentile');
assert(b.filter(x => x.tier === 'safe').every(x => 93.4 - x.best.pct >= 1.0), 'every "safe" is >= 1.0 above cutoff');
assert(b.filter(x => x.firstClear).every(x => x.rounds[x.firstClear].pct <= 93.4), 'first-clear round cutoff is actually cleared');

const maleSeats = new Set();
b.forEach(x => maleSeats.add(x.best.seat));
assert(![...maleSeats].some(s => s.startsWith('L')), 'male profile never matched a Ladies seat');

const homeSeats = new Set();
e.forEach(x => Object.values(x.rounds).forEach(r => homeSeats.add(r.seat + '@' + meta.colleges[x.ci][3])));
const muIdx = String(meta.univs.indexOf('Mumbai University'));
const badHome = [...homeSeats].filter(s => {
  const [seat, u] = s.split('@');
  const d = decodeSeat(seat);
  if (d.scope === 'H') return u !== muIdx;
  if (d.scope === 'O') return u === muIdx;
  return false;
});
assert(badHome.length === 0, `home-university scoping correct (${badHome.length} violations)`);

const openOnly = search(P({ value: 93.4 }));
const withEws = search(P({ value: 93.4, specials: ['EWS'] }));
assert(withEws.length >= openOnly.length, 'adding EWS never removes options');

console.log(`\n${fails.length ? fails.length + ' FAILURES' : 'All invariants passed.'}`);
