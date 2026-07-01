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

interface VideoUploadProps {
  /** 프레임 추출 완료 시 호출 */
  onFramesExtracted: (frames: ImageData[]) => void;
}


export default function VideoUpload({ onFramesExtracted }: VideoUploadProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [isGif, setIsGif] = useState(false);
  const [gifFrameCount, setGifFrameCount] = useState(0);

  // 디코딩된 전체 프레임 (타임라인용)
  const [allFrames, setAllFrames] = useState<ImageData[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);  // 타임라인용 (작은 썸네일)
  const [previews, setPreviews] = useState<string[]>([]);      // 미리보기용 (원본 해상도)
  const [decoding, setDecoding] = useState(false);

  // 트림 설정 (인덱스 기반)
  const [trimStartIdx, setTrimStartIdx] = useState(0);
  const [trimEndIdx, setTrimEndIdx] = useState(0);

  // 비디오용 트림 (시간 기반)
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // 추출 설정
  const [fps, setFps] = useState(8);

  // 상태
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loopIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);

  // 타임라인 폭 측정
  useEffect(() => {
    const updateWidth = () => {
      if (timelineRef.current) {
        setTimelineWidth(timelineRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [thumbnails.length]);

  // 썸네일 폭 계산 (화면 폭 ÷ 프레임 수, 스크롤 없음)
  const thumbWidth = thumbnails.length > 0 && timelineWidth > 0
    ? Math.max(4, timelineWidth / thumbnails.length)
    : 48;

  // ImageData를 이미지 URL로 변환
  const frameToDataUrl = useCallback((frame: ImageData, maxSize?: number): string => {
    // 원본 크기 캔버스에 ImageData 그리기
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = frame.width;
    tempCanvas.height = frame.height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(frame, 0, 0);

    // maxSize가 지정되면 축소, 아니면 원본 크기
    if (maxSize && (frame.width > maxSize || frame.height > maxSize)) {
      const canvas = document.createElement("canvas");
      const scale = Math.min(maxSize / frame.width, maxSize / frame.height);
      canvas.width = Math.floor(frame.width * scale);
      canvas.height = Math.floor(frame.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    }

    return tempCanvas.toDataURL("image/png");
  }, []);

  // 파일 업로드
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 이전 URL 해제
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    // 상태 초기화
    setAllFrames([]);
    setThumbnails([]);
    setPreviews([]);
    setTrimStartIdx(0);
    setTrimEndIdx(0);
    setLooping(false);

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

        // GIF 전체 프레임 디코딩 + 타임라인 생성
        setDecoding(true);
        try {
          const gifResult = await extractGifFrames(url);
          setAllFrames(gifResult.frames);
          setTrimStartIdx(0);
          setTrimEndIdx(gifResult.frames.length);

          // 타임라인용 썸네일 (60px) + 미리보기용 (원본 해상도)
          const thumbs = gifResult.frames.map((f) => frameToDataUrl(f, 60));
          const prevs = gifResult.frames.map((f) => frameToDataUrl(f));
          setThumbnails(thumbs);
          setPreviews(prevs);
        } finally {
          setDecoding(false);
        }
      } else {
        const meta = await getVideoMetadata(url);
        setDuration(meta.duration);
        setVideoWidth(meta.width);
        setVideoHeight(meta.height);
        setGifFrameCount(0);
        setTrimStart(0);
        setTrimEnd(meta.duration);

        // 비디오는 먼저 전체 프레임 추출
        setDecoding(true);
        try {
          const result = await extractFrames(url, { fps, startSec: 0, endSec: meta.duration });
          setAllFrames(result.frames);
          setTrimStartIdx(0);
          setTrimEndIdx(result.frames.length);

          // 타임라인용 썸네일 (60px) + 미리보기용 (원본 해상도)
          const thumbs = result.frames.map((f) => frameToDataUrl(f, 60));
          const prevs = result.frames.map((f) => frameToDataUrl(f));
          setThumbnails(thumbs);
          setPreviews(prevs);
        } finally {
          setDecoding(false);
        }
      }
    } catch (err) {
      setError(fileIsGif ? "GIF 메타데이터를 읽을 수 없습니다." : "영상 메타데이터를 읽을 수 없습니다.");
    }
  };

  // 구간 루프 프리뷰 (프레임 인덱스 기반)
  useEffect(() => {
    if (!looping || allFrames.length === 0) {
      if (loopIntervalRef.current) {
        clearInterval(loopIntervalRef.current);
        loopIntervalRef.current = null;
      }
      return;
    }

    const startIdx = trimStartIdx;
    const endIdx = Math.max(trimStartIdx + 1, trimEndIdx);
    let currentIdx = startIdx;
    setPreviewIdx(currentIdx);

    // 프레임 간격 (약 100ms = 10fps)
    loopIntervalRef.current = setInterval(() => {
      currentIdx++;
      if (currentIdx >= endIdx) {
        currentIdx = startIdx;
      }
      setPreviewIdx(currentIdx);
    }, 100);

    return () => {
      if (loopIntervalRef.current) {
        clearInterval(loopIntervalRef.current);
        loopIntervalRef.current = null;
      }
    };
  }, [looping, trimStartIdx, trimEndIdx, allFrames.length]);

  // 트림 핸들 변경
  const handleTrimStartIdxChange = (value: number) => {
    const newStart = Math.min(value, trimEndIdx - 1);
    setTrimStartIdx(Math.max(0, newStart));
  };

  const handleTrimEndIdxChange = (value: number) => {
    const newEnd = Math.max(value, trimStartIdx + 1);
    setTrimEndIdx(Math.min(allFrames.length, newEnd));
  };

  // 드래그로 핸들 위치 계산
  const getIndexFromMouseX = useCallback((clientX: number): number => {
    if (!timelineRef.current || thumbnails.length === 0) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const idx = Math.floor(x / thumbWidth);
    return Math.max(0, Math.min(thumbnails.length - 1, idx));
  }, [thumbnails.length, thumbWidth]);

  // 드래그 이벤트 핸들러
  const handleMouseDown = (handle: "start" | "end") => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(handle);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const idx = getIndexFromMouseX(e.clientX);
    if (dragging === "start") {
      handleTrimStartIdxChange(idx);
    } else {
      handleTrimEndIdxChange(idx + 1);
    }
  }, [dragging, getIndexFromMouseX]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // 드래그 이벤트 등록
  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // 프레임 추출 (트림된 구간만)
  const handleExtract = async () => {
    if (allFrames.length === 0) {
      setError("먼저 영상을 업로드하세요.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // 트림된 프레임만 추출 (인덱스 기반 slice, 크로마키는 SpriteSlicer에서 적용)
      const frames = allFrames.slice(trimStartIdx, trimEndIdx);

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

  // 선택된 프레임 수 (트림 구간)
  const selectedFrameCount = Math.max(0, trimEndIdx - trimStartIdx);

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

      {/* 디코딩 상태 */}
      {decoding && (
        <div className="p-4 bg-zinc-800 rounded text-center">
          <div className="text-sm text-zinc-400">프레임 디코딩 중...</div>
        </div>
      )}

      {/* 프레임 프리뷰 + 타임라인 */}
      {videoUrl && thumbnails.length > 0 && !decoding && (
        <>
          {/* 시작/끝 프레임 미리보기 (2개 나란히, 원본 해상도) */}
          <div className="grid grid-cols-2 gap-4">
            {/* 시작 프레임 */}
            <div className="bg-zinc-800 rounded p-4">
              {previews[trimStartIdx] && (
                <img
                  src={previews[trimStartIdx]}
                  alt={`Start Frame ${trimStartIdx}`}
                  className="w-full max-h-80 object-contain mx-auto rounded"
                />
              )}
              <div className="text-center text-xs text-green-400 mt-2 font-medium">
                시작: {trimStartIdx}번
              </div>
            </div>

            {/* 끝 프레임 */}
            <div className="bg-zinc-800 rounded p-4">
              {previews[trimEndIdx - 1] && (
                <img
                  src={previews[trimEndIdx - 1]}
                  alt={`End Frame ${trimEndIdx - 1}`}
                  className="w-full max-h-80 object-contain mx-auto rounded"
                />
              )}
              <div className="text-center text-xs text-red-400 mt-2 font-medium">
                끝: {trimEndIdx - 1}번
              </div>
            </div>
          </div>

          {/* 구간 루프 재생 중일 때 현재 프레임 표시 */}
          {looping && (
            <div className="text-center text-xs text-blue-400">
              루프 재생 중: {previewIdx}번 프레임
            </div>
          )}

          {/* 타임라인 썸네일 스트립 + 트림 핸들 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                타임라인 (전체 {allFrames.length}프레임)
              </label>
              <button
                onClick={() => setLooping(!looping)}
                className={`px-3 py-1 text-xs rounded ${
                  looping ? "bg-blue-600" : "bg-zinc-700 hover:bg-zinc-600"
                }`}
              >
                {looping ? "⏸ 루프 정지" : "▶ 구간 루프"}
              </button>
            </div>

            {/* 타임라인 컨테이너 (핸들 포함, 스크롤 없음) */}
            <div
              ref={timelineRef}
              className="relative w-full h-14 bg-zinc-900 rounded overflow-hidden"
              style={{ cursor: dragging ? "grabbing" : "default" }}
            >
              {/* 썸네일 스트립 (100% 폭, 스크롤 없음) */}
              <div className="flex h-full">
                {thumbnails.map((thumb, idx) => {
                  const isSelected = idx >= trimStartIdx && idx < trimEndIdx;
                  return (
                    <div
                      key={idx}
                      className={`relative h-full flex-shrink-0 transition-opacity ${
                        isSelected ? "opacity-100" : "opacity-30"
                      }`}
                      style={{ width: `${thumbWidth}px` }}
                    >
                      <img
                        src={thumb}
                        alt={`Frame ${idx}`}
                        className="w-full h-full object-cover"
                        style={{ imageRendering: "pixelated" }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* 시작 핸들 (녹색) */}
              <div
                className="absolute top-0 bottom-0 w-2 bg-green-500 cursor-ew-resize z-10 flex items-center justify-center hover:bg-green-400 transition-colors"
                style={{
                  left: `${trimStartIdx * thumbWidth}px`,
                  borderRadius: "2px 0 0 2px"
                }}
                onMouseDown={handleMouseDown("start")}
              >
                <div className="w-0.5 h-8 bg-white/70 rounded" />
              </div>

              {/* 끝 핸들 (빨간색) */}
              <div
                className="absolute top-0 bottom-0 w-2 bg-red-500 cursor-ew-resize z-10 flex items-center justify-center hover:bg-red-400 transition-colors"
                style={{
                  left: `${trimEndIdx * thumbWidth - 8}px`,
                  borderRadius: "0 2px 2px 0"
                }}
                onMouseDown={handleMouseDown("end")}
              >
                <div className="w-0.5 h-8 bg-white/70 rounded" />
              </div>

              {/* 선택 영역 상단 바 */}
              <div
                className="absolute top-0 h-1 bg-blue-400 z-5"
                style={{
                  left: `${trimStartIdx * thumbWidth + 8}px`,
                  width: `${Math.max(0, (trimEndIdx - trimStartIdx) * thumbWidth - 16)}px`
                }}
              />

              {/* 선택 영역 하단 바 */}
              <div
                className="absolute bottom-0 h-1 bg-blue-400 z-5"
                style={{
                  left: `${trimStartIdx * thumbWidth + 8}px`,
                  width: `${Math.max(0, (trimEndIdx - trimStartIdx) * thumbWidth - 16)}px`
                }}
              />
            </div>

            {/* 선택 정보 텍스트 */}
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                시작: <span className="text-green-400 font-medium">{trimStartIdx}번</span>
              </span>
              <span className="text-zinc-500">
                선택: {selectedFrameCount}프레임 ({trimStartIdx}~{trimEndIdx - 1})
              </span>
              <span>
                끝: <span className="text-red-400 font-medium">{trimEndIdx - 1}번</span>
              </span>
            </div>
          </div>

          {/* 추출 정보 */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">
              선택 프레임: <span className="text-white font-medium">{selectedFrameCount}장</span>
              <span className="text-zinc-500 ml-2">(인덱스 {trimStartIdx}~{trimEndIdx - 1})</span>
            </span>
            <span className="text-xs text-zinc-500">
              배경 제거는 아래 스프라이트 오리기에서 진행
            </span>
          </div>

          {/* 추출 버튼 */}
          <button
            onClick={handleExtract}
            disabled={processing || selectedFrameCount === 0}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded font-medium"
          >
            {processing ? "추출 중..." : `구간 추출 (${selectedFrameCount}장)`}
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
