/* =========================================================================
   CutoffPath — app.js
   Client logic: data loading, eligibility matching, payment, choice list.
   ========================================================================= */
(function () {
  'use strict';

  const LS = {
    token: 'cp_token',
    profile: 'cp_profile',
    choices: 'cp_choices',
    lastSearch: 'cp_last_search'
  };

  const state = {
    meta: null,
    shards: {},          // family -> rows
    mode: 'pct',         // 'pct' | 'rank'
    gender: 'M',
    groups: new Set([0]),
    specials: new Set(),
    token: localStorage.getItem(LS.token) || '',
    access: false,
    student: null,
    results: [],
    shown: 0,
    choices: load(LS.choices, [])
  };

  const PAGE = 25;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------------------------------------------------------- API -- */
  async function api(path, body) {
    const opts = { headers: { 'Content-Type': 'application/json' } };
    if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api/' + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function track(type, meta) {
    if (!navigator.sendBeacon) {
      api('track', { type, token: state.token, meta: meta || {} }).catch(() => {});
      return;
    }
    const blob = new Blob([JSON.stringify({ type, token: state.token, meta: meta || {} })],
      { type: 'application/json' });
    navigator.sendBeacon('/api/track', blob);
  }

  /* --------------------------------------------------------------- DATA -- */
  async function loadMeta() {
    if (state.meta) return state.meta;
    const res = await fetch('/data/meta.json');
    state.meta = await res.json();
    return state.meta;
  }

  async function loadShard(family) {
    if (state.shards[family]) return state.shards[family];
    const res = await fetch('/data/shards/' + family + '.json');
    if (!res.ok) { state.shards[family] = []; return []; }
    state.shards[family] = await res.json();
    return state.shards[family];
  }

  /* ------------------------------------------------- seat-code decoding -- */
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

  /* ------------------------------------------------------- eligibility -- */
  function buildFilter(profile) {
    const bases = new Set(['OPEN']);
    if (profile.category) bases.add(profile.category);
    const genders = profile.gender === 'F' ? ['G', 'L'] : ['G'];
    const specials = profile.specials || [];
    const univIdx = profile.univIdx;   // '' means unknown

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
        return true;                                    // EWS/TFWS/MI/ORPHAN are state level
      }

      // university scope: S = state level, H = home university, O = other than home
      if (!s.scope || s.scope === 'S') return true;
      if (univIdx === '' || univIdx === null || univIdx === undefined) return true;
      const isHome = String(collegeUnivIdx) === String(univIdx);
      return s.scope === 'H' ? isHome : !isHome;
    };
  }

  function familiesNeeded(profile) {
    const fams = new Set(['OPEN']);
    if (profile.category && profile.category !== 'OPEN') fams.add(profile.category);
    (profile.specials || []).forEach(sp => fams.add(sp));
    return Array.from(fams);
  }

  /* ----------------------------------------------------------- matching -- */
  function tierOf(profile, cut) {
    if (profile.mode === 'rank') {
      if (!cut.rank) return null;
      const r = profile.value;
      if (r <= cut.rank * 0.85) return 'safe';
      if (r <= cut.rank) return 'likely';
      if (r <= cut.rank * 1.18) return 'reach';
      return null;
    }
    const m = profile.value - cut.pct;
    if (m >= 1.0) return 'safe';
    if (m >= 0) return 'likely';
    if (m >= -0.9) return 'reach';
    return null;
  }

  function clears(profile, cut) {
    return profile.mode === 'rank'
      ? (cut.rank && profile.value <= cut.rank)
      : profile.value >= cut.pct;
  }

  async function runSearch(profile) {
    const meta = await loadMeta();
    const fams = familiesNeeded(profile);
    await Promise.all(fams.map(loadShard));

    const allow = buildFilter(profile);
    const colleges = meta.colleges;
    const groups = profile.groups;
    const region = profile.region;
    const bag = new Map();

    for (const fam of fams) {
      const rows = state.shards[fam] || [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const ci = r[0], bi = r[1], sufi = r[2], si = r[3], rnd = r[4], rank = r[5], pct = r[6];

        if (!groups.has(meta.branchGroup[bi])) continue;
        const col = colleges[ci];
        if (region !== '' && String(col[4]) !== String(region)) continue;
        if (!allow(meta.seats[si], col[3])) continue;

        const key = ci + '|' + bi + '|' + sufi;
        let ent = bag.get(key);
        if (!ent) {
          ent = { ci, bi, sufi, rounds: {} };
          bag.set(key, ent);
        }
        const prev = ent.rounds[rnd];
        if (!prev || pct < prev.pct) {
          ent.rounds[rnd] = { pct, rank, seat: meta.seats[si] };
        }
      }
    }

    const out = [];
    bag.forEach(ent => {
      let best = null, bestRound = null, firstClear = null;
      for (const rnd of [1, 2, 3]) {
        const c = ent.rounds[rnd];
        if (!c) continue;
        if (!best || c.pct < best.pct) { best = c; bestRound = rnd; }
        if (firstClear === null && clears(profile, c)) firstClear = rnd;
      }
      if (!best) return;
      const tier = tierOf(profile, best);
      if (!tier) return;
      ent.best = best;
      ent.bestRound = bestRound;
      ent.firstClear = firstClear;
      ent.tier = tier;
      ent.margin = profile.mode === 'rank'
        ? (best.rank ? (best.rank - profile.value) / best.rank : 0)
        : profile.value - best.pct;
      out.push(ent);
    });

    return out;
  }

  /* -------------------------------------------------------------- SORT -- */
  function sortResults(list, how, meta) {
    const rank = { safe: 0, likely: 1, reach: 2 };
    if (how === 'safe') {
      list.sort((a, b) => rank[a.tier] - rank[b.tier] || b.margin - a.margin);
    } else if (how === 'branch') {
      list.sort((a, b) =>
        meta.branches[a.bi].localeCompare(meta.branches[b.bi]) || b.best.pct - a.best.pct);
    } else {
      list.sort((a, b) => b.best.pct - a.best.pct);
    }
    return list;
  }

  /* ------------------------------------------------------------ RENDER -- */
  const TIER_LABEL = { safe: 'Safe', likely: 'Likely', reach: 'Borderline' };

  function scaleLow() { return state.student && state.student.mode === 'rank' ? 0 : 55; }

  function rulerHTML(profile, cut) {
    if (profile.mode === 'rank') return '';
    const lo = scaleLow(), hi = 100;
    const clamp = v => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const you = clamp(profile.value);
    const cutp = clamp(cut.pct);
    return `<div class="ruler" style="--pos:${you.toFixed(2)}%;--cut:${cutp.toFixed(2)}%">
      <div class="track"></div><div class="span"></div>
      <div class="cut"></div><div class="you"></div>
    </div>`;
  }

  function resultHTML(ent, idx) {
    const meta = state.meta, p = state.student;
    const col = meta.colleges[ent.ci];
    const branch = meta.branches[ent.bi];
    const suf = meta.suffixes[ent.sufi] || '';
    const sufLabel = { L: 'Regional language', F: 'Female only', T: 'TFWS', U: 'Un-aided', K: 'Special' }[suf];
    const inList = state.choices.some(c => c.key === keyOf(ent));

    let rounds = '';
    for (const rnd of [1, 2, 3]) {
      const c = ent.rounds[rnd];
      if (!c) continue;
      const ok = clears(p, c);
      rounds += `<span class="rd ${ok ? 'on' : ''}">CAP ${rnd} · <b>${c.pct.toFixed(3)}</b>${c.rank ? ' · rank ' + c.rank.toLocaleString('en-IN') : ''}</span>`;
    }

    const eligLine = ent.firstClear
      ? `Eligible from CAP Round ${ent.firstClear}`
      : `Just below the CAP Round ${ent.bestRound} cutoff`;

    return `<article class="result ${ent.tier}" data-key="${esc(keyOf(ent))}" data-idx="${idx}">
      <div class="tier"><span>${TIER_LABEL[ent.tier]}</span></div>
      <h3>${esc(col[1])}</h3>
      <div class="branch">${esc(branch)}${sufLabel ? ' · ' + sufLabel : ''}</div>
      <div class="meta">${esc(meta.regions[col[4]])} · ${esc(meta.statuses[col[2]])} · ${esc(col[0])}</div>
      ${rulerHTML(p, ent.best)}
      <div class="meta" style="margin-top:0">${eligLine} · closing seat type ${esc(ent.best.seat)}</div>
      <div class="rounds">${rounds}</div>
      <div class="result-actions">
        <button class="btn ${inList ? 'ghost' : ''} slim js-add">${inList ? 'In my list' : 'Add to choice list'}</button>
        <a class="btn ghost slim" style="flex:none" href="/colleges/${encodeURIComponent(col[0])}.html">College info</a>
      </div>
    </article>`;
  }

  function keyOf(ent) { return ent.ci + '|' + ent.bi + '|' + ent.sufi; }

  function renderResults(reset) {
    const wrap = $('#results');
    if (reset) { wrap.innerHTML = ''; state.shown = 0; }
    const slice = state.results.slice(state.shown, state.shown + PAGE);
    wrap.insertAdjacentHTML('beforeend',
      slice.map((e, i) => resultHTML(e, state.shown + i)).join(''));
    state.shown += slice.length;
    $('#showMore').hidden = state.shown >= state.results.length;
    $('#showMore').textContent = `Show ${Math.min(PAGE, state.results.length - state.shown)} more of ${state.results.length}`;
  }

  function renderSummary() {
    const p = state.student;
    const c = { safe: 0, likely: 0, reach: 0 };
    state.results.forEach(r => c[r.tier]++);
    const scoreTxt = p.mode === 'rank'
      ? 'Merit rank ' + p.value.toLocaleString('en-IN')
      : p.value + ' percentile';
    $('#summaryCard').innerHTML = `
      <div class="card-head" style="margin-bottom:8px">
        <h2>${state.results.length} matches</h2>
        <span class="numtag">${esc(scoreTxt)}</span>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><span class="n" style="color:var(--safe)">${c.safe}</span><span class="l">Safe</span></div>
        <div class="stat"><span class="n" style="color:var(--likely)">${c.likely}</span><span class="l">Likely</span></div>
        <div class="stat"><span class="n" style="color:var(--reach)">${c.reach}</span><span class="l">Borderline</span></div>
      </div>`;
  }

  /* ------------------------------------------------------- CHOICE LIST -- */
  function renderChoices() {
    const wrap = $('#choiceWrap');
    wrap.hidden = state.choices.length === 0;
    $('#choiceCount').textContent = state.choices.length + ' selected';
    $('#choiceList').innerHTML = state.choices.map((c, i) => `
      <div class="choice" data-key="${esc(c.key)}">
        <span class="ord">${i + 1}</span>
        <div class="body"><b>${esc(c.college)}</b><span>${esc(c.branch)} · ${esc(c.note)}</span></div>
        <button class="iconbtn js-up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="iconbtn js-down" aria-label="Move down" ${i === state.choices.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="iconbtn del js-remove" aria-label="Remove">&times;</button>
      </div>`).join('');
    save(LS.choices, state.choices);
  }

  function addChoice(ent) {
    const key = keyOf(ent);
    if (state.choices.some(c => c.key === key)) return;
    const meta = state.meta, col = meta.colleges[ent.ci];
    state.choices.push({
      key,
      code: col[0],
      college: col[1],
      branch: meta.branches[ent.bi],
      region: meta.regions[col[4]],
      status: meta.statuses[col[2]],
      tier: TIER_LABEL[ent.tier],
      round: ent.firstClear || ent.bestRound,
      pct: ent.best.pct,
      rank: ent.best.rank,
      seat: ent.best.seat,
      note: `${TIER_LABEL[ent.tier]} · CAP ${ent.firstClear || ent.bestRound} · ${ent.best.pct.toFixed(3)}`
    });
    renderChoices();
    track('add_choice', { code: col[0], branch: meta.branches[ent.bi] });
  }

  /* ---------------------------------------------------------------- PDF -- */
  function downloadPDF() {
    if (!window.jspdf) { alert('PDF library still loading. Try again in a moment.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const p = state.student || {};
    const name = (state.access && state.profileName) ? state.profileName : '';

    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('My CAP Choice List', 40, 48);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.setTextColor(90);
    const line2 = [
      name ? 'Candidate: ' + name : null,
      p.mode === 'rank' ? 'Merit rank: ' + p.value : 'Percentile: ' + p.value,
      'Category: ' + (p.category || 'OPEN'),
      'Gender: ' + (p.gender === 'F' ? 'Female' : 'Male')
    ].filter(Boolean).join('   |   ');
    doc.text(line2, 40, 64);
    doc.text('Based on MHT-CET 2026-27 CAP Round I–III cutoffs published by the State CET Cell.', 40, 78);

    const body = state.choices.map((c, i) => [
      i + 1, c.code, c.college, c.branch,
      'CAP ' + c.round, c.pct.toFixed(4), c.rank ? c.rank.toLocaleString('en-IN') : '-', c.tier
    ]);

    doc.autoTable({
      startY: 92,
      head: [['#', 'Code', 'College', 'Branch', 'Round', 'Cut-off %ile', 'Cut-off rank', 'Chance']],
      body,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak', lineColor: [222, 230, 236], lineWidth: 0.5 },
      headStyles: { fillColor: [18, 59, 110], textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 38 }, 2: { cellWidth: 150 }, 3: { cellWidth: 120 } },
      margin: { left: 40, right: 40 }
    });

    const y = doc.lastAutoTable.finalY + 18;
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text('Cut-offs are from the previous CAP rounds and are a guide, not a guarantee. Verify on cetcell.mahacet.org before filling your option form.', 40, y, { maxWidth: 515 });
    doc.save('cap-choice-list.pdf');
    track('download_pdf', { count: state.choices.length });
  }

  /* ------------------------------------------------------------ ACCESS -- */
  function setAccess(on, name) {
    state.access = on;
    state.profileName = name || state.profileName;
    const pill = $('#accessPill');
    pill.textContent = on ? 'Full access' : 'Free preview';
    pill.className = 'pill ' + (on ? 'paid' : 'free');
    $('#payHint').hidden = on;
    $('#findBtn').textContent = 'Find my colleges';
  }

  async function checkAccess() {
    if (!state.token) return setAccess(false);
    try {
      const r = await api('me?token=' + encodeURIComponent(state.token));
      setAccess(!!r.access, r.name);
    } catch (e) { setAccess(false); }
  }

  function showSheet(id, on) {
    $(id).hidden = !on;
    document.body.style.overflow = on ? 'hidden' : '';
  }

  function readProfile() {
    const raw = $('#score').value.trim();
    const value = parseFloat(raw);
    if (!raw || isNaN(value)) return { error: 'Enter your percentile or merit rank first.' };
    if (state.mode === 'pct' && (value < 0 || value > 100)) {
      return { error: 'Percentile must be between 0 and 100.' };
    }
    if (state.mode === 'rank' && value < 1) {
      return { error: 'Merit rank must be 1 or higher.' };
    }
    if (state.groups.size === 0) return { error: 'Pick at least one branch group.' };
    return {
      mode: state.mode,
      value,
      category: $('#category').value,
      gender: state.gender,
      univIdx: $('#univ').value,
      region: $('#region').value,
      groups: new Set(state.groups),
      specials: Array.from(state.specials)
    };
  }

  async function doFind() {
    const btn = $('#findBtn');
    const p = readProfile();
    if (p.error) { flash(p.error); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Matching cutoffs…';
    try {
      state.student = p;
      const list = await runSearch(p);
      sortResults(list, $('#sortBy').value, state.meta);
      state.results = list;
      save(LS.lastSearch, {
        mode: p.mode, value: p.value, category: p.category, gender: p.gender,
        univIdx: p.univIdx, region: p.region,
        groups: Array.from(p.groups), specials: p.specials
      });
      track('search', {
        percentile: p.mode === 'pct' ? p.value : null,
        rank: p.mode === 'rank' ? p.value : null,
        category: p.category, gender: p.gender, results: list.length
      });

      if (!state.access) {
        $('#payTitle').textContent = list.length
          ? `We found ${list.length} colleges for you`
          : 'Unlock your college list';
        showSheet('#paySheet', true);
        track('paywall_view', { results: list.length });
        return;
      }
      revealResults();
    } catch (e) {
      flash('Could not load the cutoff data. Check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Find my colleges';
    }
  }

  function revealResults() {
    if (!state.results.length) {
      $('#resultsWrap').hidden = false;
      $('#summaryCard').innerHTML =
        `<div class="empty"><h3>No colleges matched</h3>
         <p class="hint">Try adding more branch groups, clearing the region filter, or checking your percentile.</p></div>`;
      $('#results').innerHTML = '';
      $('#showMore').hidden = true;
      return;
    }
    $('#formCard').hidden = true;
    $('#resultsWrap').hidden = false;
    renderSummary();
    renderResults(true);
    renderChoices();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function flash(msg, kind) {
    let n = $('#flash');
    if (!n) {
      n = document.createElement('div');
      n.id = 'flash';
      n.className = 'notice err';
      $('#formCard').prepend(n);
    }
    n.className = 'notice ' + (kind || 'err');
    n.textContent = msg;
    n.hidden = false;
    n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    clearTimeout(n._t);
    n._t = setTimeout(() => { n.hidden = true; }, 6000);
  }

  /* ------------------------------------------------------------ PAYMENT -- */
  function validPay() {
    const name = $('#payName').value.trim();
    const email = $('#payEmail').value.trim();
    const phone = $('#payPhone').value.replace(/\D/g, '');
    if (name.length < 3) return { error: 'Enter your full name.' };
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { error: 'Enter a valid email address.' };
    if (phone.length !== 10) return { error: 'Enter your 10-digit mobile number.' };
    return { name, email, phone };
  }

  async function startPayment() {
    const err = $('#payError');
    err.hidden = true;
    const v = validPay();
    if (v.error) { err.textContent = v.error; err.hidden = false; return; }

    const btn = $('#payBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Opening checkout…';

    try {
      const p = state.student || {};
      const order = await api('create-order', {
        name: v.name, email: v.email, phone: v.phone,
        percentile: p.mode === 'pct' ? p.value : null,
        rank: p.mode === 'rank' ? p.value : null,
        category: p.category, gender: p.gender
      });
      track('pay_start', {});

      if (!window.Razorpay) throw new Error('Checkout could not load. Refresh and try again.');

      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: 'INR',
        name: 'CutoffPath',
        description: 'MHT-CET college finder — full access',
        prefill: { name: v.name, email: v.email, contact: v.phone },
        theme: { color: '#123b6e' },
        handler: async function (resp) {
          btn.innerHTML = '<span class="spin"></span> Confirming payment…';
          try {
            const r = await api('verify-payment', {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature
            });
            state.token = r.token;
            localStorage.setItem(LS.token, r.token);
            save(LS.profile, { name: v.name, email: v.email, phone: v.phone });
            setAccess(true, r.name || v.name);
            showSheet('#paySheet', false);
            track('paid', {});
            revealResults();
          } catch (e) {
            err.textContent = 'Payment went through but we could not confirm it. Use "Restore access" with your email and phone, or contact support.';
            err.hidden = false;
          } finally {
            btn.disabled = false;
            btn.textContent = 'Pay ₹49 and see my colleges';
          }
        },
        modal: {
          ondismiss: function () {
            btn.disabled = false;
            btn.textContent = 'Pay ₹49 and see my colleges';
            track('pay_cancel', {});
          }
        }
      });
      rzp.on('payment.failed', function (r) {
        err.textContent = (r.error && r.error.description) || 'Payment failed. No money was deducted.';
        err.hidden = false;
      });
      rzp.open();
    } catch (e) {
      err.textContent = e.status === 501
        ? 'Payments are not switched on yet. Add your Razorpay keys in the project settings.'
        : (e.message || 'Could not start the payment. Try again.');
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Pay ₹49 and see my colleges';
    }
  }

  async function restoreAccess() {
    const err = $('#resError');
    err.hidden = true;
    const email = $('#resEmail').value.trim();
    const phone = $('#resPhone').value.replace(/\D/g, '');
    if (!email || phone.length !== 10) {
      err.textContent = 'Enter the same email and 10-digit phone you paid with.';
      err.hidden = false; return;
    }
    const btn = $('#restoreBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Checking…';
    try {
      const r = await api('restore-access', { email, phone });
      state.token = r.token;
      localStorage.setItem(LS.token, r.token);
      save(LS.profile, { name: r.name, email, phone });
      setAccess(true, r.name);
      showSheet('#restoreSheet', false);
      showSheet('#paySheet', false);
      track('restore', {});
      if (state.results.length) revealResults();
      else flash('Access restored. Run your search again.', 'ok');
    } catch (e) {
      err.textContent = e.status === 404
        ? 'No paid account found with that email and phone. Check for typos, or use the details from your payment receipt.'
        : (e.message || 'Could not restore access right now.');
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Restore access';
    }
  }

  /* ----------------------------------------------------- COLLEGES TAB -- */
  let collegeFilterRegion = '';
  async function renderColleges() {
    const meta = await loadMeta();
    if (!$('#regionChips').children.length) {
      $('#regionChips').innerHTML =
        `<button class="chip" data-r="" aria-pressed="true">All</button>` +
        meta.regions.map((r, i) => `<button class="chip" data-r="${i}" aria-pressed="false">${esc(r)}</button>`).join('');
    }
    const q = $('#collegeSearch').value.trim().toLowerCase();
    const list = meta.colleges
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (collegeFilterRegion !== '' && String(c[4]) !== collegeFilterRegion) return false;
        if (!q) return true;
        return (c[1] + ' ' + c[0] + ' ' + meta.regions[c[4]]).toLowerCase().includes(q);
      });

    $('#collegeList').innerHTML = list.slice(0, 200).map(({ c }) => `
      <a class="list-item" href="/colleges/${encodeURIComponent(c[0])}.html">
        <div class="body">
          <b>${esc(c[1])}</b>
          <span>${esc(c[0])} · ${esc(meta.regions[c[4]])} · ${esc(meta.statuses[c[2]])}</span>
        </div>
        <span class="arrow">&rsaquo;</span>
      </a>`).join('') ||
      `<div class="empty"><h3>Nothing found</h3><p class="hint">Try a shorter search term.</p></div>`;
    $('#collegeCount').textContent =
      list.length > 200 ? `Showing 200 of ${list.length} colleges` : `${list.length} colleges`;
  }

  /* --------------------------------------------------------------- TABS -- */
  function switchTab(name) {
    $$('.nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    ['finder', 'colleges', 'hostel'].forEach(t => { $('#tab-' + t).hidden = t !== name; });
    if (name === 'colleges') renderColleges();
    track('tab', { tab: name });
    window.scrollTo({ top: 0 });
  }

  /* ---------------------------------------------------------------- INIT */
  async function init() {
    const meta = await loadMeta();

    $('#univ').insertAdjacentHTML('beforeend',
      meta.univs.map((u, i) => `<option value="${i}">${esc(u)}</option>`).join(''));
    $('#region').insertAdjacentHTML('beforeend',
      meta.regions.map((r, i) => `<option value="${i}">${esc(r)}</option>`).join(''));

    const last = load(LS.lastSearch, null);
    if (last) {
      state.mode = last.mode;
      state.gender = last.gender;
      state.groups = new Set(last.groups);
      state.specials = new Set(last.specials || []);
      $('#score').value = last.value;
      $('#category').value = last.category;
      $('#univ').value = last.univIdx ?? '';
      $('#region').value = last.region ?? '';
      syncControls();
    }

    checkAccess();
    renderChoices();

    const prof = load(LS.profile, null);
    if (prof) {
      $('#payName').value = prof.name || '';
      $('#payEmail').value = prof.email || '';
      $('#payPhone').value = prof.phone || '';
      $('#resEmail').value = prof.email || '';
      $('#resPhone').value = prof.phone || '';
    }
    track('visit', {});
  }

  function syncControls() {
    $$('.seg [data-mode]').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
    $$('.seg [data-gender]').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.gender === state.gender));
    $$('#groupChips .chip').forEach(b =>
      b.setAttribute('aria-pressed', state.groups.has(+b.dataset.group)));
    $$('#specialChips .chip').forEach(b =>
      b.setAttribute('aria-pressed', state.specials.has(b.dataset.sp)));
    const pct = state.mode === 'pct';
    $('#scoreLabel').textContent = pct ? 'Your CET percentile' : 'Your CET merit rank';
    $('#score').placeholder = pct ? 'e.g. 93.4521' : 'e.g. 24536';
    $('#score').step = pct ? '0.0000001' : '1';
    $('#scoreHint').textContent = pct
      ? 'Use the percentile printed on your CET scorecard — decimals matter.'
      : 'Use your Maharashtra State General Merit Number.';
  }

  /* -------------------------------------------------------------- EVENTS */
  document.addEventListener('click', function (e) {
    const t = e.target.closest('button, a');
    if (!t) return;

    if (t.dataset.tab) { switchTab(t.dataset.tab); return; }
    if (t.dataset.mode) { state.mode = t.dataset.mode; syncControls(); return; }
    if (t.dataset.gender) { state.gender = t.dataset.gender; syncControls(); return; }

    if (t.dataset.group !== undefined && t.closest('#groupChips')) {
      const g = +t.dataset.group;
      state.groups.has(g) ? state.groups.delete(g) : state.groups.add(g);
      syncControls(); return;
    }
    if (t.dataset.sp) {
      const s = t.dataset.sp;
      state.specials.has(s) ? state.specials.delete(s) : state.specials.add(s);
      syncControls(); return;
    }
    if (t.dataset.r !== undefined && t.closest('#regionChips')) {
      collegeFilterRegion = t.dataset.r;
      $$('#regionChips .chip').forEach(c => c.setAttribute('aria-pressed', c === t));
      renderColleges(); return;
    }

    switch (t.id) {
      case 'findBtn': doFind(); return;
      case 'showMore': renderResults(false); return;
      case 'editSearch':
        $('#formCard').hidden = false;
        $('#resultsWrap').hidden = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      case 'payBtn': startPayment(); return;
      case 'payClose': showSheet('#paySheet', false); return;
      case 'restoreOpen': showSheet('#paySheet', false); showSheet('#restoreSheet', true); return;
      case 'restoreClose': showSheet('#restoreSheet', false); return;
      case 'restoreBtn': restoreAccess(); return;
      case 'downloadPdf': downloadPDF(); return;
      case 'clearChoices':
        if (confirm('Remove all colleges from your choice list?')) {
          state.choices = []; renderChoices(); renderResults(true);
        }
        return;
      case 'notifyHostel':
        t.textContent = state.access ? 'You are on the list' : 'Pay first, then we will have your email';
        t.disabled = true;
        track('hostel_notify', {});
        return;
    }

    if (t.classList.contains('js-add')) {
      const card = t.closest('.result');
      addChoice(state.results[+card.dataset.idx]);
      t.textContent = 'In my list';
      t.classList.add('ghost');
      return;
    }

    const choiceRow = t.closest('.choice');
    if (choiceRow) {
      const i = state.choices.findIndex(c => c.key === choiceRow.dataset.key);
      if (i < 0) return;
      if (t.classList.contains('js-up') && i > 0) {
        [state.choices[i - 1], state.choices[i]] = [state.choices[i], state.choices[i - 1]];
      } else if (t.classList.contains('js-down') && i < state.choices.length - 1) {
        [state.choices[i + 1], state.choices[i]] = [state.choices[i], state.choices[i + 1]];
      } else if (t.classList.contains('js-remove')) {
        state.choices.splice(i, 1);
        renderResults(true);
      }
      renderChoices();
    }
  });

  $('#sortBy').addEventListener('change', function () {
    if (!state.results.length) return;
    sortResults(state.results, this.value, state.meta);
    renderResults(true);
  });

  let searchTimer;
  $('#collegeSearch').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderColleges, 180);
  });

  $$('.scrim').forEach(s => s.addEventListener('click', e => {
    if (e.target === s) showSheet('#' + s.id, false);
  }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { showSheet('#paySheet', false); showSheet('#restoreSheet', false); }
  });

  syncControls();
  init();
})();
