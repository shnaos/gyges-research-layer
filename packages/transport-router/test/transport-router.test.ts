import net from 'node:net';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSocks5ConnectRequest, TransportRouter } from '../src/index.js';

interface CapturedConnect {
  username?: string;
  atyp?: number;
  host?: string;
  port?: number;
}

/**
 * Minimal SOCKS5 proxy used only for tests. Supports no-auth and
 * username/password auth, performs the CONNECT using the domain the client
 * sent (proving remote DNS), then pipes to the real destination.
 */
function startFakeSocks(captured: CapturedConnect): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'auth' | 'connect' | 'done' = 'greeting';

    client.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      process();
    });
    client.on('error', () => client.destroy());

    function process(): void {
      if (stage === 'done') return;
      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        const nMethods = buffer[1];
        if (buffer.length < 2 + nMethods) return;
        const methods = buffer.subarray(2, 2 + nMethods);
        buffer = buffer.subarray(2 + nMethods);
        if (methods.includes(0x02)) {
          client.write(Buffer.from([0x05, 0x02]));
          stage = 'auth';
        } else {
          client.write(Buffer.from([0x05, 0x00]));
          stage = 'connect';
        }
        return process();
      }
      if (stage === 'auth') {
        if (buffer.length < 2) return;
        const ulen = buffer[1];
        if (buffer.length < 2 + ulen + 1) return;
        const username = buffer.subarray(2, 2 + ulen).toString('utf8');
        const plen = buffer[2 + ulen];
        const total = 2 + ulen + 1 + plen;
        if (buffer.length < total) return;
        captured.username = username;
        buffer = buffer.subarray(total);
        client.write(Buffer.from([0x01, 0x00]));
        stage = 'connect';
        return process();
      }
      // connect
      if (buffer.length < 5) return;
      const atyp = buffer[3];
      captured.atyp = atyp;
      if (atyp !== 0x03) {
        client.destroy();
        return;
      }
      const dlen = buffer[4];
      const needed = 5 + dlen + 2;
      if (buffer.length < needed) return;
      const host = buffer.subarray(5, 5 + dlen).toString('ascii');
      const port = buffer.readUInt16BE(5 + dlen);
      captured.host = host;
      captured.port = port;
      buffer = buffer.subarray(needed);
      stage = 'done';

      const upstream = net.connect({ host, port }, () => {
        // success reply with bound addr 0.0.0.0:0
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => {
        client.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.destroy();
      });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

function startTarget(
  onHit: () => void
): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((_req, res) => {
    onHit();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ results: [{ title: 'ok', url: 'http://x', content: 'c' }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('buildSocks5ConnectRequest', () => {
  it('encodes ATYP=domain (remote DNS), never a resolved IP', () => {
    const req = buildSocks5ConnectRequest('example.onion', 443);
    expect(req[0]).toBe(0x05); // version
    expect(req[1]).toBe(0x01); // connect
    expect(req[3]).toBe(0x03); // ATYP = domain name
    const dlen = req[4];
    expect(req.subarray(5, 5 + dlen).toString('ascii')).toBe('example.onion');
    expect(req.readUInt16BE(5 + dlen)).toBe(443);
  });
});

describe('TransportRouter tor/proxy', () => {
  it('routes over Tor using remote DNS (domain sent to the proxy)', async () => {
    const captured: CapturedConnect = {};
    const socks = await startFakeSocks(captured);
    cleanups.push(socks.close);
    let hits = 0;
    const target = await startTarget(() => {
      hits += 1;
    });
    cleanups.push(target.close);

    const router = new TransportRouter();
    const client = router.createClient({
      type: 'tor',
      userAgent: 'gyges-test',
      dnsPolicy: 'remote',
      sessionId: 'session-xyz',
      socks: { host: '127.0.0.1', port: socks.port }
    });

    const res = await client.fetch(`http://127.0.0.1:${target.port}/search?q=x`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ results: [{ title: 'ok', url: 'http://x', content: 'c' }] });

    // DNS remote resolution enforced: the proxy received the hostname.
    expect(captured.atyp).toBe(0x03);
    expect(captured.host).toBe('127.0.0.1');
    expect(captured.port).toBe(target.port);
    // Tor circuit isolation: the sessionId is used as the SOCKS credential.
    expect(captured.username).toBe('session-xyz');
    expect(hits).toBe(1);
  });

  it('fails closed when Tor is unreachable and never falls back to direct', async () => {
    let hits = 0;
    const target = await startTarget(() => {
      hits += 1;
    });
    cleanups.push(target.close);

    // Point at a closed SOCKS port.
    const deadSocks = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const port = (s.address() as AddressInfo).port;
        s.close(() => resolve(port));
      });
    });

    const router = new TransportRouter();
    const client = router.createClient({
      type: 'tor',
      userAgent: 'gyges-test',
      dnsPolicy: 'remote',
      sessionId: 'session-xyz',
      socks: { host: '127.0.0.1', port: deadSocks },
      timeoutMs: 1_000
    });

    await expect(client.fetch(`http://127.0.0.1:${target.port}/search?q=x`)).rejects.toThrow();
    // No silent downgrade: the destination was never contacted directly.
    expect(hits).toBe(0);
  });

  it('refuses Tor without a remote DNS policy (no local DNS leak)', () => {
    const router = new TransportRouter();
    expect(() =>
      router.createClient({
        type: 'tor',
        userAgent: 'gyges-test',
        dnsPolicy: 'system',
        socks: { host: '127.0.0.1', port: 9050 }
      })
    ).toThrow(/remote DNS/);
  });

  it('refuses Tor without a SOCKS endpoint', () => {
    const router = new TransportRouter();
    expect(() =>
      router.createClient({ type: 'tor', userAgent: 'gyges-test', dnsPolicy: 'remote' })
    ).toThrow(/SOCKS5 endpoint/);
  });

  it('refuses direct transport with a remote DNS policy', () => {
    const router = new TransportRouter();
    expect(() =>
      router.createClient({ type: 'direct', userAgent: 'gyges-test', dnsPolicy: 'remote' })
    ).toThrow(/remote DNS/);
  });
});

describe('TransportRouter direct', () => {
  it('fetches over the direct transport', async () => {
    const target = await startTarget(() => undefined);
    cleanups.push(target.close);

    const router = new TransportRouter();
    const client = router.createClient({
      type: 'direct',
      userAgent: 'gyges-test',
      dnsPolicy: 'system'
    });

    const res = await client.fetch(`http://127.0.0.1:${target.port}/search?q=x`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });
});
