import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
  access,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildGraphModel, layoutGraph } from "arrowcrab/engine";
import { createDrawing, drawDiagram } from "arrowcrab/drawing";
import {
  serializeLayoutSnapshot,
  deserializeLayoutSnapshot,
} from "arrowcrab/diagram";
import { renderDiagramPng } from "arrowcrab/png";

const root = fileURLToPath(new URL("..", import.meta.url));
const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "arrowcrab-screenshot-"));
let images = 0;
try {
  const examples = await readdir(join(root, "dist/examples"));
  for (const name of examples.filter((name) => name.endsWith(".json"))) {
    const input = join(directory, name);
    const bytes = await readFile(join(root, "dist/examples", name));
    await writeFile(input, bytes);
    for (const expansion of [[], ["--expand-all"]]) {
      await execute(
        process.execPath,
        ["scripts/screenshot.mjs", input, ...expansion],
        { cwd: root },
      );
      assert.deepEqual(
        await readFile(input),
        bytes,
        "screenshot changed input JSON",
      );
      const output = input.replace(/\.json$/, ".png");
      const png = await readFile(output);
      assert.deepEqual(
        png.subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const image = await loadImage(png);
      assert.ok(image.width > 0 && image.height > 0);
      const canvas = createCanvas(
        Math.min(image.width, 512),
        Math.min(image.height, 512),
      );
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let foreground = false;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index] !== 20 ||
          pixels[index + 1] !== 20 ||
          pixels[index + 2] !== 20
        ) {
          foreground = true;
          break;
        }
      }
      assert.ok(foreground, "PNG contains no graph drawing");
      images += 1;
    }
  }
  const computed = layoutGraph(
    buildGraphModel({
      strings: ["node", "rgba(255,0,0,0.5)"],
      nodes: [0, 0, 1, 1, 0, 1, 3, 0, 1],
      edges: [1, 0, 3, 0],
      subgraphs: [0, 1, 3],
    }),
    new Set([0]),
  );
  const diagram = {
    nodeMap: structuredClone(computed.nodeMap),
    ...deserializeLayoutSnapshot(
      structuredClone(
        serializeLayoutSnapshot(computed.layoutMap, computed.routingMap),
      ),
    ),
  };
  const canvas = createCanvas(256, 256);
  const surface = createDrawing(
    canvas.getContext("2d"),
    createCanvas(1, 1).getContext("2d"),
    null,
  );
  const regions = drawDiagram(surface, diagram, {
    width: 256,
    height: 256,
    pixelRatio: 1,
    viewport: { offsetX: 24, offsetY: 24, scale: 1 },
    highlightedNodes: new Set(),
    highlightedEdges: new Set(),
    background: "#141414",
  });
  assert.ok(
    regions.nodes.length && regions.edges.length,
    "transported diagram was not drawn independently",
  );
  const exported = await renderDiagramPng(diagram, {
    scale: 1,
    padding: 24,
    background: "#141414",
  });
  assert.ok((await loadImage(exported)).width > 0);
  assert.equal(typeof window, "undefined");
  assert.equal(typeof document, "undefined");
  images += 1;
  const empty = join(directory, "empty graph.json");
  const explicit = join(directory, "explicit image.png");
  await writeFile(
    empty,
    JSON.stringify({ strings: [], nodes: [], edges: [], subgraphs: [] }),
  );
  await execute(process.execPath, ["scripts/screenshot.mjs", empty, explicit], {
    cwd: root,
  });
  assert.ok((await loadImage(explicit)).width > 0);
  images += 1;
  const malformed = join(directory, "malformed.json");
  const absentOutput = join(directory, "rejected.png");
  for (const input of [
    "not JSON",
    JSON.stringify({
      strings: ["node", "red"],
      nodes: [0, 0, 1, 1, 0, 1],
      edges: [1, 0, 0, 0],
      subgraphs: [],
    }),
  ]) {
    await writeFile(malformed, input);
    await assert.rejects(
      execute(
        process.execPath,
        ["scripts/screenshot.mjs", malformed, absentOutput],
        { cwd: root },
      ),
    );
    await assert.rejects(access(absentOutput));
    assert.equal(await readFile(malformed, "utf8"), input);
  }
  await assert.rejects(
    execute(process.execPath, ["scripts/screenshot.mjs", empty, empty], {
      cwd: root,
    }),
  );
  const alias = join(directory, "input-alias.png");
  await link(empty, alias);
  await assert.rejects(
    execute(process.execPath, ["scripts/screenshot.mjs", empty, alias], {
      cwd: root,
    }),
  );
  assert.deepEqual(await readFile(empty), await readFile(alias));
  console.log(
    `Screenshot/library integration passed (${images} decoded PNGs; browser-free transported drawing; malformed input rejected; JSON preserved).`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
