import { loadWorkbenchSkills } from "./skills-catalog.js";

const skills = await loadWorkbenchSkills();
if (skills.entries.length === 0) {
  throw new Error("The Workbench MCP Skills catalog is empty.");
}

console.log("Validated "+skills.entries.length+" Workbench MCP Skills.");
