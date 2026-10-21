export interface SmsAdapter {
  send(to: string, body: string): Promise<void>;
}

/** Prints the message in the terminal. The only place a sign-in code is ever printed. */
class FakeSms implements SmsAdapter {
  async send(to: string, body: string) {
    console.log(`\n┌─ FAKE SMS to ${to} ${"─".repeat(Math.max(0, 40 - to.length))}\n│ ${body}\n└${"─".repeat(56)}\n`);
  }
}

export function sms(): SmsAdapter {
  const provider = process.env.SMS_PROVIDER ?? "fake";
  if (provider === "fake") return new FakeSms();
  if (provider === "off") return { send: async () => {} }; // email only (owner's choice for now)
  throw new Error(`SMS_PROVIDER "${provider}" is not available yet — Twilio can be added when needed`);
}
