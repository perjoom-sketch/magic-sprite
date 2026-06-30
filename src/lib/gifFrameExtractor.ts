/**
 * gifFrameExtractor.ts — 브라우저에서 GIF 프레임 추출.
 * gifuct-js를 사용하여 순수 클라이언트 처리.
 */

import { parseGIF, decompressFrames } from "gifuct-js";

export interface GifExtractResult {
  frames: ImageData[];
  width: number;
  height: number;
  frameCount: number;
  /** 각 프레임의 지연 시간 (ms) */
  delays: number[];
}

/**
 * GIF 파일에서 프레임 추출.
 */
export async function extractGifFrames(
  gifUrl: string
): Promise<GifExtractResult> {
  // GIF 파일을 ArrayBuffer로 가져오기
  const response = await fetch(gifUrl);
  if (!response.ok) {
    throw new Error("GIF 로드 실패");
  }
  const arrayBuffer = await response.arrayBuffer();

  // GIF 파싱
  const gif = parseGIF(arrayBuffer);
  const decompressedFrames = decompressFrames(gif, true);

  if (decompressedFrames.length === 0) {
    throw new Error("GIF에서 프레임을 찾을 수 없습니다.");
  }

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  // 캔버스를 사용하여 프레임 합성
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const frames: ImageData[] = [];
  const delays: number[] = [];

  // 이전 프레임을 저장할 캔버스 (dispose method 처리용)
  const prevCanvas = document.createElement("canvas");
  prevCanvas.width = width;
  prevCanvas.height = height;
  const prevCtx = prevCanvas.getContext("2d")!;

  for (const frame of decompressedFrames) {
    const { dims, patch, disposalType, delay } = frame;

    // 프레임 패치를 ImageData로 변환
    const frameImageData = new ImageData(
      new Uint8ClampedArray(patch),
      dims.width,
      dims.height
    );

    // 임시 캔버스에 프레임 패치 그리기
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = dims.width;
    tempCanvas.height = dims.height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(frameImageData, 0, 0);

    // 메인 캔버스에 프레임 그리기
    ctx.drawImage(tempCanvas, dims.left, dims.top);

    // 현재 프레임 저장
    frames.push(ctx.getImageData(0, 0, width, height));
    delays.push(delay);

    // disposal method 처리
    if (disposalType === 2) {
      // 배경으로 복원
      ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
    } else if (disposalType === 3) {
      // 이전 상태로 복원
      ctx.drawImage(prevCanvas, 0, 0);
    } else {
      // 현재 상태를 이전 상태로 저장
      prevCtx.clearRect(0, 0, width, height);
      prevCtx.drawImage(canvas, 0, 0);
    }
  }

  return {
    frames,
    width,
    height,
    frameCount: frames.length,
    delays,
  };
}

/**
 * GIF 메타데이터 가져오기.
 */
export async function getGifMetadata(
  gifUrl: string
): Promise<{ duration: number; width: number; height: number; frameCount: number }> {
  const response = await fetch(gifUrl);
  if (!response.ok) {
    throw new Error("GIF 로드 실패");
  }
  const arrayBuffer = await response.arrayBuffer();

  const gif = parseGIF(arrayBuffer);
  const decompressedFrames = decompressFrames(gif, true);

  // 총 duration 계산 (각 프레임 delay의 합, ms → s)
  const totalDelayMs = decompressedFrames.reduce(
    (sum, frame) => sum + (frame.delay || 100),
    0
  );

  return {
    duration: totalDelayMs / 1000,
    width: gif.lsd.width,
    height: gif.lsd.height,
    frameCount: decompressedFrames.length,
  };
}
