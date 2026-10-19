#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const serverInfo = { name: "dayweave-imagegen", version: "1.0.0" };
const outputDirectory = resolve(
  process.env.DAYWEAVE_IMAGEGEN_OUTPUT_DIR ??
    fileURLToPath(new URL("../artifacts/dayweave-logo-candidates", import.meta.url)),
);

const toolDefinition = {
  name: "generate_dayweave_image",
  description:
    "Generate a square raster image with the configured GPT Image-compatible API. The image is saved only in Dayweave's local logo-candidates folder and is also returned inline for review.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        description: "Complete image-generation prompt.",
      },
      filename: {
        type: "string",
        pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$",
        description: "Optional safe filename, without a directory. A .png suffix is added when omitted.",
      },
      size: {
        type: "string",
        enum: ["1024x1024", "1536x1536"],
        description: "Square output size. Defaults to 1024x1024.",
      },
    },
    required: ["prompt"],
  },
};

function response(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function failure(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

function safeFilename(input) {
  const fallback = `dayweave-image-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const value = input ? basename(input) : fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value)) {
    throw new Error("filename must be a simple file name containing only letters, numbers, dots, underscores, or hyphens.");
  }
  return value.toLowerCase().endsWith(".png") ? value : `${value}.png`;
}

function apiConfiguration() {
  const baseUrl = process.env.DAYWEAVE_IMAGEGEN_BASE_URL;
  const apiKey =
    process.env.DAYWEAVE_IMAGEGEN_API_KEY ??
    process.env.CPA_LOCAL_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (!baseUrl) {
    throw new Error("DAYWEAVE_IMAGEGEN_BASE_URL is not configured for this MCP server.");
  }
  if (!apiKey) {
    throw new Error("No image API key is available. Set DAYWEAVE_IMAGEGEN_API_KEY, CPA_LOCAL_API_KEY, or OPENAI_API_KEY in the launch environment.");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

async function generateImage({ prompt, filename, size = "1024x1024" }) {
  const { baseUrl, apiKey } = apiConfiguration();
  const result = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size,
      response_format: "b64_json",
    }),
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw new Error(body?.error?.message ?? `Image API returned HTTP ${result.status}.`);
  }
  const encoded = body?.data?.[0]?.b64_json;
  if (!encoded || typeof encoded !== "string") {
    throw new Error("The Image API response did not include data[0].b64_json.");
  }

  const bytes = Buffer.from(encoded, "base64");
  const resolvedFilename = safeFilename(filename);
  await mkdir(outputDirectory, { recursive: true });
  const destination = resolve(outputDirectory, resolvedFilename);
  if (!destination.startsWith(`${outputDirectory}\\`) && destination !== outputDirectory) {
    throw new Error("filename resolves outside the approved output directory.");
  }
  await writeFile(destination, bytes, { flag: "wx" });
  return {
    encoded,
    destination,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function handle(message) {
  if (message.method === "notifications/initialized") return;
  if (message.method === "initialize") {
    response(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo,
    });
    return;
  }
  if (message.method === "tools/list") {
    response(message.id, { tools: [toolDefinition] });
    return;
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== toolDefinition.name) {
      failure(message.id, -32602, "Unknown tool.");
      return;
    }
    try {
      const image = await generateImage(message.params.arguments ?? {});
      response(message.id, {
        content: [
          {
            type: "text",
            text: `Saved ${image.byteLength.toLocaleString()} bytes to ${image.destination}\nSHA-256: ${image.sha256}`,
          },
          { type: "image", data: image.encoded, mimeType: "image/png" },
        ],
      });
    } catch (error) {
      response(message.id, {
        content: [{ type: "text", text: `Image generation failed: ${error.message}` }],
        isError: true,
      });
    }
    return;
  }
  failure(message.id, -32601, `Method not found: ${message.method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    await handle(JSON.parse(line));
  } catch (error) {
    failure(null, -32700, `Invalid JSON-RPC request: ${error.message}`);
  }
}
