import express, { type Request, type Response } from 'express';
import { voiceAssistantEngine } from './voiceAssistantEngine.ts';

export const voiceAssistantRouter = express.Router();

/**
 * Health and status check for the dedicated Voice Assistant backend
 */
voiceAssistantRouter.get('/status', (_req: Request, res: Response) => {
  return res.json({
    status: 'online',
    service: 'EcoQuest Voice Assistant Subsystem',
    version: '2.0.0',
    capabilities: [
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-flash-transcription',
      'instant-task-reasoner',
      'wav-audio-streaming',
    ],
    activeVoice: 'Aoede (Warm Explorer Guide)',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Main End-to-End Pipeline:
 * Accepts microphone audio base64 from the client, transcribes it, runs reasoning,
 * synthesizes audio/wav speech, and returns all results in one response!
 */
voiceAssistantRouter.post('/process-speech', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', state = {}, history = [] } = req.body;

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'audioBase64 string required' });
    }

    const result = await voiceAssistantEngine.processSpeechStream({
      audioBase64,
      mimeType,
      state,
      history,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[VoiceAssistantRouter] process-speech error:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      spokenText: "I'm right here with you on the trail! Check your task card to keep exploring.",
    });
  }
});

/**
 * Interactive Text / Speech Query:
 * Accepts text transcript + game state, returns response and synthesized WAV audio
 */
voiceAssistantRouter.post('/interact', async (req: Request, res: Response) => {
  try {
    const { query, state = {}, history = [] } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Query text required' });
    }

    // Merge root-level body params for backwards compatibility
    const mergedState = {
      playerName: req.body.playerName || req.body.explorerName || state.playerName || 'Explorer',
      currentQuest: req.body.currentQuest || state.currentQuest || 'The Forest Leaf Dragon',
      questPhase: req.body.questPhase || state.questPhase,
      scavengerItems: req.body.scavengerItems || state.scavengerItems,
      foundItems: req.body.foundItems || state.foundItems || [],
      playerInventory: req.body.playerInventory || state.playerInventory,
      playerScore: req.body.playerScore ?? state.playerScore,
      location: req.body.telemetry || state.location,
      activeWaypoint: req.body.activeWaypoint || state.activeWaypoint,
      mission: req.body.mission || state.mission,
      ...state,
    };

    const result = await voiceAssistantEngine.interact(query.trim(), mergedState, history);

    return res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[VoiceAssistantRouter] interact error:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      spokenText: "I'm with you on the trail! Let's check your quest objectives.",
    });
  }
});

/**
 * Text-to-Speech Streaming Endpoint:
 * Returns binary WAV audio directly
 */
voiceAssistantRouter.post('/speak', async (req: Request, res: Response) => {
  try {
    const { text, voiceName = 'Zephyr' } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text prompt required' });
    }

    const audioResult = await voiceAssistantEngine.synthesizeSpeech(text.trim(), voiceName);

    if (audioResult && audioResult.buffer) {
      res.setHeader('Content-Type', audioResult.mimeType);
      res.setHeader('Content-Length', audioResult.buffer.byteLength);
      res.setHeader('X-Voice-Engine', audioResult.mimeType === 'audio/mpeg' ? 'elevenlabs-sarah' : 'gemini-neural-speech');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(audioResult.buffer);
    }

    return res.status(200).json({
      success: false,
      fallback: true,
      message: 'TTS generation unavailable, use browser voice synthesis fallback.',
    });
  } catch (err: any) {
    console.error('[VoiceAssistantRouter] speak error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Instant Task Brief Endpoint:
 * Returns instant spoken task briefing audio tailored to current mission
 */
voiceAssistantRouter.get('/task-brief', async (req: Request, res: Response) => {
  try {
    const questTitle = (req.query.quest as string) || 'The Forest Leaf Dragon';
    const items = (req.query.items as string) || 'two fallen leaves, a dry twig, and two river pebbles';
    const script = `Your current task is the "${questTitle}". Look around the trail for ${items}!`;

    const audioResult = await voiceAssistantEngine.synthesizeSpeech(script, 'Zephyr');

    return res.json({
      success: true,
      script,
      audioBase64: audioResult?.base64,
      mimeType: audioResult?.mimeType || 'audio/wav',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Test Voice Audio Generator:
 * Plays a warm, pleasing, natural spoken confirmation
 */
voiceAssistantRouter.post('/test-voice', async (_req: Request, res: Response) => {
  try {
    const message = "Hello Explorer! I am Aura, your nature companion. It feels so wonderful to walk the trail together with you. Take a breath of fresh air and let's explore!";
    const audioResult = await voiceAssistantEngine.synthesizeSpeech(message, 'Zephyr');

    return res.json({
      success: true,
      message,
      audioBase64: audioResult?.base64,
      mimeType: audioResult?.mimeType || 'audio/wav',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
