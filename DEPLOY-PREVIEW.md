# Publishing a preview

How to put VulnSight online so other people can see it, today, for free.

This is the **preview** deployment: the whole site, the animated hero, and a
complete sample report. Live scanning stays off, because it cannot work on this
kind of host. Full deployment is a separate job and needs a real server.

---

## Why scanning cannot run on Vercel

Not a configuration problem, and not something a paid plan fixes.

| What VulnSight does | What a serverless host allows |
|---|---|
| Spawns `nmap`, `nuclei`, `zap` binaries | No arbitrary binaries |
| Launches a real Chromium | No persistent browser |
| Holds a job for 3 to 9 minutes | Functions are frozen when the HTTP response is sent |
| Keeps scan state in memory between polls | Every request may hit a different instance |

Any one of those is fatal on its own. So the preview shows the product honestly
and says plainly that scanning is off, rather than shipping a build where only
one scanner exists and calling it a scan.

## What visitors get

- The full animated hero, and every section of the home page
- `/results/sample`, a **real report from a real scan** of `scanme.nmap.org`:
  15 findings, 4 confirmed by more than one tool, score 50
- PDF and JSON export from that report
- In place of the scan box, a short note explaining why, with a link to the
  sample

## Steps

### 1. Push to GitHub

```bash
git add -A
git commit -m "feat: animated hero, demo mode"
git push
```

### 2. Import on Vercel

vercel.com, **Add New, Project**, pick the repository. Next.js is detected
automatically; no build settings need changing.

### 3. Set one environment variable

**Before** the first deploy, under Settings, Environment Variables:

| Name | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | `1` | Production, Preview, Development |

This one variable replaces the scan form with the preview notice, turns the
docked header bar into a link to the sample, and makes `POST /api/scan` return
503 with an explanation.

**It must be set before you build.** `NEXT_PUBLIC_` variables are compiled into
the browser bundle, not read at runtime, so adding it afterwards requires a
redeploy to take effect.

### 4. Deploy

You get `your-project.vercel.app`. That link is shareable immediately.

### 5. Optional: your own domain

The GitHub Student Pack includes a free domain from Namecheap. Add it under
Settings, Domains, and follow the DNS instructions. HTTPS is automatic.

## Verifying it worked

Three checks, in order of how badly it matters:

1. **The scan box is gone.** Scroll to the form area. You should see an amber
   "Preview deployment" panel, not an input.
2. **The API refuses.** In the browser console:
   ```js
   fetch('/api/scan', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ url: 'https://example.com', authorized: true }),
   }).then((r) => r.json()).then(console.log)
   ```
   Expect `code: "demo_mode"` and HTTP 503.
3. **The sample renders.** Visit `/results/sample`. Score 50, "High", 15
   findings, 4 confirmed.

If the scan box is still there, `NEXT_PUBLIC_DEMO_MODE` was set after the
build. Redeploy.

## Running the real thing locally

Demo mode is off unless the variable is set, so nothing changes for local work:

```bash
docker compose up --build     # everything, real scans
```

To preview exactly what the public sees:

```bash
NEXT_PUBLIC_DEMO_MODE=1 pnpm dev
```

## After this

Full scanning needs a host that can run binaries and hold long jobs. The plan
is Oracle Cloud Always Free (ARM64, 2 OCPU, 12 GB), which runs the existing
`docker-compose.yml` unchanged. That is Stage B.
