const PAN_CLICK_THRESHOLD = 5;
const MIN_ZOOM_SCALE = 0.1;
const MAX_ZOOM_SCALE = 5;
const ZOOM_STEP_FACTOR = 1.1;
const KEYBOARD_PAN_STEP = 50;

interface Viewport {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface ViewportCallbacks {
  onRender: () => void;
  onClick?: (canvasX: number, canvasY: number, ctrlKey: boolean) => void;
  onZoomChange?: (zoomPercent: number) => void;
  onFitToScreen?: () => void;
}

export interface ViewportControls {
  zoomIn(): void;
  zoomOut(): void;
  fitToScreen(): void;
  getZoomPercent(): number;
  setZoomPercent(percent: number): void;
  destroy(): void;
}

/**
 * Attach pan, zoom, and keyboard handlers to a canvas.
 * Returns controls for programmatic zoom and a cleanup function.
 *
 * Pan: click-drag anywhere on the canvas.
 * Zoom: scroll wheel (centered on cursor), +/- keys, or programmatic.
 * Click: if the mouse barely moved between down and up, dispatches onClick.
 */
export function setupViewport(
  canvas: HTMLCanvasElement,
  viewport: Viewport,
  callbacks: ViewportCallbacks,
): ViewportControls {
  const abortController = new AbortController();
  const { signal } = abortController;

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let mouseDownX = 0;
  let mouseDownY = 0;

  function clampScale(scale: number): number {
    return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, scale));
  }

  function notifyZoomChange(): void {
    callbacks.onZoomChange?.(Math.round(viewport.scale * 100));
  }

  function zoomAtPoint(factor: number, centerX: number, centerY: number): void {
    const newScale = clampScale(viewport.scale * factor);
    if (newScale === viewport.scale) {
      return;
    }

    // Adjust offset so the point under the cursor stays fixed.
    viewport.offsetX =
      centerX - (centerX - viewport.offsetX) * (newScale / viewport.scale);
    viewport.offsetY =
      centerY - (centerY - viewport.offsetY) * (newScale / viewport.scale);
    viewport.scale = newScale;
    callbacks.onRender();
    notifyZoomChange();
  }

  function zoomAtCanvasCenter(factor: number): void {
    zoomAtPoint(factor, canvas.width / 2, canvas.height / 2);
  }

  function setAbsoluteScale(newScale: number): void {
    const clamped = clampScale(newScale);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    viewport.offsetX =
      centerX - (centerX - viewport.offsetX) * (clamped / viewport.scale);
    viewport.offsetY =
      centerY - (centerY - viewport.offsetY) * (clamped / viewport.scale);
    viewport.scale = clamped;
    callbacks.onRender();
    notifyZoomChange();
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      let factor: number;
      if (event.deltaY > 0) {
        factor = 1 / ZOOM_STEP_FACTOR;
      } else {
        factor = ZOOM_STEP_FACTOR;
      }
      const rect = canvas.getBoundingClientRect();
      zoomAtPoint(factor, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false, signal },
  );

  let isDragging = false;

  canvas.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      mouseDownX = event.clientX;
      mouseDownY = event.clientY;
      isPanning = true;
      isDragging = false;
      panStartX = event.clientX - viewport.offsetX;
      panStartY = event.clientY - viewport.offsetY;
    },
    { signal },
  );

  window.addEventListener(
    "mousemove",
    (event) => {
      if (!isPanning) {
        return;
      }
      if (!isDragging) {
        const deltaX = event.clientX - mouseDownX;
        const deltaY = event.clientY - mouseDownY;
        if (
          deltaX * deltaX + deltaY * deltaY <=
          PAN_CLICK_THRESHOLD * PAN_CLICK_THRESHOLD
        ) {
          return;
        }
        isDragging = true;
        canvas.style.cursor = "grabbing";
      }
      viewport.offsetX = event.clientX - panStartX;
      viewport.offsetY = event.clientY - panStartY;
      callbacks.onRender();
    },
    { signal },
  );

  window.addEventListener(
    "mouseup",
    (event) => {
      if (!isPanning) {
        return;
      }
      isPanning = false;
      if (isDragging) {
        isDragging = false;
        canvas.style.cursor = "grab";
      } else {
        callbacks.onClick?.(
          event.clientX,
          event.clientY,
          event.ctrlKey || event.metaKey,
        );
      }
    },
    { signal },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      // Don't capture when typing in an input.
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          viewport.offsetX += KEYBOARD_PAN_STEP;
          callbacks.onRender();
          break;
        case "ArrowRight":
          event.preventDefault();
          viewport.offsetX -= KEYBOARD_PAN_STEP;
          callbacks.onRender();
          break;
        case "ArrowUp":
          event.preventDefault();
          viewport.offsetY += KEYBOARD_PAN_STEP;
          callbacks.onRender();
          break;
        case "ArrowDown":
          event.preventDefault();
          viewport.offsetY -= KEYBOARD_PAN_STEP;
          callbacks.onRender();
          break;
        case "+":
        case "=":
          event.preventDefault();
          zoomAtCanvasCenter(ZOOM_STEP_FACTOR);
          break;
        case "-":
          event.preventDefault();
          zoomAtCanvasCenter(1 / ZOOM_STEP_FACTOR);
          break;
        case "0":
          event.preventDefault();
          controls.fitToScreen();
          break;
      }
    },
    { signal },
  );

  let lastTouchDistance: number | null = null;

  canvas.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const touch0 = event.touches[0];
        const touch1 = event.touches[1];
        lastTouchDistance = Math.hypot(
          touch1.clientX - touch0.clientX,
          touch1.clientY - touch0.clientY,
        );
      } else if (event.touches.length === 1) {
        const touch = event.touches[0];
        mouseDownX = touch.clientX;
        mouseDownY = touch.clientY;
        isPanning = true;
        panStartX = touch.clientX - viewport.offsetX;
        panStartY = touch.clientY - viewport.offsetY;
      }
    },
    { passive: false, signal },
  );

  canvas.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 2 && lastTouchDistance !== null) {
        event.preventDefault();
        const touch0 = event.touches[0];
        const touch1 = event.touches[1];
        const newDistance = Math.hypot(
          touch1.clientX - touch0.clientX,
          touch1.clientY - touch0.clientY,
        );
        const rect = canvas.getBoundingClientRect();
        const center = {
          x: (touch0.clientX + touch1.clientX) / 2 - rect.left,
          y: (touch0.clientY + touch1.clientY) / 2 - rect.top,
        };
        zoomAtPoint(newDistance / lastTouchDistance, center.x, center.y);
        lastTouchDistance = newDistance;
      } else if (event.touches.length === 1 && isPanning) {
        event.preventDefault();
        const touch = event.touches[0];
        viewport.offsetX = touch.clientX - panStartX;
        viewport.offsetY = touch.clientY - panStartY;
        callbacks.onRender();
      }
    },
    { passive: false, signal },
  );

  canvas.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) {
        lastTouchDistance = null;
      }
      if (event.touches.length === 0) {
        isPanning = false;
      }
    },
    { signal },
  );

  canvas.style.cursor = "grab";

  const controls: ViewportControls = {
    zoomIn() {
      zoomAtCanvasCenter(ZOOM_STEP_FACTOR);
    },
    zoomOut() {
      zoomAtCanvasCenter(1 / ZOOM_STEP_FACTOR);
    },
    fitToScreen() {
      callbacks.onFitToScreen?.();
      notifyZoomChange();
    },
    getZoomPercent() {
      return Math.round(viewport.scale * 100);
    },
    setZoomPercent(percent: number) {
      setAbsoluteScale(percent / 100);
    },
    destroy() {
      abortController.abort();
      canvas.style.cursor = "";
    },
  };

  return controls;
}
