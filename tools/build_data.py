import json, re, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'site', 'data')

RAW = json.load(open(os.path.join(ROOT, 'raw_cutoffs.json')))

REGIONS = {
    '01': 'Amravati', '02': 'Chh. Sambhajinagar', '03': 'Mumbai',
    '04': 'Nagpur', '05': 'Nashik', '06': 'Pune', '14': 'State', '16': 'State',
}

TECH_KEYS = ['computer', 'information technology', 'artificial intelligence', 'data science',
             'cyber', 'software', 'iot', 'internet of things', 'cloud', 'machine learning',
             'data engineering']
CORE_KEYS = ['mechanical', 'civil', 'electrical', 'electronic', 'telecommunication',
             'communication', 'instrumentation', 'chemical engineering', 'automobile',
             'automation', 'robotic', 'mechatronic', 'production', 'manufacturing',
             'metallurg', 'mining', 'aeronaut', 'aerospace', 'structural', 'power',
             'vlsi', 'rail', 'petro chemical', 'plastic', 'polymer', 'safety and fire',
             'agricultural']


def group_of(name):
    n = name.lower()
    for k in TECH_KEYS:
        if k in n:
            return 0          # technical
    for k in CORE_KEYS:
        if k in n:
            return 1          # core
    return 2                   # others


def clean_name(n):
    n = re.sub(r'\s+', ' ', n).strip().strip(',')
    if n.isupper() and len(n) > 12:
        n = n.title()
    return n


# ---------- aggregate ----------
# key: (college, coursecode, seat, round) -> (min pct, max rank, stage)
agg = {}
colleges = {}
branch_of_course = {}

for cc, cn, bc, bn, st, hu, sec, cat, rnd, stg, rank, pct in RAW:
    if pct is None:
        continue
    cn = clean_name(cn)
    bn = clean_name(bn)
    if cc not in colleges:
        colleges[cc] = {'code': cc, 'name': cn, 'status': st, 'univ': hu,
                        'region': REGIONS.get(cc[:2], 'Maharashtra')}
    branch_of_course[bc] = bn
    k = (cc, bc, cat, rnd)
    prev = agg.get(k)
    if prev is None or pct < prev[0]:
        agg[k] = (pct, rank, sec)

# ---------- index tables ----------
college_codes = sorted(colleges)
cidx = {c: i for i, c in enumerate(college_codes)}

statuses = sorted({colleges[c]['status'] for c in college_codes})
sidx = {s: i for i, s in enumerate(statuses)}
univs = sorted({colleges[c]['univ'] for c in college_codes})
uidx = {u: i for i, u in enumerate(univs)}
regions = sorted({colleges[c]['region'] for c in college_codes})
ridx = {r: i for i, r in enumerate(regions)}

branch_names = sorted(set(branch_of_course.values()))
bidx = {b: i for i, b in enumerate(branch_names)}

seats = sorted({k[2] for k in agg})
seatidx = {s: i for i, s in enumerate(seats)}

def family(c):
    if c in ('TFWS', 'EWS', 'MI'):
        return c
    if c.startswith('ORPHAN'):
        return 'ORPHAN'
    if c.startswith('PWD'):
        return 'PWD'
    if c.startswith('DEF'):
        return 'DEF'
    return c[1:-1]


suffixes = ['', 'F', 'L', 'T', 'U', 'K', 'H', 'M', 'N']
sufidx = {s: i for i, s in enumerate(suffixes)}

shards = defaultdict(list)
rows = []
for (cc, bc, cat, rnd), (pct, rank, sec) in agg.items():
    bn = branch_of_course[bc]
    suf = bc[-1] if bc[-1].isalpha() else ''
    if suf not in sufidx:
        sufidx[suf] = len(suffixes); suffixes.append(suf)
    r = [cidx[cc], bidx[bn], sufidx[suf], seatidx[cat], rnd, rank or 0, round(pct, 4)]
    rows.append(r)
    shards[family(cat)].append(r)

rows.sort(key=lambda r: (r[0], r[1], r[3], r[4]))
for k in shards:
    shards[k].sort(key=lambda r: (r[6], r[0], r[1]))

meta = {
    'year': '2026-27',
    'source': 'MH State CET Cell — CAP Round I / II / III cutoff lists',
    'colleges': [[colleges[c]['code'], colleges[c]['name'],
                  sidx[colleges[c]['status']], uidx[colleges[c]['univ']],
                  ridx[colleges[c]['region']]] for c in college_codes],
    'statuses': statuses,
    'univs': univs,
    'regions': regions,
    'branches': branch_names,
    'branchGroup': [group_of(b) for b in branch_names],
    'seats': seats,
    'suffixes': suffixes,
    'shards': {k: len(v) for k, v in sorted(shards.items())},
    'counts': {'rows': len(rows), 'colleges': len(college_codes),
               'branches': len(branch_names)},
}

os.makedirs(DATA, exist_ok=True)
json.dump(meta, open(os.path.join(DATA, 'meta.json'), 'w'), separators=(',', ':'))
json.dump(rows, open(os.path.join(DATA, 'cutoffs.json'), 'w'), separators=(',', ':'))
os.makedirs(os.path.join(DATA, 'shards'), exist_ok=True)
for k, v in shards.items():
    json.dump(v, open(os.path.join(DATA, 'shards', k + '.json'), 'w'), separators=(',', ':'))

# One file per college, so a college page loads ~8 KB instead of the whole set.
percollege = defaultdict(list)
for r in rows:
    percollege[r[0]].append(r[1:])
cdir = os.path.join(DATA, 'colleges')
os.makedirs(cdir, exist_ok=True)
for ci, rs in percollege.items():
    rs.sort(key=lambda x: (x[0], x[2], x[3]))
    json.dump(rs, open(os.path.join(cdir, college_codes[ci] + '.json'), 'w'),
              separators=(',', ':'))
print('per-college files', len(percollege))

# CSV for optional Supabase import
with open(os.path.join(ROOT, 'supabase', 'cutoffs.csv'), 'w') as f:
    f.write('college_code,college_name,status,home_university,region,course_code,branch,branch_group,seat_type,cap_round,closing_rank,closing_percentile\n')
    for (cc, bc, cat, rnd), (pct, rank, sec) in sorted(agg.items()):
        bn = branch_of_course[bc]
        g = ['technical', 'core', 'others'][group_of(bn)]
        cn = colleges[cc]['name'].replace('"', "'")
        f.write(f'{cc},"{cn}","{colleges[cc]["status"]}","{colleges[cc]["univ"]}",'
                f'{colleges[cc]["region"]},{bc},"{bn}",{g},{cat},{rnd},{rank or ""},{pct}\n')

print('colleges', len(college_codes))
print('branches', len(branch_names))
print('seats', len(seats))
print('rows', len(rows))
for p in ['meta.json', 'cutoffs.json']:
    print(p, round(os.path.getsize(os.path.join(DATA, p)) / 1024, 1), 'KB')
gcount = defaultdict(int)
for b, g in zip(branch_names, meta['branchGroup']):
    gcount[g] += 1
print('branch groups tech/core/others:', dict(gcount))
