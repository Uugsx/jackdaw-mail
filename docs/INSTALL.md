# Development setup

Lock files are not committed: install with `npm install`, the same way CI does
(`.github/workflows/check-desktop.yml`).

1. Install

```bash
(cd app && npm install --legacy-peer-deps --ignore-scripts)
(cd lib && npm install)
(cd desktop && npm install --legacy-peer-deps)
(cd desktop/backend && npm install)
```

2. OAuth configuration: copy the example and fill in your own client IDs if needed.
   `OAuth2Secrets.user.ts` is ignored by git and must never be committed.

```bash
cp app/logic/Auth/OAuth2Secrets.local.example.ts app/logic/Auth/OAuth2Secrets.user.ts
```

3. In terminal 1:

```bash
cd app && npm run dev
```

4. In terminal 2:

```bash
cd desktop && npm run dev
```

# Tests

```bash
cd app && npm run test:regression
```

# Build

The renderer build needs more memory than Node's default heap.

Local macOS app for manual checks (`desktop/dist/mac-arm64/Jackdaw Mail.app`):

```bash
cd desktop
NODE_OPTIONS=--max-old-space-size=8192 npm run build
npx electron-builder --mac --arm64 --dir --config
```

Releases are built and published by CI only: see
[`systems/desktop-build/ota-jackdaw.md`](systems/desktop-build/ota-jackdaw.md).

# Problems

#### better-sqlite3 not found

1. `rm -rf desktop/node_modules desktop/backend/node_modules`
2. Repeat the install
