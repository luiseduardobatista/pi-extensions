/**
 * Ciclo de vida dos servidores (spec §3.3): um processo por (família, root),
 * startup sob demanda com dedupe, leases, idle timeout, shutdown em escada e
 * cleanup no fim da sessão. Nenhuma atividade LSP acontece fora de chamadas
 * explícitas — este módulo só é acionado pelo tool.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { LspConnection } from "./client.ts";
import { expandHome, type LspConfig } from "./config.ts";
import { binDirs, sectionResponder } from "./installer.ts";
import type { ActionEntry } from "./actions.ts";
import type { ResolvedServer } from "./servers.ts";

const INIT_TIMEOUT_MS = 15_000;
const EXIT_GRACE_MS = 2_000;
const SIGTERM_GRACE_MS = 2_000;

export type SyncKind = { openClose: boolean; change: number } | null;

interface ManagedServer {
	key: string;
	child: ChildProcessWithoutNullStreams;
	conn: LspConnection;
	root: string;
	resolved: ResolvedServer;
	encoding: "utf-16" | "utf-8";
	syncKind: SyncKind;
	capabilities: Record<string, unknown>;
	documents: Map<string, { text: string; version: number }>;
	actions: Map<string, ActionEntry>;
	leases: number;
	idleTimer: ReturnType<typeof setTimeout> | null;
	chain: Promise<unknown>;
	stopPromise: Promise<void> | null;
	dead: boolean;
}

const servers = new Map<string, ManagedServer>();
const startPromises = new Map<string, Promise<ManagedServer>>();

function keyFor(resolved: ResolvedServer): string {
	return `${resolved.spec.family}\0${resolved.root}`;
}

function debugFile(config: LspConfig, resolved: ResolvedServer): string {
	const dir = join(expandHome(config.cacheDir), "debug");
	mkdirSync(dir, { recursive: true });
	return join(dir, `${resolved.spec.command}-${resolved.root.replaceAll(/[/\\:]/g, "_")}.log`);
}

function parseSyncKind(raw: unknown): SyncKind {
	if (typeof raw === "number") {
		return { openClose: true, change: raw };
	}
	if (typeof raw === "object" && raw !== null) {
		const o = raw as { openClose?: boolean; change?: number };
		return { openClose: o.openClose ?? true, change: o.change ?? 1 };
	}
	return null;
}

async function startServer(resolved: ResolvedServer, config: LspConfig): Promise<ManagedServer> {
	const key = keyFor(resolved);
	const child = spawn(resolved.commandPath, resolved.spec.args, {
		cwd: resolved.root,
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			PATH: [...binDirs(config, resolved.spec.family), process.env.PATH ?? ""].join(delimiter),
		},
	});
	// stderr → arquivo de debug local; nunca chega ao agente (spec §5.7).
	const dbg = debugFile(config, resolved);
	child.stderr.on("data", (chunk: Buffer) => {
		try {
			appendFileSync(dbg, chunk);
		} catch {
			// A gravação de debug é opcional.
		}
	});
	// Processo morto no meio de uma escrita → EPIPE; consumir (o estado dead cobre o resto).
	child.stdin.on("error", () => undefined);
	child.stdout.on("error", () => undefined);
	child.stderr.on("error", () => undefined);

	// Barreira do spawn: só cria a conexão (e qualquer escrita) depois de confirmar que
	// o processo nasceu. Sem isso, um spawn falho deixa a escrita do initialize na
	// fila do writer sobre um stream destruído (ERR_STREAM_DESTROYED não tratado).
	const spawned = await new Promise<Error | null>((resolve) => {
		child.once("error", (err) => resolve(err));
		child.once("spawn", () => resolve(null));
	});
	if (spawned) {
		throw new Error(`lsp: falha ao iniciar ${resolved.commandPath}: ${spawned.message}`);
	}

	const conn = new LspConnection(child, pathToFileURL(resolved.root).href, config.requestTimeoutMs, sectionResponder(config));

	try {
		// Captura sem efeito para evitar rejeição não tratada quando a requisição fica órfã.
		const initPromise = conn.request("initialize", {
			processId: null,
			clientInfo: { name: "pi-lsp" },
			rootUri: pathToFileURL(resolved.root).href,
			capabilities: {
				workspace: { configuration: true, workspaceFolders: true, applyEdit: true },
				general: { positionEncodings: ["utf-16"] },
			},
		});
		initPromise.catch(() => undefined);
		const initResult = (await Promise.race([
			initPromise,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout no initialize")), INIT_TIMEOUT_MS),
			),
		])) as { capabilities?: Record<string, unknown>; positionEncoding?: string };

		conn.notify("initialized", {});

		const server: ManagedServer = {
			key,
			child,
			conn,
			root: resolved.root,
			resolved,
			encoding: initResult.positionEncoding === "utf-8" ? "utf-8" : "utf-16",
			syncKind: parseSyncKind(initResult.capabilities?.textDocumentSync),
			capabilities: initResult.capabilities ?? {},
			documents: new Map(),
			actions: new Map(),
			leases: 0,
			idleTimer: null,
			chain: Promise.resolve(),
			stopPromise: null,
			dead: false,
		};

		child.on("exit", (code, signal) => {
			server.dead = true;
			// Requisições pendentes são rejeitadas pelo fechamento da conexão; a próxima
			// chamada reinicia (spec §3.3.3).
			if (servers.get(key) === server) servers.delete(key);
			if (code !== 0 && signal === null && !server.stopPromise) {
				// saída inesperada: nada a limpar além do registro acima
			}
		});

		return server;
	} catch (e) {
		// initialize falhou (timeout/erro do servidor/spawn): limpeza sem órfão (spec §3.3.3)
		if (child.pid !== undefined) {
			conn.dispose(); // descarta escritas pendentes no stream vivo antes de matar
			try {
				child.kill("SIGKILL");
			} catch {
				// já morto
			}
		} else {
			// spawn falhou (ENOENT/EACCES): streams destruídos — dispose() tentaria
			// escrever no stream morto (ERR_STREAM_DESTROYED); nada a limpar além disso
		}
		throw e;
	}
}

/** Adquire (ou inicia) o servidor da chave; dedupe via promise cache (spec §5.7). */
async function acquire(resolved: ResolvedServer, config: LspConfig): Promise<ManagedServer> {
	const key = keyFor(resolved);
	const existing = servers.get(key);
	if (existing && !existing.dead) {
		if (existing.stopPromise) {
			// chamada durante shutdown: aguarda o término e reinicia (spec §3.3.3)
			await existing.stopPromise;
		} else {
			existing.leases++;
			clearIdle(existing);
			return existing;
		}
	}
	const pending = startPromises.get(key);
	if (pending) return pending;
	const p = startServer(resolved, config).then((s) => {
		servers.set(key, s);
		s.leases++;
		return s;
	});
	startPromises.set(key, p);
	try {
		return await p;
	} finally {
		startPromises.delete(key);
	}
}

function clearIdle(s: ManagedServer): void {
	if (s.idleTimer) {
		clearTimeout(s.idleTimer);
		s.idleTimer = null;
	}
}

function release(s: ManagedServer, config: LspConfig): void {
	s.leases = Math.max(0, s.leases - 1);
	if (s.leases === 0 && !s.dead) {
		clearIdle(s);
		s.idleTimer = setTimeout(() => {
			void shutdown(keyFor(s.resolved), config);
		}, config.idleTimeoutMs);
	}
}

/** Escada de término: shutdown → exit → SIGTERM → SIGKILL (spec §3.3.4). */
export async function shutdown(key: string, config: LspConfig): Promise<void> {
	const s = servers.get(key);
	if (!s || s.dead || s.child.exitCode !== null) return;
	if (s.stopPromise) return s.stopPromise;
	clearIdle(s);
	s.leases = 0;

	const stop = (async () => {
		try {
			await s.conn.shutdownGracefully();
		} catch {
			// segue para sinais
		}
		if (!s.dead) {
			await Promise.race([
				new Promise<void>((resolveExit) => s.child.once("exit", () => resolveExit())),
				new Promise<void>((r) => setTimeout(r, EXIT_GRACE_MS)),
			]);
		}
		if (!s.dead) s.child.kill("SIGTERM");
		if (!s.dead) {
			await Promise.race([
				new Promise<void>((resolveExit) => s.child.once("exit", () => resolveExit())),
				new Promise<void>((r) => setTimeout(r, SIGTERM_GRACE_MS)),
			]);
		}
		if (!s.dead) s.child.kill("SIGKILL");
		s.conn.dispose();
	})();
	s.stopPromise = stop;
	try {
		await stop;
	} finally {
		servers.delete(key);
	}
}

/** Serializa requests por processo e executa a operação com lease (spec §3.3.3). */
export async function runWithServer<T>(
	resolved: ResolvedServer,
	config: LspConfig,
	fn: (s: ManagedServer) => Promise<T>,
): Promise<T> {
	const s = await acquire(resolved, config);
	const work = s.chain.then(() => fn(s));
	// mantém a cadeia viva mesmo se a operação falhar
	s.chain = work.then(
		() => undefined,
		() => undefined,
	);
	try {
		return await work;
	} finally {
		release(s, config);
	}
}

export type { ManagedServer };

/** Cleanup de fim de sessão (hook passivo session_shutdown — spec §3.3.5). */
export async function shutdownAll(config: LspConfig): Promise<void[]> {
	// aguarda startups em andamento antes de desligar (spec §3.3.5: sem órfão)
	await Promise.allSettled([...startPromises.values()]);
	return Promise.all([...servers.keys()].map((k) => shutdown(k, config)));
}
