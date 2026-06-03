export interface TransportConfig {
  id: string;
  type: 'direct' | 'tor';
  proxyUrl?: string;
}

export class TransportRouter {
  constructor(
    private readonly transports: TransportConfig[],
    private readonly defaultTransportId = 'direct'
  ) {}

  route(transportId?: string): TransportConfig {
    const targetId = transportId ?? this.defaultTransportId;
    const selected = this.transports.find((transport) => transport.id === targetId);

    if (!selected) {
      throw new Error(`Unknown transport: ${targetId}`);
    }

    return selected;
  }
}
