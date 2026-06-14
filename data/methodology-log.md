# SaaSRank Tier 2 — Methodology Log

**Generated:** 2026-06-13T18:06:53.676Z
**Study:** "Why X% of SaaS Companies Have No Marketing Leader: A 2026 Analysis of 200 B2B Software Brands"

## Sample

- Source: Tranco top-1M, top 50K candidates probed
- Filter: SaaS-fingerprint (5 signals, threshold 3) — see build-site-list.mjs
- Total raw rows: 266
- Usable rows (status=ok): 261
- Sites with team page found: 200 (76.6%)
- Sites with careers page found: 214 (82%)

## Confidence tier distribution

- High (team + LinkedIn + careers + titles found): 188 (72%)
- Medium (2+ signals): 57 (21.8%)
- Low (limited signals): 16 (6.1%)

## Headline stats

- **% with NO marketing leader visible: 88.1%** (230 of 261)
- Single marketing lead: 10%
- Multi-person marketing team: 4.2%
- Mean marketing-titled count: 0.20
- Title distribution: CMO 8.4%, VP Marketing 1.1%, Head of Marketing 1.9%, Marketing Director 0.8%, Marketing Manager 4.6%
- Founder-led marketing pattern: 0%
- Fractional / outsourced mentions: 0%
- Growth-led vs Marketing-led: 0.4% vs 10.7%
- Content/SEO specialised leadership: 1.1%
- Actively hiring marketing: 12.6%
- Mean open marketing jobs (when careers page found): 0.20

## Known limitations

- Team page detection relies on common URL paths; sites with non-standard paths may show as "missing" team page
- LinkedIn employee-level title parsing is NOT included (anti-bot risk) — relies on public team pages only
- "Fractional CMO" mention undercounts invisible relationships
- Regex title detection may miss creative title styling (e.g. "Marketing Whisperer", "Storyteller-in-Chief")
- Career page job counts are heuristic — may double-count or miss based on careers page structure
