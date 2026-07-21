import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

try {
  const storedTheme = localStorage.getItem("theme");
  const theme = storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  document.documentElement.classList.toggle("dark", theme === "dark");
} catch {
  // O aplicativo continua funcionando mesmo quando o armazenamento local está bloqueado.
}

createRoot(document.getElementById("root")!).render(<App />);
