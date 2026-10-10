import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface VoiceAssistantGameState {
  playerName?: string;
  currentQuest?: string;
  questPhase?: string;
  scavengerItems?: string[];
  foundItems?: string[];
  playerInventory?: string[];
  playerScore?: number;
  location?: any;
  activeWaypoint?: any;
  currentTime?: string;
  currentDay?: string;
  mission?: any;
}

export interface VoiceInteractionResult {
  transcript?: string;
  spokenText: string;
  thought: string;
  action: string;
  audioBase64?: string;
  mimeType?: string;
  questUpdate?: any;
  source: string;
}

class VoiceAssistantEngine {
  private cache: Map<string, { buffer: Buffer; mimeType: string; base64: string }> = new Map();

  constructor() {
    console.log('[VoiceAssistantEngine] Dedicated Voice Assistant Backend Engine initialized');
  }

  /**
   * Transcribe recorded audio (base64) using Gemini 3.8 Flash
   */
  public async transcribeAudio(audioBase64: string, mimeType: string = 'audio/webm'): Promise<string> {
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return '';
    }

    const cleanBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim();

    const candidateModels = ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite'];

    for (const model of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: cleanBase64,
                  },
                },
                {
                  text: `You are an expert audio transcriber for a nature exploration mobile game called EcoQuest.
Listen to this voice recording and output ONLY the exact spoken English words transcribed from the explorer's speech.
Common queries from explorers include:
- "What is my task?"
- "What's my mission?"
- "What should I do?"
- "Where can I find leaves?"
- "How many pebbles do I need?"
- "What items do I have?"
- "Where is the waypoint?"

Do not add commentary, quotation marks, punctuation tags, or metadata.
If no recognizable speech is heard or it is just background rustle, return an empty string.`,
                },
              ],
            },
          ],
        });

        const transcript = (response.text || '').trim();
        if (transcript) {
          console.log(`[VoiceAssistantEngine] Transcribed via ${model}: "${transcript}"`);
          return transcript.replace(/^["']|["']$/g, '');
        }
      } catch (err: any) {
        console.warn(`[VoiceAssistantEngine] Transcribe error with ${model}:`, err.message);
      }
    }

    return '';
  }

  /**
   * Synthesize spoken text into crystal-clear WAV audio using Gemini Flash Lite TTS
  /**
   * Humanize text for spoken audio: replaces rigid symbols, abbreviations, and list syntax
   * with smooth, melodious conversational English that sounds warm and natural in earphones.
   */
  public humanizeTextForSpeech(text: string): string {
    if (!text) return '';
    return text
      .replace(/2x\s*/gi, 'two ')
      .replace(/1x\s*/gi, 'one ')
      .replace(/3x\s*/gi, 'three ')
      .replace(/4x\s*/gi, 'four ')
      .replace(/\(Wings\)/gi, 'for the wings')
      .replace(/\(Spine\)/gi, 'for the spine')
      .replace(/\(Eyes\)/gi, 'for the eyes')
      .replace(/[*_#`~[\]]/g, '')
      .replace(/\(\s*([^\)]+)\s*\)/g, ', $1, ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Synthesize spoken text into a warm, natural, human-like voice.
   * Uses ElevenLabs (if configured) or Gemini Flash Lite TTS with warm conversational speech styling.
   */
  public async synthesizeSpeech(
    text: string,
    voiceName: string = 'Zephyr'
  ): Promise<{ buffer: Buffer; mimeType: string; base64: string } | null> {
    if (!text || !text.trim()) return null;

    const cleanText = this.humanizeTextForSpeech(text).slice(0, 1000);
    const validVoices = ['Zephyr', 'Kore', 'Aoede', 'Puck', 'Fenrir', 'Charon'];
    const chosenVoice = validVoices.includes(voiceName) ? voiceName : 'Zephyr';

    const cacheKey = `${chosenVoice}:${cleanText}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // 1. If ElevenLabs API key is configured, synthesize with ultra-lifelike human voice
    const elevenKey = (process.env.ELEVENLABS_API_KEY || 'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2').trim();
    if (elevenKey && elevenKey.length >= 24 && !elevenKey.includes('33fcd7b69062fca952ae8ba0156513b9245afe81639c5be0d27110b5a245736b')) {
      try {
        const elevenVoiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - Single locked voice from API key
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}?output_format=mp3_44100_128`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': elevenKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.45,
              similarity_boost: 0.88,
              style: 0.15,
              use_speaker_boost: true,
            },
          }),
        });

        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64 = buffer.toString('base64');
          const result = { buffer, mimeType: 'audio/mpeg', base64 };
          if (this.cache.size < 50) this.cache.set(cacheKey, result);
          console.log(`[VoiceAssistantEngine] Synthesized ${buffer.length} bytes via ElevenLabs ultra-human voice`);
          return result;
        }
      } catch (err: any) {
        console.warn('[VoiceAssistantEngine] ElevenLabs synthesis notice:', err.message);
      }
    }

    // 2. Synthesize via Gemini Flash Lite TTS with natural, soothing human voice styling
    const ttsModels = ['gemini-3.8-flash-lite-tts'];

    for (const model of ttsModels) {
      try {
        const ttsPromise = ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText,
                  speechMetadata: {
                    style: 'Warm, natural, soothing human voice, gentle and pleasing to listen to in earphones, friendly companion tone',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: chosenVoice },
              },
            },
          },
        });

        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('TTS generation timeout')), 8000)
        );

        const response: any = await Promise.race([ttsPromise, timeoutPromise]);
        const part = response?.candidates?.[0]?.content?.parts?.[0];
        const base64Audio = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType || 'audio/wav';

        if (base64Audio) {
          const buffer = Buffer.from(base64Audio, 'base64');
          const result = {
            buffer,
            mimeType,
            base64: base64Audio,
          };
          if (this.cache.size < 50) {
            this.cache.set(cacheKey, result);
          }
          console.log(`[VoiceAssistantEngine] Synthesized ${buffer.length} bytes soothing audio via ${model} (${chosenVoice})`);
          return result;
        }
      } catch (err: any) {
        console.warn(`[VoiceAssistantEngine] TTS error with ${model}:`, err.message);
      }
    }

    return null;
  }

  /**
   * Generate conversational intelligence and game actions for a given query and state
   */
  public async interact(
    query: string,
    state: VoiceAssistantGameState = {},
    history: any[] = []
  ): Promise<VoiceInteractionResult> {
    const q = (query || '').toLowerCase().trim();
    const playerName = state.playerName || 'Explorer';
    const currentQuest = state.currentQuest || state.mission?.title || 'The Forest Leaf Dragon';
    const scavengerItems = state.scavengerItems || state.mission?.scavengerItems || [
      '2x Broad Leaves (Wings)',
      '1x Curved Twig (Spine)',
      '2x River Pebbles (Eyes)',
    ];
    const foundItems = state.foundItems || [];
    const remainingItems = (scavengerItems as string[]).filter((i: string) => !foundItems.includes(i));
    const score = state.playerScore ?? 850;

    // Friendly humanized remaining list
    const friendlyRemaining = remainingItems.length > 0
      ? this.humanizeTextForSpeech(remainingItems.join(', '))
      : 'all items';

    const cleanQuestName = currentQuest.replace(/^the\s+/i, '');

    // Fast-path instant handling for Task / Mission inquiries
    // Guarantees zero latency and warm pleasing human response
    if (
      q.includes('task') ||
      q.includes('mission') ||
      q.includes('objective') ||
      q.includes('quest') ||
      q.includes('what should i do') ||
      q.includes('what do i need') ||
      q.includes('what are we doing') ||
      q.includes('what to do')
    ) {
      let spokenText = '';
      if (remainingItems.length === 0 && scavengerItems.length > 0) {
        spokenText = `Splendid work, ${playerName}! You found all the items for the ${cleanQuestName}. Place your specimens gently on the soil and snap a photo in your field book!`;
      } else if (remainingItems.length > 0) {
        spokenText = `We are crafting the ${cleanQuestName} today, ${playerName}! Right now we are searching for ${friendlyRemaining}. Keep your eyes open along the trail—it is so lovely out here!`;
      } else {
        spokenText = `Our quest today is the ${cleanQuestName}, ${playerName}. Enjoy your walk, gather natural treasures, and we will craft something beautiful together!`;
      }

      const audio = await this.synthesizeSpeech(spokenText, 'Zephyr');

      return {
        spokenText,
        thought: `Aura provided soothing quest guidance: ${remainingItems.length} items remaining for ${currentQuest}.`,
        action: 'HIGHLIGHT_QUEST_CARD',
        audioBase64: audio?.base64,
        mimeType: audio?.mimeType,
        source: 'instant-task-engine',
      };
    }

    // Full conversational reasoning with Gemini 3.8 Flash
    try {
      const systemInstruction = `You are "Aura", the warm, gentle, and pleasing nature companion for the outdoor mobile scavenger hunt app "EcoQuest".
You speak in a comforting, natural, melodious human voice that is relaxing and delightful to hear through earphones.
Keep responses short, warm, and conversational (1 to 2 sentences max).
Never sound robotic or mechanical. Avoid technical jargon, bullet points, asterisks, or item lists with 'x' (say "two broad leaves" instead of "2x Broad Leaves").
Current Explorer: ${playerName}
Current Quest: ${currentQuest}
Scavenger Items Needed: ${scavengerItems.join(', ')}
Items Already Found: ${foundItems.length > 0 ? foundItems.join(', ') : 'None yet'}
Remaining Items Needed: ${remainingItems.join(', ')}
Explorer Score: ${score} XP
Location / Biome: ${state.location?.localityName || 'Redwood Nature Trail'}

Respond with JSON:
{
  "thought": "brief 1-sentence reasoning",
  "spokenText": "1-2 sentences warm, pleasing conversational response",
  "action": "NONE" | "HIGHLIGHT_QUEST_CARD" | "OPEN_STAMP_BOOK" | "OPEN_CAMERA" | "TOGGLE_WAYPOINT"
}`;

      const conversationParts = [
        ...history.slice(-4).map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }],
        })),
        {
          role: 'user',
          parts: [{ text: query }],
        },
      ];

      const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
      let parsed: any = null;
      let usedModel = 'gemini-3.1-flash-lite';

      for (const model of models) {
        try {
          const resp = await ai.models.generateContent({
            model,
            contents: conversationParts as any,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
            },
          });
          if (resp && resp.text) {
            parsed = JSON.parse(resp.text);
            usedModel = model;
            break;
          }
        } catch (mErr: any) {
          console.warn(`[VoiceAssistantEngine] Reasoning notice on ${model}:`, mErr?.message);
        }
      }

      if (!parsed) {
        throw new Error('All models returned empty response, using fallback');
      }

      const spokenText =
        parsed.spokenText ||
        `I am right here with you on the path, ${playerName}! Let's find what we need for ${currentQuest}.`;
      const thought = parsed.thought || 'Aura processed your voice with real-time expedition state.';
      const action = parsed.action || 'NONE';

      // Synthesize soothing audio
      const audio = await this.synthesizeSpeech(spokenText, 'Zephyr');

      return {
        spokenText,
        thought,
        action,
        audioBase64: audio?.base64,
        mimeType: audio?.mimeType,
        source: usedModel,
      };
    } catch (err: any) {
      console.warn('[VoiceAssistantEngine] Reasoning error, using fallback:', err.message);
      const fallbackTarget = remainingItems[0] ? this.humanizeTextForSpeech(remainingItems[0]) : 'natural specimens';
      const fallbackText = `I am right beside you, ${playerName}! Our quest is the ${currentQuest}. Take a look around the trail for ${fallbackTarget}!`;
      const audio = await this.synthesizeSpeech(fallbackText, 'Zephyr');

      return {
        spokenText: fallbackText,
        thought: 'Fallback quest guidance.',
        action: 'NONE',
        audioBase64: audio?.base64,
        mimeType: audio?.mimeType,
        source: 'contextual-fallback',
      };
    }
  }

  /**
   * Full end-to-end processing pipeline:
   * Takes raw microphone audio (base64) -> Transcribes -> Brain Thinking -> Synthesizes Speech -> Returns audio & text in 1 shot!
   */
  public async processSpeechStream(params: {
    audioBase64: string;
    mimeType?: string;
    state?: VoiceAssistantGameState;
    history?: any[];
  }): Promise<VoiceInteractionResult> {
    const { audioBase64, mimeType = 'audio/webm', state = {}, history = [] } = params;

    // 1. Transcribe audio
    const transcript = await this.transcribeAudio(audioBase64, mimeType);

    if (!transcript || transcript.length < 2) {
      const emptyText = "I didn't quite catch that, Explorer. Whenever you are ready, tap the microphone or ask 'What is my task?'";
      const audio = await this.synthesizeSpeech(emptyText, 'Zephyr');
      return {
        transcript: '',
        spokenText: emptyText,
        thought: 'No clear speech detected in audio stream.',
        action: 'NONE',
        audioBase64: audio?.base64,
        mimeType: audio?.mimeType,
        source: 'no-speech-detected',
      };
    }

    // 2. Reason and respond
    const result = await this.interact(transcript, state, history);
    result.transcript = transcript;
    return result;
  }
}

export const voiceAssistantEngine = new VoiceAssistantEngine();
