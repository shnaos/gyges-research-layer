# GRL — Distribution Guide

This document covers local distribution, version pinning, integrity, npm strategy, GitHub releases, and offline installs.

---

## Local distribution

GRL is designed for local-first distribution. No package registry is required to use it.

### Option A — git clone (recommended for development)

```bash
git clone https://github.com/shnaos/gyges-research-layer.git
cd gyges-research-layer
npm install
npm --prefix apps/grl-cli install
npm run build
```

### Option B — file: reference (for SDK consumers)

Add `@gyges/agent-sdk` to any local project:

```json
{
  "dependencies": {
    "@gyges/agent-sdk": "file:../gyges-research-layer/packages/agent-sdk"
  }
}
```

Then `npm install` in the consumer project. npm resolves the `dist/` outputs via the `exports` map.

### Option C — npm pack (tarball)

Pack a single package for manual distribution:

```bash
cd packages/agent-sdk
npm pack
# Produces: gyges-agent-sdk-0.1.0.tgz
```

Install the tarball in a consumer project:

```bash
npm install /path/to/gyges-agent-sdk-0.1.0.tgz
```

---

## Version pinning

All GRL packages share the same version (`0.1.0` as of Sprint 22). When consuming via `file:` or tarball, pin the exact version in your `package.json`:

```json
{
  "dependencies": {
    "@gyges/agent-sdk": "0.1.0"
  }
}
```

---

## Integrity

### Checksums

GRL runtime config snapshots are SHA-256 checksummed in memory after load. This prevents silent config mutation at runtime. See [`docs/runtime-config.md`](runtime-config.md).

### npm pack integrity

When distributing tarballs, verify the SHA-512 integrity hash printed by npm:

```bash
npm pack --dry-run 2>&1 | grep integrity
```

Store the hash alongside the tarball and verify before install:

```bash
npm install --prefer-offline /path/to/tarball.tgz
```

### No signing yet

GRL 0.1.x does not yet support GPG or Sigstore signing. This is planned for a future release.

---

## npm strategy

GRL packages are scoped to `@gyges/`:

| Package | Scope |
|---------|-------|
| `@gyges/core` | Private (monorepo internal) |
| `@gyges/agent-sdk` | Public (primary consumer surface) |
| `@gyges/grl-cli` | Public (CLI tool) |

Publication policy:
- `@gyges/core` is not published independently — it is a build dependency of the server and SDK
- `@gyges/agent-sdk` and `@gyges/grl-cli` are the primary public packages
- All packages are ESM-only (`"type": "module"`)

When ready to publish:

```bash
npm run release-check       # must pass
npm publish --access public # per package in packages/ and apps/grl-cli
```

---

## GitHub releases

Each version is tagged and released on GitHub:

1. All release checks pass (`npm run release-check`)
2. Version bumped in all `package.json` files
3. Git tag created: `git tag v0.x.0 && git push --tags`
4. GitHub Release created with:
   - Release notes (changes since last tag)
   - Tarballs for `@gyges/agent-sdk` and `@gyges/grl-cli` as release assets
5. SHA-256 checksums of release assets published in release notes

---

## Offline installs

GRL supports fully offline installation after an initial `npm install`:

1. Run `npm install` while online to populate the npm cache
2. For subsequent installs (e.g., on an air-gapped machine):

```bash
npm install --prefer-offline
```

Or use `npm pack` to create tarballs and transfer manually:

```bash
# On an online machine
npm pack --pack-destination /path/to/tarballs

# On the offline machine
npm install /path/to/tarballs/gyges-agent-sdk-0.1.0.tgz
```

---

## Security constraints for distribution

GRL distribution MUST NEVER include:

| Forbidden | Reason |
|-----------|--------|
| `.env` files | Contains runtime secrets |
| `*.key` / `*.pem` files | Private key material |
| Raw audit logs | May contain agent input metadata |
| Session state | Contains compartment data |
| Tokens or credentials | Security risk |
| `node_modules/` | Must be installed by consumer |
| `src/` | Only `dist/` is distributed |

The `"files"` field in each `package.json` enforces this at publish time.

The `npm run release-check` script verifies no forbidden files are present before release.

---

## Determinism

GRL builds are deterministic:
- TypeScript compiler output is stable for a given input
- `package-lock.json` pins all transitive dependency versions
- No build-time randomness or timestamp injection

To reproduce a build exactly:

```bash
npm ci           # clean install from lockfile
npm run build    # deterministic compile
```
