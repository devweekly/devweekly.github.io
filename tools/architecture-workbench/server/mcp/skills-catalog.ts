import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";

const skillsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills");

export function loadWorkbenchSkills() {
  return loadSkills(skillsDirectory, { strict: true });
}
