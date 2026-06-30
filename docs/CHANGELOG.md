# Changelog — Homeserver Backend (`be-homeserver`)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] — 2026-06-26

### Added

- **System Vitals API** (`GET /vitals`)
  - CPU load average (normalized per core)
  - RAM usage (used / total in GB)
  - Disk usage percentage (root partition)
  - CPU temperature reading (Linux `hwmon`)

- **Docker Monitor API** (`GET /docker`)
  - Real-time container stats via `docker stats --no-stream`
  - Container status via `docker ps -a`
  - Merged stats + status response per container
  - Git branch detection for public-facing app containers

- **Health Check API** (`GET /health`)
  - Returns service status and process uptime

- **Infrastructure**
  - Morgan HTTP request logging (`dev` format)
  - CORS headers (`Access-Control-Allow-Origin: *`)
  - Docker-in-Docker via `docker-cli` in Alpine image
  - GitHub Actions CI/CD pipeline → GHCR
  - Production-ready `docker-compose.yml` with security hardening
