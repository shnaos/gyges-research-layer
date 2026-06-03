import { TransportConfig } from '../../transport-router/src/index.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface SearchContext {
  transport: TransportConfig;
}

export interface SearchAdapter {
  search(query: string, context: SearchContext): Promise<SearchResult[]>;
}

export class SearxngAdapter implements SearchAdapter {
  constructor(private readonly baseUrl: string) {}

  async search(query: string, _context: SearchContext): Promise<SearchResult[]> {
    const response = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}&format=json`);

    if (!response.ok) {
      throw new Error(`SearXNG request failed with status ${response.status}`);
    }

    const payload = await response.json() as { results?: Array<{ title: string; url: string; content?: string }> };

    return (payload.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content
    }));
  }
}

export interface FetchHtmlContext {
  transport: TransportConfig;
}

export class FetchHtmlAdapter {
  constructor(private readonly allowedHosts: readonly string[]) {}

  async fetchHtml(url: string, context: FetchHtmlContext): Promise<string> {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http(s) URLs are supported.');
    }

    if (!this.allowedHosts.includes(parsed.hostname)) {
      throw new Error('Host is not permitted by local fetch policy.');
    }

    const safePath = `${parsed.pathname}${parsed.search}`;
    const safeUrl = new URL(safePath, `https://${parsed.hostname}`);

    const response = await fetch(safeUrl, {
      headers: {
        'User-Agent': 'gyges-research-layer/0.1.0',
        'X-Gyges-Transport': context.transport.id
      }
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const body = await response.text();
    return body.slice(0, 100_000);
  }
}
