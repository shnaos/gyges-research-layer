import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { TransportType, DnsPolicy } from '../../core/src/index.js';

export type { TransportType, DnsPolicy } from '../../core/src/index.js';

/** Minimal response surface consumed by adapters. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface FetchInit {
  headers?: Record<string, string>;
  method?: string;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<HttpResponse>;

/** A transport-bound client. The adapter receives this and nothing else. */
export interface TransportClient {
  type: TransportType;
  userAgent: string;
  fetch: FetchLike;
}

export interface SocksEndpoint {
  host: string;
  port: number;
}

export interface TransportRequest {
  type: TransportType;
  userAgent: string;
  dnsPolicy: DnsPolicy;
  /**
   * Per-session credential. For tor this is forwarded as the SOCKS5
   * username/password so Tor isolates the circuit (stream isolation). Rotating
   * the session id rebuilds the circuit.
   */
  sessionId?: string;
  timeoutMs?: number;
  /** Required for `tor` and `proxy`. */
  socks?: SocksEndpoint;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build the SOCKS5 CONNECT request for a destination using ATYP=domain (0x03).
 * Sending the domain name (never a pre-resolved IP) forces the proxy to do
 * remote DNS resolution, which prevents local DNS leaks.
 */
export function buildSocks5ConnectRequest(host: string, port: number): Buffer {
  const hostBuf = Buffer.from(host, 'ascii');
  if (hostBuf.length > 255) {
    throw new Error('SOCKS5 destination host too long');
  }
  const head = Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]);
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port, 0);
  return Buffer.concat([head, hostBuf, portBuf]);
}

interface Socks5ConnectOptions {
  socksHost: string;
  socksPort: number;
  destHost: string;
  destPort: number;
  username?: string;
  password?: string;
  timeoutMs: number;
}

/**
 * Establish a SOCKS5 tunnel to destHost:destPort and resolve with the connected
 * socket. Remote DNS only. Fails closed: any protocol or socket error rejects
 * and never returns a usable direct connection.
 */
function socks5Connect(options: Socks5ConnectOptions): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: options.socksHost, port: options.socksPort });
    const useAuth = Boolean(options.username);
    let stage: 'greeting' | 'auth' | 'reply' = 'greeting';
    let buffer = Buffer.alloc(0);
    let settled = false;

    const timer = setTimeout(() => fail(new Error('SOCKS5 handshake timed out')), options.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      socket.removeListener('close', onClose);
    };

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    }

    function onClose(): void {
      fail(new Error('SOCKS5 connection closed during handshake'));
    }

    function sendConnect(): void {
      socket.write(buildSocks5ConnectRequest(options.destHost, options.destPort));
    }

    function process(): void {
      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        if (buffer[0] !== 0x05) return fail(new Error('Unexpected SOCKS version'));
        const method = buffer[1];
        buffer = buffer.subarray(2);
        if (method === 0x02) {
          const user = Buffer.from(options.username ?? '', 'utf8');
          const pass = Buffer.from(options.password ?? options.username ?? '', 'utf8');
          socket.write(
            Buffer.concat([
              Buffer.from([0x01, user.length]),
              user,
              Buffer.from([pass.length]),
              pass
            ])
          );
          stage = 'auth';
          return process();
        }
        if (method === 0x00) {
          sendConnect();
          stage = 'reply';
          return process();
        }
        return fail(new Error(`Unsupported SOCKS5 auth method: ${method}`));
      }

      if (stage === 'auth') {
        if (buffer.length < 2) return;
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (status !== 0x00) return fail(new Error('SOCKS5 authentication failed'));
        sendConnect();
        stage = 'reply';
        return process();
      }

      // stage === 'reply'
      if (buffer.length < 4) return;
      if (buffer[0] !== 0x05) return fail(new Error('Unexpected SOCKS reply version'));
      const reply = buffer[1];
      if (reply !== 0x00) return fail(new Error(`SOCKS5 connect rejected (code ${reply})`));
      const atyp = buffer[3];
      let needed: number;
      if (atyp === 0x01) {
        needed = 4 + 4 + 2;
      } else if (atyp === 0x04) {
        needed = 4 + 16 + 2;
      } else if (atyp === 0x03) {
        if (buffer.length < 5) return;
        needed = 4 + 1 + buffer[4] + 2;
      } else {
        return fail(new Error('Unexpected SOCKS reply address type'));
      }
      if (buffer.length < needed) return;
      const leftover = buffer.subarray(needed);
      settled = true;
      cleanup();
      if (leftover.length > 0) socket.unshift(leftover);
      resolve(socket);
    }

    function onData(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk]);
      process();
    }

    socket.on('error', fail);
    socket.on('close', onClose);
    socket.on('data', onData);
    socket.on('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, useAuth ? 0x02 : 0x00]));
    });
  });
}

function performSocksRequest(
  url: string,
  init: FetchInit | undefined,
  socks: SocksEndpoint,
  credential: string | undefined,
  userAgent: string,
  timeoutMs: number
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error as Error);
      return;
    }
    const isHttps = target.protocol === 'https:';
    if (!isHttps && target.protocol !== 'http:') {
      reject(new Error(`Unsupported protocol for SOCKS transport: ${target.protocol}`));
      return;
    }
    const port = target.port ? Number(target.port) : isHttps ? 443 : 80;

    socks5Connect({
      socksHost: socks.host,
      socksPort: socks.port,
      destHost: target.hostname,
      destPort: port,
      username: credential,
      password: credential,
      timeoutMs
    })
      .then((rawSocket) => {
        const stream: net.Socket = isHttps
          ? (tls.connect({ socket: rawSocket, servername: target.hostname }) as unknown as net.Socket)
          : rawSocket;

        const lib = isHttps ? https : http;
        const agent = new lib.Agent({ keepAlive: false });
        // Reuse the already-established tunnel as the underlying connection.
        (agent as unknown as { createConnection: () => net.Socket }).createConnection = () => stream;

        const request = lib.request(
          {
            hostname: target.hostname,
            port,
            path: `${target.pathname}${target.search}`,
            method: init?.method ?? 'GET',
            agent,
            timeout: timeoutMs,
            headers: { 'User-Agent': userAgent, Host: target.host, ...(init?.headers ?? {}) }
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              const status = res.statusCode ?? 0;
              resolve({
                ok: status >= 200 && status < 300,
                status,
                json: async () => JSON.parse(body),
                text: async () => body
              });
            });
            res.on('error', reject);
          }
        );

        request.on('timeout', () => {
          request.destroy(new Error('SOCKS request timed out'));
        });
        request.on('error', (error) => {
          stream.destroy();
          reject(error);
        });
        request.end();
      })
      .catch(reject);
  });
}

/**
 * Decides and constructs transport-bound clients. Agents never see this: the
 * server resolves the transport from policy + compartment, then asks the router
 * for a bound client. Fail-closed, deny-by-default, no silent downgrade.
 */
export class TransportRouter {
  createClient(request: TransportRequest): TransportClient {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const userAgent = request.userAgent;

    if (request.type === 'direct') {
      if (request.dnsPolicy === 'remote') {
        // Direct cannot guarantee remote DNS; refuse rather than leak intent.
        throw new Error('Direct transport cannot satisfy a remote DNS policy.');
      }
      return { type: 'direct', userAgent, fetch: this.directFetch(userAgent, timeoutMs) };
    }

    if (request.type === 'tor') {
      if (request.dnsPolicy !== 'remote') {
        throw new Error('Tor transport requires a remote DNS policy (no local DNS leak).');
      }
      if (!request.socks) {
        throw new Error('Tor transport requires a SOCKS5 endpoint.');
      }
      const socks = request.socks;
      const credential = request.sessionId ?? 'gyges';
      return {
        type: 'tor',
        userAgent,
        fetch: (url, init) =>
          performSocksRequest(url, init, socks, credential, userAgent, timeoutMs)
      };
    }

    if (request.type === 'proxy') {
      if (!request.socks) {
        throw new Error('Proxy transport requires a SOCKS5 endpoint.');
      }
      const socks = request.socks;
      // Proxy routing always resolves DNS remotely via the SOCKS5 proxy.
      return {
        type: 'proxy',
        userAgent,
        fetch: (url, init) =>
          performSocksRequest(url, init, socks, request.sessionId, userAgent, timeoutMs)
      };
    }

    // Exhaustive guard: unknown transports fail closed.
    throw new Error(`Unsupported transport: ${String((request as TransportRequest).type)}`);
  }

  private directFetch(userAgent: string, timeoutMs: number): FetchLike {
    return async (url, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await globalThis.fetch(url, {
          method: init?.method,
          headers: { 'User-Agent': userAgent, ...(init?.headers ?? {}) },
          signal: controller.signal
        });
        return response as unknown as HttpResponse;
      } finally {
        clearTimeout(timer);
      }
    };
  }
}
