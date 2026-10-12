import type { ViewTransform } from "../drawing/types.ts";
import {
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  ZOOM_STEP_FACTOR,
  KEYBOARD_PAN_STEP,
} from "./constants.ts";

const PAN_CLICK_THRESHOLD = 5;

interface ViewportCallbacks {
  onRender: () => void;
  onClick: (canvasX: number, canvasY: number, ctrlKey: boolean) => void;
  onZoomChange: (zoomPercent: number) => void;
  onFitToScreen: () => void;
}

interface ActivePointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

export interface ViewportControls {
  zoomIn(): void;
  zoomOut(): void;
  fitToScreen(): void;
  setZoomPercent(percent: number): void;
  destroy(): void;
}

export function setupViewport(
  canvas: HTMLCanvasElement,
  viewport: ViewTransform,
  callbacks: ViewportCallbacks,
): ViewportControls {
  const abortController = new AbortController();
  const { signal } = abortController;
  const pointers = new Map<number, ActivePointer>();

  function notifyZoomChange(): void {
    callbacks.onZoomChange(Math.round(viewport.scale * 100));
  }

  function zoomAtPoint(factor: number, centerX: number, centerY: number): void {
    const newScale = Math.min(
      MAX_ZOOM_SCALE,
      Math.max(MIN_ZOOM_SCALE, viewport.scale * factor),
    );
    if (newScale === viewport.scale) {
      return;
    }

    viewport.offsetX =
      centerX - (centerX - viewport.offsetX) * (newScale / viewport.scale);
    viewport.offsetY =
      centerY - (centerY - viewport.offsetY) * (newScale / viewport.scale);
    viewport.scale = newScale;
    callbacks.onRender();
    notifyZoomChange();
  }

  function zoomAtCanvasCenter(factor: number): void {
    zoomAtPoint(factor, canvas.clientWidth / 2, canvas.clientHeight / 2);
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.deltaY === 0) {
        return;
      }
      const factor = event.deltaY > 0 ? 1 / ZOOM_STEP_FACTOR : ZOOM_STEP_FACTOR;
      const rectangle = canvas.getBoundingClientRect();
      zoomAtPoint(
        factor,
        event.clientX - rectangle.left,
        event.clientY - rectangle.top,
      );
    },
    { passive: false, signal },
  );

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      });
      if (pointers.size > 1) {
        for (const pointer of pointers.values()) {
          pointer.dragging = true;
        }
        canvas.style.cursor = "grabbing";
      }
    },
    { signal },
  );

  function movePointer(event: PointerEvent): void {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      return;
    }

    if (pointers.size > 1) {
      const [firstPointer, secondPointer] = pointers.values();
      const oldCenterX = (firstPointer.x + secondPointer.x) / 2;
      const oldCenterY = (firstPointer.y + secondPointer.y) / 2;
      const oldDistance = Math.hypot(
        secondPointer.x - firstPointer.x,
        secondPointer.y - firstPointer.y,
      );
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const newCenterX = (firstPointer.x + secondPointer.x) / 2;
      const newCenterY = (firstPointer.y + secondPointer.y) / 2;
      const newDistance = Math.hypot(
        secondPointer.x - firstPointer.x,
        secondPointer.y - firstPointer.y,
      );
      const rectangle = canvas.getBoundingClientRect();
      if (oldDistance > 0 && newDistance > 0) {
        zoomAtPoint(
          newDistance / oldDistance,
          oldCenterX - rectangle.left,
          oldCenterY - rectangle.top,
        );
      }
      viewport.offsetX += newCenterX - oldCenterX;
      viewport.offsetY += newCenterY - oldCenterY;
      callbacks.onRender();
      return;
    }

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (pointer.dragging) {
      viewport.offsetX += event.clientX - pointer.x;
      viewport.offsetY += event.clientY - pointer.y;
      callbacks.onRender();
    } else if (
      deltaX * deltaX + deltaY * deltaY >
      PAN_CLICK_THRESHOLD * PAN_CLICK_THRESHOLD
    ) {
      pointer.dragging = true;
      canvas.style.cursor = "grabbing";
      viewport.offsetX += deltaX;
      viewport.offsetY += deltaY;
      callbacks.onRender();
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }

  canvas.addEventListener("pointermove", movePointer, { signal });
  canvas.addEventListener(
    "pointerup",
    (event) => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) {
        return;
      }
      movePointer(event);
      pointers.delete(event.pointerId);
      if (pointers.size === 0) {
        canvas.style.cursor = "grab";
      }
      if (!pointer.dragging) {
        const rectangle = canvas.getBoundingClientRect();
        callbacks.onClick(
          event.clientX - rectangle.left,
          event.clientY - rectangle.top,
          event.ctrlKey || event.metaKey,
        );
      }
    },
    { signal },
  );

  function cancelPointer(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      canvas.style.cursor = "grab";
    }
  }

  canvas.addEventListener("pointercancel", cancelPointer, { signal });
  canvas.addEventListener("lostpointercapture", cancelPointer, { signal });

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
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

  canvas.style.cursor = "grab";

  const controls: ViewportControls = {
    zoomIn() {
      zoomAtCanvasCenter(ZOOM_STEP_FACTOR);
    },
    zoomOut() {
      zoomAtCanvasCenter(1 / ZOOM_STEP_FACTOR);
    },
    fitToScreen() {
      callbacks.onFitToScreen();
      notifyZoomChange();
    },
    setZoomPercent(percent: number) {
      zoomAtCanvasCenter(percent / 100 / viewport.scale);
    },
    destroy() {
      abortController.abort();
      for (const pointerId of pointers.keys()) {
        canvas.releasePointerCapture(pointerId);
      }
      pointers.clear();
      canvas.style.cursor = "";
    },
  };

  return controls;
}
