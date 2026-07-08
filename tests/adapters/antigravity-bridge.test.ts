import { describe, expect, it } from "vitest";
import { parseLanguageServerProcessList } from "../../src/adapters/antigravity-bridge.js";

describe("parseLanguageServerProcessList", () => {
  it("extracts localhost port and CSRF token from Windows command lines", () => {
    const result = parseLanguageServerProcessList(
      "language_server_windows_x64.exe --extension_server_port 54321 --csrf_token abc-123"
    );

    expect(result).toEqual([{ port: 54321, csrf: "abc-123" }]);
  });

  it("supports equals-style arguments used by macOS processes", () => {
    const result = parseLanguageServerProcessList(
      "912 /Applications/Antigravity.app/language_server --csrf_token=token-9 --extension_server_port=61234"
    );

    expect(result).toEqual([{ port: 61234, csrf: "token-9" }]);
  });

  it("ignores unrelated processes and incomplete language servers", () => {
    const result = parseLanguageServerProcessList(
      [
        "100 node server.js",
        "101 language_server --extension_server_port 1234",
        "102 language_server --csrf_token secret"
      ].join("\n")
    );

    expect(result).toEqual([]);
  });
});

