import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const forbiddenDocumentExtensions = new Set([
  ".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".pdf", ".zip", ".rar", ".7z",
]);

const filesExcludedFromNetworkScan = new Set([
  "scripts/security-check.mjs",
]);

const networkPatterns = [
  { name: "fetch", regex: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", regex: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", regex: /\bWebSocket\s*\(/ },
  { name: "sendBeacon", regex: /\bsendBeacon\s*\(/ },
  { name: "axios", regex: /\baxios\b/ },
  { name: "Supabase", regex: /\b(?:createClient|supabase)\b/i },
  { name: "Firebase", regex: /\b(?:firebase|initializeApp)\b/i },
];

function gitFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

const trackedFiles = gitFiles();
const errors = [];

for (const file of trackedFiles) {
  if (/^(?:|.*\/)\.env(?:\..*)?$/i.test(file) && !file.endsWith(".env.example")) {
    errors.push(`Possível arquivo de credenciais rastreado pelo Git: ${file}`);
  }
  if (forbiddenDocumentExtensions.has(extname(file).toLowerCase())) {
    errors.push(`Arquivo privado rastreado pelo Git: ${file}`);
  }
}

for (const file of trackedFiles.filter((name) => /\.(?:ts|tsx|js|jsx|mjs|cjs|py)$/i.test(name))) {
  if (filesExcludedFromNetworkScan.has(file)) continue;
  const content = readFileSync(file, "utf8");
  if (/\.test\.[jt]sx?$/.test(file) && /(?:\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b)/.test(content)) {
    errors.push(`Possível CPF ou CNPJ em arquivo de teste: ${file}`);
  }
  for (const pattern of networkPatterns) {
    if (pattern.regex.test(content)) {
      errors.push(`Comunicação de rede não autorizada (${pattern.name}) em ${file}`);
    }
  }
}

if (errors.length > 0) {
  console.error("\nFalha na verificação de privacidade:\n");
  for (const error of errors) console.error(`- ${error}`);
  console.error("\nRevise a alteração antes de publicar o site.\n");
  process.exit(1);
}

console.log("Verificação de privacidade concluída: verificações automáticas concluídas. A revisão de dados fictícios e do histórico continua necessária.");
