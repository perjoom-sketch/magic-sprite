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
  model?: "banana2" | "banana-pro";
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
      imageUrl = body.image_base64.startsWith("data:")
        ? body.image_base64
        : `data:image/png;base64,${body.image_base64}`;
    }

    // Select model based on request
    let modelId: string;

    switch (body.model) {
      case "banana2":
        // Nano Banana 2 - $0.08/image (draft/iteration)
        modelId = "fal-ai/nano-banana-2/edit";
        break;
      case "banana-pro":
      default:
        // Nano Banana Pro - $0.15/image (final/quality)
        modelId = "fal-ai/nano-banana-pro/edit";
        break;
    }

    const input = {
      prompt: body.prompt,
      image_urls: [imageUrl],
      num_images: 1,
      aspect_ratio: "1:1",
      output_format: "png",
    };

    console.log(`[generate] Using model: ${modelId}`);

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
      model: modelId,
    });
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
