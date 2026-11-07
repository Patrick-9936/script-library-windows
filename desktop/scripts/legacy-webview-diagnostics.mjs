import { writeFileSync } from "node:fs";

const [debugUrl, screenshotPath, reportPath] = process.argv.slice(2);
if (!debugUrl || !screenshotPath || !reportPath) {
  throw new Error("Usage: legacy-webview-diagnostics.mjs <websocket-url> <screenshot.png> <report.json>");
}

const socket = new WebSocket(debugUrl);
let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    errors.push(message.params.entry.text);
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__legacyErrors = [];
    addEventListener('error', event => window.__legacyErrors.push(event.message || String(event.error)));
    addEventListener('unhandledrejection', event => window.__legacyErrors.push(String(event.reason)));
  `,
});
const loaded = new Promise(resolve => {
  const timer = setTimeout(resolve, 15000);
  const listener = event => {
    if (event.data) {
      const message = JSON.parse(event.data);
      if (message.method === "Page.loadEventFired") {
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        resolve();
      }
    }
  };
  socket.addEventListener("message", listener);
});
await send("Page.reload", { ignoreCache: true });
await loaded;
await new Promise(resolve => setTimeout(resolve, 2500));

const evaluation = await send("Runtime.evaluate", {
  expression: `(() => {
    const main = document.querySelector('#main');
    return {
      readyState: document.readyState,
      title: document.title,
      userAgent: navigator.userAgent,
      mainText: main?.innerText?.trim()?.slice(0, 1200) || '',
      mainHtmlLength: main?.innerHTML?.length || 0,
      appShell: Boolean(document.querySelector('.app .shell')),
      runtimeErrors: window.__legacyErrors || []
    };
  })()`,
  returnByValue: true,
});
const report = { ...evaluation.result.value, consoleErrors: errors };
writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (!report.appShell || !report.mainText) {
  socket.close();
  throw new Error(`Legacy UI did not render; diagnostic report: ${reportPath}`);
}

const captured = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(screenshotPath, Buffer.from(captured.data, "base64"));
socket.close();
console.log(JSON.stringify({ ...report, screenshotPath }, null, 2));
