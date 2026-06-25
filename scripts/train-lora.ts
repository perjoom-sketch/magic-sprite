import { fal } from "@fal-ai/client";
import * as fs from "fs";
import * as path from "path";

// Configure fal client
fal.config({
  credentials: process.env.FAL_KEY,
});

interface TrainingResult {
  data: {
    diffusers_lora_file: {
      url: string;
      content_type: string;
      file_name: string;
      file_size: number;
    };
    config_file: {
      url: string;
    };
  };
  requestId: string;
}

async function trainLora() {
  const zipPath = path.resolve(
    "C:\\Users\\lenovo\\OneDrive\\문서\\게임\\LoRA\\redshadow_adam_seeds.zip"
  );

  console.log("Reading ZIP file...");
  const zipBuffer = fs.readFileSync(zipPath);
  const zipBlob = new Blob([zipBuffer], { type: "application/zip" });

  console.log("Uploading ZIP to fal.ai storage...");
  const zipUrl = await fal.storage.upload(zipBlob);
  console.log("ZIP uploaded:", zipUrl);

  console.log("Starting LoRA training...");
  console.log("- trigger_word: redshadow_adam");
  console.log("- is_style: false");
  console.log("- steps: 1000");

  const result = (await fal.subscribe("fal-ai/flux-lora-fast-training", {
    input: {
      images_data_url: zipUrl,
      trigger_word: "redshadow_adam",
      is_style: false,
      steps: 1000,
    },
    logs: true,
    onQueueUpdate: (update) => {
      console.log(`Status: ${update.status}`);
      if (update.status === "IN_PROGRESS" && update.logs) {
        update.logs.forEach((log) => console.log(log.message));
      }
    },
  })) as TrainingResult;

  console.log("\n=== Training Complete ===");
  console.log("LoRA URL:", result.data.diffusers_lora_file.url);
  console.log("File name:", result.data.diffusers_lora_file.file_name);
  console.log("File size:", result.data.diffusers_lora_file.file_size);
  console.log("Config URL:", result.data.config_file.url);

  // Save the LoRA URL to a file for later use
  const loraInfo = {
    lora_url: result.data.diffusers_lora_file.url,
    trigger_word: "redshadow_adam",
    trained_at: new Date().toISOString(),
    config_url: result.data.config_file.url,
  };

  fs.writeFileSync(
    path.resolve("C:\\Users\\lenovo\\OneDrive\\문서\\magic-sprite\\lora-info.json"),
    JSON.stringify(loraInfo, null, 2)
  );

  console.log("\nLoRA info saved to lora-info.json");

  return result;
}

trainLora().catch(console.error);
