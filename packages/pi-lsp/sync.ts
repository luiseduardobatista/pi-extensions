/**
 * Sync de documento (spec §3.3.6): didOpen uma única vez por URI; antes de
 * cada request o arquivo é relido do disco e re-sincronizado por didChange
 * respeitando o TextDocumentSyncKind negociado. Falha acionável quando a
 * capacidade negociada não permite manter o documento sincronizado.
 */

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fullRangeEnd } from "./positions.ts";
import { languageIdFor } from "./servers.ts";
import type { ManagedServer } from "./server-manager.ts";

/** Relê o disco e sincroniza o documento com o servidor; retorna o texto atual. */
export function syncDocument(s: ManagedServer, file: string): string {
	const sync = s.syncKind;
	if (!sync?.openClose) {
		throw new Error("lsp: servidor não anuncia openClose — operações que dependem do conteúdo do documento não estão disponíveis");
	}
	if (sync.change === 0) {
		throw new Error("lsp: servidor com textDocumentSync change=None não acompanha edições — operações textuais indisponíveis");
	}
	const uri = pathToFileURL(file).href;
	const text = readFileSync(file, "utf8");
	const existing = s.documents.get(uri);
	if (!existing) {
		s.conn.notify("textDocument/didOpen", {
			textDocument: { uri, languageId: languageIdFor(s.resolved.spec, file), version: 1, text },
		});
		s.documents.set(uri, { text, version: 1 });
		return text;
	}
	if (existing.text !== text) {
		existing.version++;
		const contentChanges =
			sync.change === 2
				? [{ range: fullRangeEnd(existing.text), text }] // Incremental: substituição integral do texto anterior
				: [{ text }]; // Sincronização completa.
		s.conn.notify("textDocument/didChange", {
			textDocument: { uri, version: existing.version },
			contentChanges,
		});
		existing.text = text;
	}
	return text;
}

/** Atualiza o registro e NOTIFICA o servidor após mutação própria (spec §3.3.6):
 * sem didChange, o servidor operaria com a cópia antiga nas chamadas seguintes.
 * A chave do registro é normalizada: tenta a URI do caminho original e, se o
 * arquivo foi resolvido por realpath (symlink), a do caminho real. */
export function markDocumentText(s: ManagedServer, file: string, text: string): void {
	let uri = pathToFileURL(file).href;
	let existing = s.documents.get(uri);
	if (!existing) {
		try {
			const real = realpathSync(file);
			if (real !== file) {
				uri = pathToFileURL(real).href;
				existing = s.documents.get(uri);
			}
		} catch {
			// arquivo não existe (ex.: criado pela própria mutação)
		}
	}
	if (!existing) return;
	existing.version++;
	const sync = s.syncKind;
	if (sync?.change && sync.change !== 0) {
		const contentChanges =
			sync.change === 2
				? [{ range: fullRangeEnd(existing.text), text }] // Incremental: substituição integral do texto anterior
				: [{ text }]; // Sincronização completa.
		s.conn.notify("textDocument/didChange", {
			textDocument: { uri, version: existing.version },
			contentChanges,
		});
	}
	existing.text = text;
}
