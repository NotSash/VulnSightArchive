# VulnSight

**Understand your website's security — in plain language, using real evidence.**

VulnSight is a local-first Next.js web security assessment platform. It runs a
modular TypeScript scan engine, stores reports in memory, renders a browser
report, exports JSON, and generates server-side PDFs.

The scanner never fabricates output. If Chromium, Nmap, Nuclei, OWASP ZAP, NVD,
Gemini or OpenAI is unavailable, the report records the dependency failure as a
coverage note instead of inventing results.

---

## What it does

| Stage | Real implementation |
| --- | --- |
| Validate | Normalizes URLs, resolves DNS, rejects localhost/private/reserved targets, and validates every redirect hop before fetching. |
| Collect | Fetches HTTP evidence, headers, body, TLS certificate data, DNS records, and favicon/title metadata. |
| Browser | Uses Playwright Chromium for screenshots, rendered DOM, browser title, final URL, and JS-rendered technology evidence. |
| Scan | Checks headers, cookies, plaintext transport, exposed files, Nmap XML port/service output, Nuclei JSONL findings, and OWASP ZAP passive alerts. |
| Enrich | Queries NVD only for directly observed software versions and attaches matching CVEs/CVSS/CWE/references. |
| Score | Uses a deterministic risk engine with visible penalties. |
| Explain | Uses deterministic summaries by default; optional Gemini/OpenAI can rewrite verified findings only. |
| Report | Browser UI, JSON export, and server-side PDF generation via PDFKit. |

---

## Scan modes

| Mode | Includes |
| --- | --- |
| Quick | URL/DNS/redirect validation, HTTP fetch, headers, TLS, technology fingerprinting, Playwright browser render, deterministic summary, PDF/JSON. |
| Standard | Quick + cookie/transport checks, 80/443 reachability, Nmap service enumeration, NVD CVE enrichment. |
| Comprehensive | Standard + DNS record checks, exposed-file checks, Nuclei templates, OWASP ZAP passive scan. |

---

## Local setup

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

If your local `pnpm` version does not work with your Node version, use Corepack:

```bash
corepack pnpm@10.14.0 install
corepack pnpm@10.14.0 dev
```

---

## Optional scanner dependencies

The app works without these tools, but it will record unavailable stages in the
report. Install what you want to enable.

### Playwright Chromium

```bash
pnpm exec playwright install chromium
```

Linux servers may also need Playwright system dependencies. If launch fails, the
report shows the exact Chromium error.

### Nmap

Install `nmap` and make sure it is on `PATH`, or set:

```bash
NMAP_PATH=/absolute/path/to/nmap
```

VulnSight runs TCP service/version detection with XML output and timeouts. It
never fabricates ports.

### Nuclei

Install `nuclei`, install/update templates, and optionally set:

```bash
NUCLEI_PATH=/absolute/path/to/nuclei
NUCLEI_TEMPLATES=/absolute/path/to/nuclei-templates
```

The scanner parses real JSONL output and extracts severity, evidence, CVEs,
CWEs and references from template results.

### OWASP ZAP passive scan

Start ZAP in daemon mode. Example:

```bash
zap.sh -daemon -host 127.0.0.1 -port 8080
```

VulnSight only calls `accessUrl` and passive-scan APIs. It does not run ZAP
spidering, active scan, attack mode, or exploit checks.

### NVD API

NVD can be queried without a key. Adding one raises the rate limit from 5 to 50
requests per 30 seconds.

CVE enrichment runs only for software versions directly observed in HTTP/body
fingerprints or Nmap service/version output.

### Optional AI rewriting

AI is optional and never detects vulnerabilities. It only rewrites verified
findings into executive/technical summaries and a remediation roadmap. Gemini
and OpenAI are both supported, and Gemini takes precedence when both are
configured.

Without a key, VulnSight uses the deterministic rule engine and records an LLM
coverage note in the report.

### Configuring the above

Every setting named in this section, and the rest besides, is documented in
[`.env.example`](.env.example) with the accepted values and defaults:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Never commit a real key.

---

## Useful scripts

```bash
pnpm dev                         # start the Next.js dev server
pnpm lint                        # Biome lint
pnpm typecheck                   # TypeScript validation
pnpm build                       # production build
pnpm start                       # run production build
pnpm audit --audit-level low     # dependency audit
```

---

## Project layout

```text
app/                         Next.js pages and API routes
app/api/scan                 scan start route
app/api/status/[scanId]      progress polling route
app/api/report/[scanId]      JSON report route
app/api/report/[scanId]/pdf  server-side PDF route
components/                  browser UI
lib/scanner/                 active modular TypeScript scanner
lib/report/pdf.ts            PDF generation
types/report.ts              report contract
```



---

## Ethics & scope

Use VulnSight only on systems you own or have explicit permission to assess.
Even safe checks can create logs or alerts on the target system.
