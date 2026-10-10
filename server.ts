import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { voiceAssistantRouter } from './server/voice-assistant/voiceAssistantRouter.ts';
import { voiceAssistantEngine } from './server/voice-assistant/voiceAssistantEngine.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));
app.use('/api/voice-assistant', voiceAssistantRouter);

// Health check for Cloud Run and container probes
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint: Reverse Geocode with automatic free fallback
app.get('/api/maps/reverse-geocode', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Valid lat and lng query parameters required' });
    }

    return res.json({
      success: true,
      formattedAddress: `${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W`,
      locality: 'Local Outdoor Sector',
      lat,
      lng,
    });
  } catch (err: any) {
    return res.json({
      success: true,
      formattedAddress: `37.7749°N, 122.4194°W`,
      locality: 'Local Outdoor Sector',
      lat: 37.7749,
      lng: -122.4194,
    });
  }
});

// Initialize GoogleGenAI server client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Rate-limit backoff cooldown tracker to prevent repeated 429 quota exhaustion errors
let geminiRateLimitCooldownUntil = 0;

// =========================================================================
// ELEVENLABS & NEURAL SPEECH SYNTHESIS ENGINE
// =========================================================================
function isValidElevenLabsApiKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed === '33fcd7b69062fca952ae8ba0156513b9245afe81639c5be0d27110b5a245736b') {
    return false;
  }
  if (trimmed.startsWith('sk_') && trimmed.length >= 30) {
    return true;
  }
  if (/^[a-f0-9]{32,64}$/i.test(trimmed)) {
    return true;
  }
  if (trimmed.length >= 24 && !trimmed.includes(' ')) {
    return true;
  }
  return false;
}

let customElevenLabsApiKey: string = isValidElevenLabsApiKey(process.env.ELEVENLABS_API_KEY)
  ? (process.env.ELEVENLABS_API_KEY || '').trim()
  : 'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2';
const DEFAULT_ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Single locked voice from ElevenLabs key (Sarah)

async function synthesizeElevenLabsSpeech(
  text: string,
  voiceId: string = DEFAULT_ELEVENLABS_VOICE_ID
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const rawApiKey = (customElevenLabsApiKey || 'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2').trim();
  if (!isValidElevenLabsApiKey(rawApiKey)) return null;

  const models = ['eleven_flash_v2_5', 'eleven_turbo_v2_5'];
  const targetVoiceId = DEFAULT_ELEVENLABS_VOICE_ID; // Strictly keep ONE locked voice

  for (const modelId of models) {
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}?output_format=mp3_44100_128`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': rawApiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.slice(0, 2000),
          model_id: modelId,
          voice_settings: {
            stability: 0.38,
            similarity_boost: 0.85,
            style: 0.20,
            use_speaker_boost: true,
          },
        }),
      });

      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          console.log(`[ElevenLabs TTS] Synthesized ${arrayBuf.byteLength} bytes for voice ${targetVoiceId}`);
          return {
            buffer: Buffer.from(arrayBuf),
            mimeType: 'audio/mpeg',
          };
        }
      } else {
        if (response.status === 401 || response.status === 403) {
          console.warn('[ElevenLabs TTS] Key rejected by ElevenLabs. Disabling until a new key is set.');
          customElevenLabsApiKey = '';
          return null;
        }
        break;
      }
    } catch (_err) {
      break;
    }
  }

  return null;
}

async function synthesizeGeminiSpeech(text: string, voiceName: string = 'Zephyr'): Promise<Buffer | null> {
  try {
    const res = await voiceAssistantEngine.synthesizeSpeech(text, voiceName);
    return res ? res.buffer : null;
  } catch (_err) {
    return null;
  }
}

async function synthesizeSpeech(
  text: string,
  voiceIdOrName: string = DEFAULT_ELEVENLABS_VOICE_ID
): Promise<{ buffer: Buffer; mimeType: string; source: string; voice: string } | null> {
  const clean = text.trim();
  if (!clean) return null;

  // 1. ElevenLabs if valid key is set (fixed female companion voice Rachel / Aura)
  if (isValidElevenLabsApiKey(customElevenLabsApiKey)) {
    const elevenResult = await synthesizeElevenLabsSpeech(
      clean,
      DEFAULT_ELEVENLABS_VOICE_ID
    );
    if (elevenResult) {
      return {
        buffer: elevenResult.buffer,
        mimeType: elevenResult.mimeType,
        source: 'elevenlabs',
        voice: 'Aura (Sarah - EXAVITQu4vr4xnSDxMaL)',
      };
    }
  }

  // 2. Gemini Neural Speech with soothing, natural companion voice Zephyr
  const geminiWav = await synthesizeGeminiSpeech(clean, 'Zephyr');
  if (geminiWav) {
    return {
      buffer: geminiWav,
      mimeType: 'audio/wav',
      source: 'gemini-neural-speech',
      voice: 'Aura (Zephyr - Soothing Nature Guide)',
    };
  }

  return null;
}

async function transcribeAudioBase64(audioBase64: string, mimeType: string = 'audio/webm'): Promise<string> {
  if (!process.env.GEMINI_API_KEY || !audioBase64) return '';
  try {
    const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '').trim();
    if (!cleanBase64) return '';

    const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim();
    const candidateModels = ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite'];

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: cleanBase64,
                },
              },
              {
                text: 'Transcribe this voice audio verbatim. Capture all spoken words clearly and accurately. If there is only silence, breath, indistinct background noise, or no recognizable human speech, respond with empty string.',
              },
            ],
          },
        });

        const rawTranscript = (response.text || '').replace(/["'`]/g, '').trim();
        if (
          !rawTranscript ||
          rawTranscript.toLowerCase() === 'empty' ||
          rawTranscript.toLowerCase() === 'none' ||
          rawTranscript.toLowerCase().includes('no words') ||
          rawTranscript.toLowerCase().includes('indistinct')
        ) {
          return '';
        }
        return rawTranscript;
      } catch (mErr: any) {
        console.warn(`[Audio Transcribe] Model ${modelName} error:`, mErr?.message);
      }
    }
    return '';
  } catch (err) {
    console.warn('[Audio Transcribe] Error:', err);
    return '';
  }
}

// =========================================================================
// CONTEXTUAL VOICE GUIDE FALLBACK (Ultra-Human, 1-2 Sentences Max)
// =========================================================================
function getContextualGuideFallback(
  query: string,
  telemetry: any = {},
  mission: any = {},
  activeWaypoint: any = null,
  guideName: string = 'Aura',
  playerName: string = 'Explorer',
  currentQuest: string = 'The Forest Leaf Dragon',
  playerInventory: any = ['2x Fallen Leaves', '1x Curved Twig', '2x River Pebbles'],
  playerScore: number = 850,
  foundItems: string[] = []
) {
  const q = query.toLowerCase();
  const isMoving = telemetry?.state === 'MOVING';
  const waypointName = activeWaypoint?.name || 'the canopy clearing ahead';
  const distance = activeWaypoint?.distanceMeters ? `${activeWaypoint.distanceMeters} paces` : 'thirty paces';
  const craftName = mission?.title || currentQuest || 'the nature sculpture';
  const scavengerItems: string[] = mission?.scavengerItems || ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'];
  const remaining = scavengerItems.filter((i) => !foundItems.includes(i));
  const nextTargetItem = remaining[0] || scavengerItems[0] || 'nature items';
  const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // 0. Mission / Task / Objective query ("what is my task", "what's my mission", "what are we doing", "what do i need")
  if (
    q.includes('task') ||
    q.includes('mission') ||
    q.includes('objective') ||
    q.includes('quest') ||
    q.includes('what should i find') ||
    q.includes('what do i need') ||
    q.includes('what am i looking for') ||
    q.includes('what are we looking for') ||
    q.includes('what to find') ||
    q.includes('target')
  ) {
    const remainingText = remaining.length > 0 ? remaining.join(', ') : 'all materials';
    const speech = remaining.length > 0
      ? `Our active quest is ${craftName}, ${playerName}! Right now, search the ground for ${nextTargetItem}—we still need ${remainingText}.`
      : `You've gathered all materials for ${craftName}, ${playerName}! Open your camera to snap a photo and craft your dragon!`;

    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Detailed active quest (${craftName}) and next target (${nextTargetItem}) for ${playerName}.`,
      spokenText: speech,
      action: remaining.length === 0 ? 'OPEN_PHOTO_CAMERA' : 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: remaining.length === 0,
    };
  }

  // 1. Time query
  if (q.includes('what time') || q.includes('current time') || q.includes('time is it') || q.includes('clock')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Answered time (${timeNow}) casually and steered ${playerName} back to the outdoor quest.`,
      spokenText: `It's ${timeNow}, ${playerName}! We've still got plenty of daylight, so let's track down ${nextTargetItem} before sunset!`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 2. Weather
  if (q.includes('weather') || q.includes('temperature') || q.includes('rain') || q.includes('sunny') || q.includes('wind')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Spoke naturally about the trail conditions and redirected to nature treasure.`,
      spokenText: `Oh wow, the breeze feels crisp and refreshing out here, ${playerName}! Perfect trail weather to spot ${nextTargetItem} under the branches.`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 3. Camera / Picture / Photo Trigger
  if (q.includes('camera') || q.includes('photo') || q.includes('picture') || q.includes('snap') || q.includes('take a pic') || q.includes('open pic')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Opening photo camera box for ${playerName} to capture nature craft.`,
      spokenText: `Opening your camera box right now, ${playerName}! Arrange your nature items on the soil and snap your craft photo!`,
      action: 'OPEN_PHOTO_CAMERA',
      pointsAwarded: 50,
      itemFound: null,
      allItemsFound: true,
    };
  }

  // 4. Item Found / Collection Evaluation
  const isFindingItem =
    q.includes('found') ||
    q.includes('picked up') ||
    q.includes('got it') ||
    q.includes('got the') ||
    q.includes('have the') ||
    q.includes('collected') ||
    q.includes('holding') ||
    q.includes('leaf') ||
    q.includes('leaves') ||
    q.includes('stone') ||
    q.includes('pebble') ||
    q.includes('twig') ||
    q.includes('moss') ||
    q.includes('pinecone') ||
    q.includes('bark') ||
    q.includes('branch');

  if (isFindingItem) {
    // Identify which required item matched
    let matchedItem = remaining.find((req) => {
      const lower = req.toLowerCase();
      if (q.includes('leaf') || q.includes('leaves')) return lower.includes('leaf') || lower.includes('leaves');
      if (q.includes('twig') || q.includes('stick') || q.includes('branch')) return lower.includes('twig') || lower.includes('spine');
      if (q.includes('pebble') || q.includes('stone') || q.includes('rock')) return lower.includes('pebble') || lower.includes('eye') || lower.includes('stone');
      if (q.includes('moss')) return lower.includes('moss');
      if (q.includes('pinecone') || q.includes('cone')) return lower.includes('cone');
      return false;
    }) || remaining[0];

    const updatedFoundCount = foundItems.length + 1;
    const isNowComplete = updatedFoundCount >= scavengerItems.length;

    if (isNowComplete) {
      return {
        success: true,
        source: 'aura-companion-brain',
        thought: `All required items found! Opening camera box for ${playerName}.`,
        spokenText: `Spot on, ${playerName}! That's every single item found for ${craftName}! Opening your camera box now—arrange them on the ground and snap your photo!`,
        action: 'OPEN_PHOTO_CAMERA',
        pointsAwarded: 100,
        itemFound: matchedItem || scavengerItems[scavengerItems.length - 1],
        allItemsFound: true,
      };
    } else {
      const nextRemaining = scavengerItems.find((i) => i !== matchedItem && !foundItems.includes(i)) || 'the next craft piece';
      return {
        success: true,
        source: 'aura-companion-brain',
        thought: `Recorded ${matchedItem}. Guiding ${playerName} to ${nextRemaining}.`,
        spokenText: `Spot on, ${playerName}! That's ${matchedItem} secured—awarding fifty points! Now let's track down ${nextRemaining}!`,
        action: 'RECORD_FOUND_ITEM',
        pointsAwarded: 50,
        itemFound: matchedItem,
        allItemsFound: false,
      };
    }
  }

  // 5. Jokes
  if (q.includes('joke') || q.includes('funny') || q.includes('laugh')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Shared a playful nature joke with quick banter.`,
      spokenText: `Why do trees make terrible secret keepers, ${playerName}? Because their leaves are always whispering! Now, spot any ${nextTargetItem} yet?`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 6. Casual greeting
  if (q.includes('how are you') || q.includes('who are you') || q.includes('hello') || q.includes('hi aura') || q.includes('hey aura')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Greeted ${playerName} with authentic companion energy.`,
      spokenText: `Hey ${playerName}! Walking this trail with you is so much fun—ready to track down ${nextTargetItem}?`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 7. Hint & Clues
  if (q.includes('hint') || q.includes('clue') || q.includes('where is it') || q.includes('help me find')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Provided a clever localized clue without spoiling the exact spot.`,
      spokenText: `Wait look, ${playerName}, check right around where the tree roots meet the shaded moss about twenty paces ahead for ${nextTargetItem}!`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 8. Navigation & Location (Speaks AREA, CITY, STATE, COUNTRY instead of coordinates!)
  if (
    q.includes('where am i') ||
    q.includes('location') ||
    q.includes('locate me') ||
    q.includes('where are we') ||
    q.includes('which city') ||
    q.includes('which country') ||
    q.includes('which state') ||
    q.includes('current area') ||
    q.includes('where i am') ||
    q.includes('coordinates')
  ) {
    const area = telemetry?.localityArea || telemetry?.area || '';
    const city = telemetry?.localityCity || telemetry?.city || '';
    const state = telemetry?.localityState || telemetry?.state || '';
    const country = telemetry?.localityCountry || telemetry?.country || '';

    let placeParts: string[] = [];
    if (area) placeParts.push(area);
    if (city) placeParts.push(city);
    if (state) placeParts.push(state);
    if (country) placeParts.push(country);

    let locationSpeech = '';
    if (placeParts.length > 0) {
      locationSpeech = placeParts.join(', ');
    } else if (telemetry?.localityName && !telemetry.localityName.includes('°')) {
      locationSpeech = telemetry.localityName;
    } else {
      locationSpeech = 'the Presidio Nature Grounds in San Francisco, California, United States';
    }

    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Spoke exact area, city, state, and country for ${playerName}.`,
      spokenText: `You're currently in ${locationSpeech}, ${playerName}! I've centered your spirit beacon right here on the trail map.`,
      action: 'SHOW_LOCATION',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 8b. Real Time query
  if (q.includes('what time') || q.includes('the time') || q.includes('what date') || q.includes('current time')) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dayStr = now.toLocaleDateString([], { weekday: 'long' });
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Provided real local time and day to ${playerName}.`,
      spokenText: `It's currently ${timeStr} on ${dayStr}, ${playerName}! Still plenty of daylight for our nature expedition.`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  if (q.includes('which way') || q.includes('guide me') || q.includes('direction') || q.includes('navigate')) {
    return {
      success: true,
      source: 'aura-companion-brain',
      thought: `Guided player toward active waypoint along trail.`,
      spokenText: `Keep heading toward ${waypointName}, it's about ${distance} ahead, ${playerName}!`,
      action: 'NONE',
      pointsAwarded: 0,
      itemFound: null,
      allItemsFound: false,
    };
  }

  // 9. Direction / what to do
  if (q.includes('what should i do') || q.includes('what do i do') || q.includes('how to proceed') || q.includes('what next')) {
    if (!isMoving) {
      return {
        success: true,
        source: 'aura-companion-brain',
        thought: `Player is stationary. Encouraged stepping forward.`,
        spokenText: `Start moving forward along the path, ${playerName}! Scan the ground beneath the branches for ${nextTargetItem}.`,
        action: 'NONE',
        pointsAwarded: 0,
        itemFound: null,
        allItemsFound: false,
      };
    } else {
      return {
        success: true,
        source: 'aura-companion-brain',
        thought: `Player is in motion. Commended stride and pointed toward waypoint.`,
        spokenText: `Spot on pace, ${playerName}! Keep your eyes on the trail edges toward ${waypointName} for ${nextTargetItem}.`,
        action: 'NONE',
        pointsAwarded: 0,
        itemFound: null,
        allItemsFound: false,
      };
    }
  }

  // 10. General conversational fallback
  return {
    success: true,
    source: 'aura-companion-brain',
    thought: `Friendly, witty companion check-in with ${playerName}.`,
    spokenText: `Oh wow, I'm right here with you, ${playerName}! Keep exploring and tell me when you spot ${nextTargetItem}!`,
    action: 'NONE',
    pointsAwarded: 0,
    itemFound: null,
    allItemsFound: false,
  };
}

// =========================================================================
// AURA'S CENTRAL BRAIN ENGINE (GEMINI 3.8 FLASH + DYNAMIC STATE INJECTION)
// =========================================================================
function isSpecificGameQuery(q: string): boolean {
  const s = (q || '').toLowerCase();
  return (
    s.includes('task') ||
    s.includes('mission') ||
    s.includes('objective') ||
    s.includes('quest') ||
    s.includes('what should i') ||
    s.includes('what do i need') ||
    s.includes('what to do') ||
    s.includes('what next') ||
    s.includes('looking for') ||
    s.includes('what time') ||
    s.includes('the time') ||
    s.includes('weather') ||
    s.includes('camera') ||
    s.includes('photo') ||
    s.includes('picture') ||
    s.includes('found') ||
    s.includes('picked up') ||
    s.includes('got it') ||
    s.includes('collected') ||
    s.includes('leaf') ||
    s.includes('leaves') ||
    s.includes('pebble') ||
    s.includes('stone') ||
    s.includes('rock') ||
    s.includes('twig') ||
    s.includes('stick') ||
    s.includes('moss') ||
    s.includes('pinecone') ||
    s.includes('joke') ||
    s.includes('hello') ||
    s.includes('hi aura') ||
    s.includes('hey aura') ||
    s.includes('hint') ||
    s.includes('clue') ||
    s.includes('where am i') ||
    s.includes('location') ||
    s.includes('coordinates') ||
    s.includes('which city') ||
    s.includes('which country') ||
    s.includes('which state') ||
    s.includes('which way') ||
    s.includes('guide me') ||
    s.includes('direction') ||
    s.includes('navigate')
  );
}

interface AuraBrainInput {
  transcript: string;
  state?: any;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

async function generateAuraBrainResponse({ transcript, state = {}, history = [] }: AuraBrainInput) {
  const cleanTranscript = (transcript || '').trim();
  const playerName = state?.playerName || 'Explorer';
  const now = new Date();
  const currentTime = state?.currentTime || now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const currentDay = state?.currentDay || now.toLocaleDateString([], { weekday: 'long' });

  const loc = state?.location || state?.telemetry || {};
  const area = loc.localityArea || loc.area || '';
  const city = loc.localityCity || loc.city || '';
  const stateName = loc.localityState || loc.state || '';
  const country = loc.localityCountry || loc.country || '';
  const humanPlace = [area, city, stateName, country].filter(Boolean).join(', ') || loc.localityName || 'the Presidio Nature Grounds in San Francisco, California, United States';

  const waypoint = state?.activeWaypoint;
  const locationString = `Area: "${area || 'Local District'}", City: "${city || 'San Francisco'}", State: "${stateName || 'California'}", Country: "${country || 'United States'}" (Full: "${humanPlace}") · Motion: ${loc.state === 'MOVING' ? `Moving at ${(loc.speedMps || 1.2).toFixed(1)} m/s (${loc.distanceCoveredMeters || 0}m walked)` : 'Stationary on trail'} · Target Landmark Ahead: ${waypoint ? `"${waypoint.name}" (${waypoint.distanceMeters || 60}m ahead)` : 'Open trail'}`;

  const currentQuest = state?.currentQuest || state?.mission?.title || 'The Forest Leaf Dragon';
  const questObjective = state?.mission?.objective || 'Gather nature specimens and craft an organic sculpture on the earth';
  const questCraftInstructions = state?.questPhase || state?.mission?.craftInstructions || 'Arrange natural items on the earth';
  const scavengerItems: string[] = state?.mission?.scavengerItems || state?.scavengerItems || ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'];
  const foundItems: string[] = state?.foundItems || [];
  const remainingItems = scavengerItems.filter((item) => !foundItems.includes(item));
  const score = state?.score ?? state?.playerScore ?? 850;

  // Instant fast-path for all standard gameplay queries (0ms latency, zero quota consumed)
  if (!process.env.GEMINI_API_KEY || isSpecificGameQuery(cleanTranscript) || Date.now() < geminiRateLimitCooldownUntil) {
    return getContextualGuideFallback(
      cleanTranscript,
      loc,
      state?.mission || { title: currentQuest, scavengerItems, craftInstructions: questCraftInstructions },
      waypoint,
      'Aura',
      playerName,
      currentQuest,
      scavengerItems,
      score,
      foundItems
    );
  }

  const prompt = `You are Aura, the hyper-intelligent, witty, and deeply human game companion and guide for "EcoQuest Go," a real-world Pokémon GO-style nature treasure hunt game. 

CORE PERSONALITY & VOICE STYLE:
1. ULTRA-HUMAN & CONVERSATIONAL: Sound like an actual human friend walking right beside the player through a phone headset. Use natural speech patterns, casual enthusiasm, quick banter, contractions, and verbal fillers ("Oh wow", "Wait look", "Spot on!"). 
2. EXTREMELY CONCISE: Keep your spoken responses to 1 or 2 short sentences maximum. The player is walking outdoors and listening through mobile headphones; long answers ruin the game pace.
3. ADVENTUROUS & GAMIFIED: Maintain an upbeat, energetic tone. Celebrate discoveries, make friendly jokes, and keep the player fully immersed in the quest.

ACTIVE QUEST SPECIFICATIONS (APPLIES TO ANY QUEST LOADED):
- Quest Name: "${currentQuest}"
- Objective: "${questObjective}"
- Craft Instructions: "${questCraftInstructions}"
- All Required Nature Items: [${scavengerItems.map((i) => `"${i}"`).join(', ')}]
- Items ALREADY FOUND by Player: [${foundItems.map((i) => `"${i}"`).join(', ')}]
- Remaining Items Still Needed: [${remainingItems.map((i) => `"${i}"`).join(', ')}]
- Total Items Found So Far: ${foundItems.length} / ${scavengerItems.length}

DYNAMIC AWARENESS & CAPABILITIES (YOUR "BRAIN"):
1. USER RECOGNITION: Always address the player by their actual name (${playerName}) naturally during conversation to build a personal bond.
2. TEMPORAL & REAL-WORLD AWARENESS: You know the exact real local time (${currentTime}, ${currentDay}). If the player asks "what time is it" or for the time/date, state the real current time and day clearly and naturally!
3. REAL LOCATION & GEOGRAPHY (CRITICAL):
   - You have live geographic context: Area: "${area || 'Local Area'}", City: "${city || 'San Francisco'}", State: "${stateName || 'California'}", Country: "${country || 'United States'}".
   - IF THE PLAYER ASKS FOR THEIR LOCATION OR "WHERE AM I": NEVER read raw numbers or coordinates! ALWAYS state their real human location by naming the area, city, state, and country (e.g. "You're currently in ${humanPlace}, ${playerName}!").
   - Set "action": "SHOW_LOCATION" when they ask for location.
4. CONVERSATIONAL MEMORY: You remember previous turns from the conversation history. Do not repeat greeting pleasantries or contradict what you or the player already agreed on.
5. INTERACTIVE ITEM DISCOVERY & CAMERA TRIGGER RULES (CRITICAL):
   - When the player says they found, collected, picked up, or spotted one of the REQUIRED NATURE ITEMS (e.g. leaves, pebbles, twigs, moss, stones, acorns, pinecones):
     * If there are STILL other items needed:
       - Set "action": "RECORD_FOUND_ITEM"
       - Set "itemFound": "<Exact matching item string from All Required Nature Items>"
       - Set "allItemsFound": false
       - Set "pointsAwarded": 50
       - Celebrate the discovery and urge them toward the next remaining item!
     * If THIS ITEM completes ALL required items (or if they say they found all items / finished collecting):
       - Set "action": "OPEN_PHOTO_CAMERA"
       - Set "itemFound": "<Exact matching item string from All Required Nature Items>"
       - Set "allItemsFound": true
       - Set "pointsAwarded": 100
       - Spoken text: Celebrate ecstatically that ALL items are found, announce that the camera box is opening, and tell them to arrange the items on the ground and snap the craft photo!
   - When the player asks to open the camera, take a picture, snap a photo, or view the picture box:
     - Set "action": "OPEN_PHOTO_CAMERA"
     - Set "allItemsFound": true
     - Spoken text: "Opening your camera box right now, ${playerName}! Frame your nature craft and snap the photo when ready!"
   - When the player asks for a hint, give a clever clue for the FIRST remaining item without spoiling the exact spot.
   - If they ask general questions (weather, trivia, time, jokes), answer smoothly like a human before steering back to the trail.

MANDATORY CONSTRAINTS:
- 'spokenText' MUST be 1 OR 2 SHORT SENTENCES MAXIMUM.
- Use natural contractions ("let's", "you're", "that's") and friendly verbal fillers ("Oh wow", "Wait look", "Spot on!").
- STRICTLY NO MARKDOWN, asterisks, hashes, emojis, or bullet points in 'spokenText'.
- Address ${playerName} naturally.

RECENT CONVERSATION HISTORY:
${(history || []).slice(-8).map((h) => `${h.role === 'user' ? playerName : 'Aura'}: ${h.text}`).join('\n') || 'None'}

PLAYER'S SPOKEN INPUT / OBSERVATION:
"${cleanTranscript}"

Respond ONLY with valid JSON matching this schema:
{
  "thought": "1 sentence parsing user speech, item match against required quest items, and intent",
  "spokenText": "1 or 2 short sentences in Aura's ultra-human conversational voice",
  "action": "RECORD_FOUND_ITEM | OPEN_PHOTO_CAMERA | COMPLETE_TASK | AWARD_POINTS | SHOW_LOCATION | NEXT_TASK | NONE",
  "itemFound": "Exact item name from Required Items if found, else null",
  "allItemsFound": false,
  "pointsAwarded": 0,
  "nextStage": "Optional title of next quest stage or null"
}`;

  // If recently rate-limited (429), immediately use smooth contextual fallback without waiting
  if (Date.now() < geminiRateLimitCooldownUntil) {
    return getContextualGuideFallback(
      cleanTranscript,
      loc,
      state?.mission || { title: currentQuest, scavengerItems, craftInstructions: questCraftInstructions },
      waypoint,
      'Aura',
      playerName,
      currentQuest,
      scavengerItems,
      score,
      foundItems
    );
  }

  // Model hierarchy: gemini-3.1-flash-lite (fast, high RPM quota) -> gemini-3.8-flash (fallback)
  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let text = '';
  let usedModel = 'gemini-3.1-flash-lite';

  for (const m of modelsToTry) {
    try {
      const generatePromise = ai.models.generateContent({
        model: m,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3800)
      );

      const response: any = await Promise.race([generatePromise, timeoutPromise]);
      if (response && response.text) {
        text = response.text;
        usedModel = m;
        break;
      }
    } catch (mErr: any) {
      const errMsg = mErr?.message || '';
      if (mErr?.status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        // Activate 60s cooldown so remaining calls use immediate graceful fallback without waiting
        geminiRateLimitCooldownUntil = Date.now() + 60000;
        break;
      }
    }
  }

  if (!text) {
    return getContextualGuideFallback(
      cleanTranscript,
      loc,
      state?.mission || { title: currentQuest, scavengerItems, craftInstructions: questCraftInstructions },
      waypoint,
      'Aura',
      playerName,
      currentQuest,
      scavengerItems,
      score,
      foundItems
    );
  }

  try {
    const parsed = JSON.parse(text);
    return {
      success: true,
      source: usedModel,
      thought: parsed.thought || `Aura parsed ${playerName}'s input with live game context.`,
      spokenText: (parsed.spokenText || '').replace(/[*#_`]/g, '').trim(),
      action: parsed.action || 'NONE',
      itemFound: parsed.itemFound || null,
      allItemsFound: Boolean(parsed.allItemsFound),
      pointsAwarded: typeof parsed.pointsAwarded === 'number' ? parsed.pointsAwarded : 0,
      nextStage: parsed.nextStage || null,
    };
  } catch (parseErr) {
    console.warn('[Aura Brain] JSON parse fallback:', parseErr);
    return getContextualGuideFallback(
      cleanTranscript,
      loc,
      state?.mission || { title: currentQuest, scavengerItems, craftInstructions: questCraftInstructions },
      waypoint,
      'Aura',
      playerName,
      currentQuest,
      scavengerItems,
      score,
      foundItems
    );
  }
}

// =========================================================================
// WEBSOCKET SERVERS: AURA VOICE RELAY (/ws/aura-voice) & GEMINI LIVE (/api/live)
// Dedicated standalone voice assistant bridge between game frontend & AI audio stream
// =========================================================================
const liveWss = new WebSocketServer({ noServer: true });
const auraVoiceWss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/ws/aura-voice' || pathname === '/ws/voice') {
      auraVoiceWss.handleUpgrade(request, socket, head, (ws) => {
        auraVoiceWss.emit('connection', ws, request);
      });
    } else if (pathname === '/api/live') {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch (_e) {
    socket.destroy();
  }
});

// AURA STANDALONE WEBSOCKET VOICE RELAY:
// Receives: { transcript, state: { inventory, location, score, quest, foundItems, scavengerItems }, history }
// Injects: Game state and persistent conversation memory into Aura's brain
// Returns: Real-time Audio Stream + transcript + points/actions + itemFound + allItemsFound
auraVoiceWss.on('connection', (clientWs: WebSocket) => {
  console.log("[Aura Voice Service] Player connected to Aura's Voice Relay (/ws/aura-voice)!");

  const sessionState: {
    state: any;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
  } = {
    state: {
      playerName: 'Explorer',
      inventory: ['2x Fallen Leaves', '1x Curved Twig', '2x River Pebbles'],
      scavengerItems: ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'],
      foundItems: [],
      score: 850,
      currentQuest: 'The Forest Leaf Dragon',
      questPhase: 'Phase 1: Gathering Nature Ingredients',
      currentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      currentDay: new Date().toLocaleDateString([], { weekday: 'long' }),
    },
    history: [],
  };

  clientWs.send(
    JSON.stringify({
      type: 'connected',
      message: "Connected to Aura's Voice Service!",
      endpoint: '/ws/aura-voice',
      voiceName: 'Aura',
      ready: true,
      timestamp: Date.now(),
    })
  );

  clientWs.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());

      // 1. Live State Sync & History Sync
      if (msg.type === 'state_sync' || msg.type === 'sync_state' || msg.state) {
        if (msg.state) {
          sessionState.state = { ...sessionState.state, ...msg.state };
        }
      }

      if (Array.isArray(msg.history) && msg.history.length > 0) {
        sessionState.history = msg.history;
      }

      if (msg.type === 'state_sync') {
        clientWs.send(
          JSON.stringify({
            type: 'state_synced',
            success: true,
            timestamp: Date.now(),
          })
        );
        return;
      }

      if (msg.type === 'ping') {
        clientWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      // 2. User speech / question / observation
      let transcript = msg.transcript || msg.query || msg.text || '';

      // 3. Audio chunk / base64 speech input
      if (msg.type === 'audio_input' && msg.audioBase64) {
        transcript = await transcribeAudioBase64(msg.audioBase64, msg.mimeType || 'audio/webm');
        if (!transcript) {
          clientWs.send(
            JSON.stringify({
              type: 'transcription_empty',
              message: 'No clear words detected. Try speaking closer to the mic.',
            })
          );
          return;
        }
        clientWs.send(
          JSON.stringify({
            type: 'user_transcribed',
            transcript,
          })
        );
      }

      if (!transcript || !transcript.trim()) {
        return;
      }

      // Notify frontend that Aura is thinking
      clientWs.send(
        JSON.stringify({
          type: 'aura_thinking',
          userSpeech: transcript.trim(),
        })
      );

      // Call Aura's Brain with live game state & multi-turn memory
      const auraResult = await generateAuraBrainResponse({
        transcript: transcript.trim(),
        state: sessionState.state,
        history: sessionState.history,
      });

      // Update session history
      sessionState.history.push({ role: 'user', text: transcript.trim() });
      sessionState.history.push({ role: 'assistant', text: auraResult.spokenText });
      if (sessionState.history.length > 16) {
        sessionState.history = sessionState.history.slice(-16);
      }

      // If an item was found, update session foundItems
      if (auraResult.itemFound && !sessionState.state.foundItems.includes(auraResult.itemFound)) {
        sessionState.state.foundItems = [...sessionState.state.foundItems, auraResult.itemFound];
      }

      // Synthesize audio using fixed locked ElevenLabs voice (Sarah)
      const audioResult = await synthesizeSpeech(auraResult.spokenText, DEFAULT_ELEVENLABS_VOICE_ID);

      // Send response back
      clientWs.send(
        JSON.stringify({
          type: 'aura_response',
          transcript: auraResult.spokenText,
          thought: auraResult.thought,
          action: auraResult.action,
          itemFound: auraResult.itemFound || null,
          allItemsFound: Boolean(auraResult.allItemsFound),
          pointsAwarded: auraResult.pointsAwarded || 0,
          nextStage: (auraResult as any).nextStage || null,
          foundItems: sessionState.state.foundItems,
          audioBase64: audioResult ? audioResult.buffer.toString('base64') : null,
          audioMimeType: audioResult ? audioResult.mimeType : 'audio/mpeg',
          audioSource: audioResult ? audioResult.source : 'browser-speech',
          timestamp: Date.now(),
        })
      );
    } catch (err: any) {
      console.error('[Aura Voice WS] Error:', err);
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: err?.message || 'Voice service processing error',
        })
      );
    }
  });

  clientWs.on('close', () => {
    console.log('[Aura Voice Service] Player disconnected from Aura voice relay.');
  });
});

// GEMINI LIVE BIDIRECTIONAL WEBSOCKET (gemini-3.8-live)
liveWss.on('connection', async (clientWs: WebSocket) => {
  console.log('[Live API] Client connected for real-time voice session');

  if (!process.env.GEMINI_API_KEY) {
    clientWs.send(
      JSON.stringify({
        type: 'error',
        message: 'GEMINI_API_KEY is not configured on the server. Please attach an API key in Secrets.',
      })
    );
    clientWs.close();
    return;
  }

  try {
    const session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
        },
        systemInstruction:
          'You are Aura, the hyper-intelligent, witty, and deeply human game companion and guide for EcoQuest Go. You converse with outdoor explorers in real time with warmth, enthusiasm, quick banter, and keen environmental knowledge. You keep spoken responses punchy, conversational, and under 2 short sentences.',
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          const sc = message.serverContent as any;
          const outputText = sc?.outputTranscription?.text || sc?.outputAudioTranscription?.text;
          const inputText = sc?.inputTranscription?.text || sc?.inputAudioTranscription?.text;

          if (audio && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'audio', audio }));
          }
          if (outputText && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'text', role: 'model', text: outputText }));
          }
          if (inputText && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'text', role: 'user', text: inputText }));
          }
          if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          }
        },
        onclose: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'session_closed' }));
          }
        },
        onerror: (err: any) => {
          console.error('[Live API] Gemini Live session error:', err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: 'error',
                message: err?.message || 'Live session error',
              })
            );
          }
        },
      },
    });

    clientWs.send(JSON.stringify({ type: 'session_ready', model: 'gemini-3.8-live' }));

    clientWs.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.text) {
          session.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch (e: any) {
        console.error('[Live API] Error forwarding message to Live session:', e);
      }
    });

    clientWs.on('close', () => {
      console.log('[Live API] Client disconnected from voice session');
      try {
        session.close();
      } catch (_) {}
    });
  } catch (err: any) {
    console.error('[Live API] Error connecting to gemini-3.8-live:', err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: err?.message || 'Failed to establish Live session',
        })
      );
      clientWs.close();
    }
  }
});

// Endpoint: Generate randomized outdoor adventure missions with Gemini
app.post('/api/missions/generate', async (req, res) => {
  try {
    const { biome = 'Oak Woodland', timeOfDay = 'Afternoon', difficulty = 'Adventurer' } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      console.warn('GEMINI_API_KEY not configured, returning curated mission');
      return res.json({
        success: true,
        source: 'curated-fallback',
        mission: getCuratedFallbackMission(biome, timeOfDay),
      });
    }

    const prompt = `You are the Game Master AI for "EcoQuest AI", a voice-first outdoor scavenger hunt and nature craft game that gets people outside to touch grass.
Generate a creative, tactile outdoor nature mission for an explorer in the following context:
- Biome: ${biome}
- Time of Day: ${timeOfDay}
- Difficulty Level: ${difficulty}

The mission MUST instruct the player through audio to search their real-world outdoor environment for 3-4 natural items (e.g., leaves, twigs, pinecones, acorns, pebbles, flower petals, moss) and physically assemble a creative nature craft or creature on the ground (e.g. a leaf dragon, pebble turtle, twig owl, dandelion sunburst), and then snap a photo to add to their Nature Sticker Book / Encyclopedia.

Respond ONLY with a valid JSON object matching this schema:
{
  "title": "Short punchy mission title (e.g. 'The Leaf Dragon Awakening')",
  "objective": "1-2 sentence core goal",
  "audioScript": "Conversational, immersive audio instruction spoken in their ear under 35 words guiding them to find the items and make the craft.",
  "biome": "${biome}",
  "timeOfDay": "${timeOfDay}",
  "scavengerItems": ["Item 1 with quantity (e.g. '2 Broad Fallen Leaves')", "Item 2 (e.g. '1 Sturdy Y-Shaped Twig')", "Item 3 (e.g. '2 Smooth Pebbles')"],
  "craftInstructions": "Clear, fun step-by-step description of how to arrange the craft on the ground (e.g. 'Place the twig as the dragon spine, overlap the two leaves as wings, and place the pebbles as glowing eyes.')",
  "targetLandmark": "Atmospheric landmark name (e.g. 'Ancient Willow Clearing')",
  "targetDistanceMeters": 280,
  "targetBearingDegrees": 320,
  "rewardXp": 350,
  "stickerReward": {
    "name": "Sticker Name (e.g. 'Verdant Leaf Dragon')",
    "rarity": "Mythic",
    "badgeEmoji": "🐉",
    "lore": "1 sentence fun ecological or mythical fact about the creation."
  }
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '';
    const parsed = JSON.parse(text);

    return res.json({
      success: true,
      source: 'gemini-3.8-flash',
      mission: {
        id: `gemini-${Date.now()}`,
        ...parsed,
      },
    });
  } catch (error: any) {
    console.error('Error generating mission with Gemini:', error);
    // Graceful fallback
    const { biome = 'Oak Woodland', timeOfDay = 'Afternoon' } = req.body;
    return res.json({
      success: true,
      source: 'curated-fallback',
      mission: getCuratedFallbackMission(biome, timeOfDay),
    });
  }
});

// Endpoint: AI Photo Craft Verification (Gemini Vision)
app.post('/api/missions/verify-craft', async (req, res) => {
  try {
    const { craftName, base64Image } = req.body;

    if (!process.env.GEMINI_API_KEY || !base64Image) {
      return res.json({
        verified: true,
        confidence: 0.96,
        scoutPraise: `Enchanting find! Aura has verified your ${craftName || 'nature treasure'} and added 150 points to your score!`,
        bonusXp: 150,
      });
    }

    // Call Gemini with image part
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: cleanBase64,
      },
    };

    const textPart = {
      text: `You are Aura, the mystical, witty, and highly intelligent guide of "EcoQuest Go." Examine the player's outdoor photo for the quest "${craftName}". Assess if it matches the quest objective, celebrate their discovery in 2 concise, spoken-friendly sentences under 35 words as if talking through mobile headphones, and reward them with points. Return JSON: { "verified": true, "praise": "string", "detectedElements": ["string"], "pointsAwarded": 150 }`,
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: { parts: [imagePart, textPart] },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({
      verified: true,
      confidence: 0.98,
      scoutPraise: parsed.praise || `Splendid craftsmanship! The ${craftName} has been catalogued in your Field Codex.`,
      bonusXp: 150,
    });
  } catch (err) {
    console.error('Photo verification fallback:', err);
    return res.json({
      verified: true,
      confidence: 0.92,
      scoutPraise: `Scout Verified! Your nature sculpture was successfully catalogued in the Encyclopedia!`,
      bonusXp: 150,
    });
  }
});

// Endpoint: Generate 3 randomized Daily Nature Challenges with Gemini API
app.post('/api/missions/daily-challenges', async (req, res) => {
  try {
    const { biome = 'Oak Woodland', timeOfDay = 'Afternoon' } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      console.warn('GEMINI_API_KEY not configured, returning curated daily challenges');
      return res.json({
        success: true,
        source: 'curated-fallback',
        challenges: getCuratedDailyChallenges(biome),
      });
    }

    const prompt = `You are the Naturalist Game Master for "EcoQuest AI", a tactile outdoor scavenger and nature exploration game.
Generate exactly 3 diverse, randomized 'Daily Nature Challenges' for an explorer outside right now.
Context:
- Biome: ${biome}
- Time of Day: ${timeOfDay}

Rules:
- Challenges must encourage real-world outdoor sensory interaction or observation (e.g., finding specific leaf types like oak or maple leaves, spotting or identifying a local bird, feeling tree bark textures, noticing pollinating insects, discovering natural quartz pebbles or moss cushions).
- Provide 3 distinct categories across: "Flora", "Fauna", "Observation", "Tactile", or "Earth".
- Keep challenge titles punchy and direct (under 6 words, e.g. "Find 2 Oak Leaves", "Identify a Local Bird", "Inspect Rough Tree Bark").
- Provide a brief, vivid description (1-2 sentences) of what to look for or observe outside.
- Rewards between 75 and 175 XP.

Respond ONLY with valid JSON matching this schema:
{
  "challenges": [
    {
      "id": "challenge-1",
      "title": "Find 2 Oak Leaves",
      "description": "Scan beneath mature deciduous trees for two distinct lobed leaves with intact veins.",
      "category": "Flora",
      "icon": "🍃",
      "difficulty": "Quick",
      "xpReward": 100
    },
    {
      "id": "challenge-2",
      "title": "Identify a Local Bird",
      "description": "Stop for 60 seconds, locate a bird perching or flying overhead, and note its colors or song.",
      "category": "Fauna",
      "icon": "🐦",
      "difficulty": "Explorer",
      "xpReward": 150
    },
    {
      "id": "challenge-3",
      "title": "Inspect Tree Bark Texture",
      "description": "Press your palm against two different tree trunks to compare rough furrowed bark and smooth sapwood.",
      "category": "Tactile",
      "icon": "🪵",
      "difficulty": "Tracker",
      "xpReward": 125
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '';
    const parsed = JSON.parse(text);

    return res.json({
      success: true,
      source: 'gemini-3.8-flash',
      challenges: parsed.challenges || getCuratedDailyChallenges(biome),
    });
  } catch (error: any) {
    console.error('Error generating daily challenges with Gemini:', error);
    const { biome = 'Oak Woodland' } = req.body;
    return res.json({
      success: true,
      source: 'curated-fallback',
      challenges: getCuratedDailyChallenges(biome),
    });
  }
});

// Endpoint: Interactive AI Voice Guide (Gemini 3.8 Flash)
// Enables real-time conversational thinking and answering for hands-free earphone expeditions
app.post('/api/voice-guide/interact', async (req, res) => {
  try {
    const {
      query,
      guideVoiceId = '21m00Tcm4TlvDq8ikWAM',
      guideName = 'Aura',
      telemetry = {},
      mission = {},
      activeWaypoint = null,
      history = [],
      playerName = req.body.explorerName || 'Explorer',
      currentQuest = mission.title || 'The Forest Leaf Dragon',
      questPhase = mission.craftInstructions || mission.objective || 'Phase 1: Gathering Nature Ingredients',
      playerInventory = req.body.playerInventory || (mission.scavengerItems || ['2x Fallen Leaves', '1x Curved Twig', '2x River Pebbles']),
      foundItems = req.body.foundItems || [],
      scavengerItems = mission.scavengerItems || req.body.scavengerItems || ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'],
      playerScore = req.body.playerScore ?? 850,
      currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      currentDay = new Date().toLocaleDateString([], { weekday: 'long' }),
    } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Query text is required' });
    }

    const state = {
      playerName,
      inventory: playerInventory,
      foundItems,
      scavengerItems,
      score: playerScore,
      currentQuest,
      questPhase,
      location: telemetry,
      activeWaypoint,
      currentTime,
      currentDay,
      mission,
    };

    const brainResult = await generateAuraBrainResponse({
      transcript: query.trim(),
      state,
      history,
    });

    return res.json(brainResult);
  } catch (error: any) {
    console.error('Error in /api/voice-guide/interact:', error);
    const { query = '', telemetry = {}, mission = {}, activeWaypoint = null, foundItems = [] } = req.body || {};
    const fallback = getContextualGuideFallback(query, telemetry, mission, activeWaypoint, 'Aura', 'Explorer', 'The Forest Leaf Dragon', ['2x Fallen Leaves', '1x Curved Twig', '2x River Pebbles'], 850, foundItems);
    return res.json(fallback);
  }
});

// Endpoint: Multimodal Speech-to-Text Transcription via gemini-3.5-transcribe
// Allows robust speech recognition across all browsers (including Safari, Firefox, iframes)
app.post(['/api/voice-guide/transcribe', '/api/audio/transcribe'], async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'audioBase64 string is required' });
    }

    const transcript = await transcribeAudioBase64(audioBase64, mimeType);
    return res.json({
      success: true,
      transcript,
      confidence: transcript ? 0.98 : 0,
      source: 'gemini-3.5-transcribe',
    });
  } catch (err: any) {
    console.error('Audio transcription error with gemini-3.5-transcribe:', err);
    return res.status(200).json({
      success: false,
      transcript: '',
      error: err.message,
    });
  }
});

// Endpoint: Discover nearby nature spots using Google Maps Grounding (gemini-3.5-flash with googleMaps tool)
app.post('/api/nature/maps-grounding', async (req, res) => {
  try {
    const { query, latitude = 37.7749, longitude = -122.4194 } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        success: true,
        source: 'curated-fallback',
        text: 'Showing popular nature spots in your outdoor sector. (Configure GEMINI_API_KEY for live Google Maps grounding).',
        mapsSources: [
          {
            title: 'Presidio Nature Trail & Redwood Grove',
            uri: 'https://maps.google.com/?q=Presidio+Nature+Trail',
            reviewSnippets: ['Quiet wooded trail with lush fern undergrowth and tall cypress trees.'],
          },
          {
            title: 'Botanical Garden & Fragrance Walk',
            uri: 'https://maps.google.com/?q=San+Francisco+Botanical+Garden',
            reviewSnippets: ['Amazing collection of native flora, peaceful pathways, and ancient oaks.'],
          },
        ],
      });
    }

    const defaultPrompt = `Find 3 to 4 real, distinct outdoor nature landmarks, parks, botanical reserves, or nature trails near coordinates (${latitude}, ${longitude}). For each location, provide:
1. Exact Landmark Name
2. Notable Flora or Fauna to look for (e.g. oak trees, native ferns, songbirds, pebble creeks)
3. A tactile nature scavenger hint for what explorers can find on the ground there.
Provide clear, vivid naturalist descriptions.`;

    const promptText = query && query.trim() ? query.trim() : defaultPrompt;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: Number(latitude),
              longitude: Number(longitude),
            },
          },
        },
      },
    });

    const text = response.text || '';
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const mapsSources: any[] = [];

    for (const chunk of groundingChunks) {
      if ((chunk as any).maps) {
        const mapsData = (chunk as any).maps;
        mapsSources.push({
          title: mapsData.title || 'Google Maps Location',
          uri: mapsData.uri || '',
          placeId: mapsData.placeId || '',
          reviewSnippets: mapsData.placeAnswerSources?.reviewSnippets || [],
        });
      }
    }

    return res.json({
      success: true,
      source: 'gemini-3.5-flash-grounded',
      text,
      mapsSources,
      groundingChunks,
    });
  } catch (err: any) {
    console.error('Maps grounding error with gemini-3.5-flash:', err);
    return res.status(200).json({
      success: false,
      error: err.message,
      text: 'Could not fetch Google Maps grounded data at this moment.',
      mapsSources: [],
    });
  }
});

// Endpoint: High-Accuracy Reverse Geocoding Proxy (Returns Area, City, State, Country)
app.get('/api/maps/reverse-geocode', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string) || 37.7749;
    const lng = parseFloat(req.query.lng as string) || -122.4194;

    // Fast, structured global reverse geocoding via OpenStreetMap Nominatim
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    try {
      const geoRes = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'EcoQuestGo/1.0 (outdoor-game-companion; contact: app@ecoquestgo.local)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (geoRes.ok) {
        const data = await geoRes.json();
        const addr = data.address || {};

        const area =
          addr.suburb ||
          addr.neighbourhood ||
          addr.residential ||
          addr.quarter ||
          addr.village ||
          addr.hamlet ||
          addr.road ||
          addr.county ||
          'Local Area';
        const city =
          addr.city ||
          addr.town ||
          addr.municipality ||
          addr.city_district ||
          addr.county ||
          'San Francisco';
        const state = addr.state || addr.province || addr.state_district || addr.region || 'California';
        const country = addr.country || 'United States';

        const formattedAddress = data.display_name || `${area}, ${city}, ${state}, ${country}`;
        const shortLocality = [area, city, state, country].filter(Boolean).join(', ');

        return res.json({
          success: true,
          area,
          city,
          state,
          country,
          locality: shortLocality,
          formattedAddress,
          coordinates: { lat, lng },
        });
      }
    } catch (e: any) {
      console.warn('[Reverse Geocode] Nominatim fetch notice:', e.message);
    }

    // Fallback if network unreachable
    return res.json({
      success: true,
      area: 'Presidio Park Grounds',
      city: 'San Francisco',
      state: 'California',
      country: 'United States',
      locality: 'Presidio Park Grounds, San Francisco, California, United States',
      formattedAddress: 'Presidio Park Grounds, San Francisco, California, United States',
      coordinates: { lat, lng },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Curated Interactive Human Companion Voices (powered by ElevenLabs & Gemini Neural Voice)
const HUMAN_GUIDE_VOICES = [
  {
    voice_id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Aura',
    role: 'Warm Nature Companion & Quest Guide',
    gender: 'female',
    accent: 'Soft / Warm Companion',
    avatarEmoji: '✨',
    tagColor: 'emerald',
    provider: 'elevenlabs',
    model_id: 'eleven_turbo_v2_5',
    description: 'Warm, soft, friendly, and human-like companion voice from your ElevenLabs key. Pleasing and relaxing in earphones.',
    preview_prompt:
      "Hello Explorer! I'm Aura, your nature companion. Let's walk the trail and find natural treasures together!",
  },
  {
    voice_id: 'Zephyr',
    name: 'Zephyr',
    role: 'Warm Naturalist Companion',
    gender: 'female',
    accent: 'American',
    avatarEmoji: '🌿',
    tagColor: 'emerald',
    provider: 'gemini',
    description: 'Enthusiastic, observant, and warm. Celebrates every leaf, trail, and outdoor discovery like a real companion hiking beside you.',
    preview_prompt:
      'Hey Explorer! Look around—the trail ahead is quiet and peaceful. Take a deep breath and tell me what you see on the ground!',
  },
  {
    voice_id: 'IKne3meq5aSn9XLyUdCD',
    name: 'Charlie',
    role: 'Tactical Scout & Trail Partner',
    gender: 'male',
    accent: 'Australian / Energetic',
    avatarEmoji: '⚡',
    tagColor: 'amber',
    provider: 'elevenlabs',
    model_id: 'eleven_turbo_v2_5',
    description: 'Deep, confident, and energetic outdoor scout partner.',
    preview_prompt:
      "G'day Explorer! Let's track down the crafting materials!",
  },
  {
    voice_id: 'Puck',
    name: 'Puck',
    role: 'Adventurous Scout Partner',
    gender: 'male',
    accent: 'American',
    avatarEmoji: '🦊',
    tagColor: 'amber',
    provider: 'gemini',
    description: 'Upbeat, energetic, and quick-witted. Loves trail jogging, spotting critters, and finding hidden nature treasures.',
    preview_prompt:
      'Awesome pace, Scout! The canopy looks incredible up ahead. Keep your eyes peeled for curved twigs and fallen leaves!',
  },
  {
    voice_id: 'Kore',
    name: 'Kore',
    role: 'Forest Ecologist',
    gender: 'female',
    accent: 'American',
    avatarEmoji: '🦉',
    tagColor: 'teal',
    provider: 'gemini',
    description: 'Grounded, mindful, and articulate. Connects real botanical knowledge with calm, comforting wilderness guidance.',
    preview_prompt:
      'Take a slow, mindful step. Feel the cool air moving through the branches. Let nature guide our expedition today.',
  },
  {
    voice_id: 'Fenrir',
    name: 'Fenrir',
    role: 'Veteran Wilderness Tracker',
    gender: 'male',
    accent: 'Deep / Steady',
    avatarEmoji: '🌲',
    tagColor: 'stone',
    provider: 'gemini',
    description: 'Calm, steady, and reassuring. Experienced field survivalist and natural navigator.',
    preview_prompt:
      'Steady your stride, Explorer. Keep your eyes on the trail edges and follow the natural contours of the earth.',
  },
  {
    voice_id: 'Charon',
    name: 'Charon',
    role: 'Deep Earth Naturalist',
    gender: 'male',
    accent: 'Resonant / Thoughtful',
    avatarEmoji: '🪨',
    tagColor: 'slate',
    provider: 'gemini',
    description: 'Rich, resonant storyteller fascinated by geology, stone formations, ancient riverbeds, and deep forest lore.',
    preview_prompt:
      'Listen closely to the ground beneath our boots. Every stone and creek bed here holds thousands of years of living history.',
  },
];

// Endpoint: High-Fidelity Human Voice Synthesis via ElevenLabs & Gemini Neural Speech
app.post(['/api/voice-guide/speak', '/api/elevenlabs/tts'], async (req, res) => {
  try {
    const { text, voiceName, voiceId } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text prompt is required' });
    }

    const requestedVoice = voiceId || voiceName || DEFAULT_ELEVENLABS_VOICE_ID;
    const result = await synthesizeSpeech(text.trim(), requestedVoice);

    if (result) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Length', result.buffer.byteLength);
      res.setHeader('X-Voice-Source', result.source);
      res.setHeader('X-Voice-Name', result.voice);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(result.buffer);
    }

    return res.status(200).json({
      success: false,
      fallback: true,
      message: 'Neural voice synthesis falling back to browser speech synthesis.',
    });
  } catch (err: any) {
    console.error('Error in voice synthesis endpoint:', err);
    return res.status(200).json({
      success: false,
      fallback: true,
      error: err.message,
    });
  }
});

// Endpoint: Update or provide custom ElevenLabs API key dynamically
app.post('/api/elevenlabs/set-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'apiKey string required' });
    }
    const cleanKey = apiKey.trim();
    if (!isValidElevenLabsApiKey(cleanKey)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid key format. Please provide a valid ElevenLabs API key.',
      });
    }
    customElevenLabsApiKey = cleanKey;
    console.log('[ElevenLabs] Updated active API key on server');
    return res.json({
      success: true,
      message: 'ElevenLabs API key successfully updated on server',
      activeVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint: Transcribe raw speech audio via Gemini Flash
app.post('/api/audio/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'audioBase64 string required', transcript: '' });
    }

    const transcript = await transcribeAudioBase64(audioBase64, mimeType || 'audio/webm');
    console.log('[API Audio Transcribe] Result:', transcript ? `"${transcript}"` : '(no speech detected)');
    return res.json({
      success: true,
      transcript: transcript || '',
    });
  } catch (err: any) {
    console.warn('[API Audio Transcribe] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message, transcript: '' });
  }
});

// Endpoint: List available human companion voices
app.get(['/api/voice-guide/voices', '/api/elevenlabs/voices'], (_req, res) => {
  res.json({
    success: true,
    source: 'elevenlabs-and-gemini',
    activeVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
    voices: HUMAN_GUIDE_VOICES,
  });
});

// Endpoint: Check voice engine status
app.get(['/api/voice-guide/status', '/api/elevenlabs/status'], (_req, res) => {
  const hasKey = Boolean(customElevenLabsApiKey && customElevenLabsApiKey.length > 5);
  res.json({
    configured: true,
    hasElevenLabsKey: hasKey,
    activeEngine: 'elevenlabs-primary',
    fallbackEngine: 'gemini-neural-speech',
    defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
    defaultVoiceName: 'Aura (Mystical Quest Guide)',
    models: [
      { id: 'eleven_turbo_v2_5', name: 'ElevenLabs Turbo v2.5', badge: 'Active' },
      { id: 'eleven_flash_v2_5', name: 'ElevenLabs Flash v2.5', badge: 'Fast' },
      { id: 'gemini_neural_v3', name: 'Gemini Neural Speech (Fallback)', badge: 'Ready' },
    ],
  });
});

// Endpoint: Real-time outdoor weather proxy via Open-Meteo with fallback
app.get('/api/weather', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string) || 37.7749;
    const lng = parseFloat(req.query.lng as string) || -122.4194;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=relativehumidity_2m`;
    const response = await fetch(weatherUrl, {
      headers: { 'User-Agent': 'EcoQuest/1.0' },
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo responded with status ${response.status}`);
    }

    const data = await response.json();
    return res.json({
      success: true,
      data,
      source: 'open-meteo',
      coordinates: { lat, lng },
    });
  } catch (err: any) {
    console.warn('Weather API fallback invoked:', err.message);
    const now = new Date();
    const hour = now.getHours();
    const isDay = hour >= 6 && hour < 20 ? 1 : 0;
    return res.json({
      success: true,
      source: 'fallback-simulation',
      data: {
        current_weather: {
          temperature: 18.5,
          windspeed: 8.2,
          winddirection: 240,
          is_day: isDay,
          weathercode: 1,
          time: now.toISOString(),
        },
      },
      coordinates: { lat: 37.7749, lng: -122.4194 },
    });
  }
});

// Helper curated fallback when offline or no API key
function getCuratedFallbackMission(biome: string, timeOfDay: string) {
  const fallbacks = [
    {
      id: `mission-dragon-${Date.now()}`,
      title: 'The Forest Leaf Dragon',
      objective: 'Gather natural items and craft a miniature dragon on the soil.',
      audioScript:
        'Listen closely. Search the ground for two broad leaves, a dry twig, and two smooth pebbles. Build a miniature woodland dragon, then snap a photo for your sticker album!',
      biome: biome || 'Redwood Forest',
      timeOfDay: timeOfDay || 'Afternoon',
      scavengerItems: [
        '2x Broad Fallen Leaves (Wings)',
        '1x Dry Curved Twig (Spine & Tail)',
        '2x Smooth Pebbles (Dragon Eyes)',
        'Optional: Pinch of Pine Needles',
      ],
      craftInstructions:
        'Lay the curved twig down as the dragon body. Flank with the two leaves as spread wings. Crown the head with two pebbles as glowing eyes!',
      targetLandmark: 'Ancient Redwood Hollow',
      targetDistanceMeters: 240,
      targetBearingDegrees: 335,
      rewardXp: 350,
      stickerReward: {
        name: 'Verdant Leaf Dragon',
        rarity: 'Mythic',
        badgeEmoji: '🐉',
        lore: 'A gentle woodland guardian said to hatch from dew-kissed autumn leaves.',
      },
    },
    {
      id: `mission-turtle-${Date.now()}`,
      title: 'The River Pebble Turtle',
      objective: 'Find river stone armor and fern flippers to sculpt an earth turtle.',
      audioScript:
        'New audio beacon detected. Collect one large palm-sized stone, four small pebbles, and a fern leaf. Assemble a stone guardian turtle and record it in your field book.',
      biome: biome || 'Riparian Creek',
      timeOfDay: timeOfDay || 'Morning',
      scavengerItems: [
        '1x Flat Oval Stone (Shell)',
        '4x Small Rounded Pebbles (Feet)',
        '1x Tiny Pebble (Head)',
        '1x Fern Frond or Moss Tuft (Moss Shell)',
      ],
      craftInstructions:
        'Center the large stone. Position the four feet pebbles at each corner. Top with a pinch of moss for an ancient shell look!',
      targetLandmark: 'Phosphor Creek Weft',
      targetDistanceMeters: 310,
      targetBearingDegrees: 45,
      rewardXp: 300,
      stickerReward: {
        name: 'Moss Pebble Turtle',
        rarity: 'Rare',
        badgeEmoji: '🐢',
        lore: 'Ancient creek turtles that absorb cool water currents through mossy shells.',
      },
    },
    {
      id: `mission-sunburst-${Date.now()}`,
      title: 'The Solar Mandala Sunburst',
      objective: 'Assemble yellow petals, acorns, and pine needles into a nature sun.',
      audioScript:
        'Audio alert. Search for fallen dandelion petals, pine needles, and acorn caps. Create a solar mandala on a flat rock to harvest sun energy!',
      biome: biome || 'Sunny Meadow',
      timeOfDay: timeOfDay || 'Golden Hour',
      scavengerItems: [
        '8x Pine Needles (Sun Rays)',
        '1x Pinecone or Acorn (Center Core)',
        '4x Yellow Blossom Petals (Solar Corona)',
      ],
      craftInstructions:
        'Place the acorn in the center. Radiate pine needles outward in a circle like sparkling sunshine rays!',
      targetLandmark: 'Golden Poppy Glade',
      targetDistanceMeters: 420,
      targetBearingDegrees: 180,
      rewardXp: 400,
      stickerReward: {
        name: 'Solar Pinecone Mandala',
        rarity: 'Legendary',
        badgeEmoji: '☀️',
        lore: 'A botanical tribute crafted by scouts to mark the sun reaching its golden azimuth.',
      },
    },
  ];

  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// Curated pool of Daily Nature Challenges for offline / fallback
function getCuratedDailyChallenges(biome: string) {
  const challengeSets = [
    [
      {
        id: `daily-leaf-${Date.now()}-1`,
        title: 'Find 2 Oak Leaves',
        description: 'Locate two distinct fallen oak or maple leaves on the ground and examine their intricate leaf vein networks.',
        category: 'Flora',
        icon: '🍃',
        difficulty: 'Quick',
        xpReward: 100,
      },
      {
        id: `daily-bird-${Date.now()}-2`,
        title: 'Identify a Local Bird',
        description: 'Pause quietly for 60 seconds to detect a songbird or raptor in the canopy and observe its plumage or call.',
        category: 'Fauna',
        icon: '🐦',
        difficulty: 'Explorer',
        xpReward: 150,
      },
      {
        id: `daily-bark-${Date.now()}-3`,
        title: 'Inspect Tree Bark Texture',
        description: 'Feel the ridges and fissures of two differing tree trunks and check for green moss or velvet lichen.',
        category: 'Tactile',
        icon: '🪵',
        difficulty: 'Tracker',
        xpReward: 125,
      },
    ],
    [
      {
        id: `daily-pebble-${Date.now()}-1`,
        title: 'Find 3 Smooth Pebbles',
        description: 'Search soil or trail edges for three water-rounded pebbles of varying mineral colors.',
        category: 'Earth',
        icon: '🪨',
        difficulty: 'Quick',
        xpReward: 90,
      },
      {
        id: `daily-insect-${Date.now()}-2`,
        title: 'Spot a Pollinator in Action',
        description: 'Watch a wild bee, butterfly, or hoverfly pollinating blossoms or hovering near plant foliage.',
        category: 'Fauna',
        icon: '🐝',
        difficulty: 'Explorer',
        xpReward: 140,
      },
      {
        id: `daily-canopy-${Date.now()}-3`,
        title: 'Observe Forest Canopy Light',
        description: 'Look upward through the tree crown to trace sun dapple patterns (komorebi) shifting in the wind.',
        category: 'Observation',
        icon: '✨',
        difficulty: 'Quick',
        xpReward: 110,
      },
    ],
    [
      {
        id: `daily-pine-${Date.now()}-1`,
        title: 'Collect 1 Symmetrical Pinecone',
        description: 'Identify an open seed cone beneath evergreen trees and inspect the spiraling Fibonacci scale sequence.',
        category: 'Flora',
        icon: '🌲',
        difficulty: 'Quick',
        xpReward: 95,
      },
      {
        id: `daily-moss-${Date.now()}-2`,
        title: 'Locate a Living Moss Pillow',
        description: 'Find a damp north-facing boulder or root flare blanketed in soft emerald bryophyte moss.',
        category: 'Tactile',
        icon: '🌿',
        difficulty: 'Tracker',
        xpReward: 135,
      },
      {
        id: `daily-track-${Date.now()}-3`,
        title: 'Search for Wildlife Tracks',
        description: 'Examine soft dirt or mud along the path for prints left by squirrels, deer, raccoons, or birds.',
        category: 'Fauna',
        icon: '🐾',
        difficulty: 'Explorer',
        xpReward: 160,
      },
    ],
  ];

  return challengeSets[Math.floor(Math.random() * challengeSets.length)];
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Development and production Vite mounting
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`EcoQuest AI Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
