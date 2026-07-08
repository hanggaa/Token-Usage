export interface WebviewHtmlOptions {
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  nonce: string;
}

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; connect-src 'none'; img-src ${options.cspSource} data:; font-src ${options.cspSource}; style-src ${options.cspSource}; script-src 'nonce-${options.nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${options.styleUri}" />
    <title>Token Usage</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${options.nonce}" type="module" src="${options.scriptUri}"></script>
  </body>
</html>`;
}

