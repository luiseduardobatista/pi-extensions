import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type TUI } from "@earendil-works/pi-tui";
import { BtwOverlayController, type ShowBtwOverlayParams } from "./btw-ui.ts";
import type { BtwTurn } from "./btw.ts";

const ESC = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const ENTER = "\r";
const SPACE = " ";

type MockedFunction = { mock: { calls: readonly unknown[] } };

function callCount(fn: unknown): number {
	return (fn as MockedFunction).mock.calls.length;
}

function fakeTheme(): Theme {
	// O controller só precisa das operações de cor; o teste deixa seus nomes sem efeito.
	return { fg: (_name: string, s: string) => s, bg: (_name: string, s: string) => s } as unknown as Theme;
}

function fakeTui(rows = 30): TUI {
	return { requestRender: mock.fn(), terminal: { rows } } as unknown as TUI;
}

function makeController(params: {
	question?: string;
	history?: BtwTurn[];
	reopen?: boolean;
	rows?: number;
	onAbort?: () => void;
	onClearHistory?: () => void;
	done?: () => void;
} = {}) {
	const theme = fakeTheme();
	const tui = fakeTui(params.rows ?? 30);
	const onAbort = (params.onAbort ?? mock.fn()) as () => void;
	const onClearHistory = (params.onClearHistory ?? mock.fn()) as () => void;
	const done = (params.done ?? mock.fn()) as (result?: undefined) => void;
	const controller = new BtwOverlayController(
		params.question ?? "por que X?",
		params.history ?? [],
		params.reopen ?? false,
		theme,
		tui,
		done,
		onAbort,
		onClearHistory,
	);
	return { controller, onAbort, onClearHistory, done, tui };
}

function render(controller: BtwOverlayController, width = 80): string {
	return controller.render(width).join("\n");
}

/** Remove o preenchimento do painel para inspecionar apenas o conteúdo renderizado. */
function contentLines(controller: BtwOverlayController, width = 80): string[] {
	return controller.render(width).filter((l) => l !== "");
}

function turns(n: number): BtwTurn[] {
	return Array.from({ length: n }, (_, i) => ({ question: `pergunta ${i + 1}`, answer: `resposta ${i + 1}` }));
}

before(() => {
	initTheme("dark"); // getMarkdownTheme() consulta o tema global.
});

describe("estados do overlay", () => {
	it("pending mostra a pergunta no banner, '…' e só a dica de Esc", () => {
		const { controller } = makeController({ question: "por que X?" });
		const out = render(controller);
		assert.ok(out.includes("/btw por que X?"));
		assert.ok(out.includes("…"));
		assert.ok(out.includes("Esc dispensar"));
		assert.ok(!out.includes("k/j rolar"));
		assert.ok(!out.includes("c copiar"));
		assert.ok(!out.includes("x limpar"));
	});

	it("setAnswer adiciona a troca e liga as dicas de resposta", () => {
		const { controller } = makeController();
		controller.setAnswer({ question: "por que X?", answer: "porque sim" });
		const out = render(controller);
		assert.ok(out.includes("porque sim"));
		assert.ok(out.includes("c copiar"));
		assert.ok(out.includes("x limpar"));
		assert.ok(!out.includes("k/j rolar")); // Sem overflow, o footer não oferece rolagem.
	});

	it("setStreaming exibe o texto parcial", () => {
		const { controller } = makeController();
		controller.setStreaming("a resposta está");
		controller.setStreaming("a resposta está chegando");
		assert.ok(render(controller).includes("a resposta está chegando"));
	});

	it("setError exibe a mensagem de erro", () => {
		const { controller } = makeController();
		controller.setError("chamada falhou: rede caiu");
		assert.ok(render(controller).includes("chamada falhou: rede caiu"));
		assert.ok(!render(controller).includes("c copiar"));
	});

	it("setToolStatus mostra a linha de ferramenta em pending e some com a resposta", () => {
		const { controller } = makeController();
		controller.setToolStatus("lendo src/a.ts…");
		assert.ok(render(controller).includes("lendo src/a.ts…"));
		controller.setAnswer({ question: "q", answer: "ok" });
		assert.ok(!render(controller).includes("lendo src/a.ts…"));
	});

	it("reopen já abre no modo resposta com a última troca", () => {
		const { controller } = makeController({ history: turns(2), reopen: true });
		const out = render(controller);
		assert.ok(out.includes("pergunta 2"));
		assert.ok(out.includes("resposta 2"));
		assert.ok(out.includes("c copiar"));
	});
});

describe("histórico dimmed", () => {
	it("mostra as 5 mais recentes + contador das antigas por padrão", () => {
		const { controller } = makeController({ history: turns(7) });
		controller.setAnswer({ question: "atual", answer: "ok" });
		const lines = contentLines(controller);
		const out = lines.join("\n");
		// O contador resume o histórico fora da janela inicial; ←/→ revela as antigas.
		assert.ok(out.includes("pergunta 7"));
		assert.ok(out.includes("pergunta 4"));
		assert.ok(!out.includes("pergunta 3"));
		assert.ok(!out.includes("pergunta 1"));
		assert.ok(lines[0]?.includes("…e 3 mais antigas"));
		assert.ok(lines[1]?.includes("pergunta 4"));
		// Sem overflow, a navegação é o caminho para alcançar as perguntas antigas.
		assert.ok(!out.includes("k/j rolar"));
		assert.ok(out.includes("h/l respostas"));
	});

	it("o painel tem altura fixa mesmo com conteúdo curto", () => {
		const { controller } = makeController({ rows: 30 });
		controller.setAnswer({ question: "atual", answer: "ok" });
		const lines = controller.render(80);
		assert.equal(lines.length, 15); // A altura do painel é fixa.
		assert.ok(lines[0]?.includes("/btw atual")); // O conteúdo começa no topo.
		assert.ok(lines.at(-1)?.includes("Esc dispensar")); // O footer fica no fim.
		assert.equal(lines[lines.length - 2], ""); // O espaço livre fica antes do footer.
	});

	it("↑/↓ não afetam a lista de perguntas quando tudo cabe", () => {
		const { controller } = makeController({ history: turns(10) });
		controller.setAnswer({ question: "atual", answer: "ok" });
		const first = controller.render(80);
		assert.ok(contentLines(controller)[0]?.includes("…e 6 mais antigas"));
		assert.ok(contentLines(controller)[1]?.includes("pergunta 7"));

		controller.handleInput(UP);
		controller.handleInput(DOWN);
		assert.deepEqual(controller.render(80), first); // A rolagem não altera a janela de perguntas.
	});

	it("←/→ expandem a janela para manter o destaque visível", () => {
		const { controller } = makeController({ history: turns(10) });
		controller.setAnswer({ question: "atual", answer: "ok" });
		// Retrocede até a pergunta mais antiga.
		for (let i = 0; i < 10; i++) {
			controller.handleInput(LEFT);
		}
		const lines = contentLines(controller);
		assert.ok(lines[0]?.includes("/btw pergunta 1")); // O destaque fica visível no topo.
		assert.ok(lines[1]?.includes("pergunta 2"));
	});

	it("ordena cronologicamente com a pergunta atual no fim, sem linhas em branco", () => {
		const { controller } = makeController({ history: [{ question: "oi", answer: "r1" }] });
		controller.setAnswer({ question: "ola", answer: "Olá! 👋" });
		const lines = contentLines(controller);
		assert.ok(lines[0]?.includes("/btw oi"));
		assert.ok(lines[1]?.includes("/btw ola")); // A pergunta atual aparece por último.
		assert.ok(lines[2]?.includes("Olá! 👋")); // A resposta fica junto do banner atual.
		assert.notEqual(lines[0], "");
		assert.notEqual(lines[1], "");
	});

	it("navegar com ←/→ não altera a lista de perguntas nem a altura do painel", () => {
		const { controller } = makeController({ history: turns(3) });
		controller.setAnswer({ question: "atual", answer: "resposta atual" });
		const newest = contentLines(controller);
		assert.ok(newest[2]?.includes("/btw pergunta 3")); // A pergunta anterior fica atenuada.
		assert.ok(newest[3]?.includes("/btw atual")); // A atual fica em destaque.

		controller.handleInput(LEFT);
		const mid = contentLines(controller);
		assert.equal(mid[0], newest[0]); // As perguntas anteriores permanecem visíveis.
		assert.equal(mid[1], newest[1]);
		assert.ok(mid[2]?.includes("/btw pergunta 3")); // O destaque acompanha a navegação.
		assert.ok(mid[3]?.includes("/btw atual")); // A atual continua na lista, atenuada.
		assert.equal(mid.length, newest.length); // Navegar não muda a altura do painel.

		controller.handleInput(LEFT);
		const older = contentLines(controller);
		assert.equal(older.length, newest.length);
		assert.equal(older[0], newest[0]);
		assert.ok(older[1]?.includes("/btw pergunta 2")); // O destaque acompanha a navegação.

		controller.handleInput(LEFT);
		assert.ok(contentLines(controller)[0]?.includes("/btw pergunta 1"));

		controller.handleInput(RIGHT);
		assert.ok(contentLines(controller)[1]?.includes("/btw pergunta 2"));
	});

	it("não mostra histórico quando não há trocas anteriores", () => {
		const { controller } = makeController();
		controller.setAnswer({ question: "atual", answer: "ok" });
		const lines = contentLines(controller);
		assert.ok(lines[0]?.includes("/btw atual")); // Sem histórico, o banner começa no topo.
		assert.ok(!lines.join("\n").includes("…e"));
		assert.ok(!lines.join("\n").includes("k/j rolar")); // Não há perguntas ocultas para revelar.
	});
});

describe("teclas", () => {
	it("Esc aborta e dispensa em qualquer estado", () => {
		const { controller, onAbort, done } = makeController();
		controller.handleInput(ESC);
		assert.equal(callCount(onAbort), 1);
		assert.equal(callCount(done), 1);
	});

	it("Space/Enter só dispensam depois da resposta", () => {
		const { controller, done } = makeController();
		controller.handleInput(SPACE);
		controller.handleInput(ENTER);
		assert.equal(callCount(done), 0);
		controller.setAnswer({ question: "q", answer: "ok" });
		controller.handleInput(SPACE);
		assert.equal(callCount(done), 1);
	});

	it("x limpa o histórico da sessão", () => {
		const { controller, onClearHistory } = makeController({ history: turns(2) });
		controller.handleInput("x");
		assert.equal(callCount(onClearHistory), 1);
		assert.ok(!render(controller).includes("x limpar"));
	});

	it("←/→ navegam entre respostas anteriores", () => {
		const { controller } = makeController({ history: turns(2) });
		controller.setAnswer({ question: "atual", answer: "resposta atual" });
		assert.ok(render(controller).includes("atual"));

		controller.handleInput(LEFT);
		assert.ok(render(controller).includes("pergunta 2"));
		assert.ok(render(controller).includes("resposta 2"));

		controller.handleInput(LEFT);
		assert.ok(render(controller).includes("pergunta 1"));

		controller.handleInput(LEFT);
		assert.ok(render(controller).includes("pergunta 1"));

		controller.handleInput(RIGHT);
		assert.ok(render(controller).includes("pergunta 2"));
	});

	it("↑/↓ rolam a resposta mesmo sem perguntas escondidas", () => {
		const { controller } = makeController({ rows: 10 });
		const longAnswer = Array.from({ length: 40 }, (_, i) => `linha ${i + 1}`).join("\n");
		controller.setAnswer({ question: "q", answer: longAnswer });
		const first = controller.render(80);
		assert.equal(first.length, 5); // A resposta não altera a altura do painel.
		assert.ok(first[0]?.includes("/btw q")); // A pergunta permanece visível no topo.
		assert.ok(first[1]?.includes("linha 1")); // A resposta começa visível.
		assert.ok(first.at(-1)?.includes("Esc dispensar")); // O footer permanece fixo.
		assert.ok(first.at(-1)?.includes("k/j rolar")); // O footer sinaliza o overflow.

		controller.handleInput(DOWN); // ↓ revela o restante da resposta
		assert.notDeepEqual(controller.render(80), first);

		controller.handleInput(UP); // ↑ volta ao topo.
		assert.deepEqual(controller.render(80), first);
	});

	it("↑/↓ rolam o viewport sem alterar a lista de perguntas", () => {
		const { controller } = makeController({ rows: 8, history: turns(10) });
		const longAnswer = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join("\n");
		controller.setAnswer({ question: "atual", answer: longAnswer });
		const first = controller.render(80);
		assert.equal(first.length, 4); // A altura do painel permanece fixa.
		assert.ok(first[0]?.includes("…e 6 mais antigas")); // O contador fica no topo.
		assert.ok(first[1]?.includes("pergunta 7"));
		assert.ok(first.at(-1)?.includes("k/j rolar")); // O footer sinaliza o overflow.

		controller.handleInput(DOWN);
		const scrolled = controller.render(80);
		assert.notDeepEqual(scrolled, first); // ↓ mostra o conteúdo abaixo.
		assert.ok(scrolled.at(-1)?.includes("Esc dispensar")); // O footer permanece fixo.

		controller.handleInput(UP);
		assert.deepEqual(controller.render(80), first); // ↑ restaura a âncora e a lista.
	});

	it("← mantém as perguntas anteriores visíveis (regressão)", () => {
		const { controller } = makeController({ rows: 10, history: turns(6) });
		const longAnswer = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join("\n");
		controller.setAnswer({ question: "atual", answer: longAnswer });
		// Move o destaque para uma pergunta antiga sem perder o contexto anterior.
		for (let i = 0; i < 3; i++) {
			controller.handleInput(LEFT);
		}
		const lines = controller.render(80);
		// O conteúdo anterior ao destaque continua visível.
		assert.ok(lines[0]?.includes("…e 2 mais antigas"));
		assert.ok(lines[1]?.includes("pergunta 3"));
		assert.ok(lines[2]?.includes("/btw pergunta 4")); // O destaque fica visível.
		assert.ok(lines[3]?.includes("pergunta 5"));
		assert.ok(lines.at(-1)?.includes("Esc dispensar")); // O footer permanece fixo.
	});

	it("←/→ expandem a janela e trazem o destaque para o topo do viewport", () => {
		const { controller } = makeController({ rows: 8, history: turns(10) });
		controller.setAnswer({ question: "atual", answer: "ok" });
		for (let i = 0; i < 10; i++) {
			controller.handleInput(LEFT);
		}
		const lines = contentLines(controller);
		assert.ok(lines[0]?.includes("/btw pergunta 1")); // O destaque fica no topo do viewport.
		assert.ok(lines[1]?.includes("pergunta 2"));
		assert.ok(controller.render(80).at(-1)?.includes("Esc dispensar")); // O footer permanece fixo.
	});

	it("hjkl funcionam como vim bindings", () => {
		const { controller } = makeController({ history: turns(2), rows: 8 });
		const longAnswer = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join("\n");
		controller.setAnswer({ question: "atual", answer: longAnswer });
		const first = controller.render(80);

		controller.handleInput("j"); // j desce pelo conteúdo.
		assert.notDeepEqual(controller.render(80), first);
		controller.handleInput("k"); // k retorna ao topo.
		assert.deepEqual(controller.render(80), first);

		controller.handleInput("h"); // h seleciona a resposta anterior.
		let lines = contentLines(controller);
		assert.ok(lines[1]?.includes("/btw pergunta 2")); // O destaque acompanha a seleção.
		controller.handleInput("l"); // l retorna à resposta atual.
		lines = contentLines(controller);
		assert.ok(lines[2]?.includes("/btw atual")); // O destaque volta à atual.
	});

	it("rotações de input desconhecidas são ignoradas", () => {
		const { controller, done, onAbort } = makeController();
		controller.handleInput("z");
		assert.equal(callCount(done), 0);
		assert.equal(callCount(onAbort), 0);
	});
});

describe("banner", () => {
	it("trunca perguntas longas com …", () => {
		const { controller } = makeController({ question: "x".repeat(200) });
		const out = render(controller, 60);
		assert.ok(out.includes("…"));
		assert.ok(out.length > 0);
	});
});

describe("showBtwOverlay", () => {
	it("resolve controllerReady com a factory", async () => {
		let captured!: (tui: TUI, theme: Theme, kb: unknown, done: (r?: undefined) => void) => unknown;
		const ctx = {
			ui: {
				custom: (factory: typeof captured) => {
					captured = factory;
					return Promise.resolve(undefined);
				},
			},
		} as unknown as ShowBtwOverlayParams["ctx"];

		const { controllerReady } = await import("./btw-ui.ts").then((m) =>
			m.showBtwOverlay({ ctx, question: "q", history: [], onAbort: () => {}, onClearHistory: () => {} }),
		);
		const controller = captured({ requestRender: mock.fn(), terminal: { rows: 30 } } as unknown as TUI, fakeTheme(), undefined, () => {}) as BtwOverlayController;
		assert.equal(await controllerReady, controller);
	});
});
