// refine.mjs — SaaSRank Tier 2 data refinement
// Cleans raw-scrape.csv into refined-scrape.csv with:
//   1. Dedupe: collapse rows with the same team_page_url to one canonical company
//   2. Filter: mark team_page_status as "fake_redirect" when URL doesn't contain team/about/people/etc.
//   3. Compute clean per-company classification

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const RAW = path.join(DATA_DIR, 'raw-scrape.csv');
const REFINED = path.join(DATA_DIR, 'refined-scrape.csv');

function parseLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => row[h] = cells[idx] || '');
    rows.push(row);
  }
  return { headers, rows };
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// A team-page URL is "real" if its path contains a team-page indicator AFTER any redirect.
// "/eu/?ir=1&bc=DB/team" has /team in query but path is /eu/ — that's a fake.
// "/about-us" has /about-us in path — that's real.
function isRealTeamPageUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const indicators = ['/team', '/about', '/people', '/leadership', '/company', '/our-story', '/our-team'];
    return indicators.some(ind => path.includes(ind));
  } catch {
    return false;
  }
}

function boolish(v) {
  return v === 'true' || v === true || v === 'TRUE';
}

async function main() {
  const { headers, rows } = parseCsv(await readFile(RAW, 'utf8'));
  console.log(`Loaded ${rows.length} raw rows`);

  // Step 1: Identify fake-redirect team pages
  let fakeRedirects = 0;
  for (const r of rows) {
    if (r.team_page_status === 'ok' && !isRealTeamPageUrl(r.team_page_url)) {
      r.team_page_status = 'fake_redirect';
      // Clear the title detection — they were based on the homepage, not a real team page
      r.has_cmo = 'false';
      r.has_vp_marketing = 'false';
      r.has_head_of_marketing = 'false';
      r.has_marketing_director = 'false';
      r.has_marketing_manager = 'false';
      r.has_head_of_growth = 'false';
      r.has_vp_growth = 'false';
      r.has_head_of_content = 'false';
      r.has_content_director = 'false';
      r.has_head_of_seo = 'false';
      r.marketing_titles_count = '0';
      r.marketing_titles_list = '';
      r.has_marketing_leader = 'false';
      r.marketing_leader_seniority = '';
      fakeRedirects++;
    }
  }
  console.log(`Cleared ${fakeRedirects} fake-redirect team-page rows`);

  // Step 2: Dedupe by team_page_url (or by LinkedIn URL if team URL missing)
  // For each duplicate group, keep the row with the lowest tranco_rank (most authoritative)
  // by taking the row with the shortest homepage_url as a proxy.
  const dedupKey = (r) => {
    if (r.team_page_url && r.team_page_status === 'ok') return `team:${r.team_page_url.toLowerCase()}`;
    if (r.linkedin_company_url) return `li:${r.linkedin_company_url.toLowerCase()}`;
    return `home:${r.homepage_url.toLowerCase()}`;
  };

  const groups = new Map();
  for (const r of rows) {
    const key = dedupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // Choose canonical row per group: prefer shorter homepage_url (likely the primary domain)
  const refined = [];
  let dropped = 0;
  for (const [, group] of groups) {
    if (group.length === 1) {
      refined.push(group[0]);
    } else {
      // Sort by homepage_url length ascending; first is canonical
      group.sort((a, b) => a.homepage_url.length - b.homepage_url.length);
      refined.push(group[0]);
      dropped += group.length - 1;
    }
  }
  console.log(`Deduped ${rows.length} rows → ${refined.length} unique companies (dropped ${dropped} duplicate-domain rows)`);

  // Step 3: Add a clean "team_page_real" flag for analysis
  for (const r of refined) {
    r.team_page_real = r.team_page_status === 'ok' ? 'true' : 'false';
  }

  // Write refined CSV
  const newHeaders = [...headers, 'team_page_real'];
  let out = newHeaders.join(',') + '\n';
  for (const r of refined) {
    out += newHeaders.map(h => csvEscape(r[h])).join(',') + '\n';
  }
  await writeFile(REFINED, out);
  console.log(`Wrote ${REFINED} with ${refined.length} unique companies`);

  // Quick summary
  const usable = refined.filter(r => r.status === 'ok');
  const realTeam = refined.filter(r => r.team_page_status === 'ok').length;
  const hasLeader = usable.filter(r => boolish(r.has_marketing_leader)).length;
  const hasCmo = usable.filter(r => boolish(r.has_cmo)).length;
  console.log(`\nRefined summary:`);
  console.log(`  Usable companies: ${usable.length}`);
  console.log(`  Real team pages: ${realTeam} (${Math.round(100*realTeam/usable.length)}%)`);
  console.log(`  Has marketing leader (on real team pages): ${hasLeader} (${Math.round(100*hasLeader/usable.length)}%)`);
  console.log(`  Has CMO title: ${hasCmo} (${Math.round(100*hasCmo/usable.length)}%)`);
}

main().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
