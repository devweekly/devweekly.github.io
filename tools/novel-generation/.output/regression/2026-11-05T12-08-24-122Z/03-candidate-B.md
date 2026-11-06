<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="Bash">
<｜｜DSML｜｜ parameter name="command" string="true">ls /Users/saga/code-repos/devweekly.github.io/tools/novel-generation && echo "---" && ls /Users/saga/code-repos/devweekly.github.io/tools/novel-generation/worlds 2>/dev/null</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="description" string="true">List project structure</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
<｜｜DSML｜｜ invoke name="Bash">
<｜｜DSML｜｜ parameter name="command" string="true">find /Users/saga/code-repos/devweekly.github.io/tools/novel-generation -maxdepth 3 -name "world-bible.md" -o -maxdepth 3 -name "yanfu-system.md" | head -20</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="description" string="true">Find world bible files</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>
