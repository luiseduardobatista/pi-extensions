// Fake LSP server para testes de ciclo de vida (determinístico, sem rede).
// Fala JSON-RPC sobre stdio via vscode-jsonrpc; responde a initialize/shutdown,
// sai no exit e expõe handlers para os testes.

import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";

const conn = createMessageConnection(
	new StreamMessageReader(process.stdin),
	new StreamMessageWriter(process.stdout),
);

conn.onRequest("initialize", () => ({
	capabilities: {
		textDocumentSync: { openClose: true, change: 1 },
		definitionProvider: true,
		referencesProvider: true,
		implementationProvider: true,
		typeDefinitionProvider: true,
		hoverProvider: true,
		documentSymbolProvider: true,
		codeActionProvider: true,
		renameProvider: true,
	},
}));
conn.onRequest("shutdown", () => null);
conn.onNotification("exit", () => {
	process.exit(0);
});
// request lento: usado para testar cancelamento ($/cancelRequest)
conn.onRequest("textDocument/slow", () => new Promise((r) => setTimeout(r, 5000)));

process.on("SIGTERM", () => process.exit(0));

conn.listen();
