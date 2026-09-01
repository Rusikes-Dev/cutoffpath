"""Generate one HTML page per college from tools/college_template.html.

Run again any time you refresh the data. Files that you have already edited
are left alone unless you pass --force.
"""
import json, os, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = open(os.path.join(ROOT, 'tools', 'college_template.html')).read()
META = json.load(open(os.path.join(ROOT, 'site', 'data', 'meta.json')))
OUT = os.path.join(ROOT, 'site', 'colleges')
FORCE = '--force' in sys.argv

os.makedirs(OUT, exist_ok=True)
made = skipped = 0
for code, name, si, ui, ri in META['colleges']:
    path = os.path.join(OUT, code + '.html')
    if os.path.exists(path) and not FORCE:
        skipped += 1
        continue
    page = (TPL.replace('__CODE__', code)
               .replace('__NAME__', html.escape(name))
               .replace('__STATUS__', html.escape(META['statuses'][si]))
               .replace('__UNIV__', html.escape(META['univs'][ui]))
               .replace('__REGION__', html.escape(META['regions'][ri])))
    open(path, 'w').write(page)
    made += 1

print(f'created {made} pages, left {skipped} existing pages untouched')
