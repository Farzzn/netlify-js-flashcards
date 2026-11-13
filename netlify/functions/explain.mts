import { GoogleGenAI } from "@google/genai";
import { getDeployStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

interface FlashcardPayload {
  topic: string;
  explanation: string;
  codeExample: string;
  generatedAt: string;
}

const flashcardSchema = {
  type: "object",
  properties: {
    explanation: {
      type: "string",
      description:
        "Exactly 2 simple, beginner-friendly sentences explaining the JavaScript concept clearly.",
    },
    codeExample: {
      type: "string",
      description:
        "A concise, practical 4-6 line JavaScript code snippet demonstrating the concept (raw code only, no markdown backticks).",
    },
  },
  required: ["explanation", "codeExample"],
};

export default async (req: Request) => {
  const url = new URL(req.url);
  const rawTopic = url.searchParams.get("topic") ?? "closures";
  const topic = rawTopic.trim().toLowerCase() || "closures";

  // Open a deploy-scoped key-value store in Netlify Blobs
  const store = getDeployStore("explanations");

  if (req.method === "DELETE") {
    await store.delete(topic);
    return Response.json({ cleared: true, topic });
  }

  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // 1. Check Netlify Blobs cache first
  const cachedData = (await store.get(topic, {
    type: "json",
  })) as FlashcardPayload | null;

  if (cachedData) {
    return Response.json({
      ...cachedData,
      source: "Netlify Blobs Cache",
      cached: true,
    });
  }

  // 2. Cache miss -> Generate via Google Gemini using Netlify AI Gateway
  try {
    // No hardcoded API key: relies on Netlify AI Gateway auto-injected env vars
    const ai = new GoogleGenAI({});

    // Using gemini-3.8-flash (current replacement for deprecated gemini-2.5-flash)
    const prompt = `Explain the JavaScript concept "${topic}" for a developer flashcard. Return JSON with "explanation" (2 simple beginner-friendly sentences explaining the JS concept) and "codeExample" (a short 4-6 line JavaScript snippet without markdown fences).`;

    let rawJsonText = "";

    // Support both the modern Interactions API (@google/genai >= 2.x) and models.generateContent gateway proxy
    if (typeof ai.interactions?.create === "function") {
      try {
        const interaction = await ai.interactions.create({
          model: "gemini-3.8-flash",
          input: prompt,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: flashcardSchema,
          },
        });
        rawJsonText = interaction.output_text ?? "";
      } catch (interactionErr) {
        // If AI Gateway proxy routes via v1beta/models:generateContent, fall back seamlessly
        const fallbackResp = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: flashcardSchema,
          },
        });
        rawJsonText = fallbackResp.text ?? "";
        if (!rawJsonText) throw interactionErr;
      }
    } else {
      const resp = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: flashcardSchema,
        },
      });
      rawJsonText = resp.text ?? "";
    }

    const cleaned = rawJsonText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as {
      explanation?: string;
      codeExample?: string;
    };

    if (!parsed.explanation || !parsed.codeExample) {
      throw new Error("Incomplete structured JSON returned from Gemini.");
    }

    const payload: FlashcardPayload = {
      topic,
      explanation: parsed.explanation.trim(),
      codeExample: parsed.codeExample
        .trim()
        .replace(/^```(?:js|javascript)?\s*/i, "")
        .replace(/\s*```$/, ""),
      generatedAt: new Date().toISOString(),
    };

    // Save valid AI responses to Netlify Blobs deploy-scoped store
    await store.setJSON(topic, payload);

    return Response.json({
      ...payload,
      source: "Netlify AI Gateway (Gemini)",
      cached: false,
    });
  } catch (_error) {
    // Friendly un-cached fallback when GEMINI_API_KEY / AI Gateway is not yet linked locally
    const fallbackPayload: FlashcardPayload = {
      topic,
      explanation: `Netlify AI Gateway automatically injects GEMINI_API_KEY and gateway routing credentials once your project is linked via "netlify init" and deployed once (or when GEMINI_API_KEY is set locally). Until linked, here is an offline preview for "${topic}"—intentionally not cached in Netlify Blobs so live Gemini generation kicks in immediately once connected!`,
      codeExample: [
        `// Zero-config Gemini via Netlify AI Gateway`,
        `const ai = new GoogleGenAI({}); // Auto-uses injected GEMINI_API_KEY`,
        `const res = await ai.interactions.create({`,
        `  model: "gemini-3.8-flash",`,
        `  input: "Explain ${topic.replace(/"/g, "")} in JavaScript"`,
        `});`,
      ].join("\n"),
      generatedAt: new Date().toISOString(),
    };

    return Response.json({
      ...fallbackPayload,
      source: "Netlify AI Gateway (Local Fallback — Unlinked)",
      cached: false,
      isFallback: true,
    });
  }
};

export const config: Config = {
  path: "/api/explain",
};
