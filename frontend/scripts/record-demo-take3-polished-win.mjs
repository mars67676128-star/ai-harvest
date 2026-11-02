import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wrapperPath = path.join(__dirname, "record-demo-take3-polished.mjs");
const runtimeWrapperPath = path.join(__dirname, ".record-demo-take3-polished-win.runtime.mjs");

let wrapper = await fs.readFile(wrapperPath, "utf8");
const oldLine = 'let source = await fs.readFile(sourcePath, "utf8");';
const newLine = 'let source = (await fs.readFile(sourcePath, "utf8")).replace(/\\r\\n/g, "\\n");';

if (!wrapper.includes(oldLine)) {
  throw new Error("Take 3 Polished Windows shim could not find the source-read line.");
}
wrapper = wrapper.replace(oldLine, newLine);

await fs.writeFile(runtimeWrapperPath, wrapper, "utf8");
try {
  await import(pathToFileURL(runtimeWrapperPath).href + "?v=" + Date.now());
} finally {
  await fs.rm(runtimeWrapperPath, { force: true });
}
