import { request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF-safe GET. Resolves the host itself, rejects if ANY address is in a
 * blocked range, then pins the socket to the validated addresses (no second
 * DNS resolution). Redirects are followed manually and re-validated per hop.
 * Proxy env vars are ignored (node:http does not read them).
 */

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

const BLOCKED = new net.BlockList();
for (const [addr, bits, fam] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 96, "ipv6"], // :: , ::1 and deprecated IPv4-compatible forms
  ["64:ff9b::", 96, "ipv6"], // NAT64 can embed a private IPv4
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  BLOCKED.addSubnet(addr, bits, fam);
}

/** Collapse IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:hhhh:hhhh) to IPv4. */
function normalise(address: string, family: 4 | 6): ResolvedAddress {
  if (family !== 6) return { address, family };
  let compact: string;
  try {
    compact = new URL(`http://[${address}]`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return { address, family };
  }
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(compact);
  if (!m) return { address: compact, family };
  const hi = parseInt(m[1] as string, 16);
  const lo = parseInt(m[2] as string, 16);
  return { address: `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, family: 4 };
}

export function isBlockedAddress(address: string, family: 4 | 6): boolean {
  const n = normalise(address, family);
  return BLOCKED.check(n.address, n.family === 6 ? "ipv6" : "ipv4");
}

const defaultResolver: Resolver = async (host) => {
  const res = await dnsLookup(host, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

async function resolveSafe(hostname: string, resolver: Resolver): Promise<ResolvedAddress[]> {
  // URL keeps brackets around IPv6 literals
  const host = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const literal = net.isIP(host);
  const addrs: ResolvedAddress[] = literal
    ? [{ address: host, family: literal === 6 ? 6 : 4 }]
    : await resolver(host);
  if (addrs.length === 0) throw new Error(`blocked: ${host} did not resolve`);
  for (const a of addrs) {
    if (isBlockedAddress(a.address, a.family)) {
      throw new Error(`blocked: ${host} resolves to a disallowed address`);
    }
  }
  return addrs;
}

function checkUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`blocked: unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("blocked: credentials in URL");
}

function pinnedLookup(addrs: ResolvedAddress[]) {
  return (
    _host: string,
    opts: { all?: boolean } | undefined,
    cb: (err: Error | null, a: string | ResolvedAddress[], f?: number) => void,
  ) => {
    if (opts?.all) cb(null, addrs);
    else cb(null, (addrs[0] as ResolvedAddress).address, (addrs[0] as ResolvedAddress).family);
  };
}

function requestOnce(
  url: URL,
  addrs: ResolvedAddress[],
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<IncomingMessage> {
  const mod = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = mod(
      {
        protocol: url.protocol,
        // hostname (not IP) keeps TLS SNI + certificate verification
        hostname: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "GET",
        headers: { "Accept-Encoding": "identity", ...headers },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lookup: pinnedLookup(addrs) as any,
        signal,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const len = Number(res.headers["content-length"]);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      res.destroy();
      reject(new Error("response body too large"));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    res.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        res.destroy();
        reject(new Error("response body too large"));
        return;
      }
      chunks.push(c);
    });
    res.on("end", () => resolve(new TextDecoder().decode(Buffer.concat(chunks))));
    res.on("error", reject);
    res.on("close", () => {
      if (!res.complete) reject(new Error("response aborted"));
    });
  });
}

/** Validate scheme + resolved addresses without fetching (no DNS pinning). */
export async function assertSafeUrl(input: string, resolver: Resolver = defaultResolver): Promise<void> {
  const url = new URL(input);
  checkUrl(url);
  await resolveSafe(url.hostname, resolver);
}

export interface SafeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  text(): Promise<string>;
}

export interface SafeFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to dns.promises.lookup(all). */
  resolver?: Resolver;
}

export async function safeFetch(input: string, init: SafeFetchInit = {}): Promise<SafeResponse> {
  const resolver = init.resolver ?? defaultResolver;
  let url = new URL(input);
  let headers = init.headers ?? {};

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkUrl(url);
    const addrs = await resolveSafe(url.hostname, resolver);
    const res = await requestOnce(url, addrs, { ...headers, Host: url.host }, init.signal);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume(); // discard redirect body
      if (hop === MAX_REDIRECTS) throw new Error("too many redirects");
      const next = new URL(location, url);
      if (next.origin !== url.origin) {
        // never leak credentials to another origin
        headers = Object.fromEntries(
          Object.entries(headers).filter(([k]) => !/^(authorization|cookie)$/i.test(k)),
        );
      }
      url = next;
      continue;
    }
    const body = await readBody(res);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: res.statusMessage ?? "",
      url: url.toString(),
      text: async () => body,
    };
  }
  throw new Error("too many redirects");
}
