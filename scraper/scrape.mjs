// scrape.mjs — SaaSRank Tier 2 study, per-site analyzer
// For each verified SaaS company from data/site-list.csv:
//   1. Fetch homepage (already verified; we re-fetch to grab LinkedIn URL + team-page links)
//   2. Try a list of team-page paths (/team, /about, /about-us, /company, /people, /leadership)
//   3. Parse team page for marketing titles using regex patterns
//   4. Try careers page (/careers, /jobs, /work-with-us, /join-us)
//   5. Count marketing job postings on careers page
//   6. Check homepage + about + team for "fractional" mentions
//   7. Detect founder-led marketing pattern ("Co-founder & CMO", "Founder, Marketing")
//
// Writes data/raw-scrape.csv (resumable).

import { chromium } from 'playwright';
import { writeFile, appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const SITE_LIST = path.join(DATA_DIR, 'site-list.csv');
const RAW = path.join(DATA_DIR, 'raw-scrape.csv');
const PROGRESS = path.join(DATA_DIR, 'progress.log');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const RAW_HEADERS = [
  'company_name','homepage_url','status',
  'team_page_url','team_page_status',
  'has_cmo','has_vp_marketing','has_head_of_marketing','has_marketing_director','has_marketing_manager',
  'has_head_of_growth','has_vp_growth',
  'has_head_of_content','has_content_director','has_head_of_seo',
  'marketing_titles_count','marketing_titles_list',
  'has_marketing_leader','marketing_leader_seniority',
  'founder_has_marketing_title','founder_marketing_pattern',
  'mentions_fractional','fractional_mention_context',
  'careers_page_url','careers_page_status',
  'marketing_jobs_open_count','marketing_job_titles',
  'linkedin_company_url',
  'confidence_tier',
  'error_note',
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(obj) {
  return RAW_HEADERS.map(h => csvEscape(obj[h])).join(',') + '\n';
}
async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  await appendFile(PROGRESS, line);
}

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

// --- Title regex patterns ---
// Each pattern matches the FULL title (case-insensitive, word-boundary-aware)
const TITLE_PATTERNS = {
  cmo: /\b(chief marketing officer|cmo)\b/i,
  vp_marketing: /\b(vice president,?\s+marketing|vp of marketing|vp,?\s+marketing|vp marketing)\b/i,
  head_of_marketing: /\b(head of marketing|director of marketing|marketing director)\b/i,
  marketing_manager: /\b(marketing manager|senior marketing manager)\b/i,
  head_of_growth: /\b(head of growth|vp of growth|vp growth|growth director|director of growth)\b/i,
  vp_growth: /\b(vp of growth|vp growth|vice president,?\s+growth)\b/i,
  head_of_content: /\b(head of content|content director|director of content)\b/i,
  content_director: /\b(content director|director of content)\b/i,
  head_of_seo: /\b(head of seo|seo director|director of seo|seo lead)\b/i,
};

// Title extraction — find any marketing-related title phrases in arbitrary text
const ANY_MARKETING_TITLE_RX = /\b(chief marketing officer|cmo|vp of marketing|vp marketing|vice president,?\s+marketing|head of marketing|director of marketing|marketing director|marketing manager|senior marketing manager|head of growth|growth lead|growth director|head of content|content director|head of seo|seo director|seo lead|brand director|head of brand|demand gen lead|head of demand|marketing lead)\b/gi;

const FOUNDER_MARKETING_RX = /\b(co-?founder.{0,5}(cmo|chief marketing|head of marketing|head of growth|marketing lead)|founder.{0,5}(cmo|chief marketing|head of marketing|head of growth|marketing lead)|ceo.{0,5}(cmo|chief marketing|head of marketing)|(cmo|chief marketing officer|head of marketing|head of growth).{0,10}(co-?founder|founder))\b/i;

const FRACTIONAL_RX = /\b(fractional cmo|fractional marketing director|fractional vp of marketing|fractional vp marketing|fractional chief marketing officer|interim cmo|interim head of marketing|outsourced cmo|outsourced marketing director|outsourced marketing)\b/i;

const TEAM_PATHS = ['/team', '/about', '/about-us', '/company', '/people', '/leadership', '/our-team'];
const CAREERS_PATHS = ['/careers', '/jobs', '/work-with-us', '/join-us', '/company/careers', '/about/careers'];

const LINKEDIN_RX = /https?:\/\/(?:www\.)?linkedin\.com\/company\/[A-Za-z0-9_-]+/i;

async function tryFetch(url, opts = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeout || 10000),
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return { ok: false, status: res.status, note: 'not_html' };
    const text = await res.text();
    return { ok: true, status: res.status, url: res.url, text };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 80) };
  }
}

async function findTeamPage(homepageUrl) {
  const base = homepageUrl.replace(/\/$/, '');
  for (const p of TEAM_PATHS) {
    const result = await tryFetch(base + p, { timeout: 8000 });
    if (result.ok && result.text && result.text.length > 800) {
      return { url: result.url || (base + p), text: result.text, status: 'ok' };
    }
  }
  return { url: '', text: '', status: 'missing' };
}

async function findCareersPage(homepageUrl) {
  const base = homepageUrl.replace(/\/$/, '');
  for (const p of CAREERS_PATHS) {
    const result = await tryFetch(base + p, { timeout: 8000 });
    if (result.ok && result.text && result.text.length > 500) {
      return { url: result.url || (base + p), text: result.text, status: 'ok' };
    }
  }
  return { url: '', text: '', status: 'missing' };
}

function stripHtml(html) {
  // Remove script/style blocks, then strip tags. Decode common entities.
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function detectTitles(text) {
  const out = {
    has_cmo: false,
    has_vp_marketing: false,
    has_head_of_marketing: false,
    has_marketing_director: false,
    has_marketing_manager: false,
    has_head_of_growth: false,
    has_vp_growth: false,
    has_head_of_content: false,
    has_content_director: false,
    has_head_of_seo: false,
  };
  if (!text) return out;
  out.has_cmo = TITLE_PATTERNS.cmo.test(text);
  out.has_vp_marketing = TITLE_PATTERNS.vp_marketing.test(text);
  out.has_head_of_marketing = /\b(head of marketing)\b/i.test(text);
  out.has_marketing_director = /\b(director of marketing|marketing director)\b/i.test(text);
  out.has_marketing_manager = /\b(marketing manager|senior marketing manager)\b/i.test(text);
  out.has_head_of_growth = /\b(head of growth)\b/i.test(text);
  out.has_vp_growth = TITLE_PATTERNS.vp_growth.test(text);
  out.has_head_of_content = /\b(head of content)\b/i.test(text);
  out.has_content_director = TITLE_PATTERNS.content_director.test(text);
  out.has_head_of_seo = TITLE_PATTERNS.head_of_seo.test(text);
  return out;
}

function extractTitles(text) {
  if (!text) return [];
  const matches = text.match(ANY_MARKETING_TITLE_RX) || [];
  // Deduplicate, normalize to lowercase
  const set = new Set(matches.map(s => s.toLowerCase().trim()));
  return Array.from(set);
}

function highestSeniority(titles) {
  // Order from most to least senior
  const order = [
    /chief marketing officer|cmo/i,
    /vp of marketing|vp marketing|vice president marketing/i,
    /head of marketing|director of marketing|marketing director/i,
    /head of growth/i,
    /head of content|content director/i,
    /head of seo|seo director/i,
    /marketing manager|senior marketing manager/i,
    /brand director|head of brand/i,
    /demand gen lead|head of demand|marketing lead|growth lead/i,
  ];
  const labels = ['cmo','vp_marketing','head_of_marketing','head_of_growth','head_of_content','head_of_seo','marketing_manager','brand_director','marketing_lead'];
  for (let i = 0; i < order.length; i++) {
    if (titles.some(t => order[i].test(t))) return labels[i];
  }
  return '';
}

function extractLinkedIn(html) {
  if (!html) return '';
  const m = html.match(LINKEDIN_RX);
  return m ? m[0] : '';
}

function getFractionalContext(text) {
  if (!text) return '';
  const m = text.match(/.{0,80}(fractional cmo|fractional marketing director|fractional vp of marketing|fractional chief marketing officer|interim cmo|outsourced cmo).{0,80}/i);
  return m ? m[0].slice(0, 200) : '';
}

function countMarketingJobs(text) {
  if (!text) return { count: 0, titles: [] };
  // Heuristic: count occurrences of job-title patterns within careers page text that mention "marketing"
  const jobTitleRx = /(?:^|>|\.|·|•|\|)\s*([A-Z][A-Za-z &,/\-]{2,60}(?:Marketing|Growth|Demand Gen|Content|SEO|Brand)[A-Za-z &,/\-]{0,60})(?:\s*(?:<|\.|·|•|\||$))/g;
  const titles = new Set();
  let m;
  let safety = 0;
  while ((m = jobTitleRx.exec(text)) !== null && safety < 100) {
    safety++;
    const title = m[1].trim().replace(/\s+/g, ' ');
    // Filter: skip if it looks like a section heading rather than a job title
    if (title.length > 80) continue;
    if (/^(our|about|the|all|view|browse|filter)/i.test(title)) continue;
    titles.add(title);
  }
  // Fallback: just count "Marketing" occurrences in a careers-list pattern
  if (titles.size === 0) {
    const rx2 = /marketing\s+(manager|director|lead|specialist|coordinator|associate|analyst)/gi;
    const matches2 = text.match(rx2) || [];
    for (const t of matches2.slice(0, 20)) titles.add(t);
  }
  return { count: titles.size, titles: Array.from(titles).slice(0, 10) };
}

function assignConfidence({ team_page_status, marketing_titles_count, careers_page_status, linkedin_company_url }) {
  let score = 0;
  if (team_page_status === 'ok') score += 2;
  if (marketing_titles_count > 0) score += 1;
  if (careers_page_status === 'ok') score += 1;
  if (linkedin_company_url) score += 1;
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

async function loadProcessed() {
  if (!existsSync(RAW)) return new Set();
  const text = await readFile(RAW, 'utf8');
  const rows = parseCsv(text);
  return new Set(rows.map(r => r.homepage_url));
}

async function main() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(SITE_LIST)) {
    await log('FATAL: site-list.csv missing. Run build-site-list.mjs first.');
    process.exit(1);
  }
  const siteListText = await readFile(SITE_LIST, 'utf8');
  const sites = parseCsv(siteListText);
  await log(`Loaded ${sites.length} sites from list`);

  const processed = await loadProcessed();
  if (processed.size === 0) await writeFile(RAW, RAW_HEADERS.join(',') + '\n');
  await log(`Resuming. Already processed: ${processed.size}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    javaScriptEnabled: true,
  });

  const start = Date.now();
  let count = 0;
  let teamPageHits = 0;
  let careersPageHits = 0;

  for (const site of sites) {
    if (processed.has(site.homepage_url)) continue;
    count++;
    const t0 = Date.now();
    const row = { ...Object.fromEntries(RAW_HEADERS.map(h => [h, ''])) };
    row.company_name = site.company_name;
    row.homepage_url = site.homepage_url;

    try {
      // 1. Homepage fetch — for LinkedIn URL + fractional mentions
      const homeResult = await tryFetch(site.homepage_url, { timeout: 10000 });
      let homeText = '';
      let homepageHtml = '';
      if (homeResult.ok && homeResult.text) {
        homepageHtml = homeResult.text;
        homeText = stripHtml(homepageHtml);
        row.linkedin_company_url = extractLinkedIn(homepageHtml);
      }

      // 2. Team page
      const teamRes = await findTeamPage(site.homepage_url);
      row.team_page_url = teamRes.url;
      row.team_page_status = teamRes.status;
      let teamText = '';
      if (teamRes.status === 'ok') {
        teamPageHits++;
        teamText = stripHtml(teamRes.text);
      }

      // 3. Title detection on team page (fall back to homepage if no team page)
      const titleSource = teamText || homeText;
      const titleDetect = detectTitles(titleSource);
      Object.assign(row, titleDetect);

      const titlesList = extractTitles(titleSource);
      row.marketing_titles_count = titlesList.length;
      row.marketing_titles_list = titlesList.join(';');
      row.has_marketing_leader = titlesList.some(t =>
        /chief marketing officer|cmo|vp of marketing|vp marketing|head of marketing|director of marketing|marketing director|head of growth|head of content/i.test(t)
      );
      row.marketing_leader_seniority = highestSeniority(titlesList);

      // 4. Founder marketing pattern
      const founderMatch = (homeText + ' ' + teamText).match(FOUNDER_MARKETING_RX);
      row.founder_has_marketing_title = !!founderMatch;
      row.founder_marketing_pattern = founderMatch ? founderMatch[0].slice(0, 150) : '';

      // 5. Fractional mentions
      const fractionalSource = homeText + ' ' + teamText;
      row.mentions_fractional = FRACTIONAL_RX.test(fractionalSource);
      row.fractional_mention_context = getFractionalContext(fractionalSource);

      // 6. Careers page
      const careersRes = await findCareersPage(site.homepage_url);
      row.careers_page_url = careersRes.url;
      row.careers_page_status = careersRes.status;
      if (careersRes.status === 'ok') {
        careersPageHits++;
        const careersText = stripHtml(careersRes.text);
        const jobs = countMarketingJobs(careersText);
        row.marketing_jobs_open_count = jobs.count;
        row.marketing_job_titles = jobs.titles.join(';');
      } else {
        row.marketing_jobs_open_count = '';
      }

      row.confidence_tier = assignConfidence(row);
      row.status = (homeResult.ok || teamRes.status === 'ok') ? 'ok' : 'no_data';
    } catch (err) {
      row.status = 'fatal';
      row.error_note = String(err.message || err).slice(0, 300);
    }

    await appendFile(RAW, csvRow(row));
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (count % 5 === 0) {
      await log(`Processed ${count} | last: ${site.homepage_url} | site_ms=${Date.now()-t0} | team_hits=${teamPageHits} careers_hits=${careersPageHits} | elapsed=${elapsed}s`);
    }
  }

  await browser.close();
  await log(`Scrape complete. Sites processed: ${count}. Team hits: ${teamPageHits}. Careers hits: ${careersPageHits}.`);
}

main().catch(async (err) => {
  await log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
