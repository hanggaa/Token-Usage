import { execFile } from "node:child_process";
import { request } from "node:https";
import { promisify } from "node:util";
import type { AntigravityLegacyBridge } from "./antigravity-source.js";

interface Endpoint {
  port: number;
  csrf: string;
}

const execFileAsync = promisify(execFile);
const BASE_PATH = "/exa.language_server_pb.LanguageServerService";

export function parseLanguageServerProcessList(output: string): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!/language_server/iu.test(line)) {
      continue;
    }
    const port = line.match(/--extension_server_port(?:=|\s+)(\d+)/iu)?.[1];
    const csrf = line.match(/--csrf_token(?:=|\s+)([A-Za-z0-9_-]+)/iu)?.[1];
    if (port && csrf) {
      endpoints.push({ port: Number(port), csrf });
    }
  }
  return endpoints;
}

async function discoverEndpoints(): Promise<Endpoint[]> {
  if (process.platform === "win32") {
    const command =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' } | ForEach-Object { $_.CommandLine }";
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024
    });
    return parseLanguageServerProcessList(result.stdout);
  }

  const result = await execFileAsync("ps", ["-axo", "pid=,command="], {
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024
  });
  return parseLanguageServerProcessList(result.stdout);
}

function callApi(endpoint: Endpoint, method: string, body: object): Promise<unknown | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const apiRequest = request(
      {
        hostname: "127.0.0.1",
        port: endpoint.port,
        path: `${BASE_PATH}/${method}`,
        method: "POST",
        rejectUnauthorized: false,
        timeout: 15_000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "Connect-Protocol-Version": "1",
          "X-Codeium-Csrf-Token": endpoint.csrf
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(null);
          }
        });
      }
    );
    apiRequest.on("error", () => resolve(null));
    apiRequest.on("timeout", () => {
      apiRequest.destroy();
      resolve(null);
    });
    apiRequest.end(payload);
  });
}

export class LocalAntigravityBridge implements AntigravityLegacyBridge {
  async fetchSteps(sessionId: string): Promise<unknown[] | null> {
    let endpoints: Endpoint[];
    try {
      endpoints = await discoverEndpoints();
    } catch {
      return null;
    }

    for (const endpoint of endpoints) {
      const response = await callApi(endpoint, "GetCascadeTrajectorySteps", {
        cascadeId: sessionId,
        startIndex: 0,
        endIndex: 10_010
      });
      if (response && typeof response === "object") {
        const object = response as Record<string, unknown>;
        const steps = Array.isArray(object.steps)
          ? object.steps
          : Array.isArray(object.messages)
            ? object.messages
            : null;
        if (steps) {
          return steps;
        }
      }
    }
    return null;
  }
}

