/**
 * videoFrameExtractor.ts — 브라우저에서 영상 프레임 추출.
 * <video> + <canvas>로 순수 클라이언트 처리. 서버/ffmpeg 없음.
 */

export interface ExtractOptions {
  /** 추출 fps (기본 8) */
  fps: number;
  /** 시작 시간 (초) */
  startSec?: number;
  /** 종료 시간 (초) */
  endSec?: number;
}

export interface ExtractResult {
  frames: ImageData[];
  width: number;
  height: number;
  /** 실제 추출된 프레임 수 */
  frameCount: number;
}

/**
 * 영상에서 프레임 추출.
 * video.currentTime을 (1/fps) 간격으로 이동 → seeked 후 canvas에 그려 ImageData 수집.
 */
export async function extractFrames(
  videoUrl: string,
  options: ExtractOptions
): Promise<ExtractResult> {
  const { fps, startSec = 0, endSec } = options;

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const end = endSec !== undefined ? Math.min(endSec, duration) : duration;
      const start = Math.max(0, startSec);

      if (start >= end) {
        reject(new Error("시작 시간이 종료 시간보다 크거나 같습니다."));
        return;
      }

      const width = video.videoWidth;
      const height = video.videoHeight;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;

      const frames: ImageData[] = [];
      const interval = 1 / fps;
      let currentTime = start;

      const seekAndCapture = (): Promise<void> => {
        return new Promise((res) => {
          if (currentTime >= end) {
            res();
            return;
          }

          video.currentTime = currentTime;

          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            ctx.drawImage(video, 0, 0, width, height);
            frames.push(ctx.getImageData(0, 0, width, height));
            currentTime += interval;
            res();
          };

          video.addEventListener("seeked", onSeeked);
        });
      };

      // 순차적으로 프레임 추출
      while (currentTime < end) {
        await seekAndCapture();
      }

      // 정리
      video.src = "";
      video.load();

      resolve({
        frames,
        width,
        height,
        frameCount: frames.length,
      });
    };

    video.onerror = () => {
      reject(new Error("영상 로드 실패"));
    };

    video.src = videoUrl;
    video.load();
  });
}

/**
 * 영상 메타데이터 가져오기 (duration, width, height).
 */
export async function getVideoMetadata(
  videoUrl: string
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      video.src = "";
      video.load();
    };

    video.onerror = () => {
      reject(new Error("영상 메타데이터 로드 실패"));
    };

    video.src = videoUrl;
    video.load();
  });
}
