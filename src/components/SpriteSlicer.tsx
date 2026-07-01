"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  sliceSprite,
  sliceSpriteByContour,
  autoDetectGrid,
  alignFramesWithSpec,
  splitGrid,
  applyChromaKey,
  connectedComponents,
  mergeSmallBlobs,
  type SliceOptions,
  type MagicWandOptions,
  type OutputSpec,
  type SizeMode,
  type FitMode,
  type AlignMode,
  type SliceResult,
} from "@/lib/spriteSlicer";
import JSZip from "jszip";

interface SpriteSlicerProps {
  /** 생성 결과 이미지 URL (fal.media 등 외부) */
  source?: string | null;
  /** 영상에서 추출된 프레임 (직접 주입) - 요술봉 등 후처리 가능 */
  cells?: ImageData[] | null;
}

const CHROMA_PRESETS: { label: string; color: [number, number, number] }[] = [
  { label: "녹색", color: [0, 255, 0] },
  { label: "검정", color: [0, 0, 0] },
  { label: "흰색", color: [255, 255, 255] },
];

const ASPECT_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1:1", w: 1, h: 1 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:4", w: 3, h: 4 },
  { label: "16:9", w: 16, h: 9 },
  { label: "2:3", w: 2, h: 3 },
];

type SliceMode = "grid" | "magicWand";

export default function SpriteSlicer({ source, cells: injectedCells }: SpriteSlicerProps) {
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

  // 영상에서 주입된 프레임 (요술봉 처리 전)
  const [videoCells, setVideoCells] = useState<ImageData[] | null>(null);
  // 영상 프레임 썸네일 (캐싱)
  const [videoCellThumbnails, setVideoCellThumbnails] = useState<string[]>([]);

  // 출력 규격 설정
  const [useOutputSpec, setUseOutputSpec] = useState(false);
  const [sizeMode, setSizeMode] = useState<SizeMode>("auto");
  const [fixedWidth, setFixedWidth] = useState(256);
  const [fixedHeight, setFixedHeight] = useState(256);
  const [aspectW, setAspectW] = useState(1);
  const [aspectH, setAspectH] = useState(1);
  const [longSide, setLongSide] = useState(256);
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const [fillRatio, setFillRatio] = useState(0.8);
  const [pixelArt, setPixelArt] = useState(true);

  // source가 바뀌면 자동 적용
  useEffect(() => {
    if (source) setImageUrl(source);
  }, [source]);

  // injectedCells가 있으면 videoCells에 저장 (바로 처리하지 않고 사용자가 "오리기 실행" 클릭 시 처리)
  useEffect(() => {
    if (!injectedCells || injectedCells.length === 0) {
      setVideoCells(null);
      setVideoCellThumbnails([]);
      return;
    }

    // 영상 프레임 저장
    setVideoCells(injectedCells);
    setResult(null);
    setError(null);

    // 썸네일 생성
    const thumbnails = injectedCells.map((frame) => {
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(frame, 0, 0);
      return canvas.toDataURL();
    });
    setVideoCellThumbnails(thumbnails);

    // 영상 프레임은 출력 규격 자동 활성화
    setUseOutputSpec(true);
  }, [injectedCells]);

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

  // 단일 프레임에 요술봉(connected components) 적용하여 가장 큰 덩어리만 추출
  const extractLargestBlob = (frame: ImageData): ImageData => {
    const { width, height } = frame;

    // 크로마키 적용
    const chromaKeyOpts = { targetColor: chromaColor, tolerance };
    applyChromaKey(frame, chromaKeyOpts);

    // connected components로 덩어리 찾기
    const { labeled, sizes } = connectedComponents(frame);
    const { blobs } = mergeSmallBlobs(labeled, width, height, sizes, minBlobSize);

    if (blobs.length === 0) {
      // 덩어리가 없으면 원본 반환
      return frame;
    }

    // 가장 큰 덩어리 선택
    const largestBlob = blobs.reduce((a, b) => a.pixels.length > b.pixels.length ? a : b);

    // 바운딩 박스 계산
    let left = width, top = height, right = 0, bottom = 0;
    for (const p of largestBlob.pixels) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
    right++;
    bottom++;

    const cellW = right - left;
    const cellH = bottom - top;
    const cellCanvas = document.createElement("canvas");
    cellCanvas.width = cellW;
    cellCanvas.height = cellH;
    const cellCtx = cellCanvas.getContext("2d")!;
    const cellData = cellCtx.createImageData(cellW, cellH);

    const pixelSet = new Set<string>();
    for (const p of largestBlob.pixels) {
      pixelSet.add(`${p.x},${p.y}`);
    }

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = ((y - top) * cellW + (x - left)) * 4;
        if (pixelSet.has(`${x},${y}`)) {
          cellData.data[dstIdx] = frame.data[srcIdx];
          cellData.data[dstIdx + 1] = frame.data[srcIdx + 1];
          cellData.data[dstIdx + 2] = frame.data[srcIdx + 2];
          cellData.data[dstIdx + 3] = frame.data[srcIdx + 3];
        } else {
          cellData.data[dstIdx + 3] = 0;
        }
      }
    }

    return cellData;
  };

  const handleSlice = async () => {
    // 영상 프레임이 있으면 videoCells 처리
    if (videoCells && videoCells.length > 0) {
      setProcessing(true);
      setError(null);
      setResult(null);

      try {
        let cells: ImageData[];

        if (sliceMode === "magicWand") {
          // 요술봉 모드: 각 프레임에서 가장 큰 덩어리만 추출 (워터마크 제거)
          cells = videoCells.map((frame) => {
            // ImageData 복사 (원본 변경 방지)
            const canvas = document.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            const ctx = canvas.getContext("2d")!;
            ctx.putImageData(frame, 0, 0);
            const frameCopy = ctx.getImageData(0, 0, frame.width, frame.height);
            return extractLargestBlob(frameCopy);
          });
        } else {
          // 사각 분할 모드: 크로마키만 적용
          cells = videoCells.map((frame) => {
            const canvas = document.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            const ctx = canvas.getContext("2d")!;
            ctx.putImageData(frame, 0, 0);
            const frameCopy = ctx.getImageData(0, 0, frame.width, frame.height);
            const chromaKeyOpts = { targetColor: chromaColor, tolerance };
            applyChromaKey(frameCopy, chromaKeyOpts);
            return frameCopy;
          });
        }

        const outputSpec: OutputSpec = {
          sizeMode,
          width: fixedWidth,
          height: fixedHeight,
          aspectW,
          aspectH,
          longSide,
          fitMode,
          fillRatio,
          alignMode,
          pixelArt,
        };

        const sliceResult = alignFramesWithSpec(cells, outputSpec);

        if (sliceResult.frames.length === 0) {
          setError("프레임을 처리할 수 없습니다.");
        } else {
          setResult(sliceResult);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "처리 중 오류 발생");
      } finally {
        setProcessing(false);
      }
      return;
    }

    // 기존 이미지 경로
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

      if (useOutputSpec) {
        // 출력 규격 사용 시: 셀 추출 → alignFramesWithSpec
        const chromaKeyOpts = { targetColor: chromaColor, tolerance };
        applyChromaKey(data, chromaKeyOpts);

        let cells: ImageData[];

        if (sliceMode === "magicWand") {
          // 요술봉 모드: connected components로 셀 추출
          const { width, height } = data;
          const { labeled, sizes } = connectedComponents(data);
          const { blobs } = mergeSmallBlobs(labeled, width, height, sizes, minBlobSize);

          cells = [];
          for (const blob of blobs) {
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
            const cellCanvas = document.createElement("canvas");
            cellCanvas.width = cellW;
            cellCanvas.height = cellH;
            const cellCtx = cellCanvas.getContext("2d")!;
            const cellData = cellCtx.createImageData(cellW, cellH);

            const pixelSet = new Set<string>();
            for (const p of blob.pixels) {
              pixelSet.add(`${p.x},${p.y}`);
            }

            for (let y = top; y < bottom; y++) {
              for (let x = left; x < right; x++) {
                const srcIdx = (y * width + x) * 4;
                const dstIdx = ((y - top) * cellW + (x - left)) * 4;
                if (pixelSet.has(`${x},${y}`)) {
                  cellData.data[dstIdx] = data.data[srcIdx];
                  cellData.data[dstIdx + 1] = data.data[srcIdx + 1];
                  cellData.data[dstIdx + 2] = data.data[srcIdx + 2];
                  cellData.data[dstIdx + 3] = data.data[srcIdx + 3];
                } else {
                  cellData.data[dstIdx + 3] = 0;
                }
              }
            }
            cells.push(cellData);
          }
        } else {
          // 사각 분할 모드
          cells = splitGrid(data, columns, rows);
        }

        const outputSpec: OutputSpec = {
          sizeMode,
          width: fixedWidth,
          height: fixedHeight,
          aspectW,
          aspectH,
          longSide,
          fitMode,
          fillRatio,
          alignMode,
          pixelArt,
        };

        sliceResult = alignFramesWithSpec(cells, outputSpec);
      } else {
        // 기존 방식 (하위호환)
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
        {imageUrl && !videoCells && (
          <img
            src={imageUrl}
            alt="Slicer source"
            className="h-16 rounded border border-zinc-600"
          />
        )}
        {!videoCells && (
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
        )}
      </div>

      {/* 영상 프레임 미리보기 */}
      {videoCells && videoCells.length > 0 && (
        <div className="mb-4 p-3 bg-purple-900/20 border border-purple-600/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-purple-300 text-sm font-medium">
                🎬 영상 프레임 {videoCells.length}장
              </span>
              <span className="text-xs text-purple-400">
                ({videoCells[0].width}×{videoCells[0].height})
              </span>
            </div>
            <span className="text-xs text-purple-400">
              크로마키 + 요술봉으로 배경 제거 → 오리기 실행
            </span>
          </div>
          <div className="flex gap-1 overflow-x-auto py-1">
            {videoCellThumbnails.map((dataUrl, idx) => (
              <img
                key={idx}
                src={dataUrl}
                alt={`Frame ${idx + 1}`}
                className="h-16 rounded border border-purple-600/30 flex-shrink-0"
                title={`프레임 ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}

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
          disabled={(!imageUrl && !videoCells) || processing}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded font-medium"
        >
          {processing ? "처리 중..." : "오리기 실행"}
        </button>
      </div>

      {/* 출력 규격 설정 */}
      <div className="mb-4 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useOutputSpec}
              onChange={(e) => setUseOutputSpec(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">출력 규격 사용</span>
          </label>
          {useOutputSpec && (
            <span className="text-xs text-zinc-500">
              모든 프레임을 동일 크기로 출력합니다
            </span>
          )}
        </div>

        {useOutputSpec && (
          <div className="space-y-4">
            {/* 크기 모드 */}
            <div>
              <label className="block text-xs text-zinc-400 mb-2">크기 모드</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSizeMode("auto")}
                  className={`px-3 py-1 text-xs rounded ${
                    sizeMode === "auto" ? "bg-blue-600" : "bg-zinc-700 hover:bg-zinc-600"
                  }`}
                >
                  자동
                </button>
                <button
                  onClick={() => setSizeMode("fixed")}
                  className={`px-3 py-1 text-xs rounded ${
                    sizeMode === "fixed" ? "bg-blue-600" : "bg-zinc-700 hover:bg-zinc-600"
                  }`}
                >
                  고정 크기
                </button>
                <button
                  onClick={() => setSizeMode("aspect")}
                  className={`px-3 py-1 text-xs rounded ${
                    sizeMode === "aspect" ? "bg-blue-600" : "bg-zinc-700 hover:bg-zinc-600"
                  }`}
                >
                  종횡비
                </button>
              </div>
            </div>

            {/* 고정 크기 입력 */}
            {sizeMode === "fixed" && (
              <div className="flex gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">너비</label>
                  <input
                    type="number"
                    min={32}
                    max={1024}
                    value={fixedWidth}
                    onChange={(e) => setFixedWidth(Number(e.target.value))}
                    className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">높이</label>
                  <input
                    type="number"
                    min={32}
                    max={1024}
                    value={fixedHeight}
                    onChange={(e) => setFixedHeight(Number(e.target.value))}
                    className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
              </div>
            )}

            {/* 종횡비 설정 */}
            {sizeMode === "aspect" && (
              <div className="space-y-2">
                <div className="flex gap-2 flex-wrap">
                  {ASPECT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => { setAspectW(preset.w); setAspectH(preset.h); }}
                      className={`px-2 py-1 text-xs rounded ${
                        aspectW === preset.w && aspectH === preset.h
                          ? "bg-blue-600"
                          : "bg-zinc-700 hover:bg-zinc-600"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">긴 변 길이</label>
                  <input
                    type="number"
                    min={64}
                    max={1024}
                    value={longSide}
                    onChange={(e) => setLongSide(Number(e.target.value))}
                    className="w-24 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
              </div>
            )}

            {/* 맞춤 방식 & 채움 비율 */}
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">맞춤 방식</label>
                <select
                  value={fitMode}
                  onChange={(e) => setFitMode(e.target.value as FitMode)}
                  className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                >
                  <option value="contain">비율 유지 (contain)</option>
                  <option value="height">높이 기준</option>
                  <option value="width">너비 기준</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  채움 비율: {Math.round(fillRatio * 100)}%
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={fillRatio}
                  onChange={(e) => setFillRatio(Number(e.target.value))}
                  className="w-32"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pixelArt}
                    onChange={(e) => setPixelArt(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs">픽셀아트 모드</span>
                </label>
              </div>
            </div>
          </div>
        )}
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
