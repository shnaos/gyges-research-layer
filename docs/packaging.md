# GRL — Packaging Guide

This document describes the GRL package layout, build system, export conventions, release flow, and versioning.

---

## Package layout

```
gyges-research-layer/
├── packages/
│   ├── core/                  @gyges/core          — all core engines
│   ├── agent-sdk/             @gyges/agent-sdk      — agent client SDK
│   ├── policy-engine/         @gyges/policy-engine  — legacy policy engine
│   ├── identity-compartment/  @gyges/identity-compartment
│   ├── transport-router/      @gyges/transport-router
│   └── search-adapter-searxng/ @gyges/search-adapter-searxng
├── apps/
│   ├── grl-server/            grl-server            — local API server
│   └── grl-cli/               @gyges/grl-cli        — CLI operator interface
├── scripts/
│   ├── smoke-test.ts          — local runtime validation
│   ├── release-check.ts       — pre-release gate
│   ├── validate-package-exports.ts — package export validation
│   └── validate-security-docs.ts  — security docs validation
├── examples/
│   └── quickstart/
│       ├── local-runtime.sh   — start the local server
│       ├── cli-demo.sh        — CLI demo (requires server)
│       └── sdk-demo.ts        — SDK demo (requires server)
└── docs/                      — documentation
```

---

## Package export conventions

Each publishable package must have:

```json
{
  "name": "@gyges/<name>",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md"]
}
```

Rules:
- ESM-only (`"type": "module"`)
- `NodeNext` module resolution
- No CJS fallback (the runtime targets Node.js 20+)
- `"files"` must list only `dist` and `README.md` — never `src`, `node_modules`, `.env`, or config files
- All public types exported from `index.ts`; no accidental private surface

---

## Build system

### Root scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all packages in dependency order |
| `npm run build:core` | Build `@gyges/core` only |
| `npm run build:cli` | Build `@gyges/grl-cli` only |
| `npm run build:agent-sdk` | Build `@gyges/agent-sdk` only |
| `npm run typecheck` | Type-check all packages |
| `npm test` | Run all tests via Vitest |
| `npm run test:core` | Run `@gyges/core` tests only |
| `npm run test:cli` | Run CLI tests only |
| `npm run test:agent-sdk` | Run SDK tests only |
| `npm run smoke-test` | Local runtime smoke test |
| `npm run release-check` | Full pre-release gate |
| `npm run validate:exports` | Package export validation |
| `npm run validate:security-docs` | Security docs validation |

### Build order

The root `build` script compiles packages in this order (topological dependency order):

1. `@gyges/core`
2. `@gyges/policy-engine`
3. `@gyges/identity-compartment`
4. `@gyges/transport-router`
5. `@gyges/search-adapter-searxng`
6. `@gyges/agent-sdk`
7. `grl-server`
8. `@gyges/grl-cli`

---

## Release flow

### Pre-release gate

Before any release, run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke-test
npm run validate:exports
npm run validate:security-docs
npm run release-check
```

All must exit with code 0.

### Release check validates

- All `dist/` outputs exist
- All `package.json` export fields are present and coherent
- All security docs are present
- All distribution docs are present
- All quickstart examples are present
- No `.env`, secret files, or private key material at root

### Versioning

GRL uses [Semantic Versioning](https://semver.org/):

- `MAJOR.MINOR.PATCH`
- All packages share the same version (monorepo-wide)
- Current version: `0.1.0` (pre-release / MVP)

To bump the version, update `package.json` and all `packages/*/package.json` and `apps/*/package.json` files.

---

## TypeScript configuration

All packages extend `tsconfig.base.json` at the root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "dist"
  }
}
```

Each package's `tsconfig.json` adds `"outDir": "dist"` and `"include": ["src"]`.

---

## Smoke test

The smoke test (`scripts/smoke-test.ts`) validates the local runtime without any network access:

1. `DEFAULT_RUNTIME_CONFIG` loads from `@gyges/core`
2. `RuntimeProfileResolver` resolves all 4 built-in profiles
3. `apps/grl-cli/dist/cli.js` exists
4. `@gyges/agent-sdk` exports `GrlAgentClient`, type guards, and `GrlAgentSdkError`
5. `GrlAgentClient` instantiates without a network call

Run: `npm run smoke-test`

---

## Package export validation

The export validator (`scripts/validate-package-exports.ts`) checks statically:

- All required `package.json` fields present
- `exports` map is correct
- `dist` files exist
- Type definitions exist
- `bin` paths exist (for CLI)
- No private paths in `files`
- SDK named exports present in source

Run: `npm run validate:exports`

---

## Future: npm publish

When ready to publish to npm:

1. Ensure all release checks pass
2. Update version numbers across all packages
3. Run `npm pack --dry-run` per package to confirm `files` contents
4. Tag the release: `git tag v0.x.0`
5. Publish: `npm publish --access public` per package

Packages are scoped to `@gyges/` and published independently.
