import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, parse, join } from "node:path";
import { parseArgs } from "node:util";
import { buildGraphModel, layoutGraph } from "../src/lib/engine/index.ts";
import { renderDiagramPng } from "../src/lib/platform/png.ts";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "expand-all": { type: "boolean" } },
  });
  if (positionals.length < 1 || positionals.length > 2) {
    throw new Error(
      "Usage: npm run screenshot -- graph.json [output.png] [--expand-all]",
    );
  }
  const input = resolve(positionals[0]);
  const parsed = parse(input);
  const output =
    positionals.length === 2
      ? resolve(positionals[1])
      : join(parsed.dir, `${parsed.name}.png`);
  if (input === output)
    throw new Error("The PNG output must not replace the input JSON file.");
  const inputStat = await stat(input, { bigint: true });
  const outputStat = await stat(output, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (outputStat?.dev === inputStat.dev && outputStat.ino === inputStat.ino)
    throw new Error("The PNG output must not replace the input JSON file.");
  const model = buildGraphModel(JSON.parse(await readFile(input, "utf8")));
  const expandedNodes = new Set();
  if (values["expand-all"]) {
    for (const scope of model.scopeMap.values()) {
      if (scope.parentNodeId !== null) expandedNodes.add(scope.parentNodeId);
    }
  }
  const diagram = layoutGraph(model, expandedNodes);
  const png = await renderDiagramPng(diagram, {
    scale: 1,
    padding: 24,
    background: "#141414",
  });
  await writeFile(output, png);
  console.log(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
