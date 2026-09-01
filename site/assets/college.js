/* Cutoff tables for a single college page.
   Loads /data/colleges/<code>.json (about 6 KB) plus the shared meta file. */
(function () {
  'use strict';

  var code = document.body.dataset.code;
  var meta = null, rows = null;
  var sel = { branch: 'all', seat: 'all' };

  var BASE = {
    OPEN: 'Open', SC: 'SC', ST: 'ST', VJ: 'VJ / DT (NT-A)', NT1: 'NT-B',
    NT2: 'NT-C', NT3: 'NT-D', OBC: 'OBC', SEBC: 'SEBC'
  };
  var SCOPE = { S: 'State level', H: 'Home university', O: 'Other than home' };
  var BASE_ORDER = ['OPEN', 'SC', 'ST', 'VJ', 'NT1', 'NT2', 'NT3', 'OBC', 'SEBC'];
  var SCOPE_ORDER = ['H', 'O', 'S'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Turn a raw seat code such as PWDROBCH into something a student can read. */
  function seatLabel(codeStr) {
    if (codeStr === 'TFWS') return { group: 'Special', text: 'TFWS (fee waiver)', sort: [3, 0] };
    if (codeStr === 'EWS') return { group: 'Special', text: 'EWS', sort: [0, 0] };
    if (codeStr === 'MI') return { group: 'Special', text: 'Minority', sort: [2, 0] };
    /* The CET lists publish two orphan seat codes. Their exact meaning is not
       stated in the legend, so show the official code rather than guess. */
    if (codeStr.indexOf('ORPHAN') === 0) {
      return { group: 'Special', text: 'Orphan (' + codeStr + ')', sort: [1, 0] };
    }

    var prefix = '', rest = codeStr, group;
    if (codeStr.indexOf('PWDR') === 0) { prefix = 'PWD common reserved'; rest = codeStr.slice(4); group = 'PWD'; }
    else if (codeStr.indexOf('PWD') === 0) { prefix = 'PWD'; rest = codeStr.slice(3); group = 'PWD'; }
    else if (codeStr.indexOf('DEFR') === 0) { prefix = 'Defence common reserved'; rest = codeStr.slice(4); group = 'Defence'; }
    else if (codeStr.indexOf('DEF') === 0) { prefix = 'Defence'; rest = codeStr.slice(3); group = 'Defence'; }
    else {
      prefix = codeStr[0] === 'L' ? 'Ladies' : 'General';
      rest = codeStr.slice(1);
      group = codeStr[0] === 'L' ? 'Ladies seats' : 'General seats';
    }
    var scopeKey = rest.slice(-1);
    var baseKey = rest.slice(0, -1);
    var scope = SCOPE[scopeKey] || '';
    var base = BASE[baseKey] || baseKey;
    return {
      group: group,
      text: base + ' · ' + prefix + (scope ? ' · ' + scope : ''),
      sort: [BASE_ORDER.indexOf(baseKey), SCOPE_ORDER.indexOf(scopeKey)]
    };
  }

  function build() {
    var branchSel = document.getElementById('branchPick');
    var seatSel = document.getElementById('seatPick');

    var branchIds = [], seatIds = [];
    rows.forEach(function (r) {
      if (branchIds.indexOf(r[0]) === -1) branchIds.push(r[0]);
      if (seatIds.indexOf(r[2]) === -1) seatIds.push(r[2]);
    });

    branchIds.sort(function (a, b) { return meta.branches[a].localeCompare(meta.branches[b]); });
    branchSel.innerHTML = '<option value="all">All branches</option>' +
      branchIds.map(function (i) {
        return '<option value="' + i + '">' + esc(meta.branches[i]) + '</option>';
      }).join('');

    /* group the seat types so the dropdown is navigable */
    var groups = {}, order = ['General seats', 'Ladies seats', 'Special', 'PWD', 'Defence'];
    seatIds.forEach(function (i) {
      var l = seatLabel(meta.seats[i]);
      (groups[l.group] = groups[l.group] || []).push({ i: i, text: l.text, sort: l.sort });
    });
    var html = '<option value="all">All categories</option>';
    order.forEach(function (g) {
      if (!groups[g]) return;
      groups[g].sort(function (a, b) {
        return (a.sort[0] - b.sort[0]) || (a.sort[1] - b.sort[1]) || a.text.localeCompare(b.text);
      });
      html += '<optgroup label="' + esc(g) + '">' +
        groups[g].map(function (o) {
          return '<option value="' + o.i + '">' + esc(o.text) + '</option>';
        }).join('') + '</optgroup>';
    });
    seatSel.innerHTML = html;

    /* default to Open · General · State level if this college has it */
    var open = seatIds.filter(function (i) { return meta.seats[i] === 'GOPENS'; })[0];
    if (open !== undefined) { seatSel.value = String(open); sel.seat = String(open); }

    branchSel.addEventListener('change', function () { sel.branch = this.value; render(); });
    seatSel.addEventListener('change', function () { sel.seat = this.value; render(); });
  }

  function render() {
    var table = document.getElementById('cutTable');
    var caption = document.getElementById('cutCaption');
    var bFilter = sel.branch === 'all' ? null : Number(sel.branch);
    var sFilter = sel.seat === 'all' ? null : Number(sel.seat);

    var picked = rows.filter(function (r) {
      return (bFilter === null || r[0] === bFilter) && (sFilter === null || r[2] === sFilter);
    });

    if (!picked.length) {
      table.innerHTML = '<tbody><tr><td class="hint">No seats were allotted in this combination. ' +
        'Pick another category or branch above.</td></tr></tbody>';
      caption.textContent = '';
      return;
    }

    /* Rows of the table vary with what the student narrowed down. */
    var mode = bFilter === null ? 'branch' : (sFilter === null ? 'seat' : 'both');
    var keyOf, labelOf;
    if (mode === 'branch') {
      keyOf = function (r) { return r[0] + ':' + r[2]; };
      labelOf = function (r) {
        return esc(meta.branches[r[0]]) +
          (sFilter === null ? '<span class="rowsub">' + esc(seatLabel(meta.seats[r[2]]).text) + '</span>' : '');
      };
    } else {
      keyOf = function (r) { return r[2] + ':' + r[0]; };
      labelOf = function (r) {
        return esc(seatLabel(meta.seats[r[2]]).text) +
          (bFilter === null ? '' : '');
      };
    }

    var byKey = new Map();
    picked.forEach(function (r) {
      var k = keyOf(r);
      if (!byKey.has(k)) byKey.set(k, { label: labelOf(r), rounds: {} });
      var e = byKey.get(k);
      if (!e.rounds[r[3]] || r[5] < e.rounds[r[3]].pct) {
        e.rounds[r[3]] = { pct: r[5], rank: r[4] };
      }
    });

    var list = Array.from(byKey.values()).sort(function (a, b) {
      var av = (a.rounds[1] || a.rounds[2] || a.rounds[3]).pct;
      var bv = (b.rounds[1] || b.rounds[2] || b.rounds[3]).pct;
      return bv - av;
    });

    var showRank = document.getElementById('showRank').checked;
    var cell = function (r) {
      if (!r) return '—';
      return showRank
        ? (r.rank ? r.rank.toLocaleString('en-IN') : '—')
        : r.pct.toFixed(3);
    };

    table.innerHTML =
      '<thead><tr><th>' + (mode === 'branch' ? 'Branch' : 'Category') +
      '</th><th>CAP I</th><th>CAP II</th><th>CAP III</th></tr></thead><tbody>' +
      list.map(function (e) {
        return '<tr><td class="rowhead">' + e.label + '</td><td>' + cell(e.rounds[1]) +
          '</td><td>' + cell(e.rounds[2]) + '</td><td>' + cell(e.rounds[3]) + '</td></tr>';
      }).join('') + '</tbody>';

    caption.textContent = list.length + (list.length === 1 ? ' row' : ' rows') +
      ' · showing ' + (showRank ? 'closing merit rank' : 'closing percentile');
  }

  Promise.all([
    fetch('/data/meta.json').then(function (r) { return r.json(); }),
    fetch('/data/colleges/' + code + '.json').then(function (r) {
      if (!r.ok) throw new Error('no data');
      return r.json();
    })
  ]).then(function (out) {
    meta = out[0];
    rows = out[1];
    build();
    document.getElementById('showRank').addEventListener('change', render);
    render();
  }).catch(function () {
    document.getElementById('cutTable').innerHTML =
      '<tbody><tr><td class="hint">Cutoffs could not load. Refresh the page.</td></tr></tbody>';
  });

  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'college_view',
      token: localStorage.getItem('cp_token') || '',
      meta: { code: code }
    })
  }).catch(function () {});
})();
