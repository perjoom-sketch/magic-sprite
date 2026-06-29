"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  sliceSprite,
  sliceSpriteByContour,
  autoDetectGrid,
  type SliceOptions,
  type MagicWandOptions,
  type AlignMode,
  type SliceResult,
} from "@/lib/spriteSlicer";
import JSZip from "jszip";

interface SpriteSlicerProps {
  /** 생성 결과 이미지 URL (fal.media 등 외부) */
  source?: string | null;
}

const CHROMA_PRESETS: { label: string; color: [number, number, number] }[] = [
  { label: "녹색", color: [0, 255, 0] },
  { label: "검정", color: [0, 0, 0] },
  { label: "흰색", color: [255, 255, 255] },
];

type SliceMode = "grid" | "magicWand";

export default function SpriteSlicer({ source }: SpriteSlicerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sliceMode, setSliceMode] = useState<SliceMode>("grid");
  const [columns, setColumns] = useState(6);
  const [rows, setRows] = useState(1);
  const [minBlobSize, setMinBlobSize] = useState(2000);
  const [chromaColor, setChromaColor] = useState<[number, number, number]>([0, 255, 0]);
  const [tolerance, setTolerance] = useState(40);
  const [alignMode, setAlignMode] = useState<AlignMode>("bottom");
  const [padding, setPadding] = useState(12);
  const [prefix, setPrefix] = useState("adam_walk");
  const [result, setResult] = useState<SliceResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);
  const [animFrame, setAnimFrame] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animRef = useRef<number | null>(null);

  // source가 바뀌면 자동 적용
  useEffect(() => {
    if (source) setImageUrl(source);
  }, [source]);

  // 애니메이션 루프
  useEffect(() => {
    if (!animating || !result || result.frames.length === 0) return;
    let frame = 0;
    const interval = setInterval(() => {
      frame = (frame + 1) % result.frames.length;
      setAnimFrame(frame);
    }, 120);
    return () => clearInterval(interval);
  }, [animating, result]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setResult(null);
    setError(null);
  };

  const loadImageData = useCallback(async (url: string): Promise<ImageData | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        try {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(data);
        } catch {
          // Tainted canvas (CORS fail)
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }, []);

  const handleAutoDetect = async () => {
    if (!imageUrl) return;
    setError(null);
    const data = await loadImageData(imageUrl);
    if (!data) {
      setError("CORS 오류: 이미지를 직접 업로드해주세요.");
      return;
    }
    const detected = autoDetectGrid(data);
    setColumns(detected.columns);
    setRows(detected.rows);
  };

  const handleSlice = async () => {
    if (!imageUrl) return;
    setProcessing(true);
    setError(null);
    setResult(null);

    const data = await loadImageData(imageUrl);
    if (!data) {
      setError("CORS 오류: 이미지를 직접 업로드해주세요.");
      setProcessing(false);
      return;
    }

    try {
      let sliceResult: SliceResult;

      if (sliceMode === "magicWand") {
        const options: MagicWandOptions = {
          chromaKey: { targetColor: chromaColor, tolerance },
          alignMode,
          padding,
          minBlobSize,
        };
        sliceResult = sliceSpriteByContour(data, options);
      } else {
        const options: SliceOptions = {
          columns,
          rows,
          chromaKey: { targetColor: chromaColor, tolerance },
          alignMode,
          padding,
        };
        sliceResult = sliceSprite(data, options);
      }

      if (sliceResult.frames.length === 0) {
        if (sliceMode === "magicWand") {
          setError("캐릭터 덩어리를 찾을 수 없습니다. 최소 덩어리 크기를 낮추거나 크로마키 설정을 확인해주세요.");
        } else {
          setError("프레임을 찾을 수 없습니다. 크로마키 설정을 확인해주세요.");
        }
      } else {
        setResult(sliceResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 중 오류 발생");
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!result || result.frames.length === 0) return;

    const zip = new JSZip();
    const canvas = document.createElement("canvas");
    canvas.width = result.canvasWidth;
    canvas.height = result.canvasHeight;
    const ctx = canvas.getContext("2d")!;

    for (let i = 0; i < result.frames.length; i++) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(result.frames[i], 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (blob) {
        zip.file(`${prefix}_${i + 1}.png`, blob);
      }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prefix}_sprites.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderFrame = (frame: ImageData, idx: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(frame, 0, 0);
    return canvas.toDataURL();
  };

  return (
    <div className="mt-8 border border-zinc-700 rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">스프라이트 오리기</h2>

      {/* 입력 소스 */}
      <div className="flex items-center gap-4 mb-4">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Slicer source"
            className="h-16 rounded border border-zinc-600"
          />
        )}
        <div className="flex flex-col gap-2">
          {source && (
            <span className="text-xs text-zinc-400">
              생성 결과 자동 연결됨
            </span>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded"
          >
            다른 이미지 업로드
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* 모드 선택 */}
      <div className="mb-4">
        <label className="block text-xs text-zinc-400 mb-2">분할 모드</label>
        <div className="flex gap-2">
          <button
            onClick={() => setSliceMode("grid")}
            className={`px-3 py-1.5 text-sm rounded ${
              sliceMode === "grid"
                ? "bg-blue-600 text-white"
                : "bg-zinc-700 hover:bg-zinc-600"
            }`}
          >
            사각 분할
          </button>
          <button
            onClick={() => setSliceMode("magicWand")}
            className={`px-3 py-1.5 text-sm rounded ${
              sliceMode === "magicWand"
                ? "bg-blue-600 text-white"
                : "bg-zinc-700 hover:bg-zinc-600"
            }`}
          >
            요술봉 (윤곽 분리)
          </button>
        </div>
        {sliceMode === "magicWand" && (
          <p className="text-xs text-zinc-500 mt-1">
            캐릭터를 덩어리로 자동 분리합니다. 여백이 좁아 옆 캐릭터가 끼어드는 문제를 해결합니다.
          </p>
        )}
      </div>

      {/* 설정 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {/* 사각 분할 모드 전용: 열/행 */}
        {sliceMode === "grid" && (
          <>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">열(Columns)</label>
              <input
                type="number"
                min={1}
                max={20}
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">행(Rows)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm"
              />
            </div>
          </>
        )}

        {/* 요술봉 모드 전용: 최소 덩어리 크기 */}
        {sliceMode === "magicWand" && (
          <div className="col-span-2">
            <label className="block text-xs text-zinc-400 mb-1">
              최소 덩어리 크기 (px)
            </label>
            <input
              type="range"
              min={500}
              max={10000}
              step={100}
              value={minBlobSize}
              onChange={(e) => setMinBlobSize(Number(e.target.value))}
              className="w-full"
            />
            <span className="text-xs text-zinc-500">{minBlobSize}px (작은 조각은 가까운 캐릭터에 병합)</span>
          </div>
        )}

        <div>
          <label className="block text-xs text-zinc-400 mb-1">여백(px)</label>
          <input
            type="number"
            min={0}
            max={64}
            value={padding}
            onChange={(e) => setPadding(Number(e.target.value))}
            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm"
          />
        </div>
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
      </div>

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        {/* 크로마키 색 */}
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

        {/* 정렬 모드 */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">정렬</label>
          <select
            value={alignMode}
            onChange={(e) => setAlignMode(e.target.value as AlignMode)}
            className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm"
          >
            <option value="bottom">발 기준(바닥)</option>
            <option value="center">중심 정렬</option>
          </select>
        </div>

        {/* 자동 감지 (사각 분할 모드에서만) */}
        {sliceMode === "grid" && (
          <button
            onClick={handleAutoDetect}
            disabled={!imageUrl}
            className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded"
          >
            자동 감지
          </button>
        )}

        {/* 실행 */}
        <button
          onClick={handleSlice}
          disabled={!imageUrl || processing}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded font-medium"
        >
          {processing ? "처리 중..." : "오리기 실행"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* 미리보기 */}
      {result && result.frames.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-4 mb-3">
            <span className="text-sm text-zinc-300">
              {result.frames.length}프레임 · {result.canvasWidth}×{result.canvasHeight}px
            </span>
            <button
              onClick={() => setAnimating(!animating)}
              className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded"
            >
              {animating ? "⏸ 정지" : "▶ 재생"}
            </button>
          </div>

          {/* 애니메이션 미리보기 */}
          {animating && (
            <div className="mb-3 p-4 bg-zinc-800 rounded flex items-center justify-center"
              style={{ minHeight: result.canvasHeight + 20 }}>
              <img
                src={renderFrame(result.frames[animFrame], animFrame)}
                alt={`frame ${animFrame}`}
                style={{ imageRendering: "pixelated" }}
              />
            </div>
          )}

          {/* 프레임 나열 (발 베이스라인 표시) */}
          <div className="relative overflow-x-auto p-3 bg-zinc-800 rounded">
            <div className="flex gap-2 items-end" style={{ minHeight: result.canvasHeight }}>
              {result.frames.map((frame, i) => (
                <img
                  key={i}
                  src={renderFrame(frame, i)}
                  alt={`Frame ${i + 1}`}
                  className="border border-zinc-600"
                  style={{ imageRendering: "pixelated" }}
                />
              ))}
            </div>
            {/* 바닥 베이스라인 */}
            {alignMode === "bottom" && (
              <div
                className="absolute left-3 right-3 border-t border-red-500/50"
                style={{ bottom: padding + 12 }}
              />
            )}
          </div>

          {/* 다운로드 */}
          <div className="flex items-center gap-3 mt-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">파일명 접두사</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm w-40"
              />
            </div>
            <button
              onClick={handleDownload}
              className="mt-5 px-4 py-2 bg-green-600 hover:bg-green-700 rounded font-medium text-sm"
            >
              ZIP 다운로드
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
