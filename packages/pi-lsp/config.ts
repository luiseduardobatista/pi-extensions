/**
 * Config da extensão (extensions/lsp/config.json), com defaults da spec.
 */

import { readFileSync } from "node:fs";

export interface LspConfig {
	idleTimeoutMs: number;
	requestTimeoutMs: number;
	cacheDir: string;
}

const DEFAULT_CONFIG: LspConfig = {
	idleTimeoutMs: 600_000,
	requestTimeoutMs: 60_000,
	cacheDir: "~/.cache/pi-lsp",
};

export function loadConfig(): LspConfig {
	try {
		const url = new URL("./config.json", import.meta.url);
		const raw = JSON.parse(readFileSync(url, "utf8")) as Partial<LspConfig>;
		return { ...DEFAULT_CONFIG, ...raw };
	} catch {
		return DEFAULT_CONFIG;
	}
}

/** Expande `~` no início de um caminho. */
export function expandHome(p: string): string {
	if (p === "~") return process.env.HOME ?? p;
	if (p.startsWith("~/") || p.startsWith("~\\")) {
		return (process.env.HOME ?? "") + p.slice(1);
	}
	return p;
}
