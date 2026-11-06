export type AccessPointField = { name: string; label: string; secret?: boolean };

export type AccessPointAdapter = {
  fields(): AccessPointField[];
  testConnection(): Promise<{ ok: boolean; message: string }>;
  lookupParticipant(scheme: string, id: string): Promise<{ registered: boolean }>;
  registerParticipant(scheme: string, id: string): Promise<void>;
  deregisterParticipant(scheme: string, id: string): Promise<void>;
  send(xml: string, metadata: Record<string, string>): Promise<{ id: string }>;
  verifyWebhook(request: Request): Promise<boolean>;
  parseWebhook(request: Request): Promise<Record<string, string>>;
};

export function mockAccessPoint(): AccessPointAdapter {
  return {
    fields: () => [
      { name: "accountId", label: "Account ID" },
      { name: "apiKey", label: "API key", secret: true },
    ],
    async testConnection() {
      return { ok: true, message: "The mock Access Point accepted the connection." };
    },
    async lookupParticipant() {
      return { registered: true };
    },
    async registerParticipant() {},
    async deregisterParticipant() {},
    async send() {
      return { id: "mock" };
    },
    async verifyWebhook() {
      return true;
    },
    async parseWebhook() {
      return {};
    },
  };
}
