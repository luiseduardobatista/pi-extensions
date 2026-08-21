import { test } from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "./lru.ts";

test("LRU: miss retorna undefined e não insere entrada", () => {
	const cache = new LRUCache<string, number>(2);
	assert.equal(cache.get("a"), undefined);
});

test("LRU: get após set retorna o valor (hit)", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1);
	assert.equal(cache.get("a"), 1);
});

test("LRU: eviction descarta a entrada mais antiga ao exceder a capacidade", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1);
	cache.set("b", 2);
	cache.set("c", 3);
	assert.equal(cache.get("a"), undefined);
	assert.equal(cache.get("b"), 2);
	assert.equal(cache.get("c"), 3);
});

test("LRU: get move a entrada para o fim (ordem de uso, não de inserção)", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1);
	cache.set("b", 2);
	assert.equal(cache.get("a"), 1);
	cache.set("c", 3);
	assert.equal(cache.get("b"), undefined);
	assert.equal(cache.get("a"), 1);
	assert.equal(cache.get("c"), 3);
});

test("LRU: set repetido atualiza o valor sem duplicar entrada", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1);
	cache.set("a", 2);
	cache.set("b", 3);
	cache.set("c", 4);
	assert.equal(cache.get("a"), undefined);
	assert.equal(cache.get("b"), 3);
	assert.equal(cache.get("c"), 4);
});

test("LRU: valores undefined são tratados como miss (não armazenáveis)", () => {
	const cache = new LRUCache<string, string | undefined>(2);
	cache.set("a", undefined);
	assert.equal(cache.get("a"), undefined);
	cache.set("b", "x");
	assert.equal(cache.get("b"), "x");
});
