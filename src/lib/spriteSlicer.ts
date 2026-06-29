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

// ─── Output Spec ──────────────────────────────────────────────────────

export type SizeMode = "auto" | "fixed" | "aspect";
export type FitMode = "height" | "width" | "contain";

export interface OutputSpec {
  /** 출력 캔버스 크기 결정 방식 */
  sizeMode: SizeMode;

  // fixed 모드
  width?: number;
  height?: number;

  // aspect 모드
  aspectW?: number;
  aspectH?: number;
  longSide?: number;

  /** 캐릭터를 캔버스에 맞추는 방식 */
  fitMode: FitMode;

  /** 캐릭터가 캔버스에서 차지할 비율 (0~1, 기본 0.8) */
  fillRatio: number;

  /** 정렬 모드 */
  alignMode: AlignMode;

  /** 픽셀아트 스타일 유지 (imageSmoothingEnabled = false) */
  pixelArt?: boolean;
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

/**
 * 출력 규격을 적용하여 프레임 생성.
 * OutputSpec에 따라 캔버스 크기 결정 + 캐릭터 스케일 + 정렬.
 */
export function alignFramesWithSpec(
  cells: ImageData[],
  spec: OutputSpec
): SliceResult {
  const boxes = cells.map(c => getBoundingBox(c));

  // 빈 프레임 제거
  const validIndices = boxes.map((b, i) => b ? i : -1).filter(i => i >= 0);
  const validBoxes = validIndices.map(i => boxes[i]!);
  const validCells = validIndices.map(i => cells[i]);

  if (validBoxes.length === 0) {
    return { frames: [], canvasWidth: 0, canvasHeight: 0 };
  }

  // 1. 캐릭터 최대 크기 계산
  const maxCharW = Math.max(...validBoxes.map(b => b.right - b.left));
  const maxCharH = Math.max(...validBoxes.map(b => b.bottom - b.top));

  // 2. 출력 캔버스 크기 결정
  let canvasWidth: number;
  let canvasHeight: number;

  if (spec.sizeMode === "fixed" && spec.width && spec.height) {
    canvasWidth = spec.width;
    canvasHeight = spec.height;
  } else if (spec.sizeMode === "aspect" && spec.aspectW && spec.aspectH && spec.longSide) {
    const ratio = spec.aspectW / spec.aspectH;
    if (ratio >= 1) {
      // 가로가 긴 변
      canvasWidth = spec.longSide;
      canvasHeight = Math.round(spec.longSide / ratio);
    } else {
      // 세로가 긴 변
      canvasHeight = spec.longSide;
      canvasWidth = Math.round(spec.longSide * ratio);
    }
  } else {
    // auto: 기존 동작 (캐릭터 크기 기준, 여백은 fillRatio로 계산)
    const padding = Math.round(maxCharW * (1 - spec.fillRatio) / 2);
    canvasWidth = maxCharW + padding * 2;
    canvasHeight = maxCharH + padding * 2;
  }

  // 3. 공통 스케일 계산 (가장 큰 캐릭터 기준)
  const targetW = canvasWidth * spec.fillRatio;
  const targetH = canvasHeight * spec.fillRatio;

  let scale: number;
  if (spec.fitMode === "height") {
    scale = targetH / maxCharH;
  } else if (spec.fitMode === "width") {
    scale = targetW / maxCharW;
  } else {
    // contain: 캐릭터가 캔버스에 완전히 들어가도록
    scale = Math.min(targetW / maxCharW, targetH / maxCharH);
  }

  // 업스케일 경고 (1.5배 이상은 화질 저하)
  if (scale > 1.5) {
    console.warn(`[alignFramesWithSpec] 스케일 ${scale.toFixed(2)}x — 화질 저하 가능`);
  }

  // 4. 프레임 생성
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d")!;

  // 픽셀아트 모드
  ctx.imageSmoothingEnabled = spec.pixelArt !== true;

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

    // 크롭 캔버스 생성
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d")!;
    cropCtx.drawImage(tmpCanvas, box.left, box.top, cropW, cropH, 0, 0, cropW, cropH);

    // 스케일된 크기
    const scaledW = Math.round(cropW * scale);
    const scaledH = Math.round(cropH * scale);

    // 정렬된 캔버스에 배치
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const ox = Math.floor((canvasWidth - scaledW) / 2); // 가로 중앙
    let oy: number;
    if (spec.alignMode === "bottom") {
      // 발 기준: 바닥 정렬 (여백 = 캔버스 높이 * (1 - fillRatio) / 2)
      const bottomMargin = Math.floor(canvasHeight * (1 - spec.fillRatio) / 2);
      oy = canvasHeight - bottomMargin - scaledH;
    } else {
      oy = Math.floor((canvasHeight - scaledH) / 2); // 중심 정렬
    }

    // 스케일 적용하여 그리기
    ctx.drawImage(cropCanvas, 0, 0, cropW, cropH, ox, oy, scaledW, scaledH);
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

// ─── Magic Wand (Connected Components) ────────────────────────────────

export interface MagicWandOptions {
  chromaKey: ChromaKeyOptions;
  alignMode: AlignMode;
  padding: number;
  /** 캐릭터로 인정할 최소 픽셀 수 (기본 2000) */
  minBlobSize: number;
}

interface Blob {
  label: number;
  pixels: { x: number; y: number }[];
  centerX: number;
}

/**
 * 8방향 연결 요소(Connected Components) 라벨링.
 * BFS 기반 flood-fill로 불투명 픽셀 덩어리를 분리.
 */
export function connectedComponents(
  imageData: ImageData,
  alphaThreshold = 20
): { labeled: Int32Array; numLabels: number; sizes: number[] } {
  const { width, height, data } = imageData;
  const labeled = new Int32Array(width * height);
  let currentLabel = 0;
  const sizes: number[] = [];

  // 8방향 오프셋
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const alpha = data[idx * 4 + 3];

      // 이미 라벨링 됐거나 투명이면 스킵
      if (labeled[idx] !== 0 || alpha <= alphaThreshold) continue;

      // 새 덩어리 발견 — BFS
      currentLabel++;
      let size = 0;
      const queue: number[] = [idx];
      labeled[idx] = currentLabel;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        size++;
        const cx = cur % width;
        const cy = Math.floor(cur / width);

        for (let d = 0; d < 8; d++) {
          const nx = cx + dx[d];
          const ny = cy + dy[d];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (labeled[nidx] !== 0) continue;
          if (data[nidx * 4 + 3] <= alphaThreshold) continue;
          labeled[nidx] = currentLabel;
          queue.push(nidx);
        }
      }

      sizes.push(size);
    }
  }

  return { labeled, numLabels: currentLabel, sizes };
}

/**
 * 작은 조각(blob)을 가장 가까운 큰 덩어리에 병합.
 * x중심 거리 기준.
 */
export function mergeSmallBlobs(
  labeled: Int32Array,
  width: number,
  height: number,
  sizes: number[],
  minBlobSize: number
): { merged: Int32Array; blobs: Blob[] } {
  // 각 라벨의 픽셀 좌표 수집 & x중심 계산
  const labelData: Map<number, { pixels: { x: number; y: number }[]; sumX: number }> = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lbl = labeled[y * width + x];
      if (lbl === 0) continue;
      if (!labelData.has(lbl)) {
        labelData.set(lbl, { pixels: [], sumX: 0 });
      }
      const d = labelData.get(lbl)!;
      d.pixels.push({ x, y });
      d.sumX += x;
    }
  }

  // 큰 덩어리(캐릭터) 식별
  const bigLabels: { label: number; centerX: number }[] = [];
  const smallLabels: { label: number; centerX: number }[] = [];

  for (const [lbl, d] of labelData) {
    const centerX = d.sumX / d.pixels.length;
    if (sizes[lbl - 1] >= minBlobSize) {
      bigLabels.push({ label: lbl, centerX });
    } else {
      smallLabels.push({ label: lbl, centerX });
    }
  }

  // 큰 덩어리를 x좌표 기준 정렬
  bigLabels.sort((a, b) => a.centerX - b.centerX);

  // 작은 조각을 가장 가까운 큰 덩어리에 병합
  const labelMapping: Map<number, number> = new Map();
  for (const big of bigLabels) {
    labelMapping.set(big.label, big.label);
  }
  for (const small of smallLabels) {
    if (bigLabels.length === 0) {
      // 큰 덩어리가 없으면 그냥 유지
      labelMapping.set(small.label, small.label);
    } else {
      // 가장 가까운 큰 덩어리 찾기
      let nearest = bigLabels[0];
      let minDist = Math.abs(small.centerX - nearest.centerX);
      for (const big of bigLabels) {
        const dist = Math.abs(small.centerX - big.centerX);
        if (dist < minDist) {
          minDist = dist;
          nearest = big;
        }
      }
      labelMapping.set(small.label, nearest.label);
    }
  }

  // 병합된 라벨 배열 생성
  const merged = new Int32Array(width * height);
  for (let i = 0; i < labeled.length; i++) {
    const lbl = labeled[i];
    if (lbl === 0) continue;
    merged[i] = labelMapping.get(lbl) || lbl;
  }

  // 최종 blob 목록 (큰 덩어리 기준, x순 정렬)
  const blobs: Blob[] = bigLabels.map(b => ({
    label: b.label,
    pixels: [],
    centerX: b.centerX,
  }));

  // 병합된 픽셀 수집
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lbl = merged[y * width + x];
      if (lbl === 0) continue;
      const blob = blobs.find(b => b.label === lbl);
      if (blob) blob.pixels.push({ x, y });
    }
  }

  return { merged, blobs };
}

/**
 * 요술봉 모드 파이프라인: 크로마키 → 윤곽 분리 → 조각 병합 → 정렬.
 */
export function sliceSpriteByContour(
  imageData: ImageData,
  options: MagicWandOptions
): SliceResult {
  const { width, height } = imageData;

  // 1. 크로마키 적용
  applyChromaKey(imageData, options.chromaKey);

  // 2. Connected Components
  const { labeled, sizes } = connectedComponents(imageData);

  // 3. 작은 조각 병합
  const { blobs } = mergeSmallBlobs(labeled, width, height, sizes, options.minBlobSize);

  if (blobs.length === 0) {
    return { frames: [], canvasWidth: 0, canvasHeight: 0 };
  }

  // 4. 각 blob을 독립 ImageData로 추출
  const cells: ImageData[] = [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);

  for (const blob of blobs) {
    // blob의 바운딩 박스 계산
    let left = width, top = height, right = 0, bottom = 0;
    for (const p of blob.pixels) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
    right++;
    bottom++;

    const cellW = right - left;
    const cellH = bottom - top;

    // 이 blob의 픽셀만 포함하는 ImageData 생성
    const cellCanvas = document.createElement("canvas");
    cellCanvas.width = cellW;
    cellCanvas.height = cellH;
    const cellCtx = cellCanvas.getContext("2d")!;
    const cellData = cellCtx.createImageData(cellW, cellH);

    // blob 픽셀 좌표를 빠른 조회용 Set에 저장
    const pixelSet = new Set<string>();
    for (const p of blob.pixels) {
      pixelSet.add(`${p.x},${p.y}`);
    }

    // 원본에서 해당 영역 복사 (blob 픽셀만)
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = ((y - top) * cellW + (x - left)) * 4;

        if (pixelSet.has(`${x},${y}`)) {
          cellData.data[dstIdx] = imageData.data[srcIdx];
          cellData.data[dstIdx + 1] = imageData.data[srcIdx + 1];
          cellData.data[dstIdx + 2] = imageData.data[srcIdx + 2];
          cellData.data[dstIdx + 3] = imageData.data[srcIdx + 3];
        } else {
          // blob에 속하지 않는 픽셀은 투명
          cellData.data[dstIdx + 3] = 0;
        }
      }
    }

    cells.push(cellData);
  }

  // 5. 기존 alignFrames로 정렬 + 크기 통일
  return alignFrames(cells, options.alignMode, options.padding);
}
