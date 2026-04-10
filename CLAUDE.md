# Signic SDK

TypeScript SDK for the Signic decentralized email platform. Authenticates users via SIWE (Sign-In with Ethereum) and provides read access to emails stored in a WildDuck mail server.

## Architecture

```
SignicClient
├── Indexer API (mail_box_indexer) — SIWE auth, wallet verification
└── WildDuck API (wildduck) — email storage and retrieval
```

**Auth flow** (`connect()`): get SIWE message from Indexer -> sign with viem -> verify signature with Indexer -> authenticate with WildDuck -> find INBOX mailbox ID.

**Email addresses** are derived from EVM wallet addresses: `{walletAddress}@{emailDomain}`.

## Project structure

```
src/
├── index.ts          — Public exports (SignicClient, types, errors)
├── client.ts         — SignicClient class (all public methods)
├── types.ts          — Public types (top) + internal API response types (bottom)
├── errors.ts         — Error hierarchy: SignicError > Auth | Network | Validation
├── client.test.ts    — Client unit tests (mocked fetch)
├── errors.test.ts    — Error class tests
└── network/
    ├── http.ts       — Generic fetch wrapper (httpGet/httpPost/httpPut)
    └── http.test.ts  — HTTP utility tests
```

## Commands

```bash
npm run build         # Compile to ESM (dist/)
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
npm run test          # Vitest (interactive watch)
npm run test:run      # Vitest (single run, CI)
npm run verify        # typecheck + lint + test:run + build (full CI check)
```

## Code conventions

- ESM-only (`"type": "module"`) — use `.js` extensions in all imports
- Target: ES2020, Node >= 20
- Only dependency: `viem` (for Ethereum key management)
- Uses native `fetch` (no axios/node-fetch)
- Tests use `vitest` with `vi.stubGlobal('fetch', mockFetch)` pattern
- Prettier + ESLint enforced (`npm run lint`)
- All public API surfaces are in `src/index.ts` — add new exports there
- Public types go in the top section of `types.ts`, internal API response types in the bottom section
- Error hierarchy: `SignicError` is the base; subclasses for auth (401/403), validation (400/422), network (fetch failures)
- Every public method that hits an API requires auth — call `this.requireAuth()` first
- API response mapping: internal WildDuck types -> public Signic types (never expose WildDuck shapes directly)

## Adding a new public method

1. Add any new internal response types to the bottom section of `types.ts`
2. Add any new public return types to the top section of `types.ts`
3. Implement the method on `SignicClient` in `client.ts` — call `this.requireAuth()`, use `httpGet`/`httpPost`/`httpPut`, check `response.data.success`, map to public types
4. Export new public types from `index.ts`
5. Add tests in `client.test.ts` using the `createConnectedClient()` helper + `mockFetch`
6. Run `npm run verify` to confirm everything passes

## Related projects (same machine)

- `/Users/johnhuang/projects/mail_box_indexer` — Blockchain indexer backend (Ponder + Hono). Provides SIWE auth endpoints and delivers on-chain emails to WildDuck.
- `/Users/johnhuang/projects/wildduck` — WildDuck mail server (Node.js + MongoDB). Stores/serves emails via REST API, IMAP, POP3.
- `/Users/johnhuang/projects/signic_sdk_demo` — React demo app consuming this SDK.

## WildDuck API reference (commonly used)

These are the WildDuck REST endpoints this SDK calls:

- `GET /wallets/{address}/message?chainId&domain&url` — (Indexer) Get SIWE message
- `GET /wallets/{address}/accounts` — (Indexer) Verify signature, get wallet accounts. Headers: `x-signature`, `x-message`, `x-signer`
- `POST /authenticate` — (WildDuck) Get access token. Body: `{ username, signature, message, signer, scope, token, protocol }`
- `GET /users/{id}/mailboxes?counters=true` — (WildDuck) List mailboxes
- `GET /users/{id}/mailboxes/{mailbox}/messages?unseen&limit` — (WildDuck) List messages
- `GET /users/{id}/mailboxes/{mailbox}/messages/{message}` — (WildDuck) Get full message detail
- `PUT /users/{id}/mailboxes/{mailbox}/messages/{message}` — (WildDuck) Update message flags
