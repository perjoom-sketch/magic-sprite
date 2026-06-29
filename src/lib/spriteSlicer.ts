/**
 * spriteSlicer.ts — 스프라이트 분할/크로마키/정렬 순수 함수.
 * 브라우저 Canvas API 전용. 서버 의존 없음.
 */

export type AlignMode = "bottom" | "center";

export interface ChromaKeyOptions {
  /** 타겟 배경색 [R, G, B] */
  targetColor: [number, number, number];
  /** 허용 범위 (기본 40) */
  tolerance: number;
}

export interface SliceOptions {
  columns: number;
  rows: number;
  chromaKey: ChromaKeyOptions;
  alignMode: AlignMode;
  padding: number;
}

export interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SliceResult {
  frames: ImageData[];
  canvasWidth: number;
  canvasHeight: number;
}

// ─── Grid Auto-Detection ──────────────────────────────────────────────

/**
 * 가로 투영(projection)으로 빈 열(gutter)을 감지하여 열 수 추정.
 * alpha < threshold 인 픽셀을 "빈" 으로 취급.
 */
export function detectColumns(imageData: ImageData, threshold = 20): number {
  const { width, height, data } = imageData;
  const colDensity = new Float32Array(width);

  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > threshold) count++;
    }
    colDensity[x] = count / height;
  }

  // gutter = 연속 0-density 구간
  const gutters: { start: number; end: number }[] = [];
  let inGutter = false;
  let gStart = 0;
  const gutterThreshold = 0.02; // 2% 미만이면 빈 열

  for (let x = 0; x < width; x++) {
    if (colDensity[x] < gutterThreshold) {
      if (!inGutter) { inGutter = true; gStart = x; }
    } else {
      if (inGutter) {
        gutters.push({ start: gStart, end: x });
        inGutter = false;
      }
    }
  }

  // gutter 수 + 1 = column 수 (양쪽 끝 빈 공간은 제외)
  // 유의미한 gutter만 카운트 (너비 > 2px)
  const significantGutters = gutters.filter(g => g.end - g.start > 2 && g.start > 5 && g.end < width - 5);
  return Math.max(1, significantGutters.length + 1);
}

/**
 * 세로 투영으로 행 수 추정.
 */
export function detectRows(imageData: ImageData, threshold = 20): number {
  const { width, height, data } = imageData;
  const rowDensity = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > threshold) count++;
    }
    rowDensity[y] = count / width;
  }

  const gutters: { start: number; end: number }[] = [];
  let inGutter = false;
  let gStart = 0;
  const gutterThreshold = 0.02;

  for (let y = 0; y < height; y++) {
    if (rowDensity[y] < gutterThreshold) {
      if (!inGutter) { inGutter = true; gStart = y; }
    } else {
      if (inGutter) {
        gutters.push({ start: gStart, end: y });
        inGutter = false;
      }
    }
  }

  const significantGutters = gutters.filter(g => g.end - g.start > 2 && g.start > 5 && g.end < height - 5);
  return Math.max(1, significantGutters.length + 1);
}

// ─── Chroma Key ───────────────────────────────────────────────────────

/**
 * 크로마키 적용. 타겟 배경색을 투명화하되, 캐릭터 색(피부/빨강/어두움/흰색)은 보호.
 * 원본 imageData를 직접 수정 (in-place).
 */
export function applyChromaKey(imageData: ImageData, options: ChromaKeyOptions): void {
  const { data } = imageData;
  const [tR, tG, tB] = options.targetColor;
  const tol = options.tolerance;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 색 보호: 캐릭터 픽셀로 판단되면 제거하지 않음
    const skin = r > 120 && (r - g) > 15;
    const red = r > 110 && (r - g) > 40 && (r - b) > 40;
    const dark = r < 90 && g < 90 && b < 90;
    const white = r > 150 && g > 150 && b > 150;
    const keep = skin || red || dark || white;

    if (keep) continue;

    // 배경 판정: 타겟 색과의 "강도" 비교
    let isBg = false;
    if (tR === 0 && tG > 100 && tB === 0) {
      // 녹색 배경: greenness 기반
      const greenness = g - Math.max(r, b);
      isBg = greenness > tol;
    } else {
      // 일반 색: 유클리드 거리
      const dist = Math.sqrt((r - tR) ** 2 + (g - tG) ** 2 + (b - tB) ** 2);
      isBg = dist < tol * 4;
    }

    if (isBg) {
      data[i + 3] = 0; // alpha = 0
    }
  }
}

// ─── Grid Split ───────────────────────────────────────────────────────

/**
 * 이미지를 columns × rows 균등 분할하여 각 셀의 ImageData 반환.
 */
export function splitGrid(
  imageData: ImageData,
  columns: number,
  rows: number
): ImageData[] {
  const { width, height } = imageData;
  const cellW = Math.floor(width / columns);
  const cellH = Math.floor(height / rows);
  const cells: ImageData[] = [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = col * cellW;
      const y = row * cellH;
      cells.push(ctx.getImageData(x, y, cellW, cellH));
    }
  }

  return cells;
}

// ─── Bounding Box ─────────────────────────────────────────────────────

/**
 * 불투명 픽셀(alpha > threshold)의 바운딩 박스 계산.
 */
export function getBoundingBox(imageData: ImageData, threshold = 20): BBox | null {
  const { width, height, data } = imageData;
  let left = width, top = height, right = 0, bottom = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > threshold) {
        found = true;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (!found) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

// ─── Align & Normalize ────────────────────────────────────────────────

/**
 * 셀들을 정렬 + 크기 통일하여 최종 프레임 생성.
 */
export function alignFrames(
  cells: ImageData[],
  alignMode: AlignMode,
  padding: number
): SliceResult {
  const boxes = cells.map(c => getBoundingBox(c));

  // 빈 프레임 제거
  const validIndices = boxes.map((b, i) => b ? i : -1).filter(i => i >= 0);
  const validBoxes = validIndices.map(i => boxes[i]!);
  const validCells = validIndices.map(i => cells[i]);

  if (validBoxes.length === 0) {
    return { frames: [], canvasWidth: 0, canvasHeight: 0 };
  }

  const maxW = Math.max(...validBoxes.map(b => b.right - b.left));
  const maxH = Math.max(...validBoxes.map(b => b.bottom - b.top));
  const canvasWidth = maxW + padding * 2;
  const canvasHeight = maxH + padding * 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d")!;

  const frames: ImageData[] = [];

  for (let i = 0; i < validCells.length; i++) {
    const cell = validCells[i];
    const box = validBoxes[i];
    const cropW = box.right - box.left;
    const cropH = box.bottom - box.top;

    // 셀에서 크롭 추출
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = cell.width;
    tmpCanvas.height = cell.height;
    const tmpCtx = tmpCanvas.getContext("2d")!;
    tmpCtx.putImageData(cell, 0, 0);
    const cropData = tmpCtx.getImageData(box.left, box.top, cropW, cropH);

    // 정렬된 캔버스에 배치
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const ox = Math.floor((canvasWidth - cropW) / 2); // 가로 중앙
    let oy: number;
    if (alignMode === "bottom") {
      oy = canvasHeight - padding - cropH; // 발 기준: 바닥 정렬
    } else {
      oy = Math.floor((canvasHeight - cropH) / 2); // 중심 정렬
    }

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d")!;
    cropCtx.putImageData(cropData, 0, 0);

    ctx.drawImage(cropCanvas, ox, oy);
    frames.push(ctx.getImageData(0, 0, canvasWidth, canvasHeight));
  }

  return { frames, canvasWidth, canvasHeight };
}

// ─── Full Pipeline ────────────────────────────────────────────────────

/**
 * 전체 파이프라인: 이미지 → 크로마키 → 분할 → 정렬 → 프레임 배열.
 */
export function sliceSprite(imageData: ImageData, options: SliceOptions): SliceResult {
  // 1. 크로마키 적용
  applyChromaKey(imageData, options.chromaKey);

  // 2. 그리드 분할
  const cells = splitGrid(imageData, options.columns, options.rows);

  // 3. 정렬 + 크기 통일
  return alignFrames(cells, options.alignMode, options.padding);
}

// ─── Grid Auto-Detect (from raw RGB, before chroma key) ───────────────

/**
 * 원본 이미지(크로마키 전)에서 그리드 자동 감지.
 * 크로마키 적용 후의 alpha가 아닌, 원본 RGB 밝기 변화로 gutter 감지.
 */
export function autoDetectGrid(imageData: ImageData): { columns: number; rows: number } {
  // 크로마키를 가볍게 적용한 복사본으로 감지
  const copy = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  // 기본 녹색 크로마키로 알파 세팅
  applyChromaKey(copy, { targetColor: [0, 255, 0], tolerance: 40 });

  const columns = detectColumns(copy);
  const rows = detectRows(copy);
  return { columns, rows };
}
