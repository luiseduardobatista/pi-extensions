/**
 * Resolução de linguagem, root e servidor (spec §5.6), separada da instalação
 * sob demanda e da verificação do executável.
 */

import { accessSync, constants } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export interface ServerSpec {
	family: string;
	/** languageId por extensão de arquivo. */
	languageIds: Record<string, string>;
	exts: string[];
	command: string;
	args: string[];
	/** Marcadores de root (ordem = precedência de desempate no mesmo diretório). */
	markers: string[];
	/** Mensagem de instalação manual quando o binário não está disponível. */
	installHint: string;
}

export const SERVER_MAP: ServerSpec[] = [
	{
		family: "ts",
		languageIds: { ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript" },
		exts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
		command: "typescript-language-server",
		args: ["--stdio"],
		markers: ["tsconfig.json", "jsconfig.json"],
		installHint: "npm install -g typescript-language-server typescript",
	},
	{
		family: "py",
		languageIds: { ".py": "python" },
		exts: [".py"],
		command: "pyright-langserver",
		args: ["--stdio"],
		markers: ["pyrightconfig.json", "pyproject.toml"],
		installHint: "npm install -g pyright",
	},
	{
		family: "go",
		languageIds: { ".go": "go" },
		exts: [".go"],
		command: "gopls",
		args: [],
		markers: ["go.mod"],
		installHint: "go install golang.org/x/tools/gopls@latest",
	},
	{
		family: "rs",
		languageIds: { ".rs": "rust" },
		exts: [".rs"],
		command: "rust-analyzer",
		args: [],
		markers: ["Cargo.toml"],
		installHint: "rustup component add rust-analyzer",
	},
	{
		family: "bash",
		languageIds: { ".sh": "shellscript", ".bash": "shellscript" },
		exts: [".sh", ".bash"],
		command: "bash-language-server",
		args: ["start"],
		markers: [],
		installHint: "npm install -g bash-language-server",
	},
	{
		family: "yaml",
		languageIds: { ".yaml": "yaml", ".yml": "yaml" },
		exts: [".yaml", ".yml"],
		command: "yaml-language-server",
		args: ["--stdio"],
		markers: [],
		installHint: "npm install -g yaml-language-server",
	},
	{
		family: "json",
		languageIds: { ".json": "json" },
		exts: [".json"],
		command: "vscode-json-languageserver",
		args: ["--stdio"],
		markers: [],
		installHint: "npm install -g vscode-langservers-extracted",
	},
	{
		family: "css",
		languageIds: { ".css": "css", ".scss": "scss", ".less": "less" },
		exts: [".css", ".scss", ".less"],
		command: "vscode-css-language-server",
		args: ["--stdio"],
		markers: [],
		installHint: "npm install -g vscode-langservers-extracted",
	},
	{
		family: "html",
		languageIds: { ".html": "html", ".htm": "html" },
		exts: [".html", ".htm"],
		command: "vscode-html-language-server",
		args: ["--stdio"],
		markers: [],
		installHint: "npm install -g vscode-langservers-extracted",
	},
];

export function specForFile(file: string): ServerSpec | null {
	const ext = extname(file);
	return SERVER_MAP.find((s) => s.exts.includes(ext)) ?? null;
}

export function languageIdFor(spec: ServerSpec, file: string): string {
	return spec.languageIds[extname(file)] ?? spec.languageIds[spec.exts[0]!];
}

/** Primeiro ancestral do diretório do arquivo que contém qualquer marcador aplicável. */
export function nearestMarkerRoot(file: string, markers: string[]): string | null {
	if (markers.length === 0) return null;
	let dir = resolve(dirname(file));
	for (;;) {
		for (const m of markers) {
			try {
				accessSync(join(dir, m));
				return dir;
			} catch {
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function gitRootFor(file: string): string | null {
	try {
		const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: dirname(file),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.trim() || null;
	} catch {
		return null;
	}
}

/** Algoritmo fechado da spec §5.6: marcador mais próximo → git root → dir do arquivo. */
export function resolveRoot(file: string, spec: ServerSpec): string {
	const fileDir = resolve(dirname(file));
	return nearestMarkerRoot(file, spec.markers) ?? gitRootFor(file) ?? fileDir;
}

/** Procura um binário executável no PATH. */
export function findInPath(bin: string): string | null {
	const dirs = (process.env.PATH ?? "").split(delimiter);
	for (const dir of dirs) {
		if (!dir) continue;
		const p = join(dir, bin);
		try {
			accessSync(p, constants.X_OK);
			return p;
		} catch {
		}
	}
	return null;
}

export interface ResolvedServer {
	spec: ServerSpec;
	root: string;
	commandPath: string;
}

/** Resolve o servidor para um arquivo (sem verificar o binário — o instalador cuida disso). */
export function resolveServer(file: string): Omit<ResolvedServer, "commandPath"> {
	const spec = specForFile(file);
	if (!spec) {
		throw new Error(`lsp: linguagem não suportada para ${file} (servidores v1: ${SERVER_MAP.map((s) => s.family).join(", ")})`);
	}
	return { spec, root: resolveRoot(file, spec) };
}
