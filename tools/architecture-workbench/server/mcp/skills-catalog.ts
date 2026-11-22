import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";

const skillsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills");

export function loadWorkbenchSkills() {
  return loadSkills(skillsDirectory, { strict: true });
}

export function getWorkbenchSkillUri(catalog:Awaited<ReturnType<typeof loadWorkbenchSkills>>,skillName:string):string {
  const entry=catalog.entries.find(candidate=>candidate.frontmatter.name===skillName);
  if (!entry) throw new Error("Unknown Workbench Skill: "+skillName);
  return entry.uri;
}
