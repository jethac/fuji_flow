export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for voice transcription.");
    }

    const audio = await request.arrayBuffer();
    if (!audio.byteLength) {
      throw new Error("No audio was received.");
    }

    const mimeType = request.headers.get("content-type") || "audio/webm";
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mimeType }), "voice-dump.webm");
    form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message || "OpenAI transcription failed.");
    }

    return Response.json({ text: payload.text || "" });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Voice transcription failed.",
      },
      {
        status: 400,
      },
    );
  }
}
