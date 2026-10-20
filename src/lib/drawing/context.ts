export type TextAlignment = "left" | "right" | "center" | "start" | "end";
export type TextBaseline =
  "top" | "hanging" | "middle" | "alphabetic" | "ideographic" | "bottom";

export interface DrawingContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  font: string;
  textAlign: TextAlignment;
  textBaseline: TextBaseline;
  globalAlpha: number;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "bevel" | "miter" | "round";
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(
    firstX: number,
    firstY: number,
    secondX: number,
    secondY: number,
    radius: number,
  ): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
  quadraticCurveTo(
    controlX: number,
    controlY: number,
    x: number,
    y: number,
  ): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fill(): void;
  stroke(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  setTransform(
    horizontalScale: number,
    horizontalSkew: number,
    verticalSkew: number,
    verticalScale: number,
    offsetX: number,
    offsetY: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): {
    readonly actualBoundingBoxLeft: number;
    readonly actualBoundingBoxRight: number;
    readonly actualBoundingBoxAscent: number;
    readonly actualBoundingBoxDescent: number;
  };
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { readonly data: ArrayLike<number> };
}
