export interface AiInput {
  text: string;
  docTitle: string;
}

export interface AiResult {
  summary: string;
  flags: string[];
}

export interface AiAdapter {
  analyse(input: AiInput): Promise<AiResult>;
}

const SYSTEM_PROMPT =
  "You are a document checker for a UK immigration law firm. " +
  "You will be shown the expected document type and text extracted from the document. " +
  "Summarise what the document shows in plain English (two to four sentences). " +
  "Then list any concerns — for example: wrong document type, expired dates, missing required fields, illegible or incomplete text. " +
  "Return a JSON object with exactly two keys: \"summary\" (string) and \"flags\" (array of strings, empty if none). " +
  "Do not use any external tools or browse the web. Only analyse the text you are given.";

function userMessage(input: AiInput): string {
  return `Expected document type: ${input.docTitle}\n\nDocument text:\n${input.text}`;
}

function parseResult(raw: string): AiResult {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON object found");
    const obj = JSON.parse(m[0]) as unknown;
    if (typeof obj !== "object" || obj === null) throw new Error("not an object");
    const r = obj as Record<string, unknown>;
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    const flags = Array.isArray(r.flags) ? r.flags.filter((f): f is string => typeof f === "string") : [];
    return { summary, flags };
  } catch {
    return { summary: raw.trim().slice(0, 800), flags: [] };
  }
}

class OffAdapter implements AiAdapter {
  async analyse(): Promise<AiResult> {
    throw new Error("AI_PROVIDER is off");
  }
}

class FakeAdapter implements AiAdapter {
  async analyse(input: AiInput): Promise<AiResult> {
    if (input.text.toLowerCase().includes("expired")) {
      return { summary: "The document appears to have an expiry date that has passed.", flags: ["Document may be expired"] };
    }
    return {
      summary: `Received text for "${input.docTitle}". The content looks complete and appears to be the correct document type.`,
      flags: [],
    };
  }
}

class BedrockAdapter implements AiAdapter {
  constructor(
    private modelId: string,
    private region: string,
  ) {}

  async analyse(input: AiInput): Promise<AiResult> {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime").catch(() => {
      throw new Error("@aws-sdk/client-bedrock-runtime is not installed — run: npm install @aws-sdk/client-bedrock-runtime");
    });
    const client = new BedrockRuntimeClient({ region: this.region });
    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage(input) }],
    };
    let raw: string;
    try {
      const cmd = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      });
      const res = await client.send(cmd);
      const decoded = new TextDecoder().decode(res.body);
      const body = JSON.parse(decoded) as { content?: Array<{ text?: string }> };
      raw = body.content?.[0]?.text ?? "";
    } catch (e) {
      throw new Error(`AI analysis failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    return parseResult(raw);
  }
}

class AnthropicAdapter implements AiAdapter {
  constructor(
    private modelId: string,
    private apiKey: string,
  ) {}

  async analyse(input: AiInput): Promise<AiResult> {
    const Anthropic = await import("@anthropic-ai/sdk").then((m) => m.default ?? m).catch(() => {
      throw new Error("@anthropic-ai/sdk is not installed — run: npm install @anthropic-ai/sdk");
    });
    let raw: string;
    try {
      const client = new (Anthropic as new (opts: { apiKey: string }) => {
        messages: { create(opts: object): Promise<{ content: Array<{ text?: string }> }> };
      })({ apiKey: this.apiKey });
      const res = await client.messages.create({
        model: this.modelId,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage(input) }],
      });
      raw = res.content[0]?.text ?? "";
    } catch (e) {
      throw new Error(`AI analysis failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    return parseResult(raw);
  }
}

export function ai(): AiAdapter {
  const provider = process.env.AI_PROVIDER ?? "off";
  if (provider === "off") return new OffAdapter();
  if (provider === "fake") return new FakeAdapter();
  if (provider === "bedrock") {
    const modelId = process.env.AI_MODEL_ID;
    const region = process.env.AWS_BEDROCK_REGION ?? "eu-west-2";
    if (!modelId) throw new Error("AI_PROVIDER=bedrock requires AI_MODEL_ID");
    return new BedrockAdapter(modelId, region);
  }
  if (provider === "anthropic") {
    const modelId = process.env.AI_MODEL_ID;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!modelId) throw new Error("AI_PROVIDER=anthropic requires AI_MODEL_ID");
    if (!apiKey) throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return new AnthropicAdapter(modelId, apiKey);
  }
  throw new Error(`Unknown AI_PROVIDER "${provider}"`);
}
