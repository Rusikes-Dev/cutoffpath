# Updating your live site

You already have CutoffPath deployed. Three things changed. Do them in this order.

## 1. Supabase — add the settings table  (30 seconds, required)

The free/paid switch needs one new table. In Supabase → **SQL Editor → New query**,
paste this and Run. It is safe to run on your existing database — nothing is dropped.

```sql
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value)
values ('access_mode', '"paid"'::jsonb)
on conflict (key) do nothing;

alter table public.settings enable row level security;
```

Skip this and nothing breaks — the site just stays in paid mode and the admin
toggle shows a note telling you to run it.

## 2. Push the files

Copy this whole folder over your repo and push. No environment variables changed.

Files that are new or changed:

```
new      site/assets/theme.js
new      site/assets/college.js
new      site/data/colleges/*.json        386 files
new      tools/test_college_page.mjs
changed  site/assets/style.css            dark palette, switch, table styles
changed  site/index.html                  theme bootstrap
changed  site/admin.html                  access mode card, theme
changed  site/colleges/*.html             all 386 regenerated
changed  api/me.js                        now returns freeMode + price
changed  api/admin.js                     getSettings / setAccessMode
changed  tools/build_data.py              writes per-college files
changed  tools/college_template.html
```

## 3. One thing to check

**Your college page edits.** All 386 pages were regenerated, so if you had already
written any About / Fees / Placements text into them, it is gone. Nothing in the
screenshot you sent suggested you had started, but check a page you care about
before you push.

From now on this will not happen again: the cutoff logic moved out of the pages
into `assets/college.js`, so future changes to how the tables work do not require
regenerating anything.

## After deploying

1. Open any college page — you should see two dropdowns above the cutoff table.
2. Tap the sun icon in the top bar. It should go dark and stay dark on reload.
3. Open `/admin` and flip **Access mode** to Free, then load the finder in a
   private window. Results should appear with no paywall. Flip it back.
