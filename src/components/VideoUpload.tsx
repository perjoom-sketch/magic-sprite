"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  extractFrames,
  getVideoMetadata,
  type ExtractResult,
} from "@/lib/videoFrameExtractor";
import {
  extractGifFrames,
  getGifMetadata,
} from "@/lib/gifFrameExtractor";
import { applyChromaKey } from "@/lib/spriteSlicer";

interface VideoUploadProps {
  /** 프레임 추출 완료 시 호출 */
  onFramesExtracted: (frames: ImageData[]) => void;
}

const CHROMA_PRESETS: { label: string; color: [number, number, number] }[] = [
  { label: "녹색", color: [0, 255, 0] },
  { label: "검정", color: [0, 0, 0] },
  { label: "흰색", color: [255, 255, 255] },
];

export default function VideoUpload({ onFramesExtracted }: VideoUploadProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [isGif, setIsGif] = useState(false);
  const [gifFrameCount, setGifFrameCount] = useState(0);

  // 트림 설정
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // 추출 설정
  const [fps, setFps] = useState(8);
  const [useChromaKey, setUseChromaKey] = useState(true);
  const [chromaColor, setChromaColor] = useState<[number, number, number]>([0, 255, 0]);
  const [tolerance, setTolerance] = useState(40);

  // 상태
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 파일 업로드
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 이전 URL 해제
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setError(null);

    // GIF 여부 확인
    const fileIsGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
    setIsGif(fileIsGif);

    try {
      if (fileIsGif) {
        const meta = await getGifMetadata(url);
        setDuration(meta.duration);
        setVideoWidth(meta.width);
        setVideoHeight(meta.height);
        setGifFrameCount(meta.frameCount);
        setTrimStart(0);
        setTrimEnd(meta.duration);
      } else {
        const meta = await getVideoMetadata(url);
        setDuration(meta.duration);
        setVideoWidth(meta.width);
        setVideoHeight(meta.height);
        setGifFrameCount(0);
        setTrimStart(0);
        setTrimEnd(meta.duration);
      }
    } catch (err) {
      setError(fileIsGif ? "GIF 메타데이터를 읽을 수 없습니다." : "영상 메타데이터를 읽을 수 없습니다.");
    }
  };

  // 루프 재생 제어
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !looping) return;

    const checkLoop = () => {
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart;
      }
    };

    video.currentTime = trimStart;
    video.play();

    const interval = setInterval(checkLoop, 50);
    return () => {
      clearInterval(interval);
      video.pause();
    };
  }, [looping, trimStart, trimEnd]);

  // 트림 범위 변경 시 비디오 위치 이동
  const handleTrimStartChange = (value: number) => {
    setTrimStart(value);
    if (videoRef.current && !looping) {
      videoRef.current.currentTime = value;
    }
  };

  const handleTrimEndChange = (value: number) => {
    setTrimEnd(value);
  };

  // 프레임 추출
  const handleExtract = async () => {
    if (!videoUrl) return;

    setProcessing(true);
    setError(null);

    try {
      let frames: ImageData[];

      if (isGif) {
        // GIF 프레임 추출 (전체 프레임 추출 후 필요시 샘플링)
        const gifResult = await extractGifFrames(videoUrl);
        frames = gifResult.frames;

        // FPS에 따른 프레임 샘플링 (GIF의 원래 프레임 수가 많을 경우)
        if (fps < gifResult.frameCount / duration) {
          const targetFrameCount = Math.floor(duration * fps);
          const step = gifResult.frameCount / targetFrameCount;
          const sampledFrames: ImageData[] = [];
          for (let i = 0; i < targetFrameCount; i++) {
            const idx = Math.min(Math.floor(i * step), gifResult.frameCount - 1);
            sampledFrames.push(frames[idx]);
          }
          frames = sampledFrames;
        }
      } else {
        // 비디오 프레임 추출
        const result = await extractFrames(videoUrl, {
          fps,
          startSec: trimStart,
          endSec: trimEnd,
        });
        frames = result.frames;
      }

      // 크로마키 적용
      if (useChromaKey) {
        frames = frames.map((frame) => {
          const copy = new ImageData(
            new Uint8ClampedArray(frame.data),
            frame.width,
            frame.height
          );
          applyChromaKey(copy, { targetColor: chromaColor, tolerance });
          return copy;
        });
      }

      if (frames.length === 0) {
        setError("프레임을 추출할 수 없습니다. 트림 범위를 확인해주세요.");
      } else {
        onFramesExtracted(frames);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "프레임 추출 실패");
    } finally {
      setProcessing(false);
    }
  };

  const estimatedFrames = isGif
    ? gifFrameCount
    : Math.max(0, Math.floor((trimEnd - trimStart) * fps));

  return (
    <div className="space-y-4">
      {/* 업로드 */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
        >
          영상 업로드 (.mp4, .webm, .gif)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,image/gif"
          onChange={handleUpload}
          className="hidden"
        />
        {videoUrl && (
          <span className="text-xs text-zinc-400">
            {videoWidth}×{videoHeight} · {duration.toFixed(2)}초
            {isGif && ` · ${gifFrameCount}프레임`}
          </span>
        )}
      </div>

      {/* 비디오/GIF 프리뷰 */}
      {videoUrl && (
        <>
          <div className="bg-zinc-800 rounded p-4">
            {isGif ? (
              <img
                src={videoUrl}
                alt="GIF Preview"
                className="max-w-full max-h-64 mx-auto rounded"
              />
            ) : (
              <video
                ref={videoRef}
                src={videoUrl}
                className="max-w-full max-h-64 mx-auto rounded"
                controls={!looping}
                muted
                playsInline
              />
            )}
          </div>

          {/* 트림 설정 - 비디오 전용 */}
          {!isGif && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">트림 (한 보폭 주기 선택)</label>
                <button
                  onClick={() => setLooping(!looping)}
                  className={`px-3 py-1 text-xs rounded ${
                    looping ? "bg-blue-600" : "bg-zinc-700 hover:bg-zinc-600"
                  }`}
                >
                  {looping ? "⏸ 루프 정지" : "▶ 루프 재생"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    시작: {trimStart.toFixed(2)}초
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.01}
                    value={trimStart}
                    onChange={(e) => handleTrimStartChange(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    종료: {trimEnd.toFixed(2)}초
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.01}
                    value={trimEnd}
                    onChange={(e) => handleTrimEndChange(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                선택 구간: {(trimEnd - trimStart).toFixed(2)}초
              </div>
            </div>
          )}

          {/* 추출 설정 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {isGif ? (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  GIF 프레임: {gifFrameCount}장
                </label>
                <div className="text-xs text-zinc-500 mt-2">
                  전체 프레임 추출됨
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  FPS: {fps} (예상 {estimatedFrames}프레임)
                </label>
                <input
                  type="range"
                  min={4}
                  max={30}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Tolerance</label>
              <input
                type="range"
                min={10}
                max={100}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-xs text-zinc-500">{tolerance}</span>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">크로마키 색</label>
              <div className="flex gap-1">
                {CHROMA_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setChromaColor(preset.color)}
                    className={`w-7 h-7 rounded border-2 ${
                      JSON.stringify(chromaColor) === JSON.stringify(preset.color)
                        ? "border-blue-400"
                        : "border-zinc-600"
                    }`}
                    style={{
                      backgroundColor: `rgb(${preset.color.join(",")})`,
                    }}
                    title={preset.label}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useChromaKey}
                  onChange={(e) => setUseChromaKey(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm">크로마키 적용</span>
              </label>
            </div>
          </div>

          {/* 추출 버튼 */}
          <button
            onClick={handleExtract}
            disabled={processing || (!isGif && trimStart >= trimEnd)}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded font-medium"
          >
            {processing ? "추출 중..." : `프레임 추출 (${isGif ? "" : "약 "}${estimatedFrames}장)`}
          </button>
        </>
      )}

      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
