/**
 * Instalador de servidores sob demanda (spec §5.5): PATH primeiro; canais npm
 * (--ignore-scripts obrigatório), GitHub release e `go install` com GOBIN
 * privado — sempre no diretório isolado da extensão (~/.cache/pi-lsp), nunca
 * global. Confirmação por servidor via UI, registrada no manifest (atômico);
 * lock cross-process; SHA256 registrado (corrupção, não autenticidade);
 * `latest` na primeira instalação, sem auto-update.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { basename, join, dirname } from "node:path";
import { promisify } from "node:util";
import { expandHome, type LspConfig } from "./config.ts";
import { findInPath, type ResolvedServer } from "./servers.ts";

const execFileAsync = promisify(execFile);
const LOCK_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

export interface InstallUI {
	hasUI: boolean;
	confirm: (message: string) => Promise<boolean>;
}

interface ManifestServer {
	command: string;
	channel: "npm" | "github" | "go-install" | "path";
	version?: string;
	source?: string;
	sha256?: string;
	installedAt: string;
	confirmed: boolean;
}

interface Manifest {
	version: 1;
	servers: Record<string, ManifestServer>;
}

interface ChannelSpec {
	family: string;
	channel: "npm" | "github" | "go-install";
	/** npm: pacotes a instalar (a ordem importa; tipos junto do servidor TS). */
	packages?: string[];
	/** github: repo dono/nome + padrão do asset por plataforma. */
	repo?: string;
	assetPattern?: string;
	/** go-install: pacote. */
	goPackage?: string;
	bin: string;
	installHint: string;
}

/** Canal de instalação por família (spec §5.6). PATH é sempre tentado primeiro. */
const CHANNELS: Record<string, ChannelSpec> = {
	// typescript PINADO na major 5: typescript@7 (port Go) não tem tsserver.js e
	// quebra o typescript-language-server (que resolve o TS pelo projeto ou por
	// configuração tsserver.path — ver tsserverConfigFor).
	ts: { family: "ts", channel: "npm", packages: ["typescript-language-server", "typescript@5"], bin: "typescript-language-server", installHint: "npm install -g typescript-language-server typescript" },
	py: { family: "py", channel: "npm", packages: ["pyright"], bin: "pyright-langserver", installHint: "npm install -g pyright" },
	bash: { family: "bash", channel: "npm", packages: ["bash-language-server"], bin: "bash-language-server", installHint: "npm install -g bash-language-server" },
	yaml: { family: "yaml", channel: "npm", packages: ["yaml-language-server"], bin: "yaml-language-server", installHint: "npm install -g yaml-language-server" },
	json: { family: "json", channel: "npm", packages: ["vscode-langservers-extracted"], bin: "vscode-json-languageserver", installHint: "npm install -g vscode-langservers-extracted" },
	css: { family: "css", channel: "npm", packages: ["vscode-langservers-extracted"], bin: "vscode-css-language-server", installHint: "npm install -g vscode-langservers-extracted" },
	html: { family: "html", channel: "npm", packages: ["vscode-langservers-extracted"], bin: "vscode-html-language-server", installHint: "npm install -g vscode-langservers-extracted" },
	go: { family: "go", channel: "go-install", goPackage: "golang.org/x/tools/gopls@latest", bin: "gopls", installHint: "go install golang.org/x/tools/gopls@latest" },
	rs: { family: "rs", channel: "github", repo: "rust-lang/rust-analyzer", assetPattern: "rust-analyzer-{platform}.gz", bin: "rust-analyzer", installHint: "rustup component add rust-analyzer" },
};

/** PATH do TypeScript isolado (lib com tsserver.js) para o typescript-language-server,
 * que resolve o TS via workspace/configuration (seção typescript-language-server). */
export function tsserverLibPath(config: LspConfig): string | null {
	const lib = join(cacheRoot(config), "servers", "ts", "node_modules", "typescript", "lib");
	return existsSync(join(lib, "tsserver.js")) ? lib : null;
}

/** Configuração de seção respondida em workspace/configuration (spec §3.4). */
export function sectionResponder(config: LspConfig): (section: string) => unknown {
	return (section: string) => {
		if (section === "typescript-language-server") {
			const path = tsserverLibPath(config);
			return path ? { tsserver: { path } } : null;
		}
		return null;
	};
}

function cacheRoot(config: LspConfig): string {
	return expandHome(config.cacheDir);
}

function manifestPath(config: LspConfig): string {
	return join(cacheRoot(config), "manifest.json");
}

export function readManifest(config: LspConfig): Manifest {
	try {
		const raw = JSON.parse(readFileSync(manifestPath(config), "utf8")) as Manifest;
		if (raw.version === 1 && raw.servers) return raw;
	} catch {
		// manifest ausente/corrompido: começa vazio
	}
	return { version: 1, servers: {} };
}

export function writeManifestAtomic(config: LspConfig, manifest: Manifest): void {
	const target = manifestPath(config);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, JSON.stringify(manifest, null, 2));
	renameSync(tmp, target);
}

/** Lock entre processos por família (mkdir atômico); libera no finally. */
export async function withLock<T>(config: LspConfig, name: string, fn: () => Promise<T>): Promise<T> {
	const lockDir = join(cacheRoot(config), "locks", `${name}.lock`);
	mkdirSync(dirname(lockDir), { recursive: true });
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			mkdirSync(lockDir);
			break;
		} catch {
			if (Date.now() > deadline) {
				throw new Error(`lsp: lock de instalação não adquirido (${name}) — outra instalação em andamento?`);
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	try {
		return await fn();
	} finally {
		rmSync(lockDir, { recursive: true, force: true });
	}
}

function sha256Of(file: string): string {
	const h = createHash("sha256");
	h.update(readFileSync(file));
	return h.digest("hex");
}

export function platformAsset(pattern: string): string {
	const os = process.platform === "darwin" ? "apple-darwin" : process.platform === "linux" ? "unknown-linux-gnu" : "pc-windows-msvc";
	const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
	return pattern.replace("{platform}", `${arch}-${os}`);
}

async function download(url: string, dest: string): Promise<void> {
	const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
	if (!res.ok) throw new Error(`lsp: download falhou (${res.status}) para ${url}`);
	const buf = Buffer.from(await res.arrayBuffer());
	writeFileSync(dest, buf);
}

interface InstallResult {
	binPath: string;
	version?: string;
	source?: string;
}

async function installNpm(spec: ChannelSpec, targetDir: string): Promise<InstallResult> {
	// --ignore-scripts é obrigatório (spec §5.5): nunca fallback silencioso.
	await execFileAsync("npm", ["install", "--prefix", targetDir, "--ignore-scripts", "--no-audit", "--no-fund", ...spec.packages!], { timeout: INSTALL_TIMEOUT_MS });
	const binPath = join(targetDir, "node_modules", ".bin", spec.bin);
	if (!existsSync(binPath)) throw new Error(`lsp: instalação npm de ${spec.bin} não produziu o binário esperado`);
	const pkgDir = join(targetDir, "node_modules", spec.packages![0]!);
	let version: string | undefined;
	try {
		version = (JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { version?: string }).version;
	} catch {
		// A versão é opcional; falha na leitura não invalida a instalação.
	}
	return { binPath, version, source: `npm:${spec.packages!.join(" ")}` };
}

async function installGithubRelease(spec: ChannelSpec, targetDir: string): Promise<InstallResult> {
	const api = await fetch(`https://api.github.com/repos/${spec.repo}/releases/latest`, {
		headers: { "User-Agent": "pi-lsp-extension", Accept: "application/vnd.github+json" },
		signal: AbortSignal.timeout(30_000),
	});
	if (!api.ok) throw new Error(`lsp: falha ao consultar releases de ${spec.repo} (${api.status})`);
	const release = (await api.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
	const assetName = platformAsset(spec.assetPattern!);
	const asset = release.assets.find((a) => a.name === assetName);
	if (!asset) throw new Error(`lsp: asset ${assetName} não encontrado em ${spec.repo} ${release.tag_name}`);
	const gzPath = join(targetDir, assetName);
	mkdirSync(targetDir, { recursive: true });
	await download(asset.browser_download_url, gzPath);
	const binPath = join(targetDir, spec.bin);
	const content = gunzipSync(readFileSync(gzPath));
	writeFileSync(binPath, content);
	chmodSync(binPath, 0o755);
	rmSync(gzPath, { force: true });
	return { binPath, version: release.tag_name, source: `github:${spec.repo}@${release.tag_name}` };
}

async function installGoInstall(spec: ChannelSpec, targetDir: string): Promise<InstallResult> {
	mkdirSync(targetDir, { recursive: true });
	await execFileAsync("go", ["install", spec.goPackage!], {
		env: { ...process.env, GOBIN: targetDir },
		timeout: INSTALL_TIMEOUT_MS,
	});
	const binPath = join(targetDir, spec.bin);
	if (!existsSync(binPath)) throw new Error(`lsp: 'go install ${spec.goPackage}' não produziu ${spec.bin}`);
	let version: string | undefined;
	try {
		const { stdout } = await execFileAsync(binPath, ["version"], { timeout: 10_000 });
		version = stdout.trim().split(" ")[1];
	} catch {
		// A versão é opcional; falha na leitura não invalida a instalação.
	}
	return { binPath, version, source: `go-install:${spec.goPackage}` };
}

/**
 * Garante o binário do servidor: PATH → dir privado (manifest) → instalação
 * com confirmação. Erro acionável quando a instalação não é possível.
 */
export async function ensureServerBinary(
	resolved: Omit<ResolvedServer, "commandPath">,
	config: LspConfig,
	ui: InstallUI,
): Promise<string> {
	const spec = resolved.spec;

	const inPath = findInPath(spec.command);
	if (inPath) return inPath;

	const manifest = readManifest(config);
	const recorded = manifest.servers[spec.family];
	if (recorded && recorded.channel !== "path") {
		const binPath = cachedBinPath(config, spec.family, recorded);
		if (binPath && existsSync(binPath)) {
			// sha256 registrado verificado no reuso: corrupção → reinstala (spec §5.5)
			if (recorded.sha256 && sha256Of(binPath) !== recorded.sha256) {
				rmSync(join(cacheRoot(config), "servers", spec.family), { recursive: true, force: true });
			} else {
				return binPath;
			}
		}
	}

	const channelSpec = CHANNELS[spec.family];
	if (!channelSpec) {
		throw new Error(`lsp: servidor ${spec.command} ausente — sem canal de instalação para '${spec.family}'. Instale manualmente: ${spec.installHint}`);
	}
	// Confirmação UMA vez por servidor (spec §5.5): já confirmado no manifest,
	// reinstalação (ex.: binário corrompido/removido) não pede de novo.
	const previouslyConfirmed = recorded?.confirmed === true;
	if (!previouslyConfirmed) {
		if (!ui.hasUI) {
			throw new Error(
				`lsp: servidor ${spec.command} não encontrado no PATH e a confirmação de instalação exige UI (modo atual sem UI). Instale manualmente: ${spec.installHint}`,
			);
		}
		const ok = await ui.confirm(
			`lsp: instalar o servidor ${spec.command} em ${cacheRoot(config)}? ` +
				`(rede + software de terceiros; canal ${channelSpec.channel})`,
		);
		if (!ok) {
			throw new Error(`lsp: instalação de ${spec.command} recusada. Instale manualmente: ${spec.installHint}`);
		}
	}

	const family = spec.family;
	const targetDir = join(cacheRoot(config), "servers", family);
	const result = await withLock(config, `install-${family}`, async () => {
		// outra sessão pode ter instalado enquanto esperávamos o lock
		const fresh = readManifest(config);
		const freshRecord = fresh.servers[family];
		if (freshRecord && freshRecord.channel !== "path") {
			const p = cachedBinPath(config, family, freshRecord);
			if (p && existsSync(p)) return { binPath: p, version: freshRecord.version, source: freshRecord.source } as InstallResult;
		}
		mkdirSync(targetDir, { recursive: true });
		let result: InstallResult;
		switch (channelSpec.channel) {
			case "npm":
				result = await installNpm(channelSpec, targetDir);
				break;
			case "github":
				result = await installGithubRelease(channelSpec, targetDir);
				break;
			case "go-install":
				result = await installGoInstall(channelSpec, targetDir);
				break;
		}
		const next = readManifest(config);
		next.servers[family] = {
			command: spec.command,
			channel: channelSpec.channel,
			version: result.version,
			source: result.source,
			sha256: sha256Of(result.binPath),
			installedAt: new Date().toISOString(),
			confirmed: true,
		};
		writeManifestAtomic(config, next);
		return result;
	});

	return result.binPath;
}

function cachedBinPath(config: LspConfig, family: string, record: ManifestServer): string | null {
	switch (record.channel) {
		case "npm":
			return join(cacheRoot(config), "servers", family, "node_modules", ".bin", record.command);
		case "go-install":
		case "github":
			return join(cacheRoot(config), "servers", family, basename(record.command));
		default:
			return null;
	}
}

/** Lista servidores instalados (PATH + manifest) sem iniciar processo (spec §3.2). */
export function installedServersWithVersions(config: LspConfig): Array<{ family: string; command: string; path: string | null; version?: string }> {
	const manifest = readManifest(config);
	return Object.entries(CHANNELS).map(([family, spec]) => {
		const inPath = findInPath(spec.bin);
		if (inPath) return { family, command: spec.bin, path: inPath };
		const recorded = manifest.servers[family];
		const p = recorded ? cachedBinPath(config, family, recorded) : null;
		return { family, command: spec.bin, path: p && existsSync(p) ? p : null, version: recorded?.version };
	});
}

/** Diretórios de binários privados para prepend no PATH do spawn. */
export function binDirs(config: LspConfig, family: string): string[] {
	const dirs: string[] = [];
	const spec = CHANNELS[family];
	if (!spec) return dirs;
	if (spec.channel === "npm") dirs.push(join(cacheRoot(config), "servers", family, "node_modules", ".bin"));
	if (spec.channel === "go-install") dirs.push(join(cacheRoot(config), "servers", family));
	return dirs;
}

export function listInstalledBins(config: LspConfig): string[] {
	const root = join(cacheRoot(config), "servers");
	if (!existsSync(root)) return [];
	return readdirSync(root).flatMap((family) => {
		const dir = join(root, family, "node_modules", ".bin");
		if (existsSync(dir)) return readdirSync(dir);
		return [];
	});
}
