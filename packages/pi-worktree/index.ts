import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

async function git(
	pi: Pick<ExtensionAPI, "exec">,
	args: string[],
	cwd: string,
) {
	return pi.exec("git", args, { cwd });
}

async function getRepoRoot(pi: Pick<ExtensionAPI, "exec">, cwd: string) {
	const r = await git(pi, ["rev-parse", "--show-toplevel"], cwd);
	return r.code === 0 ? r.stdout.trim() : null;
}

function sanitize(name: string) {
	// Normaliza o nome da branch antes de usá-lo para compor o caminho do worktree.
	return name.trim().replace(/\0/g, "") || "-";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("worktree", {
		description: "Create or reuse a Git worktree and switch Pi into it",

		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const branch = args.trim();
			if (!branch) {
				ctx.ui.notify("Usage: /worktree <branch>", "error");
				return;
			}

			const repoRoot = await getRepoRoot(pi, ctx.cwd);
			if (!repoRoot) {
				ctx.ui.notify("Not inside a git repository", "error");
				return;
			}

			const fmt = await git(
				pi,
				["check-ref-format", "--branch", branch],
				repoRoot,
			);
			if (fmt.code !== 0) {
				ctx.ui.notify(fmt.stderr.trim() || "Invalid branch name", "error");
				return;
			}

			const safeName = sanitize(branch);
			const worktreesDir = resolve(repoRoot, ".worktrees");
			const worktreeDir = resolve(worktreesDir, safeName);

			if (existsSync(worktreeDir)) {
				// Um caminho existente só pode ser reutilizado se for um worktree deste repositório.
				const top = await getRepoRoot(pi, worktreeDir);
				if (top !== worktreeDir) {
					ctx.ui.notify(
						`Path already exists but is not a git worktree for this repo: ${worktreeDir}`,
						"error",
					);
					return;
				}
			} else {
				await mkdir(worktreesDir, { recursive: true });

				const check = await git(
					pi,
					["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
					repoRoot,
				);
				const args =
					check.code === 0
						? ["worktree", "add", worktreeDir, branch]
						: ["worktree", "add", "-b", branch, worktreeDir];

				const add = await git(pi, args, repoRoot);
				if (add.code !== 0) {
					ctx.ui.notify(
						add.stderr.trim() || "Failed to create worktree",
						"error",
					);
					return;
				}
			}

			const { SessionManager } = await import(
				"@earendil-works/pi-coding-agent"
			);

			const seedFile = ctx.sessionManager.getSessionFile();
			const sm =
				seedFile && existsSync(seedFile)
					? SessionManager.forkFrom(seedFile, worktreeDir)
					: SessionManager.create(worktreeDir);

			// Em uma sessão nova, adiciona uma mensagem sentinela para forçar a persistência do arquivo antes da troca.
			if (!seedFile || !existsSync(seedFile)) {
				sm.appendMessage({
					role: "assistant",
					content: [],
					api: "synthetic",
					provider: "pi-worktree",
					model: "session-sentinel",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "aborted",
					timestamp: Date.now(),
				});
			}

			sm.resetLeaf();

			// Registra o contexto para que o agente saiba onde aplicar as alterações.
			sm.appendMessage({
				role: "user",
				content: [
					{
						type: "text",
						text: `You are in git worktree \`${worktreeDir}\` on branch \`${branch}\`. Keep all changes in this worktree.`,
					},
				],
				timestamp: Date.now(),
			});
			sm.resetLeaf();

			const sessionFile = sm.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("Failed to create worktree session file", "error");
				return;
			}

			if (!existsSync(sessionFile)) {
				ctx.ui.notify("Pi did not persist the worktree session file", "error");
				return;
			}

			const result = await ctx.switchSession(sessionFile, {
				withSession: async (nextCtx) => {
					nextCtx.ui.notify(`📂 Worktree: ${worktreeDir}  ⎇ ${branch}`, "info");
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("Switch to worktree session was cancelled", "warning");
			}
		},
	});
}
