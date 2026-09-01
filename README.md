# CutoffPath

An MHT-CET engineering college finder for Maharashtra, built on the official
State CET Cell cutoff lists for CAP Rounds I, II and III (2026-27).

A student enters their percentile or merit rank, picks their category, gender
and preferred branches, pays ₹49 once, and gets every college and branch they
are eligible for — with the round each seat closed in, and a downloadable
choice list.

---

## 1. What is in the box

```
site/                     everything served to the browser
  index.html              the app: Finder, Colleges, Hostel
  admin.html              owner dashboard  →  yoursite.com/admin
  assets/style.css
  assets/app.js
  colleges/*.html         386 college pages, one per college
  data/meta.json          colleges, branches, seat types, universities
  data/shards/*.json      cutoffs split by category

api/                      Vercel serverless functions (no npm packages)
  _lib.js                 Supabase + Razorpay helpers
  create-order.js         POST  starts a Razorpay order
  verify-payment.js       POST  checks the signature, grants access
  restore-access.js       POST  email + phone  →  access token
  me.js                   GET   is this token still valid?
  track.js                POST  analytics events
  admin.js                POST  login, stats, students, grant/revoke

supabase/
  schema.sql              run this once in Supabase
  cutoffs.csv.gz          optional: all 88,343 cutoffs as CSV

tools/
  extract.py                    PDF  →  raw_cutoffs.json
  build_data.py                 raw  →  meta.json + shards + csv
  generate_college_pages.py     meta →  386 college pages
  college_template.html         the template those pages come from
  verify_matching.mjs           checks the eligibility logic
  test_ui.mjs                   drives the whole UI in jsdom

vercel.json, package.json, .env.example
```

---

## 2. Deploy in about fifteen minutes

### Step 1 — Supabase

1. Create a project at supabase.com.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, press Run.
3. Go to **Project Settings → API** and copy two things:
   - the **Project URL**
   - the **`service_role`** key (the secret one, *not* `anon`)

The tables are created with Row Level Security on and no policies, so nothing
is readable from a browser. Only your serverless functions, which use the
`service_role` key, can touch the data. That is deliberate.

### Step 2 — Razorpay

1. Sign up at razorpay.com and finish KYC (needed before you can accept live payments).
2. **Settings → API Keys → Generate Key**. Copy the Key ID and Key Secret.
3. Start with **Test Mode** keys (`rzp_test_…`) until you have tried a full payment.

### Step 3 — Vercel

1. Push this folder to a GitHub repo.
2. On vercel.com, **Add New → Project**, import the repo.
3. Leave the framework as "Other". `vercel.json` already points the output at `site/`.
4. Under **Settings → Environment Variables**, add every line from `.env.example`
   with your real values.
5. Deploy.

### Step 4 — Try it

- Open your site, enter a percentile, hit **Find my colleges** — the paywall appears
  with the number of matches.
- Pay with a Razorpay test card (`4111 1111 1111 1111`, any future expiry, CVV `123`).
- The list unlocks. Add a few colleges, download the PDF.
- Open `/admin`, sign in with `ADMIN_PASSWORD`, and check the payment shows up.

When that all works, swap the Razorpay test keys for live keys and redeploy.

---

## 3. Environment variables

| Name | What it is |
|---|---|
| `SUPABASE_URL` | Project URL from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` secret key |
| `RAZORPAY_KEY_ID` | Razorpay Key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `PRICE_PAISE` | `4900` = ₹49. Change here to change the price everywhere |
| `ADMIN_PASSWORD` | What you type to get into `/admin` |
| `ADMIN_SECRET` | Long random string used to sign admin sessions |

Never put the `service_role` key or the Razorpay secret in any file under `site/`.
Those are public.

---

## 4. How a student's access works

There are no passwords for students. Access is tied to a random token.

1. They pay. Razorpay sends back an order id, a payment id and a signature.
2. `verify-payment.js` recomputes the HMAC-SHA256 signature server-side and
   compares it. A forged or replayed request fails here, so nobody can unlock
   the site without actually paying.
3. On success a token is generated, saved on their row in `students`, and stored
   in their browser.
4. New phone, cleared browser, whatever — they tap **Restore access**, enter the
   email and phone they paid with, and get a fresh token.

You can also grant access by hand from the admin panel. Useful for refunds,
UPI payments that came to you directly, friends, and testing.

---

## 5. The admin panel

At `/admin`. It shows:

- Revenue, paid students, manual grants, orders created
- Visits, searches run, PDFs downloaded, and paywall → paid conversion
- A 14-day bar chart of visits with searches shaded inside
- Every student, searchable by name, email or phone, with one-tap grant/revoke
- What categories and genders people are actually searching for
- A live feed of the last 60 events

The page is marked `noindex` and the API rejects any request without a valid
signed session, but the URL is still guessable — so use a real password.

---

## 6. Editing the college pages

All 386 pages already exist and already show live cutoff tables pulled from the
data. What they do not have is the human content: about, fees, placements,
hostel, contact.

Open any file in `site/colleges/`, for example `site/colleges/16006.html`, and
look for the comments:

```html
<!-- ==================== EDIT: fees ==================== -->
```

Fill in the sections under those. Everything else can be left alone.

To find a college's file, the filename is its CAP code — the same five digits
shown on its card in the app.

If you ever regenerate the pages, `python3 tools/generate_college_pages.py`
skips files that already exist, so your edits survive. Add `--force` only if you
want to wipe them and start over.

---

## 7. Refreshing the data next year

When the CET Cell publishes the next season's PDFs:

```bash
# put the three PDFs somewhere, then edit the paths at the bottom of extract.py
python3 tools/extract.py                  # parses the PDFs
python3 tools/build_data.py               # rebuilds meta.json + shards + csv
python3 tools/generate_college_pages.py   # adds pages for any new colleges
node tools/verify_matching.mjs            # sanity-checks the result
```

`extract.py` reads word coordinates rather than flat text, because a stage row
can have a value under the seventh column and nothing before it. It reports how
many rows it found and how many it could not place — that number should be zero.

---

## 8. Notes on decisions you might want to revisit

**Cutoffs are static JSON, not Supabase.** Supabase handles students, payments,
analytics and access. The 88,343 cutoff rows sit in static files instead, sharded
by category, because a search touches thousands of rows and doing that in Postgres
on every query would burn through the free tier quickly, and would be slower.
`supabase/cutoffs.csv.gz` is there if you would rather move it into the database
later — `schema.sql` already has the table for it.

**Home university is asked for.** It defaults to "Not sure", which shows every
seat type. But Home University and Other Than Home University seats close at very
different percentiles, so a student who sets it gets a much more honest list.

**Reserved-category students are matched against Open seats too**, because they
are genuinely eligible for them. A female candidate is matched against both
general and ladies seats. This is why an OBC female sees more options than an
Open male at the same percentile.

**Results include a borderline band.** Anything within 0.9 percentile *below* the
last cutoff still shows, marked "Borderline", because cutoffs move between years
and those are exactly the choices worth putting at the top of an option form.

---

## 9. Data accuracy

Extraction was validated against a raw count of every percentile figure printed
in the three PDFs:

| File | Values in PDF | Extracted |
|---|---|---|
| CAP Round I | 36,059 | 36,039 |
| CAP Round II | 34,391 | 34,390 |
| CAP Round III | 19,839 | 19,838 |

Spot-checked against the PDF by hand, for example COEP Technological University,
Civil Engineering, GOPENS, CAP I: rank 4148 / 99.0434195 — matches exactly.

Cutoffs are still a guide, not a promise. The footer says so on every page, and
the PDF export repeats it.
