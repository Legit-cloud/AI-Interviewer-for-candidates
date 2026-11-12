// Fails the build if the extension asks for more than it needs. It should only be able to reach the Vren server,
// and to act on the one tab where the icon is clicked (activeTab).
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../dist/chrome-mv3/manifest.json", import.meta.url), "utf8"));
const problems = [];
const hosts = manifest.host_permissions ?? [];
const testHosts = (process.env.WXT_E2E_HOSTS ?? "").split(",").filter(Boolean);
const api = process.env.WXT_API_ORIGIN ?? "http://localhost:8000";

for (const h of hosts) {
  if (h !== `${api}/*` && !testHosts.includes(h)) problems.push(`host permission "${h}" is not the Vren server`);
}
if ((manifest.content_scripts ?? []).length > 0) problems.push("content_scripts are registered for sites");
if ((manifest.permissions ?? []).includes("sidePanel") || manifest.side_panel) problems.push("the side panel is back");
if ((manifest.permissions ?? []).includes("tabs")) problems.push('the "tabs" permission shows every tab you have open');
for (const needed of ["activeTab", "scripting", "tabCapture", "offscreen"]) {
  if (!(manifest.permissions ?? []).includes(needed)) problems.push(`missing permission ${needed}`);
}

if (problems.length) {
  console.error("Manifest check failed:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`Manifest check passed. Permissions: ${manifest.permissions.join(", ")}. Hosts: ${hosts.join(", ") || "none"}.`);
