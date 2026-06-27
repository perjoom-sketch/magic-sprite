"use client";

import { useState, useRef } from "react";
import Image from "next/image";

type ModelType = "banana2" | "banana-pro";

export default function Home() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelType>("banana-pro");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
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
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imagePreview,
          prompt,
          model,
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
