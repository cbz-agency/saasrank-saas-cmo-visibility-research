// build-site-list.mjs — SaaSRank Tier 2 study
// Probes Tranco top-N for B2B SaaS sites using a 5-signal fingerprint.
// A domain is classified SaaS if AT LEAST 3 of 5 signals match.
//
// Signals:
//   1. /pricing returns HTTP 200 (any redirect chain)
//   2. Homepage text matches free-trial OR demo CTA regex
//   3. /login OR /signin OR /sign-in OR /account/login returns HTTP 200
//   4. Homepage text matches B2B language regex
//   5. Common SaaS analytics/widget fingerprint in homepage HTML
//
// Writes data/site-list.csv with columns:
//   company_name,homepage_url,source,tranco_rank,saas_verified,signals_matched,signals_detail

import { writeFile, appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const SITE_LIST = path.join(DATA_DIR, 'site-list.csv');
const PROGRESS = path.join(DATA_DIR, 'progress.log');
const TRANCO_ZIP = path.join(DATA_DIR, 'tranco-top1m.csv.zip');
const TRANCO_CSV = path.join(DATA_DIR, 'tranco-top1m.csv');

const TARGET_N = 300;
const PROBE_LIMIT = 50000; // top 50K Tranco — SaaS density is high enough that we hit 300 well before this
const PROBE_TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 30;
const MIN_SIGNALS_FOR_SAAS = 3;
const UA = 'SaaSRankResearchBot/1.0 (+https://saas-rank.com/research)';

// SaaS-fingerprint regexes
const RX_FREE_TRIAL = /(start (a )?free trial|free trial|try (it )?free|start for free|book a demo|request a demo|get a demo|schedule a demo|sign up free|try free)/i;
const RX_B2B_LANG = /(for teams|for companies|for businesses|enterprise|trusted by|platform for|all-in-one platform|the (leading|modern|new) platform)/i;
const RX_PRICING_LINK = /href=["'][^"']*?pricing[^"']*?["']/i;
const RX_LOGIN_LINK = /href=["'][^"']*?(login|sign-?in|signin)[^"']*?["']/i;
const RX_SAAS_FINGERPRINT = /(intercom\.io|hubspot|segment\.com|cdn\.segment|mixpanel|hotjar|amplitude\.com|appcues|userpilot|driftt\.com|drift\.com|stripe\.com\/v3|js\.stripe\.com|productboard|frontapp|js\.intercomcdn\.com)/i;

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  await appendFile(PROGRESS, line);
}

async function downloadTranco() {
  if (existsSync(TRANCO_CSV)) {
    await log('Tranco CSV already present, skipping download');
    return;
  }
  await log('Downloading Tranco top-1M list');
  execFileSync('curl', ['-L', '-s', '-o', TRANCO_ZIP, 'https://tranco-list.eu/top-1m.csv.zip'], { stdio: 'inherit' });
  await log('Unzipping Tranco list');
  execFileSync('unzip', ['-o', '-d', DATA_DIR, TRANCO_ZIP], { stdio: 'inherit' });
  const unzipped = path.join(DATA_DIR, 'top-1m.csv');
  if (existsSync(unzipped)) {
    execFileSync('mv', [unzipped, TRANCO_CSV]);
  }
  await log('Tranco ready');
}

async function loadDomains(limit) {
  const text = await readFile(TRANCO_CSV, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const [rank, domain] = lines[i].split(',');
    if (!domain) continue;
    out.push({ rank: parseInt(rank, 10), domain: domain.trim() });
  }
  return out;
}

// Skip obvious non-SaaS patterns to save probe budget on top-tier media/retail/etc.
const SKIP_HOST_PATTERNS = [
  /\.(gov|edu|mil)$/i,
  /^(google|youtube|facebook|amazon|wikipedia|twitter|x|instagram|tiktok|reddit|baidu|yahoo|bing|cnn|bbc|nytimes|wsj|washingtonpost|foxnews|imdb|netflix|disney|hulu|spotify|apple|microsoft|adobe|aliexpress|alibaba|taobao|ebay|walmart|target|bestbuy|costco|homedepot|lowes|sephora|nike|adidas|samsung|sony|nintendo|playstation|xbox|paypal|stripe|chase|wellsfargo|citi|hsbc|barclays|tmobile|verizon|att|comcast|xfinity|spectrum|fedex|ups|usps|dhl|expedia|booking|airbnb|tripadvisor|kayak|priceline|cars|carfax|zillow|realtor|trulia|redfin|indeed|glassdoor|monster|craigslist|cnet|engadget|techcrunch|theverge|gizmodo|mashable|forbes|fortune|bloomberg|reuters|bbcnews)\./i,
];

async function probeSaaS(domain) {
  for (const proto of ['https://', 'http://']) {
    const base = `${proto}${domain}`;
    let signals = 0;
    const detail = [];
    let html = '';
    let homepageUrl = base;

    // Fetch homepage
    try {
      const res = await fetch(base, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8' },
      });
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('text/html')) continue;
      html = await res.text();
      homepageUrl = res.url || base;
    } catch {
      continue;
    }

    if (!html || html.length < 500) continue;

    // Signal 2: free trial / demo CTA in homepage text
    if (RX_FREE_TRIAL.test(html)) { signals++; detail.push('cta'); }

    // Signal 4: B2B language on homepage
    if (RX_B2B_LANG.test(html)) { signals++; detail.push('b2b'); }

    // Signal 5: SaaS analytics/widget fingerprint
    if (RX_SAAS_FINGERPRINT.test(html)) { signals++; detail.push('fp'); }

    // Signals 1 & 3: pricing and login - only probe if we have at least 1 homepage signal (save HTTP budget)
    if (signals === 0) continue;

    // Signal 1: pricing page exists
    let pricingOk = false;
    // First check homepage for pricing link
    if (RX_PRICING_LINK.test(html)) {
      try {
        const u = new URL(`${homepageUrl.replace(/\/$/, '')}/pricing`);
        const res = await fetch(u.href, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          redirect: 'follow',
          headers: { 'User-Agent': UA },
        });
        pricingOk = res.ok;
      } catch {}
    }
    if (pricingOk) { signals++; detail.push('pricing'); }

    // Signal 3: login page exists
    let loginOk = false;
    if (RX_LOGIN_LINK.test(html)) {
      for (const lp of ['/login', '/signin', '/sign-in', '/account/login']) {
        try {
          const u = new URL(`${homepageUrl.replace(/\/$/, '')}${lp}`);
          const res = await fetch(u.href, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            redirect: 'follow',
            method: 'HEAD',
            headers: { 'User-Agent': UA },
          });
          if (res.ok) { loginOk = true; break; }
        } catch {}
      }
    }
    if (loginOk) { signals++; detail.push('login'); }

    if (signals >= MIN_SIGNALS_FOR_SAAS) {
      return {
        isSaaS: true,
        signals,
        signalsDetail: detail.join('|'),
        homepageUrl,
      };
    }
    return null; // first proto matched HTML but didn't clear threshold, don't retry
  }
  return null;
}

async function main() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await log('Starting SaaS site list build (Tranco source, 5-signal fingerprint)');

  await downloadTranco();
  const domains = await loadDomains(PROBE_LIMIT);
  await log(`Loaded ${domains.length} Tranco domains. Filtering known non-SaaS patterns...`);

  const filtered = domains.filter(d => !SKIP_HOST_PATTERNS.some(rx => rx.test(d.domain)));
  await log(`After skip filter: ${filtered.length} candidate domains`);

  // Resume support
  let alreadyVerified = new Set();
  let resumeFromRank = 0;
  if (existsSync(SITE_LIST)) {
    const text = await readFile(SITE_LIST, 'utf8');
    const lines = text.trim().split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      if (cells.length >= 4) {
        alreadyVerified.add(cells[0]);
        const r = parseInt(cells[3], 10);
        if (Number.isFinite(r) && r > resumeFromRank) resumeFromRank = r;
      }
    }
    await log(`Resume: ${alreadyVerified.size} already verified, last rank ${resumeFromRank}`);
  } else {
    await writeFile(
      SITE_LIST,
      'company_name,homepage_url,source,tranco_rank,saas_verified,signals_matched,signals_detail\n'
    );
  }

  let probed = 0;
  let verified = alreadyVerified.size;
  let queue = filtered.filter(d => d.rank > resumeFromRank && !alreadyVerified.has(d.domain));
  await log(`Queue size after resume filter: ${queue.length}`);
  let stopRequested = false;

  async function worker() {
    while (!stopRequested && queue.length > 0 && verified < TARGET_N) {
      const item = queue.shift();
      if (!item) break;
      probed++;
      try {
        const result = await probeSaaS(item.domain);
        if (result && result.isSaaS) {
          verified++;
          const row = [
            item.domain,
            result.homepageUrl,
            'tranco',
            item.rank,
            'y',
            result.signals,
            result.signalsDetail,
          ].map(csvEscape).join(',') + '\n';
          await appendFile(SITE_LIST, row);
        }
      } catch {}
      if (probed % 200 === 0) {
        await log(`Probed ${probed} | verified ${verified}/${TARGET_N}`);
      }
      if (verified >= TARGET_N) stopRequested = true;
    }
  }

  const workers = Array.from({ length: PROBE_CONCURRENCY }, () => worker());
  await Promise.all(workers);

  await log(`Done. Verified ${verified} SaaS sites from ${probed} candidates probed.`);
}

main().catch(async (err) => {
  await log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
