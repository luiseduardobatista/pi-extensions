/**
 * Cliente JSON-RPC sobre stdio (vscode-jsonrpc) com a fronteira da spec §3.4:
 * notificações espontâneas são descartadas; server→client requests têm
 * respostas exatas; requests desconhecidos → MethodNotFound.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	CancellationTokenSource,
	createMessageConnection,
	ErrorCodes,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
	type MessageConnection,
} from "vscode-jsonrpc/node";

const SHUTDOWN_TIMEOUT_MS = 5_000;

export class LspConnection {
	readonly conn: MessageConnection;
	private readonly requestTimeoutMs: number;
	private readonly sectionResponder: (section: string) => unknown;
	/** Fluxo ativo de execução de Command: enquanto setado, workspace/applyEdit é aplicado (spec §5.8). */
	applyEditFlow: { apply: (edit: unknown) => Promise<{ applied: boolean; failureReason?: string }> } | null = null;
	/** Diagnostics por URI, estado INTERNO de protocolo (spec §3.4) — nunca expostos ao agente;
	 * usados somente para preencher context.diagnostics do codeAction (quickfixes). */
	readonly latestDiagnostics = new Map<string, Array<{ range: { start: { line: number }; end: { line: number } }; message: string }>>();

	constructor(
		child: ChildProcessWithoutNullStreams,
		rootUri: string,
		requestTimeoutMs: number,
		sectionResponder: (section: string) => unknown = () => null,
	) {
		this.requestTimeoutMs = requestTimeoutMs;
		this.sectionResponder = sectionResponder;
		this.conn = createMessageConnection(
			new StreamMessageReader(child.stdout),
			new StreamMessageWriter(child.stdin),
		);
		// Erros de escrita (ex.: child morto no meio de um write → EPIPE) e fechamento
		// são consumidos aqui; o estado é gerenciado pelo server-manager (spec §3.3.3).
		this.conn.onError(() => undefined);
		this.conn.onClose(() => undefined);
		this.conn.listen();
		this.registerServerRequests(rootUri);
	}

	/** Server→client requests (spec §3.4): respostas exatas, nunca sucesso falso. */
	private registerServerRequests(rootUri: string): void {
		this.conn.onRequest("workspace/configuration", (params: { items: Array<{ section?: string }> }) => {
			// Uma entrada por item solicitado; seções conhecidas respondem com config
			// (ex.: typescript-language-server → tsserver.path do TS isolado), resto vazio.
			return params.items.map((item) => this.sectionResponder(item.section ?? ""));
		});
		this.conn.onRequest("workspace/workspaceFolders", () => [{ uri: rootUri }]);
		this.conn.onRequest("client/registerCapability", (params: { registrations: unknown[] }) => {
			// dynamicRegistration: false foi anunciado no initialize; rejeitar (nunca ack falso).
			throw new ResponseError(
				ErrorCodes.MethodNotFound,
				`client/registerCapability: registro dinâmico não suportado (${(params.registrations as { method?: string }[]).map((r) => r.method).join(", ")})`,
			);
		});
		this.conn.onRequest("window/workDoneProgress/create", () => null);
		this.conn.onRequest("workspace/applyEdit", async (params: { edit?: unknown }) => {
			if (this.applyEditFlow) return this.applyEditFlow.apply(params.edit);
			return {
				applied: false,
				failureReason: "workspace/applyEdit fora do fluxo de execução de Command do apply_code_action",
			};
		});
		// Notificações espontâneas: consumidas internamente, nunca cruzam a fronteira (spec §3.4).
		// Diagnostics ficam como estado interno para enriquecer context.diagnostics do codeAction.
		this.conn.onNotification("textDocument/publishDiagnostics", (params: { uri?: string; diagnostics?: Array<{ range?: { start?: { line?: number }; end?: { line?: number } }; message?: string }> }) => {
			if (!params.uri) return;
			const list = (params.diagnostics ?? []).flatMap((d) =>
				d.range?.start && d.range.end && d.message !== undefined
					? [{ range: { start: { line: d.range.start.line ?? 0 }, end: { line: d.range.end.line ?? 0 } }, message: d.message }]
					: [],
			);
			this.latestDiagnostics.set(params.uri, list);
		});
		// Requisições desconhecidas → MethodNotFound (nunca ficam pendentes).
		this.conn.onRequest("*", (method: string) => {
			throw new ResponseError(ErrorCodes.MethodNotFound, `Método não suportado: ${method}`);
		});
	}

	request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		const source = new CancellationTokenSource();
		const onAbort = (): void => source.cancel();
		let timer: ReturnType<typeof setTimeout>;
		// Rejeição client-side garantida no timeout e no abort; o cancel do token
		// envia $/cancelRequest ao servidor (polidez de protocolo).
		const fail = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				source.cancel();
				reject(new Error(`lsp: timeout após ${this.requestTimeoutMs}ms em ${method}`));
			}, this.requestTimeoutMs);
			if (signal) {
				if (signal.aborted) {
					source.cancel();
					reject(new Error("lsp: operação cancelada"));
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
					signal.addEventListener("abort", () => reject(new Error("lsp: operação cancelada")), { once: true });
				}
			}
		});
		const req = this.conn.sendRequest(method, params, source.token);
		return Promise.race([req, fail]).finally(() => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			source.dispose();
		});
	}

	notify(method: string, params: unknown): void {
		// sendNotification retorna uma promise que rejeita se a escrita falhar (processo morto
		// entre o notify e a escrita) — consumir, nunca rejeição não tratada.
		this.conn.sendNotification(method, params).catch(() => undefined);
	}

	/** shutdown → exit com prazo curto; quem gerencia SIGTERM/SIGKILL é o server-manager. */
	async shutdownGracefully(): Promise<void> {
		try {
			await Promise.race([
				this.conn.sendRequest("shutdown", null),
				new Promise((_, reject) => setTimeout(() => reject(new Error("timeout no shutdown")), SHUTDOWN_TIMEOUT_MS)),
			]);
		} catch {
			// segue para exit mesmo se o servidor não responder shutdown
		}
		try {
			this.conn.sendNotification("exit").catch(() => undefined);
		} catch {
			// conexão já fechada
		}
	}

	dispose(): void {
		this.conn.dispose();
	}
}
