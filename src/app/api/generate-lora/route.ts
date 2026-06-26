import { fal } from "@fal-ai/client";
import { NextRequest, NextResponse } from "next/server";

// Configure fal client with API key
fal.config({
  credentials: process.env.FAL_KEY,
});

// LoRA info from training
const LORA_URL =
  "https://v3b.fal.media/files/b/0a9fbd41/2AUv5rp2ieGuN1NpjN1Tb_pytorch_lora_weights.safetensors";
const TRIGGER_WORD = "redshadow_adam";

type ImageSizePreset = "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";

interface GenerateLoraRequest {
  prompt: string;
  lora_scale?: number;
  num_images?: number;
  image_size?: ImageSizePreset;
  guidance_scale?: number;
  num_inference_steps?: number;
}

interface FalImage {
  url: string;
  width: number;
  height: number;
  content_type: string;
}

interface FalResult {
  data: {
    images: FalImage[];
    prompt: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateLoraRequest = await request.json();

    if (!body.prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    // Prepend trigger word if not already in prompt
    let fullPrompt = body.prompt;
    if (!fullPrompt.toLowerCase().includes(TRIGGER_WORD.toLowerCase())) {
      fullPrompt = `${TRIGGER_WORD}, ${fullPrompt}`;
    }

    const result = (await fal.subscribe("fal-ai/flux-lora", {
      input: {
        prompt: fullPrompt,
        loras: [
          {
            path: LORA_URL,
            scale: body.lora_scale ?? 1.0,
          },
        ],
        num_images: body.num_images ?? 1,
        image_size: body.image_size ?? "square",
        guidance_scale: body.guidance_scale ?? 3.5,
        num_inference_steps: body.num_inference_steps ?? 28,
        output_format: "png",
        enable_safety_checker: false,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.map((log) => log.message).forEach(console.log);
        }
      },
    })) as FalResult;

    return NextResponse.json({
      success: true,
      images: result.data.images,
      prompt: result.data.prompt,
      trigger_word: TRIGGER_WORD,
      lora_url: LORA_URL,
    });
  } catch (error) {
    console.error("LoRA generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    lora_url: LORA_URL,
    trigger_word: TRIGGER_WORD,
    usage: "POST with { prompt: string, lora_scale?: number, num_images?: number }",
  });
}
