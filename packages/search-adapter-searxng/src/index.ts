export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface SearchAdapter {
  search(query: string): Promise<SearchResult[]>;
}

/**
 * Isolated SearXNG adapter.
 *
 * This is the ONLY component allowed to talk to the search engine. The agent
 * never receives the SearXNG base URL or a direct handle to it: it can only go
 * through the Capability Firewall, which calls this adapter after an explicit
 * allow decision. This prevents a direct agent -> search engine leak.
 */
export class SearxngAdapter implements SearchAdapter {
  constructor(private readonly baseUrl: string) {}

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');

    const response = await fetch(url, {
      headers: { 'User-Agent': 'gyges-research-layer/0.1.0' }
    });

    if (!response.ok) {
      throw new Error(`SearXNG request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      results?: Array<{ title: string; url: string; content?: string }>;
    };

    return (payload.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content
    }));
  }
}
