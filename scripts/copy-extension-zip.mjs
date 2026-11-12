// Copies the built extension zip into public/downloads so the web app can offer it.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join("extension", "dist");
const zip = readdirSync(dir).find((f) => f.endsWith(".zip") && !f.includes("sources"));
if (!zip) throw new Error("No extension zip found. Run: npm run ext:package");
mkdirSync(join("public", "downloads"), { recursive: true });
copyFileSync(join(dir, zip), join("public", "downloads", "vren-ai-extension.zip"));
console.log("Copied", zip, "to public/downloads/vren-ai-extension.zip");
