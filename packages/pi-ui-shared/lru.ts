/**
 * Cache LRU mínimo, compartilhado pelos caches de performance do ui-shared
 * (wordDiffRanges em diff-lib.ts).
 *
 * A ordem de inserção do Map serve como ordem de uso: `get` move a entrada
 * para o fim; `set` descarta a entrada mais antiga ao exceder a capacidade.
 * Valores `undefined` não são armazenáveis (tratados como miss).
 */
export class LRUCache<K, V> {
	private readonly entries = new Map<K, V>();
	private readonly capacity: number;

	constructor(capacity: number) {
		this.capacity = capacity;
	}

	get(key: K): V | undefined {
		const value = this.entries.get(key);
		if (value === undefined) return undefined;
		// Re-insere para marcar como mais recentemente usado.
		this.entries.delete(key);
		this.entries.set(key, value);
		return value;
	}

	set(key: K, value: V): void {
		if (this.entries.has(key)) this.entries.delete(key);
		this.entries.set(key, value);
		if (this.entries.size > this.capacity) {
			const oldest = this.entries.keys().next().value as K;
			this.entries.delete(oldest);
		}
	}
}
