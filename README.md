# ArrowCrab

An interactive viewer for directed acyclic graphs (DAGs). Drop in a JSON file and explore your computation graph with pan, zoom, expand/collapse, and causal cone highlighting.

## What It Does

ArrowCrab takes a JSON graph and renders it as an interactive diagram:

- **Automatic layout** - nodes are arranged in layers with edges routed between them. No manual positioning.
- **Compound nodes** - nodes can contain sub-graphs. Click `[+]` to expand, `[−]` to collapse.
- **Causal cones** - click a node to highlight everything it depends on and everything that depends on it. The rest dims out.
- **Navigation** - drag to pan, scroll to zoom (zooms at your cursor), keyboard shortcuts, pinch-to-zoom on touch.

## How to Use

1. **Load a graph** - drag and drop a `.json` file, or click to browse.
2. **Navigate** - drag to pan, scroll to zoom, press `0` to fit the whole graph on screen.
3. **Explore compound nodes** - click `[+]` on nodes with sub-graphs to expand them.
4. **Trace dependencies** - click a node to see its causal cone. Ctrl+click to select multiple nodes and see the combined cone.
5. **Click edges** - edges are clickable too. Click one to highlight it and its endpoints.
6. **Reset** - click "Load JSON" in the top-right to go back to the file picker.

### Keyboard Shortcuts

| Key        | Action        |
| ---------- | ------------- |
| Arrow keys | Pan           |
| `+` / `=`  | Zoom in       |
| `-`        | Zoom out      |
| `0`        | Fit to screen |

## JSON Format

The viewer expects a JSON file with this structure:

```json
{
  "subgraphs": [nodeId, inId, outId, ...],
  "nodes": [id, labelIndex, colorIndex, ...],
  "edges": [sourceId, sourcePort, targetId, targetPort, ...],
  "strings": ["label1", "#ff6644", ...]
}
```

Arrays are flat-packed for compactness. Node labels and colors are indices into the shared `strings` array. See the [technical docs](/docs/data-format/) for the full spec.

## Documentation

Docs covering architecture, data format, layout algorithm, rendering, and interaction are at [`/docs/`](/docs/) when running the site.
