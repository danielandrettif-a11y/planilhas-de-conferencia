import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const forbiddenDocumentExtensions = new Set([
  ".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".pdf", ".zip", ".rar", ".7z",
]);

const allowedNetworkFiles = new Set([
  // Adicione aqui somente arquivos revisados que realmente precisem de comunicação externa.
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
  if (forbiddenDocumentExtensions.has(extname(file).toLowerCase())) {
    errors.push(`Arquivo privado rastreado pelo Git: ${file}`);
  }
}

for (const file of trackedFiles.filter((name) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(name))) {
  if (allowedNetworkFiles.has(file)) continue;
  const content = readFileSync(file, "utf8");
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

console.log("Verificação de privacidade concluída: nenhum arquivo privado ou envio de rede não autorizado foi encontrado.");
