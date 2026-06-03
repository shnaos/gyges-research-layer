export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** Minimal response surface the adapter needs from a transport client. */
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchClient = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string }
) => Promise<HttpResponseLike>;

/**
 * A transport-bound client handed to the adapter. The adapter only ever sees a
 * fetch function and the user-agent to present — never the agent identity, the
 * policy, or the raw transport configuration.
 */
export interface TransportBoundClient {
  fetch: FetchClient;
  userAgent: string;
}

export interface SearchAdapter {
  search(query: string, client: TransportBoundClient): Promise<SearchResult[]>;
}

/**
 * Isolated SearXNG adapter.
 *
 * This is the ONLY component allowed to talk to the search engine. It receives
 * a sanitized query and a transport-bound fetch client; it has no knowledge of
 * the originating agent, the compartment, or the policy. The transport (direct,
 * tor, proxy) is fully decided upstream and injected here.
 */
export class SearxngAdapter implements SearchAdapter {
  constructor(private readonly baseUrl: string) {}

  async search(query: string, client: TransportBoundClient): Promise<SearchResult[]> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');

    const response = await client.fetch(url.toString(), {
      headers: { 'User-Agent': client.userAgent }
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
