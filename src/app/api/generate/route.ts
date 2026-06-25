import { fal } from "@fal-ai/client";
import { NextRequest, NextResponse } from "next/server";

// Configure fal client with API key
fal.config({
  credentials: process.env.FAL_KEY,
});

interface GenerateRequest {
  image_url?: string;
  image_base64?: string;
  prompt: string;
  model?: "kontext" | "ultra" | "banana";
  image_prompt_strength?: number;
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
    const body: GenerateRequest = await request.json();

    if (!body.prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    if (!body.image_url && !body.image_base64) {
      return NextResponse.json(
        { error: "image_url or image_base64 is required" },
        { status: 400 }
      );
    }

    // Use image_url if provided, otherwise convert base64 to data URL
    let imageUrl = body.image_url;
    if (!imageUrl && body.image_base64) {
      // fal.ai accepts data URLs
      imageUrl = body.image_base64.startsWith("data:")
        ? body.image_base64
        : `data:image/png;base64,${body.image_base64}`;
    }

    // Select model based on request
    let modelId: string;
    let input: Record<string, unknown>;

    switch (body.model) {
      case "ultra":
        modelId = "fal-ai/flux-pro/v1.1-ultra";
        input = {
          prompt: body.prompt,
          image_url: imageUrl,
          image_prompt_strength: body.image_prompt_strength ?? 0.5,
          num_images: 1,
          aspect_ratio: "1:1",
        };
        break;
      case "banana":
        modelId = "fal-ai/nano-banana-pro/edit";
        input = {
          prompt: body.prompt,
          image_urls: [imageUrl],
          num_images: 1,
          output_format: "png",
        };
        break;
      default: // kontext
        modelId = "fal-ai/flux-kontext";
        input = {
          image_url: imageUrl,
          prompt: body.prompt,
          num_images: 1,
          output_format: "png",
        };
    }

    const result = (await fal.subscribe(modelId, {
      input,
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
    });
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
