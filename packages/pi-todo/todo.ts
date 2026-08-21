/**
 * Extensão `todo` — tool `todo` e widget persistente de tarefas.
 * O estado exibido é reconstruído dos resultados persistidos no transcript da
 * sessão; os status possíveis são pending, in_progress e completed.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type TodoStatus = "pending" | "in_progress" | "completed";
interface Todo { id: number; text: string; status: TodoStatus }
interface TodoDetails { action: string; todos: Todo[]; nextId: number; error?: string }

/** Compatibilidade com sessões antigas que persistem `done` em vez de `status`. */
interface LegacyTodo { id: number; text: string; done?: boolean }

const STATUS_CYCLE: TodoStatus[] = ["pending", "in_progress", "completed"];
const VALID_STATUS = new Set<string>(STATUS_CYCLE);

const PARAMS = Type.Object({
	action: StringEnum(["list", "add", "toggle", "delete", "clear"] as const),
	text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
	id: Type.Optional(Type.Number({ description: "Todo ID (for toggle/delete)" })),
	status: Type.Optional(Type.String({ description: "Status: pending, in_progress, completed" })),
});

const migrate = (t: Todo | LegacyTodo): Todo =>
	"status" in t ? t : { id: t.id, text: t.text, status: t.done ? "completed" : "pending" };

const glyph = (t: Todo, theme: Theme): [string, string] =>
	t.status === "completed"
		? [theme.fg("success", "✓"), theme.strikethrough(theme.fg("dim", t.text))]
		: t.status === "in_progress"
			? [theme.fg("warning", "◐"), theme.fg("text", t.text)]
			: [theme.fg("dim", "○"), theme.fg("text", t.text)];

const truncate = (s: string, w: number) => (s.length <= w ? s : s.slice(0, w - 1) + "…");

export function installTodo(pi: ExtensionAPI): void {
	let todos: Todo[] = [];
	let nextId = 1;

	// O transcript é a fonte de verdade: o último snapshot do branch prevalece.
	const reconstruct = (ctx: ExtensionContext) => {
		todos = [];
		nextId = 1;
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type !== "message" || e.message.role !== "toolResult" || e.message.toolName !== "todo")
				continue;
			const d = e.message.details as TodoDetails | undefined;
			if (d) {
				todos = d.todos.map(migrate);
				nextId = d.nextId;
			}
		}
	};

	const updateWidget = (ctx?: ExtensionContext) => {
		if (!ctx?.hasUI) return;
		if (!todos.length) {
			ctx.ui.setWidget("todos", undefined);
			return;
		}
		const snap = [...todos];
		ctx.ui.setWidget("todos", (_t, theme) => ({
			render: (w: number) => {
				const done = snap.filter((t) => t.status === "completed").length;
				const icon = done === snap.length ? "○" : "●";
				const color = done === snap.length ? "dim" : "accent";
				const lines = [
					truncate(`${theme.fg(color, icon)} ${theme.fg(color, `Todos (${done}/${snap.length})`)}`, w),
				];
				for (let i = 0; i < snap.length; i++) {
					const [g, s] = glyph(snap[i], theme);
					const conn = i === snap.length - 1 ? "└─" : "├─";
					lines.push(truncate(`${theme.fg("dim", conn)} ${g} ${s}`, w));
				}
				return lines;
			},
			invalidate: () => {},
		}));
	};

	const refresh = (ctx: ExtensionContext) => {
		reconstruct(ctx);
		updateWidget(ctx);
	};

	pi.on("session_start", async (_e, ctx) => refresh(ctx));
	pi.on("session_tree", async (_e, ctx) => refresh(ctx));
	pi.on("session_compact", async (_e, ctx) => refresh(ctx));
	pi.on("turn_start", async (_e, ctx) => updateWidget(ctx));
	pi.on("tool_execution_end", async (e, ctx) => {
		if (e.toolName === "todo" && !e.isError) updateWidget(ctx);
	});

	const result = (action: string, todos: Todo[], nextId: number, error?: string): TodoDetails => ({
		action,
		todos,
		nextId,
		error,
	});

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Manage a todo list. Actions: list, add (text), toggle (id, status?), delete (id), clear. Status: pending → in_progress → completed",
		promptSnippet: "Track progress with a todo list (pending/in_progress/completed)",
		promptGuidelines: [
			"Use `todo` for multi-step work (≥3 steps). Keep ≤5 items.",
			"Mark todo in_progress BEFORE starting work on it.",
			"Mark todo completed IMMEDIATELY when done.",
		],
		parameters: PARAMS,

		async execute(_id, params, _s, _u, ctx) {
			const { action, text, id, status } = params;
			const err = (msg: string): AgentToolResult<TodoDetails> => ({
				content: [{ type: "text", text: msg }],
				details: result(action, [...todos], nextId, msg),
			});

			if (action === "list") {
				return {
					content: [
						{
							type: "text",
							text: todos.length
								? todos
										.map(
											(t) =>
												`[${t.status === "completed" ? "x" : t.status === "in_progress" ? "~" : " "}] #${t.id}: ${t.text}`,
										)
										.join("\n")
								: "No todos",
						},
					],
					details: result("list", [...todos], nextId),
				};
			}

			if (action === "add") {
				if (!text) return err("Error: text required for add");
				const t: Todo = { id: nextId++, text, status: "pending" };
				todos.push(t);
				updateWidget(ctx);
				return {
					content: [{ type: "text", text: `Added todo #${t.id}: ${t.text}` }],
					details: result("add", [...todos], nextId),
				};
			}

			if (action === "toggle") {
				if (id === undefined) return err("Error: id required for toggle");
				const todo = todos.find((t) => t.id === id);
				if (!todo) return err(`Todo #${id} not found`);
				const old = todo.status;
				todo.status =
					status && VALID_STATUS.has(status)
						? (status as TodoStatus)
						: STATUS_CYCLE[(STATUS_CYCLE.indexOf(todo.status) + 1) % 3];
				updateWidget(ctx);
				return {
					content: [{ type: "text", text: `Todo #${todo.id}: ${old} → ${todo.status}` }],
					details: result("toggle", [...todos], nextId),
				};
			}

			if (action === "delete") {
				if (id === undefined) return err("Error: id required for delete");
				const i = todos.findIndex((t) => t.id === id);
				if (i === -1) return err(`Todo #${id} not found`);
				const [r] = todos.splice(i, 1);
				updateWidget(ctx);
				return {
					content: [{ type: "text", text: `Deleted todo #${r.id}: ${r.text}` }],
					details: result("delete", [...todos], nextId),
				};
			}

			if (action === "clear") {
				const n = todos.length;
				todos = [];
				nextId = 1;
				updateWidget(ctx);
				return {
					content: [{ type: "text", text: `Cleared ${n} todos` }],
					details: result("clear", [], 1),
				};
			}

			return err(`Unknown action: ${action}`);
		},

		renderCall(args, theme) {
			let t = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
			if (args.text) t += ` ${theme.fg("dim", `"${args.text}"`)}`;
			if (args.id !== undefined) t += ` ${theme.fg("accent", `#${args.id}`)}`;
			if (args.status) t += ` ${theme.fg("muted", args.status)}`;
			return new Text(t, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const d = result.details as TodoDetails | undefined;
			if (!d) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (d.error) return new Text(theme.fg("error", `Error: ${d.error}`), 0, 0);

			if (d.action === "list") {
				if (!d.todos.length) return new Text(theme.fg("dim", "No todos"), 0, 0);
				const show = expanded ? d.todos : d.todos.slice(0, 5);
				let s = theme.fg("muted", `${d.todos.length} todo(s):`);
				for (const t of show) {
					const [g, x] = glyph(t, theme);
					s += `\n${g} ${theme.fg("accent", `#${t.id}`)} ${x}`;
				}
				if (!expanded && d.todos.length > 5) s += `\n${theme.fg("dim", `... ${d.todos.length - 5} more`)}`;
				return new Text(s, 0, 0);
			}
			if (d.action === "add") {
				const a = d.todos[d.todos.length - 1];
				return new Text(
					theme.fg("success", "✓ Added ") + theme.fg("accent", `#${a.id}`) + " " + theme.fg("muted", a.text),
					0,
					0,
				);
			}
			if (d.action === "toggle") {
				const t = result.content[0];
				return new Text(theme.fg("success", "✓ ") + theme.fg("muted", t?.type === "text" ? t.text : ""), 0, 0);
			}
			if (d.action === "delete") return new Text(theme.fg("success", "✓ Deleted"), 0, 0);
			return new Text(theme.fg("success", "✓ Cleared all todos"), 0, 0);
		},
	});
}
