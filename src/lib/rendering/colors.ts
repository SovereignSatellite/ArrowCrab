interface RGB {
  red: number;
  green: number;
  blue: number;
}

interface HSL {
  hue: number;
  saturation: number;
  lightness: number;
}

function hexToRgb(hex: string): RGB | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    return null;
  }
  return {
    red: parseInt(match[1], 16),
    green: parseInt(match[2], 16),
    blue: parseInt(match[3], 16),
  };
}

function rgbToHex({ red, green, blue }: RGB): string {
  return (
    "#" +
    [red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl({ red, green, blue }: RGB): HSL {
  const redNorm = red / 255;
  const greenNorm = green / 255;
  const blueNorm = blue / 255;
  const max = Math.max(redNorm, greenNorm, blueNorm);
  const min = Math.min(redNorm, greenNorm, blueNorm);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  let saturation: number;
  if (lightness > 0.5) {
    saturation = delta / (2 - max - min);
  } else {
    saturation = delta / (max + min);
  }

  let hue: number;
  if (max === redNorm) {
    let hueOffset: number;
    if (greenNorm < blueNorm) {
      hueOffset = 6;
    } else {
      hueOffset = 0;
    }
    hue = (greenNorm - blueNorm) / delta + hueOffset;
  } else if (max === greenNorm) {
    hue = (blueNorm - redNorm) / delta + 2;
  } else {
    hue = (redNorm - greenNorm) / delta + 4;
  }
  hue /= 6;

  return { hue, saturation, lightness };
}

function hueToChannel(
  chromaLow: number,
  chromaHigh: number,
  adjustedHue: number,
): number {
  if (adjustedHue < 0) {
    adjustedHue += 1;
  }
  if (adjustedHue > 1) {
    adjustedHue -= 1;
  }
  if (adjustedHue < 1 / 6) {
    return chromaLow + (chromaHigh - chromaLow) * 6 * adjustedHue;
  }
  if (adjustedHue < 1 / 2) {
    return chromaHigh;
  }
  if (adjustedHue < 2 / 3) {
    return chromaLow + (chromaHigh - chromaLow) * (2 / 3 - adjustedHue) * 6;
  }
  return chromaLow;
}

function hslToRgb({ hue, saturation, lightness }: HSL): RGB {
  if (saturation === 0) {
    const grey = Math.round(lightness * 255);
    return { red: grey, green: grey, blue: grey };
  }
  let chromaHigh: number;
  if (lightness < 0.5) {
    chromaHigh = lightness * (1 + saturation);
  } else {
    chromaHigh = lightness + saturation - lightness * saturation;
  }
  const chromaLow = 2 * lightness - chromaHigh;
  return {
    red: Math.round(hueToChannel(chromaLow, chromaHigh, hue + 1 / 3) * 255),
    green: Math.round(hueToChannel(chromaLow, chromaHigh, hue) * 255),
    blue: Math.round(hueToChannel(chromaLow, chromaHigh, hue - 1 / 3) * 255),
  };
}

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenContext: CanvasRenderingContext2D | null = null;

export function parseCssColor(color: string): RGB {
  const fromHex = hexToRgb(color);
  if (fromHex) {
    return fromHex;
  }

  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = offscreenCanvas.height = 1;
    offscreenContext = offscreenCanvas.getContext("2d")!;
  }
  offscreenContext!.fillStyle = color;
  offscreenContext!.fillRect(0, 0, 1, 1);
  const pixel = offscreenContext!.getImageData(0, 0, 1, 1).data;
  return { red: pixel[0], green: pixel[1], blue: pixel[2] };
}

const GOLDEN_ANGLE = 0.618033988749895;

const EDGE_HUE_ORIGIN = 0.58;

const EDGE_SATURATION = 0.18;

const EDGE_LIGHTNESS = 0.58;

const edgeColorCache: string[] = [];

export function edgeColor(index: number): string {
  const cached = edgeColorCache[index];
  if (cached !== undefined) {
    return cached;
  }
  const hue = (EDGE_HUE_ORIGIN + index * GOLDEN_ANGLE) % 1;
  const rgb = hslToRgb({
    hue,
    saturation: EDGE_SATURATION,
    lightness: EDGE_LIGHTNESS,
  });
  const result = rgbToHex(rgb);
  edgeColorCache[index] = result;
  return result;
}

const darkenedColorCache = new Map<string, string>();

export function darkenColor(color: string, amount: number): string {
  const cacheKey = `${color}_${amount}`;
  const cached = darkenedColorCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const rgb = parseCssColor(color);
  const hsl = rgbToHsl(rgb);
  const darkened = hslToRgb({
    hue: hsl.hue,
    saturation: hsl.saturation,
    lightness: Math.max(0, hsl.lightness - amount),
  });
  const result = rgbToHex(darkened);
  darkenedColorCache.set(cacheKey, result);
  return result;
}
