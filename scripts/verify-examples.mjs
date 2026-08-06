import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const { getExampleGraphDefinitions } = await import("../src/lib/examples.ts");
const { buildGraphModel } = await import("../src/lib/graph/index.ts");

const outputDirectory = path.join(process.cwd(), "dist", "examples");
const definitions = getExampleGraphDefinitions();
const expectedFiles = definitions.map((example) => `${example.slug}.json`);
const actualFiles = (await readdir(outputDirectory)).sort();

assert.deepEqual(
  actualFiles,
  [...expectedFiles].sort(),
  "build output must contain exactly the declared example graphs",
);

for (const example of definitions) {
  const output = await readFile(
    path.join(outputDirectory, `${example.slug}.json`),
    "utf8",
  );
  const graph = JSON.parse(output);
  assert.deepEqual(
    graph,
    example.create(),
    `${example.slug}.json must be the deterministic build-time graph`,
  );
  buildGraphModel(graph);
}

console.log(
  `Example output verification passed (${definitions.length} graphs).`,
);
