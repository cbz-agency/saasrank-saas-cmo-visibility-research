# SaaS CMO Visibility Research (2026)

Public dataset, source code, and methodology for the research study **"Only 8.4% of B2B SaaS Companies Publicly Identify Their CMO: A 2026 Analysis of 261 SaaS Brands."**

Published by [SaaSRank](https://saas-rank.com).

## TL;DR

We analyzed **261 unique B2B SaaS companies** sourced from the [Tranco research-grade top-1M domain list](https://tranco-list.eu/), SaaS-fingerprinted via a 5-signal probe, deduplicated by parent company.

We measured how many publicly identify a marketing leader on their team page, careers page, or homepage.

**Headline findings:**
- 8.4% publicly identify a CMO (22 of 261)
- 11.5% publicly identify any marketing leader (CMO, VP of Marketing, Head of Marketing, or Marketing Director)
- 76.6% have a public team page at all (200 of 261)
- 12.6% are actively hiring at least one marketing role
- 1 company in 261 uses a "Head of Growth" or "VP of Growth" title

Full pillar article: [saas-rank.com/guide/saas-cmo-visibility-2026](https://saas-rank.com/guide/saas-cmo-visibility-2026)

## What's in this repo

```
saasrank-saas-cmo-visibility-research/
├── README.md                          # this file
├── LICENSE-CODE                       # MIT (code)
├── LICENSE-DATA                       # CC-BY-4.0 (data)
├── scraper/
│   ├── package.json
│   ├── build-site-list.mjs            # Tranco fetch + 5-signal SaaS probe
│   ├── scrape.mjs                     # team + careers page parser
│   ├── refine.mjs                     # dedupe + fake-redirect filter
│   └── analyze.mjs                    # roll-up to stat targets
└── data/
    ├── site-list.csv                  # 304 verified SaaS sites (Tranco)
    ├── raw-scrape.csv                 # per-site team/careers analysis
    ├── refined-scrape.csv             # deduped + fake-redirect filtered
    ├── analysis.csv                   # headline stat percentages
    └── methodology-log.md             # what actually happened
```

## Verify this yourself

To reproduce the analysis:

```bash
cd scraper
npm install
npx playwright install chromium
npm run build-list  # ~30 min: fetches Tranco, probes for SaaS
npm run scrape      # ~15 min: per-site team/careers parse
npm run refine      # ~5 sec: dedupe + fake-redirect filter
npm run analyze     # ~5 sec: roll-up to analysis.csv
```

Outputs land in `data/`.

## Methodology summary

1. **Source list:** Tranco top-1M, downloaded fresh. Top 50K candidates probed after filtering known-non-SaaS patterns.
2. **SaaS-fingerprint probe** (5 signals, threshold 3):
   - Pricing page returns HTTP 200
   - Free trial OR demo CTA on homepage
   - Login page exists
   - B2B language on homepage ("for teams", "for businesses", "platform for", etc.)
   - Common SaaS analytics/widget fingerprint (HubSpot tracking, Intercom widget, Segment, Stripe SDK, etc.)
3. **Team page detection:** try `/team`, `/about`, `/about-us`, `/company`, `/people`, `/leadership`, `/our-team`. Validated team-page URLs contain one of those path segments (filters out homepage redirects).
4. **Marketing title detection:** static-HTML regex against parsed page text. Title patterns include CMO, Chief Marketing Officer, VP of Marketing, Head of Marketing, Director of Marketing, Marketing Manager, Head of Growth, Head of Content, Head of SEO.
5. **Careers page detection:** try `/careers`, `/jobs`, `/work-with-us`, `/join-us`. Marketing job count is heuristic regex against job-title patterns.
6. **Deduplication:** rows sharing the same team page URL are collapsed to one canonical company (kept the row with the shortest homepage URL).
7. **Confidence tiers:** High = team + LinkedIn + careers + titles all detected. Medium = 2 of 4 signals. Low = limited signals.

## Known limitations

This study undercounts marketing leadership for three structural reasons:

- **JS-rendered team pages.** Static HTML scrape misses team pages rendered client-side in React or Vue, which is common in modern SaaS. Spot-check suggests we miss roughly 10-20% of marketing leaders this way.
- **Fractional CMO arrangements are structurally invisible.** Companies do not advertise that their CMO is fractional. The 0% mention rate in our data is a floor, not a ceiling.
- **Founder-as-CMO requires literal phrasing.** Our regex needs "Co-founder & CMO" or similar; founders informally running marketing without disclosing it are not captured.

A v2 of this study would add a Playwright JS-rendering pass, LinkedIn employee-title cross-reference, and manual annotation on a high-confidence subsample.

## Corrections and removal requests

If your company is named in the study and you would like to:

- Correct an inaccuracy
- Add a missing marketing leader we missed
- Request removal from the public dataset

Email: **camilla@saas-rank.com**

We treat removal requests as good-faith requests and act on them within 5 business days, no questions asked. We also publish corrections at the bottom of the [pillar article](https://saas-rank.com/guide/saas-cmo-visibility-2026) for transparency.

## Citation

If you cite this study in research, journalism, or marketing material:

> Gleditsch, C. (2026). *Only 8.4% of B2B SaaS Companies Publicly Identify Their CMO: A 2026 Analysis of 261 SaaS Brands.* SaaSRank. https://saas-rank.com/guide/saas-cmo-visibility-2026

## License

- **Code** (`scraper/`): MIT — see `LICENSE-CODE`
- **Data** (`data/`): CC-BY-4.0 — see `LICENSE-DATA`

Reuse welcome with attribution.
