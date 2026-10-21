// A provider's model list holds more than chat models: OpenAI's has its
// embeddings, speech, transcription, realtime and image models, Google's its
// embeddings, Imagen, Veo and TTS, Ollama's its embedders. Every place the
// catalog is offered (the providers page, the chat's model chip, a
// Philharmonic employee) picks a model to chat with, and a chat sent to one
// of these fails; image generation and voice keep lists of their own.
const NOT_CHAT =
  /(?:^|[-_.])(?:embed|embedding|embeddings|tts|whisper|dall-e|image|imagen|imagine|veo|sora|moderation|realtime|audio|native-audio|transcribe|live|aqa|search|computer-use|instruct|babbage|davinci)(?=$|[-_.:\d])/iu

/** Whether a listed model id can be chatted with, judged by its name. */
export function isChatModelId(id: string): boolean {
  return !NOT_CHAT.test(id)
}
