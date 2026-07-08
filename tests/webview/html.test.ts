import { describe, expect, it } from "vitest";
import { renderWebviewHtml } from "../../src/webview/html.js";

describe("renderWebviewHtml", () => {
  it("uses a nonce-bound script and restrictive content security policy", () => {
    const html = renderWebviewHtml({
      cspSource: "vscode-webview://test",
      scriptUri: "vscode-webview://test/assets/index.js",
      styleUri: "vscode-webview://test/assets/index.css",
      nonce: "fixed-nonce"
    });

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("script-src 'nonce-fixed-nonce'");
    expect(html).toContain('nonce="fixed-nonce"');
    expect(html).not.toContain("unsafe-inline");
  });
});

