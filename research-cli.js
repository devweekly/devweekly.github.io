#!/usr/bin/env node

// 使用方式如下：
/*
    import { research } from "./research-cli.js";

    const result = await research(`
    Review this repository.

    Focus:

    - Architecture
    - Evidence
    - Tradeoffs
    - Risks

    Return JSON only.
    `);

    console.log(result);
*/


import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter } from "node:path";

async function which(cmd) {
    const paths = process.env.PATH.split(delimiter);

    for (const p of paths) {
        try {
            const full = `${p}/${cmd}`;
            await access(full, constants.X_OK);
            return full;
        } catch { }
    }

    return null;
}

async function detectCLI() {

    const opencode =
        await which("opencode");

    if (opencode) {
        return {
            name: "opencode",
            path: opencode
        };
    }

    const copilot =
        await which("github-copilot") ||
        await which("copilot");

    if (copilot) {
        return {
            name: "copilot",
            path: copilot
        };
    }

    throw new Error(
        "Neither OpenCode CLI nor Copilot CLI is installed."
    );
}

function run(command, args, stdin) {

    return new Promise((resolve, reject) => {

        const child = spawn(
            command,
            args,
            {
                stdio: ["pipe", "pipe", "pipe"]
            }
        );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", c => {
            stdout += c.toString();
        });

        child.stderr.on("data", c => {
            stderr += c.toString();
        });

        child.on("close", code => {

            if (code !== 0) {
                reject(new Error(stderr || `Exit ${code}`));
                return;
            }

            if (command.includes("opencode")) {
                // 过滤并拼接出模型最终输出的内容
                const jsonLines = stdout.split("\n").filter(Boolean);
                let finalModelOutput = "";

                for (const line of jsonLines) {
                    try {
                        const event = JSON.parse(line);
                        // 提取模型吐出的文本内容（包含思考和最终答案）
                        if (event.type === "chunk" || event.type === "text") {
                            finalModelOutput += event.content;
                        }
                    } catch {
                        // 忽略非 JSON 行
                        // todo
                    }
                }
                resolve(finalModelOutput);
            } else {
                resolve(stdout);
            }
        });

        child.stdin.write(stdin);
        child.stdin.end();

    });

}

export async function research(prompt, options = {}) {

    const cli = await detectCLI();

    // 👇 新增：如果传入的是对象，自动转换为 JSON 字符串
    const normalizedPrompt = typeof prompt === "object"
        ? JSON.stringify(prompt, null, 2)
        : prompt;

    if (cli.name === "opencode") {

        return run(
            cli.path,
            [
                "run",
                "--model",
                options.model ?? "gpt-5",
                "--json"
            ],
            normalizedPrompt
        );

    }

    return run(
        cli.path,
        [
            "chat",
            "--json"
        ],
        normalizedPrompt
    );

}
