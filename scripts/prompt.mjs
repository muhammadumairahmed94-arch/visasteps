/** Terminal helpers for the setup commands. Secrets are read with nothing echoed to the screen. */
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

export const ENV = new URL("../.env", import.meta.url);

export function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Reads a line in raw mode so nothing typed or pasted appears on screen. */
export function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\nStopped. Nothing was saved.\n");
          process.exit(1);
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " ") value += c;
      }
    };
    stdin.on("data", onData);
  });
}

/** Asks until `valid` accepts the answer. */
export async function askUntil(question, valid, hint, { hidden = false } = {}) {
  for (;;) {
    const v = hidden ? await askHidden(question) : await ask(question);
    if (valid(v)) return v;
    console.log(`  ${hint}\n`);
  }
}

export function saveEnv(values) {
  let text = readFileSync(ENV, "utf8");
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${JSON.stringify(value)}`;
    const re = new RegExp(`^${name}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV, text);
}
