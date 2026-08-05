# Running VulnSight with Docker

**You do not install Nmap, Nuclei, Chromium or ZAP yourself.** Docker downloads
and configures all of them inside a container. Nothing is installed onto your
laptop, nothing changes your PATH, and `docker compose down` removes it all.

---

## One-time setup

1. Install **Docker Desktop** — <https://www.docker.com/products/docker-desktop/>
   (Windows, macOS and Linux. Free.)
2. Start Docker Desktop and wait for it to report "Engine running".

That's the only installation step.

---

## Start it

From the project folder:

```bash
docker compose up --build
```

The first build takes **10–20 minutes** because it downloads Nmap, Nuclei, about
10,000 Nuclei templates, Chromium and the OWASP ZAP image. Later starts take
seconds.

When you see `Ready`, open <http://localhost:3000>.

The homepage shows a **Scanner availability** panel. With Docker it should read
**5/6 ready** — the sixth is AI summary rewriting, which needs an optional API
key.

Stop with `Ctrl+C`, then:

```bash
docker compose down
```

---

## What is in the image

| Component | Version | Purpose |
| --- | --- | --- |
| Node.js | 22 | Application runtime |
| Nmap | Debian stable | Port and service/version enumeration |
| Nuclei | 3.3.7 | Template-based vulnerability scanning |
| Nuclei templates | latest at build | ~10,000 detection templates |
| Chromium | Debian stable | Screenshots and JavaScript-rendered DOM |
| OWASP ZAP | stable | Passive analysis (separate container) |

Nmap, Nuclei and Chromium live in the app image. ZAP runs as its own container
because it is a long-lived Java daemon rather than a command-line tool.

---

## Optional API keys

Everything works without these. When a key is missing the report records a
coverage note instead of inventing data.

Create a `.env` file next to `docker-compose.yml`:

```bash
# Raises the NVD rate limit from ~5 to ~50 requests per 30s.
# Free: https://nvd.nist.gov/developers/request-an-api-key
NVD_API_KEY=your-key-here

# Optional AI summary rewriting. Never used for detection or scoring.
GEMINI_API_KEY=your-key-here
# or
OPENAI_API_KEY=your-key-here
```

Then `docker compose up` again.

---

## Verifying the toolchain

```bash
curl http://localhost:3000/api/health
```

Reports every integration, its version, and — when unavailable — the reason.
This is also what Docker's own health check uses, so an unhealthy container is
one that cannot scan, not merely one that failed to serve a page.

To confirm the tools directly:

```bash
docker compose exec app nmap --version
docker compose exec app nuclei -version
docker compose exec app chromium --version
docker compose exec app ls /opt/nuclei-templates | head
```

---

## Architecture support

The image builds for both `linux/amd64` (most laptops) and `linux/arm64`
(Apple Silicon, and Oracle Cloud's free tier). Tool downloads resolve their
architecture at build time, so the same `Dockerfile` works on your machine and
on the server.

Chromium comes from the Debian repositories rather than Playwright's own
download, because Playwright does not publish arm64 browser builds and Oracle's
free tier is arm64.

---

## Troubleshooting

**Build fails downloading Nuclei** — usually a transient GitHub rate limit.
Re-run `docker compose up --build`.

**ZAP shows unavailable** — its JVM takes up to a minute to start. Check with
`docker compose ps`; if `vulnsight-zap` is `starting`, wait and reload. Logs:
`docker compose logs zap`.

**Chromium fails to launch** — almost always insufficient shared memory. The
compose file already sets `shm_size: 1gb`; if you run the container manually,
pass `--shm-size=1g`.

**Port 3000 already in use** — change the host side of the mapping in
`docker-compose.yml`, for example `'3001:3000'`.

**Comprehensive scans take several minutes** — expected. Nmap scans the top
3,000 ports and Nuclei runs thousands of templates. Progress is live on the
scan page.

---

## Useful commands

```bash
docker compose up --build     # build and start
docker compose up -d          # start in the background
docker compose logs -f app    # follow application logs
docker compose ps             # container status and health
docker compose down           # stop and remove containers
docker compose down -v        # also remove volumes
docker compose build --no-cache   # force a clean rebuild
```

---

## Same image on the server

Phase 4 deploys this identical stack to Oracle Cloud Always Free. Because the
container carries its own toolchain, the server needs nothing installed beyond
Docker itself — what runs on your laptop is what runs in production.
