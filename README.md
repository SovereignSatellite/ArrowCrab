# ArrowCrab

A directed acyclic graph viewer with automatic layout, pan, zoom, compound expansion, and dependency highlighting.

- Drop a JSON file, browse for one, or choose an example.
- Drag to pan; scroll or pinch to zoom. Arrow keys pan, `+`/`=` and `-` zoom, and `0` fits the graph.
- Click `[+]`/`[−]` to expand/collapse compounds.
- Click a node outside its compound toggle to highlight its dependencies and dependents, or an edge to highlight it and its endpoints. Ctrl/Cmd-click selects multiple items and combines their highlights; empty space clears selection.
- Click **Load JSON** (top-right) to return to the file picker, or **Cancel loading** to stop a load.

## PNG export

```sh
npm run screenshot -- graph.json
npm run screenshot -- graph.json output.png --expand-all
```

The first command writes `graph.png` beside the JSON. Image dimensions follow the diagram and are subject to canvas/memory limits.

## Library

`npm run build:library` builds the `arrowcrab/engine`, `arrowcrab/drawing`, `arrowcrab/diagram`, and `arrowcrab/png` entry points. Drawing accepts a supplied canvas context; `arrowcrab/drawing/webgl` provides the optional WebGL2 backend.

```js
import { buildGraphModel, layoutGraph } from "arrowcrab/engine";
import { renderDiagramPng } from "arrowcrab/png";

const diagram = layoutGraph(buildGraphModel(data), new Set());
const png = await renderDiagramPng(diagram, {
  scale: 1,
  padding: 24,
  background: "#141414",
});
```

[Data format](https://sovereignsatellite.github.io/ArrowCrab/docs/data-format/) · [Documentation](https://sovereignsatellite.github.io/ArrowCrab/docs/)
