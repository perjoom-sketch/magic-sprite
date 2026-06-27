"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";

type ModelType = "banana2" | "banana-pro";
type AspectRatio = "auto" | "21:9" | "16:9" | "3:2" | "4:3" | "5:4" | "1:1" | "4:5" | "3:4" | "2:3" | "9:16" | "4:1" | "1:4" | "8:1" | "1:8";
type Resolution = "0.5K" | "1K" | "2K" | "4K";

// Aspect ratio enum values as numeric ratios for comparison
const ASPECT_RATIOS: { value: AspectRatio; label: string; ratio: number }[] = [
  { value: "auto", label: "자동(레퍼런스)", ratio: 0 },
  { value: "2:3", label: "2:3", ratio: 2 / 3 },
  { value: "3:4", label: "3:4", ratio: 3 / 4 },
  { value: "4:5", label: "4:5", ratio: 4 / 5 },
  { value: "9:16", label: "9:16", ratio: 9 / 16 },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "5:4", label: "5:4", ratio: 5 / 4 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "3:2", label: "3:2", ratio: 3 / 2 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
  { value: "21:9", label: "21:9", ratio: 21 / 9 },
  { value: "4:1", label: "4:1", ratio: 4 / 1 },
  { value: "1:4", label: "1:4", ratio: 1 / 4 },
  { value: "8:1", label: "8:1", ratio: 8 / 1 },
  { value: "1:8", label: "1:8", ratio: 1 / 8 },
];

const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: "0.5K", label: "0.5K" },
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

// Find closest aspect ratio enum for given width/height
function findClosestAspectRatio(width: number, height: number): AspectRatio {
  const inputRatio = width / height;
  let closest: AspectRatio = "1:1";
  let minDiff = Infinity;

  for (const ar of ASPECT_RATIOS) {
    if (ar.value === "auto") continue;
    const diff = Math.abs(inputRatio - ar.ratio);
    if (diff < minDiff) {
      minDiff = diff;
      closest = ar.value;
    }
  }

  return closest;
}

export default function Home() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelType>("banana-pro");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [resolution, setResolution] = useState<Resolution>("1K");
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [detectedRatio, setDetectedRatio] = useState<AspectRatio | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImagePreview(dataUrl);

      // Read image dimensions to detect aspect ratio
      const img = new window.Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        setImageDimensions({ width, height });
        const detected = findClosestAspectRatio(width, height);
        setDetectedRatio(detected);
        console.log(`[page] Image loaded: ${width}x${height}, detected ratio: ${detected}`);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!imagePreview || !prompt) {
      setError("이미지와 프롬프트를 모두 입력해주세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setResultImage(null);

    try {
      // Determine final aspect ratio: if "auto", use detected ratio from image
      const finalAspectRatio = aspectRatio === "auto" && detectedRatio
        ? detectedRatio
        : aspectRatio;

      console.log(`[page] Generating with aspect_ratio: ${finalAspectRatio}, resolution: ${resolution}`);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imagePreview,
          prompt,
          model,
          aspect_ratio: finalAspectRatio,
          resolution,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "생성 실패");
      }

      if (data.images && data.images.length > 0) {
        setResultImage(data.images[0].url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 중 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">
          Magic Sprite Generator
        </h1>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Input Section */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">
                레퍼런스 이미지
              </label>
              <div
                className="border-2 border-dashed border-zinc-600 rounded-lg p-4 text-center cursor-pointer hover:border-zinc-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <Image
                    src={imagePreview}
                    alt="Preview"
                    width={300}
                    height={300}
                    className="mx-auto max-h-64 object-contain"
                  />
                ) : (
                  <div className="py-8 text-zinc-400">
                    클릭하여 이미지 업로드
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">프롬프트</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: same character, back view, standing pose, solid background"
                className="w-full h-32 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">모델</label>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors">
                  <input
                    type="radio"
                    name="model"
                    value="banana2"
                    checked={model === "banana2"}
                    onChange={() => setModel("banana2")}
                    className="w-4 h-4"
                  />
                  <div>
                    <span className="font-medium">Nano Banana 2</span>
                    <span className="text-zinc-400 text-sm ml-2">$0.08/장</span>
                    <p className="text-xs text-zinc-500">빠른 시안/이터레이션용</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors">
                  <input
                    type="radio"
                    name="model"
                    value="banana-pro"
                    checked={model === "banana-pro"}
                    onChange={() => setModel("banana-pro")}
                    className="w-4 h-4"
                  />
                  <div>
                    <span className="font-medium">Nano Banana Pro</span>
                    <span className="text-zinc-400 text-sm ml-2">$0.15/장</span>
                    <p className="text-xs text-zinc-500">최종 확정/고품질용</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Aspect Ratio & Resolution Dropdowns */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  종횡비
                  {imageDimensions && detectedRatio && aspectRatio === "auto" && (
                    <span className="text-zinc-400 text-xs ml-2">
                      ({imageDimensions.width}×{imageDimensions.height} → {detectedRatio})
                    </span>
                  )}
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  {ASPECT_RATIOS.map((ar) => (
                    <option key={ar.value} value={ar.value}>
                      {ar.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">해상도</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as Resolution)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  {RESOLUTIONS.map((res) => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !prompt || !imagePreview}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
            >
              {loading ? "생성 중..." : "생성하기"}
            </button>

            {error && (
              <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
                {error}
              </div>
            )}
          </div>

          {/* Result Section */}
          <div>
            <label className="block text-sm font-medium mb-2">생성 결과</label>
            <div className="border border-zinc-700 rounded-lg p-4 min-h-64 flex items-center justify-center">
              {loading ? (
                <div className="text-zinc-400 animate-pulse">생성 중...</div>
              ) : resultImage ? (
                <div className="space-y-4">
                  <Image
                    src={resultImage}
                    alt="Generated"
                    width={400}
                    height={400}
                    className="max-w-full h-auto rounded"
                    unoptimized
                  />
                  <a
                    href={resultImage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-blue-400 hover:underline text-sm"
                  >
                    원본 크기로 보기
                  </a>
                </div>
              ) : (
                <div className="text-zinc-500">
                  이미지가 여기에 표시됩니다
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
