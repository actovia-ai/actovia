import { unlink } from 'fs/promises'
import { join } from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ImageGenerationDetails } from '@actovia/shared/types/chat'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import OpenAI from 'openai'
import { ImageGenerateParams } from 'openai/resources/images'

import { Settings } from '../../db/schema'
import {
  mediaDirFor,
  saveMedia,
  type MediaTarget,
  type SavedMedia
} from '../../media/store'
import { fetchPublicHttps } from '../../net/safe-fetch'

const imageGenerationSchema = Type.Object({
  prompt: Type.String({
    description: 'Detailed description of the image to generate.'
  })
})

/** Where the images are saved: a chat's media dir, or a Group's. */
export type ImageGenerationTarget = MediaTarget

// A DALL·E link is fetched the moment it arrives (it expires in an hour).
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

// The link comes from whatever answers at the OpenAI base URL (a setting),
// so it is fetched through the public-internet-only guard: https, no
// loopback / LAN / metadata address, every redirect re-checked.
const download = (url: string, signal?: AbortSignal) =>
  fetchPublicHttps(url, {
    signal,
    maxBytes: MAX_DOWNLOAD_BYTES,
    timeoutMs: DOWNLOAD_TIMEOUT_MS
  })

export const imageGeneration = (
  setting: Settings,
  target: ImageGenerationTarget
): AgentTool<typeof imageGenerationSchema> => ({
  name: TOOL_NAMES.imageGeneration,
  label: 'Image Generation',
  description: 'Generate one or more images from a text prompt.',
  parameters: imageGenerationSchema,
  execute: async (_toolCallId, { prompt }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    if (!setting.providers?.openaiApiKey) {
      throw new Error(
        'Image Generation requires an OpenAI API Key. Please add it in Settings → Providers.'
      )
    }
    // Checked before the API is paid: an id that would leave the media dir
    // fails the call here, and nothing is written.
    const dir = mediaDirFor(target)
    try {
      const openai = new OpenAI({
        baseURL: setting.providers?.openaiBaseUrl,
        apiKey: setting.providers.openaiApiKey
      })
      const response = await openai.images.generate(
        {
          model: setting.image?.model ?? 'gpt-image-2',
          prompt,
          n: setting.image?.generatedCounts ?? 1,
          size: setting.image?.size as ImageGenerateParams['size'],
          quality: setting.image?.quality as ImageGenerateParams['quality'],
          background:
            (setting.image?.background as ImageGenerateParams['background']) ??
            undefined
        },
        { signal }
      )
      // GPT image models only answer in base64; DALL·E answers with a URL.
      // Either way the image is saved under ~/.actovia/media right now, and
      // `details` carries only its id: base64 in the row would add megabytes
      // to every history load, and a DALL·E link is dead in an hour.
      const outputMime = `image/${response.output_format ?? 'png'}`
      const data = response.data ?? []
      const saved: SavedMedia[] = []
      try {
        for (const [i, img] of data.entries()) {
          try {
            const { bytes, contentType } = img.b64_json
              ? {
                  bytes: Buffer.from(img.b64_json, 'base64'),
                  contentType: outputMime
                }
              : img.url
                ? await download(img.url, signal)
                : { bytes: Buffer.alloc(0), contentType: null }
            saved.push(await saveMedia(target, bytes, contentType))
          } catch (e) {
            throw new Error(
              `Image ${i + 1} of ${data.length} could not be saved: ${
                e instanceof Error ? e.message : String(e)
              }`,
              { cause: e }
            )
          }
        }
      } catch (e) {
        // All or nothing: a failed image fails the call, so the ones already
        // written would be referenced by no row.
        await Promise.all(
          saved.map((m) => unlink(join(dir, m.mediaId)).catch(() => {}))
        )
        throw e
      }

      const details: ImageGenerationDetails = {
        images: saved.map((media, i) => ({
          ...media,
          ...('chatId' in target ? { chatId: target.chatId } : {}),
          ...(data[i].revised_prompt
            ? { revisedPrompt: data[i].revised_prompt }
            : {})
        })),
        size: setting.image?.size ?? undefined
      }
      // The card shows the images; the model gets what it can talk about.
      // A data URL would put megabytes of base64 into the context for good.
      const forModel = {
        shownToUser: details.images.length,
        images: data.map(({ url, revised_prompt: revisedPrompt }) => ({
          ...(url?.startsWith('http') ? { url } : {}),
          ...(revisedPrompt ? { revisedPrompt } : {})
        }))
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(forModel) }],
        details
      }
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : 'Failed to generate images',
        { cause: e }
      )
    }
  }
})
