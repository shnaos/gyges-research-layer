import { describe, expect, it } from 'vitest';
import { CookieJar, SessionManager } from '../src/index.js';

describe('CookieJar', () => {
  it('stores and clears cookies per domain', () => {
    const jar = new CookieJar();
    jar.set('example.com', 'a=1');
    jar.set('example.com', 'b=2');
    jar.set('other.com', 'c=3');

    expect(jar.get('example.com')).toEqual(['a=1', 'b=2']);
    expect(jar.size()).toBe(3);
    expect(jar.domains().sort()).toEqual(['example.com', 'other.com']);

    jar.clear();
    expect(jar.size()).toBe(0);
    expect(jar.get('example.com')).toEqual([]);
  });
});

describe('SessionManager isolation', () => {
  it('gives each compartment a separate cookie jar (no shared cookies)', () => {
    const manager = new SessionManager();
    const a = manager.create('comp-a', { transport: 'direct' });
    const b = manager.create('comp-b', { transport: 'direct' });

    a.cookieJar.set('example.com', 'session=a');

    expect(a.cookieJar).not.toBe(b.cookieJar);
    expect(b.cookieJar.size()).toBe(0);
    expect(b.cookieJar.get('example.com')).toEqual([]);
  });

  it('gives each compartment a distinct sessionId (session separation)', () => {
    const manager = new SessionManager();
    const a = manager.create('comp-a', { transport: 'direct' });
    const b = manager.create('comp-b', { transport: 'direct' });

    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('never reuses a user-agent across live compartments', () => {
    const manager = new SessionManager();
    const a = manager.create('comp-a', { transport: 'direct' });
    const b = manager.create('comp-b', { transport: 'direct' });
    const c = manager.create('comp-c', { transport: 'tor', dnsPolicy: 'remote' });

    const uas = new Set([a.userAgent, b.userAgent, c.userAgent]);
    expect(uas.size).toBe(3);
  });

  it('rotates identity: new sessionId, cleared cookies, rotated user-agent', () => {
    const manager = new SessionManager();
    const a = manager.create('comp-a', { transport: 'direct' });
    a.cookieJar.set('example.com', 'session=a');
    const beforeSession = a.sessionId;
    const beforeUa = a.userAgent;
    const beforeRotation = a.lastRotationAt;

    const rotated = manager.rotate('comp-a');

    expect(rotated.sessionId).not.toBe(beforeSession);
    expect(rotated.cookieJar.size()).toBe(0);
    expect(rotated.userAgent).not.toBe(beforeUa);
    expect(rotated.lastRotationAt).toBeGreaterThanOrEqual(beforeRotation);
  });

  it('destroys a compartment and clears its state', () => {
    const manager = new SessionManager();
    const a = manager.create('comp-a', { transport: 'direct' });
    a.cookieJar.set('example.com', 'session=a');
    manager.recordHistory('comp-a', { tool: 'search', query: 'x' });

    expect(manager.destroy('comp-a')).toBe(true);
    expect(manager.get('comp-a')).toBeUndefined();
    expect(manager.activeCompartments()).not.toContain('comp-a');
    // The previously held identity's cookies were cleared on destroy.
    expect(a.cookieJar.size()).toBe(0);
  });

  it('refuses transport mixing within a compartment', () => {
    const manager = new SessionManager();
    manager.getOrCreate('comp-a', { transport: 'direct' });

    expect(() => manager.getOrCreate('comp-a', { transport: 'tor', dnsPolicy: 'remote' })).toThrow(
      /Transport mixing forbidden/
    );
  });

  it('defaults dnsPolicy to remote for non-direct transports', () => {
    const manager = new SessionManager();
    const tor = manager.create('comp-tor', { transport: 'tor' });
    const direct = manager.create('comp-direct', { transport: 'direct' });

    expect(tor.dnsPolicy).toBe('remote');
    expect(direct.dnsPolicy).toBe('system');
  });

  it('expires idle compartments', () => {
    let clock = 1_000;
    const manager = new SessionManager({ idleTimeoutMs: 100, now: () => clock });
    manager.create('comp-a', { transport: 'direct' });

    clock += 50;
    expect(manager.get('comp-a')).toBeDefined();

    clock += 200;
    expect(manager.get('comp-a')).toBeUndefined();
  });
});
