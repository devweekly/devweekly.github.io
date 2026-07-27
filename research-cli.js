#!/usr/bin/env node

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
        } catch {}
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

                reject(
                    new Error(stderr || `Exit ${code}`)
                );

                return;
            }

            resolve(stdout);
        });

        child.stdin.write(stdin);
        child.stdin.end();

    });

}

export async function research(prompt, options = {}) {

    const cli = await detectCLI();

    if (cli.name === "opencode") {

        return run(
            cli.path,
            [
                "run",
                "--model",
                options.model ?? "gpt-5",
                "--json"
            ],
            prompt
        );

    }

    return run(
        cli.path,
        [
            "chat",
            "--json"
        ],
        prompt
    );

}
