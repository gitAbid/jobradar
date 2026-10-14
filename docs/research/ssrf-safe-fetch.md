# How to implement an SSRF-safe fetch with DNS pinning on Node 24 (P1.3)

**Decision / answer:** Do not add `undici` just for this. Implement `safeFetch` on the built-in `node:https` / `node:http` modules with a custom `lookup` option. The validator resolves the host with `dns.promises.lookup(host, { all: true })`, rejects if any address is blocked, and then hands the chosen address to the socket through `lookup`, so the connection cannot be re-resolved. Global `fetch` cannot take a `lookup` hook. Passing an `undici` `Agent` to global `fetch` only works when the `undici` major matches the runtime's bundled copy, and that is not verifiable from this repo. Use `net.BlockList` for the CIDR checks (built in, handles IPv4-mapped IPv6), not a hand-rolled parser and not `ipaddr.js`.

## Details

**(1) Pinning options and why not undici**
- Node 24 bundles undici 7 (Node blog: "Node.js 24 includes Undici 7"; the exact patch is most likely 7.8.0, unverified). It is not exposed as a builtin: `require('node:undici')` throws `ERR_UNKNOWN_BUILTIN_MODULE`.
- The repo has only `undici@6.29.0` under `node_modules/.pnpm`, pulled in transitively by `@vercel/blob`. It is not a direct dependency. Its types live in `undici-types@8.3.0`.
- Tested on Node v26.10.0 (`process.versions.undici` 8.10.2): an `undici@6` `Agent` passed to global `fetch` fails with `InvalidArgumentError: invalid onError method`. The dispatcher must come from the same undici major as the runtime's `fetch`. Adding `undici@7` would work only if it matches Node 24's bundled version, which is a fragile coupling. So the undici path is not recommended.
- `node:http` / `node:https` with `lookup` was tested on Node v26 against a local server. It connected to the pinned address with `opts.all === true`, and the Host header was preserved.

```ts
// src/lib/safe-fetch.ts (sketch)
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export type Resolver = (host: string) => Promise<{ address: string; family: 4 | 6 }[]>;

const BLOCKED = new net.BlockList();
for (const [addr, bits, fam] of [
  ["0.0.0.0", 8, "ipv4"], ["10.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"], ["::", 128, "ipv6"], ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"], ["fe80::", 10, "ipv6"],
] as const) BLOCKED.addSubnet(addr, bits, fam);

// Pinned lookup: returns only the addresses we already validated.
function pinnedLookup(addrs: { address: string; family: 4 | 6 }[]) {
  return (_host: string, opts: { all?: boolean }, cb: any) =>
    opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
}

// Core request: one hop, no automatic redirects, streamed body capped at 10 MB.
function requestOnce(url: URL, addrs: { address: string; family: 4 | 6 }[], headers: Record<string, string>, signal: AbortSignal) {
  const mod = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = mod({
      protocol: url.protocol,
      hostname: url.hostname,          // name, not IP: keeps TLS SNI + cert check
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: "GET",
      headers: { ...headers, Host: url.host },
      lookup: pinnedLookup(addrs),
      signal,
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}
```

- Validation per hop: `const addrs = await resolver(url.hostname)`, then reject if `addrs.length === 0` or if any `BLOCKED.check(a.address, a.family === 6 ? "ipv6" : "ipv4")` is true. Reject all addresses, not the first, because `lookup` with `all` may pick any of them.
- `net.BlockList.check` (tested on Node v26): blocks `::ffff:127.0.0.1`, `::ffff:7f00:1` and `::ffff:10.0.0.1`, and allows `8.8.8.8`, `::ffff:8.8.8.8` and `2606:4700::1`. The `::ffff:` form is checked as IPv4 by the list. Tested on v26 only, so confirm on Node 24 in the P1.3 test suite.
- Not in the plan list but recommended (unverified against BlockList): `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved), `255.255.255.255/32`, `192.0.0.0/24`, `198.18.0.0/15` (benchmark), `ff00::/8` (multicast), `64:ff9b::/96` (NAT64, can embed a private IPv4). Also `::/96`, the deprecated IPv4-compatible form, which tested as not blocked by the current list (`::127.0.0.1` returned false).
- Pass the injectable resolver as a parameter defaulting to `dns.promises.lookup(host, { all: true, verbatim: true })`. Tests can then supply `async () => [{ address: "127.0.0.1", family: 4 }]` and never touch the network.
- Scheme check before resolving: only `http:` and `https:`. Reject URLs with credentials (`url.username` or `url.password`) as a defensive extra.

**(2) Redirects (`redirect: "manual"` semantics)**
- With `node:https` there is no auto-redirect, so the loop is manual by construction. Global `fetch` with `redirect: "manual"` was tested on Node v26: it returns the real `302` with `headers.get("location")` (type `basic`, not opaque-redirect as in browsers).
- Loop: up to 5 hops. For each hop, resolve the `Location` header against the current URL with `new URL(location, current)`. Then re-run the scheme check, the resolve-and-validate step, and the pin. Treat a 3xx without `Location` as an error. The plan does not say whether an `https` to `http` downgrade is allowed. Decide and document it.
- Discard the body of each redirect response (`res.resume()`) before the next hop.

**(3) 10 MB body cap while streaming**
- Stream the response. Count bytes per chunk and stop once the total passes 10 MB, instead of calling `res.text()`, which buffers everything.
- Tested with global fetch on Node v26 (`redirect: "manual"`, endless 200 response): `reader.read()` loop with `reader.cancel()` after the limit stopped at 10,551,289 bytes, which is one chunk over 10 MB.
- Node `IncomingMessage` equivalent: `res.on("data")`, then `res.destroy()` once over the limit, rejecting with a size error. Also reject early when `content-length` is over 10 MB.
- Decode text with `new TextDecoder().decode(Buffer.concat(chunks))` after the cap check, or keep `res.text()` semantics for the adapter callers. Check that the total is capped in bytes, not characters.

**(4) Preserving `fetchText` timeout behaviour**
- Current `fetchText` in `src/lib/adapters/index.ts` (lines around `TIMEOUT_MS = 15_000`):
  - `TIMEOUT_MS = 15_000`, one `AbortSignal.timeout(TIMEOUT_MS)` per attempt, passed as `signal` to `fetch`.
  - The loop runs `attempt < 2`, so 2 attempts total, no backoff.
  - The signal covers the body read too, because `res.text()` runs inside the `try`.
  - Non-2xx throws `HTTP <status> <statusText>` and is retried. Any error is retried. The last error is rethrown.
  - Headers: `User-Agent: UA`, `Accept: "application/json, text/xml, */*"`, overridable via the `headers` argument.
- To keep the timeout unchanged in `safeFetch`: create a fresh `AbortSignal.timeout(15_000)` per attempt (not per hop), pass it to every `request`, and keep the same 2-attempt loop. Keep the `res.ok` check semantics by returning `{ ok, status, statusText, text() }`. Note that a 3xx returned after the hop limit is an error, not a success.

**(5) Next.js 16 interactions**
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/httpAgentOptions.md` says Next polyfills `fetch` with undici only on Node < 18, and `httpAgentOptions` only affects that path. On Node 24, the patched global `fetch` is still Next's wrapper, so a per-call `dispatcher` would go through it. Another reason to avoid `fetch` here.
- Next's `patch-fetch.js` (`node_modules/next/dist/server/lib/patch-fetch.js`) adds a `redirect` key to the stored options (line ~647). It also caches and dedupes GET responses in the Data Cache by default. Calling `node:https` directly avoids both the Data Cache and the patched `fetch`. That is correct for a cron refresh, but confirm that nothing else relied on cached responses.
- `safeFetch` must be called from server code only (route handlers, cron, server actions). Mark the module `import "server-only"` if the package is available. Unverified: `server-only` is not in `package.json`.

**(6) Testing without network**
- Inject the resolver as in (1). For the pin test, run a local `http.createServer` on `127.0.0.1` and use a fake hostname (e.g. `safe.test`) with the resolver returning `127.0.0.1`. Note that `127.0.0.1` is blocked, so the test must either allow it through an injected block list or assert on the block. Without network, keep two cases separate: a block-list unit test on IPs, and a pin test that uses an explicit test-only option to allow loopback.
- Test cases worth covering: blocked IPs including mapped forms; one blocked address among several (all:true); redirect to a private host; redirect `Location` relative; 6th hop; body over 10 MB; timeout with a server that never responds (use the 15 s timeout or an injected timeout value).

## Gotchas
- **Do not pass an IP literal as the URL host.** The TLS SNI and certificate check then use the IP. Keep `hostname` as the name and pin via `lookup`.
- **`lookup` with `all: true`:** Node may call the function with `opts.all` true and expect an array. The sketch handles both forms. Node 20+ with `autoSelectFamily` calls `lookup` multiple times, so the pin must be the validated set on every call.
- **Re-resolve on every hop.** Do not reuse the first-hop addresses for a different host.
- **DNS rebinding:** pinning closes the gap between validation and connect only if the same `lookup` result is used. Do not call `dns.lookup` again inside the connect path.
- **Proxies:** if `HTTP_PROXY` or `HTTPS_PROXY` is set in the runtime, the pin is bypassed by the proxy. Check in deployment (Vercel does not set them by default; unverified).
- **IPv4-mapped forms:** `URL` normalizes `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`. Always check the normalized text against `BlockList`, which handled both forms in the test.
- **Cancel on exit:** call `res.destroy()` or `reader.cancel()` when the cap is hit, otherwise sockets stay open.
- **Undici `connect.lookup` (unverified):** undici forwards `connect` options to `net.connect` / `tls.connect`, so `lookup` is expected to work there too. Not exercised in this repo, since the only local undici is a mismatched major. Documentation for undici `connect.lookup` is sparse (undici Client docs show a `lookup` sample but no all/option contract).

## Sources
- `/Users/abid/Projects/jobradar/src/lib/adapters/index.ts` (`fetchText`, lines near `TIMEOUT_MS`) — current timeout, 2 attempts, `AbortSignal.timeout` per attempt, `res.text()` inside try.
- `/Users/abid/Projects/jobradar/docs/plan/production-readiness.md` (P1.3 section) — acceptance criteria and blocked ranges.
- `/Users/abid/Projects/jobradar/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/httpAgentOptions.md` — undici polyfill only for Node < 18; `httpAgentOptions` scope.
- `/Users/abid/Projects/jobradar/node_modules/next/dist/server/lib/patch-fetch.js` (line ~647) — Next's fetch patch handles the `redirect` option.
- `/Users/abid/Projects/jobradar/node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — server-side security context (no direct fetch guidance).
- `pnpm why undici` (run in repo) — `undici@6.29.0` via `@vercel/blob@2.8.0`, not a direct dependency. `node_modules/.pnpm/undici-types@8.3.0` provides types.
- Local experiments (scratchpad `/private/tmp/claude-501/-Users-abid-Projects-jobradar/c7f55475-0573-4c9c-a155-a2450a5a1e57/scratchpad/`, Node v26.10.0): `pin-test.mjs` (undici 6 Agent, failed with invalid onError), `pin-http.mjs` (`node:http` lookup pin, passed), `manual.mjs` (manual redirect, 10 MB cap), `bl.mjs` (`net.BlockList`).
- Context7 `/nodejs/undici` (v6.21.0 snapshot) — `new Agent([options])`, `fetch` `init.dispatcher`, custom `connect` function; did not document `lookup`/`all` contract.
- https://nodejs.org/en/blog/release/v24.0.0 (fetched 2026-10-14) — "Node.js 24 includes Undici 7"; undici 7.8.0 cited in a semver-patch commit list (exact bundled version unverified).
