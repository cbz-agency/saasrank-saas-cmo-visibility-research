// analyze.mjs — SaaSRank Tier 2 study analyzer
// Reads data/raw-scrape.csv and produces data/analysis.csv + data/methodology-log.md
// Computes the 12 stat targets from the Stage 1 plan.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const RAW = path.join(DATA_DIR, 'raw-scrape.csv');
const REFINED = path.join(DATA_DIR, 'refined-scrape.csv');
const ANALYSIS = path.join(DATA_DIR, 'analysis.csv');
const METHOD = path.join(DATA_DIR, 'methodology-log.md');

// Prefer refined-scrape.csv if it exists (after refine.mjs dedupe + fake-redirect filter)
import { existsSync as _existsSync } from 'node:fs';
const INPUT = _existsSync(REFINED) ? REFINED : RAW;
const INPUT_LABEL = _existsSync(REFINED) ? 'refined-scrape.csv (deduped)' : 'raw-scrape.csv (uncleaned)';

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    const cells = parseLine(lines[i]);
    headers.forEach((h, idx) => row[h] = cells[idx]);
    rows.push(row);
  }
  return rows;
}
function parseLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
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

function pct(num, denom) {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function boolish(v) {
  return v === 'true' || v === true || v === 'TRUE';
}

async function main() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  console.log(`Reading from ${INPUT_LABEL}`);
  const text = await readFile(INPUT, 'utf8');
  const rows = parseCsv(text);

  const total = rows.length;
  const ok = rows.filter(r => r.status === 'ok');
  const usable = ok.length;

  // Subset: companies with a real (non-fake-redirect) team page
  const withRealTeam = ok.filter(r => r.team_page_status === 'ok');
  const realTeamN = withRealTeam.length;

  // Stat 1: % with NO marketing leader visible
  const noLeader = ok.filter(r => !boolish(r.has_marketing_leader)).length;
  const noLeaderPct = pct(noLeader, usable);

  // Stat 2: single marketing lead vs multi-person team
  const singleLeader = ok.filter(r => parseInt(r.marketing_titles_count || 0, 10) === 1).length;
  const multiPerson = ok.filter(r => parseInt(r.marketing_titles_count || 0, 10) >= 2).length;
  const singleLeaderPct = pct(singleLeader, usable);
  const multiPersonPct = pct(multiPerson, usable);

  // Stat 3: avg marketing-titled people count
  const avgMarketingCount = ok.reduce((sum, r) => sum + (parseInt(r.marketing_titles_count || 0, 10)), 0) / Math.max(usable, 1);

  // Stat 4: title distribution
  const titleCounts = {
    cmo: ok.filter(r => boolish(r.has_cmo)).length,
    vp_marketing: ok.filter(r => boolish(r.has_vp_marketing)).length,
    head_of_marketing: ok.filter(r => boolish(r.has_head_of_marketing)).length,
    marketing_director: ok.filter(r => boolish(r.has_marketing_director)).length,
    marketing_manager: ok.filter(r => boolish(r.has_marketing_manager)).length,
  };

  // Stat 5: % actively hiring (open careers page + at least 1 marketing job)
  const hiringMarketing = ok.filter(r => parseInt(r.marketing_jobs_open_count || 0, 10) > 0).length;
  const hiringMarketingPct = pct(hiringMarketing, usable);

  // Stat 6: % with founder titled with marketing function
  const founderMarketing = ok.filter(r => boolish(r.founder_has_marketing_title)).length;
  const founderMarketingPct = pct(founderMarketing, usable);

  // Stat 7: % mentioning fractional / outsourced
  const fractional = ok.filter(r => boolish(r.mentions_fractional)).length;
  const fractionalPct = pct(fractional, usable);

  // Stat 8: Growth vs Marketing function naming
  const growthLed = ok.filter(r => boolish(r.has_head_of_growth) || boolish(r.has_vp_growth)).length;
  const marketingLed = ok.filter(r => boolish(r.has_cmo) || boolish(r.has_vp_marketing) || boolish(r.has_head_of_marketing) || boolish(r.has_marketing_director)).length;
  const growthLedPct = pct(growthLed, usable);
  const marketingLedPct = pct(marketingLed, usable);

  // Stat 9: % with specialised content/SEO leadership
  const contentSeoLead = ok.filter(r =>
    boolish(r.has_head_of_content) || boolish(r.has_content_director) || boolish(r.has_head_of_seo)
  ).length;
  const contentSeoLeadPct = pct(contentSeoLead, usable);

  // Stat 11: % with LinkedIn URL detectable (proxy for "has LinkedIn presence")
  const hasLinkedIn = ok.filter(r => r.linkedin_company_url && r.linkedin_company_url.length > 0).length;
  const hasLinkedInPct = pct(hasLinkedIn, usable);

  // Confidence tier breakdown
  const highConf = ok.filter(r => r.confidence_tier === 'high').length;
  const medConf = ok.filter(r => r.confidence_tier === 'medium').length;
  const lowConf = ok.filter(r => r.confidence_tier === 'low').length;

  // Team page presence
  const teamPageOk = ok.filter(r => r.team_page_status === 'ok').length;
  const teamPageOkPct = pct(teamPageOk, usable);

  // Careers page presence
  const careersPageOk = ok.filter(r => r.careers_page_status === 'ok').length;
  const careersPageOkPct = pct(careersPageOk, usable);

  // Avg marketing jobs open (on sites where careers page found)
  const careersSites = ok.filter(r => r.careers_page_status === 'ok');
  const avgMarketingJobs = careersSites.reduce((sum, r) => sum + parseInt(r.marketing_jobs_open_count || 0, 10), 0) / Math.max(careersSites.length, 1);

  // Marketing leadership visibility stats — only counted on companies with real team pages
  const realTeamWithLeader = withRealTeam.filter(r => boolish(r.has_marketing_leader)).length;
  const realTeamWithCmo = withRealTeam.filter(r => boolish(r.has_cmo)).length;
  const realTeamWithVpMkt = withRealTeam.filter(r => boolish(r.has_vp_marketing)).length;
  const realTeamWithHeadMkt = withRealTeam.filter(r => boolish(r.has_head_of_marketing)).length;
  const realTeamWithMktDir = withRealTeam.filter(r => boolish(r.has_marketing_director)).length;
  const realTeamWithMktMgr = withRealTeam.filter(r => boolish(r.has_marketing_manager)).length;
  const realTeamWithGrowth = withRealTeam.filter(r => boolish(r.has_head_of_growth) || boolish(r.has_vp_growth)).length;
  const realTeamWithContent = withRealTeam.filter(r => boolish(r.has_head_of_content) || boolish(r.has_content_director)).length;

  // Build analysis.csv
  const analysisRows = [
    ['stat_id','stat_label','numerator','denominator','percent','note'],
    ['headline_A','cmo_publicly_identified_pct', realTeamWithCmo, usable, pct(realTeamWithCmo, usable), 'PRIMARY HEADLINE: % of usable sample (N='+usable+') with publicly discoverable CMO'],
    ['headline_B','marketing_leader_publicly_identified_pct', realTeamWithLeader, usable, pct(realTeamWithLeader, usable), 'ALT HEADLINE: % with ANY publicly discoverable marketing leader (CMO/VP/Head of Marketing)'],
    ['headline_C','marketing_leader_among_real_teams_pct', realTeamWithLeader, realTeamN, pct(realTeamWithLeader, realTeamN), 'TIGHTER: % of companies with a public team page (N='+realTeamN+') that show a marketing leader'],
    ['1','no_marketing_leader_pct', noLeader, usable, noLeaderPct, 'sites with NO marketing-titled person on team or homepage'],
    ['2a','single_marketing_lead_pct', singleLeader, usable, singleLeaderPct, 'sites with exactly 1 marketing-titled person'],
    ['2b','multi_person_marketing_team_pct', multiPerson, usable, multiPersonPct, 'sites with 2+ marketing-titled people'],
    ['3','avg_marketing_titles_count', '', '', avgMarketingCount.toFixed(2), 'mean count of marketing-titled people across all sites'],
    ['4a','title_cmo_pct', titleCounts.cmo, usable, pct(titleCounts.cmo, usable), 'sites with at least one CMO title'],
    ['4b','title_vp_marketing_pct', titleCounts.vp_marketing, usable, pct(titleCounts.vp_marketing, usable), 'sites with at least one VP Marketing title'],
    ['4c','title_head_of_marketing_pct', titleCounts.head_of_marketing, usable, pct(titleCounts.head_of_marketing, usable), 'sites with at least one Head of Marketing'],
    ['4d','title_marketing_director_pct', titleCounts.marketing_director, usable, pct(titleCounts.marketing_director, usable), 'sites with Marketing Director'],
    ['4e','title_marketing_manager_pct', titleCounts.marketing_manager, usable, pct(titleCounts.marketing_manager, usable), 'sites with Marketing Manager only'],
    ['5','hiring_marketing_pct', hiringMarketing, usable, hiringMarketingPct, 'sites with at least 1 open marketing role on careers page'],
    ['6','founder_marketing_title_pct', founderMarketing, usable, founderMarketingPct, 'sites with founder titled with marketing function'],
    ['7','fractional_mention_pct', fractional, usable, fractionalPct, 'sites mentioning fractional or outsourced CMO/marketing'],
    ['8a','growth_led_pct', growthLed, usable, growthLedPct, 'sites with Head of Growth / VP Growth'],
    ['8b','marketing_led_pct', marketingLed, usable, marketingLedPct, 'sites with CMO / VP / Head of Marketing'],
    ['9','content_seo_lead_pct', contentSeoLead, usable, contentSeoLeadPct, 'sites with Head of Content / SEO leadership'],
    ['11','has_linkedin_pct', hasLinkedIn, usable, hasLinkedInPct, 'sites with LinkedIn company URL on homepage'],
    ['confidence_high','high_confidence_classifications', highConf, usable, pct(highConf, usable), 'team page + LinkedIn + careers all available'],
    ['confidence_med','medium_confidence_classifications', medConf, usable, pct(medConf, usable), '2 of 4 signals available'],
    ['confidence_low','low_confidence_classifications', lowConf, usable, pct(lowConf, usable), 'limited signals — caveat in pillar'],
    ['data_team_page_pct','sites_with_team_page', teamPageOk, usable, teamPageOkPct, 'team page found at one of expected paths'],
    ['data_careers_page_pct','sites_with_careers_page', careersPageOk, usable, careersPageOkPct, 'careers page found at one of expected paths'],
    ['data_avg_jobs','avg_marketing_jobs_when_careers_present', '', '', avgMarketingJobs.toFixed(2), 'mean count where careers page found'],
    ['total_processed','total_rows_in_raw_scrape', total, '', '', 'all rows in raw-scrape.csv (incl errors)'],
    ['total_usable','usable_classifications', usable, total, pct(usable, total), 'rows with status=ok'],
  ];

  const csv = analysisRows.map(row => row.map(c => {
    const s = String(c);
    if (s.includes(',') || s.includes('"')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(',')).join('\n') + '\n';

  await writeFile(ANALYSIS, csv);

  // Methodology log
  const method = `# SaaSRank Tier 2 — Methodology Log

**Generated:** ${new Date().toISOString()}
**Study:** "Why X% of SaaS Companies Have No Marketing Leader: A 2026 Analysis of 200 B2B Software Brands"

## Sample

- Source: Tranco top-1M, top 50K candidates probed
- Filter: SaaS-fingerprint (5 signals, threshold 3) — see build-site-list.mjs
- Total raw rows: ${total}
- Usable rows (status=ok): ${usable}
- Sites with team page found: ${teamPageOk} (${teamPageOkPct}%)
- Sites with careers page found: ${careersPageOk} (${careersPageOkPct}%)

## Confidence tier distribution

- High (team + LinkedIn + careers + titles found): ${highConf} (${pct(highConf, usable)}%)
- Medium (2+ signals): ${medConf} (${pct(medConf, usable)}%)
- Low (limited signals): ${lowConf} (${pct(lowConf, usable)}%)

## Headline stats

- **% with NO marketing leader visible: ${noLeaderPct}%** (${noLeader} of ${usable})
- Single marketing lead: ${singleLeaderPct}%
- Multi-person marketing team: ${multiPersonPct}%
- Mean marketing-titled count: ${avgMarketingCount.toFixed(2)}
- Title distribution: CMO ${pct(titleCounts.cmo, usable)}%, VP Marketing ${pct(titleCounts.vp_marketing, usable)}%, Head of Marketing ${pct(titleCounts.head_of_marketing, usable)}%, Marketing Director ${pct(titleCounts.marketing_director, usable)}%, Marketing Manager ${pct(titleCounts.marketing_manager, usable)}%
- Founder-led marketing pattern: ${founderMarketingPct}%
- Fractional / outsourced mentions: ${fractionalPct}%
- Growth-led vs Marketing-led: ${growthLedPct}% vs ${marketingLedPct}%
- Content/SEO specialised leadership: ${contentSeoLeadPct}%
- Actively hiring marketing: ${hiringMarketingPct}%
- Mean open marketing jobs (when careers page found): ${avgMarketingJobs.toFixed(2)}

## Known limitations

- Team page detection relies on common URL paths; sites with non-standard paths may show as "missing" team page
- LinkedIn employee-level title parsing is NOT included (anti-bot risk) — relies on public team pages only
- "Fractional CMO" mention undercounts invisible relationships
- Regex title detection may miss creative title styling (e.g. "Marketing Whisperer", "Storyteller-in-Chief")
- Career page job counts are heuristic — may double-count or miss based on careers page structure
`;

  await writeFile(METHOD, method);

  console.log(`Wrote ${ANALYSIS}`);
  console.log(`Wrote ${METHOD}`);
  console.log(`\nHeadline: ${noLeaderPct}% of ${usable} SaaS companies have NO marketing leader visible.`);
  console.log(`Fractional mention rate: ${fractionalPct}%`);
}

main().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
