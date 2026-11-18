/** Sends one plain-text email. It throws with a reason the person can read when the mail could not be handed over. */
export type EmailAdapter = {
  id: string;
  send(to: { email: string; name: string }, subject: string, text: string): Promise<void>;
};

/** The adapters an organisation can choose. No mail provider has been chosen yet, so the mock is the only one. */
export const EMAIL_ADAPTERS = [{ id: "mock", label: "Mock (nothing is delivered)" }] as const;

/** Accepts every email and delivers none. */
export function mockEmail(): EmailAdapter {
  return {
    id: "mock",
    async send() {},
  };
}

export function emailAdapter(): EmailAdapter {
  return mockEmail();
}
