import type { DrawingContext } from "./context.ts";
interface RGB {
  red: number;
  green: number;
  blue: number;
}

interface RGBA extends RGB {
  alpha: number;
}

interface HSL {
  hue: number;
  saturation: number;
  lightness: number;
}

function hexToRgb(hex: string): RGBA | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    return null;
  }
  return {
    red: parseInt(match[1], 16),
    green: parseInt(match[2], 16),
    blue: parseInt(match[3], 16),
    alpha: 1,
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

const GOLDEN_ANGLE = 0.618033988749895;

const EDGE_HUE_ORIGIN = 0.58;

const EDGE_SATURATION = 0.18;

const EDGE_LIGHTNESS = 0.58;

export class ColorPalette {
  private readonly edgeColorCache: string[] = [];
  private readonly darkenedColorCache = new Map<string, string>();
  private readonly context: DrawingContext;

  constructor(context: DrawingContext) {
    this.context = context;
  }

  parseCssColor(color: string): RGBA {
    const fromHex = hexToRgb(color);
    if (fromHex) return fromHex;
    const context = this.context;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return {
      red: pixel[0],
      green: pixel[1],
      blue: pixel[2],
      alpha: pixel[3] / 255,
    };
  }

  normalizedColor(color: string): [number, number, number] {
    const parsed = this.parseCssColor(color);
    return [parsed.red / 255, parsed.green / 255, parsed.blue / 255];
  }

  edgeColor(index: number): string {
    const cached = this.edgeColorCache[index];
    if (cached !== undefined) return cached;
    const hue = (EDGE_HUE_ORIGIN + index * GOLDEN_ANGLE) % 1;
    const result = rgbToHex(
      hslToRgb({ hue, saturation: EDGE_SATURATION, lightness: EDGE_LIGHTNESS }),
    );
    this.edgeColorCache[index] = result;
    return result;
  }

  darkenColor(color: string, amount: number): string {
    const cacheKey = `${color}_${amount}`;
    const cached = this.darkenedColorCache.get(cacheKey);
    if (cached) return cached;
    const hsl = rgbToHsl(this.parseCssColor(color));
    const result = rgbToHex(
      hslToRgb({
        hue: hsl.hue,
        saturation: hsl.saturation,
        lightness: Math.max(0, hsl.lightness - amount),
      }),
    );
    this.darkenedColorCache.set(cacheKey, result);
    return result;
  }
}
