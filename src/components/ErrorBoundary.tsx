import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, info);
    }
    this.setState({ error, info });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    const isDev = import.meta.env.DEV;
    return (
      <div style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Algo deu errado ao carregar o app
          </h1>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
            {isDev
              ? "Copie a mensagem abaixo e envie para diagnosticar o problema."
              : "Recarregue a página para tentar novamente."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 14px",
              background: "#111",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              cursor: "pointer",
              marginBottom: 16,
            }}
          >
            Recarregar página
          </button>
          {isDev && (
          <pre
            style={{
              background: "#f5f5f5",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "auto",
            }}
          >
{`${error.name}: ${error.message}

${error.stack ?? ""}

${info?.componentStack ?? ""}`}
          </pre>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;