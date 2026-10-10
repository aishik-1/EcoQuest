// Tactical Voice Assistant Service: Powered by ElevenLabs TTS & Google Gemini Flash
// Hands-free voice assistant that listens for the wake-word "EcoQuest" and runs quietly in the background
// Keeps the UI focused on the 3D Character and Tactical Google Map!

import { MovementTelemetry } from './movementTrackingService';
import { GeneratedMission } from './geminiMissionService';
import { LocalityWaypoint } from '../types';
import { hapticFeedback } from '../utils/haptics';
import { ambientAudioService } from './ambientAudioService';

export type VoiceAssistantStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thought?: string;
  action?: string;
  timestamp: number;
}

export interface VoiceAssistantState {
  status: VoiceAssistantStatus;
  activeVoiceId: string;
  activeVoiceName: string;
  isMuted: boolean;
  isWakeWordEnabled: boolean;
  isAutoLeadEnabled: boolean;
  silenceSecondsRemaining: number; // 0 to 5 countdown
  inputAudioLevel: number; // 0 to 100 for glowing orb
  outputAudioLevel: number; // 0 to 100 for speaking pulse
  audioSourceUsed: string; // 'elevenlabs' | 'gemini-neural-speech' | 'browser-speech'
  lastThought: string;
  lastSpokenText: string;
  errorMessage: string | null;
  isRelayConnected: boolean; // Standalone /ws/aura-voice WebSocket connected
  currentTranscript: string; // Real-time live speech subtitle
  isMicListening: boolean; // Mic actively streaming and hearing
  hasMicPermission: boolean | null; // Permission status
}

export type VoiceAssistantActionCallback = (action: string, payload?: any) => void;

// -----------------------------------------------------------------------------
// ASSISTANT SOUND EFFECTS (Live Mic Active Chimes, Sleep Tone, Processing)
// Built with Web Audio API for 0 latency, pleasant Apple Siri / Google Assistant fidelity
// -----------------------------------------------------------------------------
class AssistantAudioEffects {
  private ctx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch (_) {
      return null;
    }
  }

  // The Live Mic Active Sound: Musical dual-tone chime (gentle D5 -> A5 with soft acoustic envelope)
  public playWakeChime() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;

      // Tone 1: 587.33 Hz (D5) - soft, gentle bell
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.09, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.16);

      // Tone 2: 880.00 Hz (A5) - soothing harmony
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.08);
      gain2.gain.setValueAtTime(0.11, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.38);
    } catch (_) {}
  }

  // Sleep / Deactivation chime: Soft warm descending tone (659Hz -> 440Hz)
  public playSleepChime() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(440.0, now + 0.22);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    } catch (_) {}
  }

  // Thinking / Processing chime: Very subtle, relaxing notification blip
  public playProcessingChime() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(784.0, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    } catch (_) {}
  }
}

const soundEffects = new AssistantAudioEffects();

// -----------------------------------------------------------------------------
// VOICE ASSISTANT CORE SERVICE
// -----------------------------------------------------------------------------
class VoiceAssistantService {
  private state: VoiceAssistantState = {
    status: 'idle',
    activeVoiceId: 'EXAVITQu4vr4xnSDxMaL', // Aura (Sarah - ElevenLabs)
    activeVoiceName: 'Aura',
    isMuted: false,
    isWakeWordEnabled: true,
    isAutoLeadEnabled: true,
    silenceSecondsRemaining: 5,
    inputAudioLevel: 0,
    outputAudioLevel: 0,
    audioSourceUsed: 'elevenlabs-sarah',
    lastThought: 'Aura is ready. Tap the mic or an observation.',
    lastSpokenText: '',
    errorMessage: null,
    isRelayConnected: false,
    currentTranscript: '',
    isMicListening: false,
    hasMicPermission: null,
  };

  private listeners: Set<(state: VoiceAssistantState) => void> = new Set();
  private actionCallbacks: Set<VoiceAssistantActionCallback> = new Set();

  // Standalone Aura Voice Relay WebSocket (/ws/aura-voice)
  private auraSocket: WebSocket | null = null;
  private isAuraSocketConnected = false;
  private reconnectTimeout: any = null;

  // Internal Audio Playback (Single locked voice pipeline)
  private currentAudio: HTMLAudioElement | null = null;
  private currentSourceNode: AudioBufferSourceNode | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  // Speech Recognition (Wake Word + Active Listening)
  private recognition: any = null;
  private isRecognitionActive = false;
  private isAwakeListening = false; // true = listening for command, false = standby for wake word
  private currentTranscript = '';
  private silenceTimer: any = null;
  private countdownInterval: any = null;

  // Microphone Audio Level & MediaRecorder Audio Pipeline
  private micStream: MediaStream | null = null;
  private micAudioCtx: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micAnimFrameId: number | null = null;
  private mediaRecorder: any = null;
  private recordedAudioChunks: Blob[] = [];
  private isProcessingAudio = false;

  // Context Cache for ongoing session
  private latestContext: {
    telemetry?: MovementTelemetry;
    mission?: GeneratedMission;
    activeWaypoint?: LocalityWaypoint | null;
    explorerName?: string;
    playerScore?: number;
    playerInventory?: string[];
  } = {};

  // Milestone triggers for auto-coaching
  private lastMilestoneDistance = 0;
  private lastSpokenTimestamp = 0;

  // Multi-turn conversational memory for smooth, contextual outdoor dialogue (persisted in localStorage)
  private conversationHistory: Array<{ role: 'user' | 'assistant'; text: string; timestamp?: number }> = [];

  // Record of found items across the active quest (persisted in localStorage)
  private foundItems: string[] = [];

  // Playback generation mutex: strictly prevents overlapping audio/voice tracks
  private playbackGeneration: number = 0;
  private activeSynthInterval: any = null;

  // Cached fixed female voice to ensure zero voice-shifting
  private cachedBrowserVoice: SpeechSynthesisVoice | null = null;
  private watchdogInterval: any = null;

  constructor() {
    this.loadPersistedMemory();
    this.syncPersistedApiKey();
    this.initSpeechRecognition();
    this.initAuraWebSocket();
    this.warmupBrowserVoice();
    this.startWatchdog();
    this.setupGestureActivation();
  }

  private syncPersistedApiKey() {
    if (typeof window === 'undefined') return;
    try {
      const savedKey = localStorage.getItem('ecoquest_voice_api_key') || 'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2';
      if (savedKey && savedKey.trim().length > 5) {
        fetch('/api/elevenlabs/set-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: savedKey.trim() }),
        }).catch(() => {});
      }
    } catch (_) {}
  }

  private startWatchdog() {
    if (typeof window === 'undefined') return;
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (this.state.isWakeWordEnabled && this.state.status !== 'speaking' && !this.isRecognitionActive) {
        this.restartStandbySafely();
      }
    }, 2000);
  }

  // Mobile Web Audio unlock: iOS Safari & mobile Chrome require synchronous audio activation on touch
  public unlockAudioContext() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
          this.audioCtx = new AudioCtx();
        }
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        // Prime HTML5 audio thread on mobile iOS Safari
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
      }
    } catch (_) {}
  }

  private setupGestureActivation() {
    if (typeof window === 'undefined') return;
    const activateOnGesture = () => {
      this.unlockAudioContext();
      if (this.state.isWakeWordEnabled && !this.isRecognitionActive) {
        this.startWakeWordStandby();
      }
    };
    ['touchstart', 'touchend', 'click', 'pointerdown'].forEach((evt) => {
      window.addEventListener(evt, activateOnGesture, { passive: true });
    });
  }

  private warmupBrowserVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const load = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          this.cachedBrowserVoice = this.pickBestFemaleVoice(voices);
        }
      };
      load();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = load;
      }
    } catch (_) {}
  }

  private pickBestFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const maleKeywords = ['male', 'david', 'george', 'daniel', 'oliver', 'guy', 'mark', 'fred', 'alex', 'richard', 'james'];
    const candidates = voices.filter(
      (v) => v.lang.startsWith('en') && !maleKeywords.some((m) => v.name.toLowerCase().includes(m))
    );

    // 1. Edge / Azure Online Natural voices (Jenny / Aria / Sonia)
    const azureNatural = candidates.find(
      (v) => (v.name.includes('Aria') || v.name.includes('Jenny') || v.name.includes('Sonia') || v.name.includes('Neural') || v.name.includes('Natural')) && !v.name.includes('Guy')
    );
    if (azureNatural) return azureNatural;

    // 2. High-quality Apple voices (Samantha / Ava / Serena / Victoria / Siri)
    const appleNatural = candidates.find(
      (v) => v.name.includes('Samantha') || v.name.includes('Ava') || v.name.includes('Serena') || v.name.includes('Victoria') || v.name.includes('Karen') || v.name.includes('Siri')
    );
    if (appleNatural) return appleNatural;

    // 3. Google US English (Female)
    const googleFemale = candidates.find(
      (v) => v.name.includes('Google US English') || (v.name.includes('Google') && !v.name.includes('Male'))
    );
    if (googleFemale) return googleFemale;

    // 4. Any Enhanced or Premium voice
    const enhanced = candidates.find((v) => v.name.toLowerCase().includes('enhanced') || v.name.toLowerCase().includes('premium'));
    if (enhanced) return enhanced;

    return candidates[0] || voices.find((v) => v.lang.startsWith('en')) || null;
  }

  private loadPersistedMemory() {
    if (typeof window === 'undefined') return;
    try {
      const savedHistory = localStorage.getItem('ecoquest_aura_conversation_history');
      if (savedHistory) {
        this.conversationHistory = JSON.parse(savedHistory);
      }
      const savedItems = localStorage.getItem('ecoquest_aura_found_items');
      if (savedItems) {
        this.foundItems = JSON.parse(savedItems);
      }
    } catch (_) {}
  }

  private savePersistedMemory() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('ecoquest_aura_conversation_history', JSON.stringify(this.conversationHistory.slice(-24)));
      localStorage.setItem('ecoquest_aura_found_items', JSON.stringify(this.foundItems));
    } catch (_) {}
  }

  public getConversationHistory(): Array<{ role: 'user' | 'assistant'; text: string; timestamp?: number }> {
    return [...this.conversationHistory];
  }

  public clearConversationHistory() {
    this.conversationHistory = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ecoquest_aura_conversation_history');
    }
  }

  public getFoundItems(): string[] {
    return [...this.foundItems];
  }

  public setFoundItems(items: string[]) {
    this.foundItems = [...items];
    this.savePersistedMemory();
    this.syncStateToWebSocket();
  }

  public recordFoundItem(item: string): { isNew: boolean; allFound: boolean } {
    if (!item) return { isNew: false, allFound: false };
    const scavengerItems = this.latestContext.mission?.scavengerItems || [];
    const isNew = !this.foundItems.includes(item);
    if (isNew) {
      this.foundItems.push(item);
      this.savePersistedMemory();
      this.syncStateToWebSocket();
    }
    const allFound = scavengerItems.length > 0 && scavengerItems.every((si) => this.foundItems.includes(si));
    return { isNew, allFound };
  }

  public clearFoundItems() {
    this.foundItems = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ecoquest_aura_found_items');
    }
    this.syncStateToWebSocket();
  }

  // ---------------------------------------------------------------------------
  // STANDALONE WEBSOCKET VOICE RELAY: CONNECT TO /ws/aura-voice
  // Zero client clutter, instant state sync, instant audio stream return
  // ---------------------------------------------------------------------------
  public initAuraWebSocket() {
    if (typeof window === 'undefined') return;

    try {
      if (this.auraSocket) {
        try {
          this.auraSocket.close();
        } catch (_) {}
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/aura-voice`;

      const ws = new WebSocket(wsUrl);
      this.auraSocket = ws;

      ws.onopen = () => {
        console.log('[Aura Voice Relay] Connected to standalone /ws/aura-voice backend!');
        this.isAuraSocketConnected = true;
        this.state.isRelayConnected = true;
        this.notify();
        this.syncStateToWebSocket();
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            this.state.isRelayConnected = true;
            this.notify();
          } else if (data.type === 'aura_thinking') {
            this.state.status = 'thinking';
            this.notify();
          } else if (data.type === 'aura_response') {
            await this.handleAuraWebSocketResponse(data);
          }
        } catch (e) {
          console.error('[Aura Voice Relay] Message parse error:', e);
        }
      };

      ws.onclose = () => {
        this.isAuraSocketConnected = false;
        this.state.isRelayConnected = false;
        this.notify();

        if (!this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.initAuraWebSocket();
          }, 3500);
        }
      };

      ws.onerror = (err) => {
        console.warn('[Aura Voice Relay] WebSocket error:', err);
      };
    } catch (e) {
      console.warn('[Aura Voice Relay] Init failed:', e);
    }
  }

  public syncStateToWebSocket() {
    if (!this.auraSocket || this.auraSocket.readyState !== WebSocket.OPEN) return;
    try {
      const ctx = this.latestContext;
      const scavengerItems = ctx.mission?.scavengerItems || ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'];
      const payload = {
        type: 'state_sync',
        history: this.conversationHistory.slice(-10),
        state: {
          playerName: ctx.explorerName || 'Explorer',
          inventory: ctx.playerInventory || scavengerItems,
          scavengerItems,
          foundItems: this.foundItems,
          score: ctx.playerScore ?? 850,
          currentQuest: ctx.mission?.title || 'The Forest Leaf Dragon',
          questPhase: ctx.mission?.craftInstructions || ctx.mission?.objective || 'Phase 1: Gathering Nature Ingredients',
          location: {
            ...(ctx.telemetry || {}),
            area: ctx.telemetry?.localityArea || '',
            city: ctx.telemetry?.localityCity || '',
            state: ctx.telemetry?.localityState || '',
            country: ctx.telemetry?.localityCountry || '',
            localityName: ctx.telemetry?.localityName || '',
          },
          activeWaypoint: ctx.activeWaypoint || null,
          currentTime: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          currentDay: new Date().toLocaleDateString([], { weekday: 'long' }),
        },
      };
      this.auraSocket.send(JSON.stringify(payload));
    } catch (_) {}
  }

  private async handleAuraWebSocketResponse(data: any) {
    const spokenText = data.spokenText || data.transcript || '';
    const thought = data.thought || 'Aura processed your voice with real-time game context.';
    const action = data.action || 'NONE';
    const pointsAwarded = data.pointsAwarded || 0;
    const itemFound = data.itemFound || null;
    const allItemsFound = Boolean(data.allItemsFound);

    this.state.lastThought = thought;
    this.state.lastSpokenText = spokenText;

    if (spokenText) {
      this.conversationHistory.push({ role: 'assistant', text: spokenText, timestamp: Date.now() });
      if (this.conversationHistory.length > 24) {
        this.conversationHistory = this.conversationHistory.slice(-24);
      }
      this.savePersistedMemory();
    }

    if (itemFound && !this.foundItems.includes(itemFound)) {
      this.foundItems.push(itemFound);
      this.savePersistedMemory();
    }

    if (action === 'RECORD_FOUND_ITEM' || itemFound) {
      this.triggerAction('RECORD_FOUND_ITEM', { item: itemFound, allItemsFound, pointsAwarded });
    }
    if (action === 'OPEN_PHOTO_CAMERA' || (action === 'COMPLETE_TASK' && allItemsFound)) {
      this.triggerAction('OPEN_PHOTO_CAMERA', { item: itemFound, allItemsFound: true, pointsAwarded });
    } else if (action && action !== 'NONE' && action !== 'RECORD_FOUND_ITEM') {
      this.triggerAction(action, { data, pointsAwarded });
    }

    if (pointsAwarded > 0) {
      this.triggerAction('AWARD_POINTS', { points: pointsAwarded });
    }

    if (!this.state.isMuted && spokenText) {
      // Strictly cancel any previous playing audio to guarantee zero voice overlap
      this.stopSpeaking();
      const currentGen = ++this.playbackGeneration;

      if (data.audioBase64) {
        try {
          const byteCharacters = atob(data.audioBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const audioMime = data.audioMimeType || data.mimeType || 'audio/mpeg';
          const audioBlob = new Blob([byteArray], { type: audioMime });
          const audioUrl = URL.createObjectURL(audioBlob);
          this.state.status = 'speaking';
          this.state.audioSourceUsed = data.audioSource || data.source || 'elevenlabs-sarah';
          this.notify();
          await this.playAudioUrl(audioUrl, currentGen);
          return;
        } catch (e) {
          console.warn('[Voice Assistant] Failed to play base64 audio blob:', e);
        }
      }

      await this.speak(spokenText);
    } else {
      this.state.status = 'idle';
      this.notify();
      this.startWakeWordStandby();
    }
  }

  public getState(): VoiceAssistantState {
    return { ...this.state };
  }

  public subscribe(listener: (state: VoiceAssistantState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public onAction(callback: VoiceAssistantActionCallback): () => void {
    this.actionCallbacks.add(callback);
    return () => this.actionCallbacks.delete(callback);
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }

  private triggerAction(action: string, payload?: any) {
    if (!action || action === 'NONE') return;
    this.actionCallbacks.forEach((cb) => cb(action, payload));
  }

  public updateContext(context: {
    telemetry?: MovementTelemetry;
    mission?: GeneratedMission;
    activeWaypoint?: LocalityWaypoint | null;
    explorerName?: string;
    playerScore?: number;
    playerInventory?: string[];
  }) {
    this.latestContext = { ...this.latestContext, ...context };
    this.syncStateToWebSocket();
  }

  public toggleMute() {
    this.state.isMuted = !this.state.isMuted;
    if (this.state.isMuted) {
      this.stopSpeaking();
    }
    this.notify();
  }

  public toggleWakeWord() {
    this.state.isWakeWordEnabled = !this.state.isWakeWordEnabled;
    if (this.state.isWakeWordEnabled) {
      this.startWakeWordStandby();
    } else {
      this.stopListening();
    }
    this.notify();
  }

  public setVoiceId(voiceId: string, voiceName: string = 'Aura') {
    this.state.activeVoiceId = voiceId;
    this.state.activeVoiceName = voiceName;
    this.notify();
  }

  public getLatestMission(): GeneratedMission | undefined {
    return this.latestContext.mission;
  }

  // ---------------------------------------------------------------------------
  // SPEECH RECOGNITION WITH WAKE-WORD DETECTION & AUTO TIMEOUT
  // ---------------------------------------------------------------------------
  public matchesWakeWord(text: string): boolean {
    if (!text) return false;
    const clean = text.toLowerCase().trim();

    // Direct and phonetic approximations of "Aura"
    // Web Speech API commonly outputs: "ora", "oro", "oral", "aurora", "ahura", "arra", "ara", "laura", "lora", "our a", "hour a", "or a"
    const directWords = [
      'aura', 'auras', 'aurora', 'auroras',
      'ora', 'oro', 'oral', 'ahura', 'ayra', 'eyra', 'ara', 'arra',
      'laura', 'lora', 'flora',
      'our a', 'hour a', 'or a', 'oar a',
      'ecoquest', 'eco quest', 'echo quest', 'aqua quest', 'equal quest',
    ];

    for (const w of directWords) {
      const rx = new RegExp(`(^|\\s)${w}(?=[\\s,!.?]|$|')`, 'i');
      if (rx.test(clean)) return true;
    }

    // Prefixes: "hey aura", "hi aura", "hello aura", "yo aura", "ok aura", "okay aura", "wake up aura"
    if (/(?:hey|hi|hello|yo|ok|okay|listen|wake\s+up)\s+(?:aura|aurora|ora|laura|eco\s*quest)\b/i.test(clean)) {
      return true;
    }

    // Starts with aura phonetics
    if (/^(?:aura|ora|aurora|ahura|laura|ecoquest)\b/i.test(clean)) {
      return true;
    }

    return false;
  }

  public stripWakeWord(text: string): string {
    if (!text) return '';
    return text
      .replace(/(?:hey|hi|hello|yo|ok|okay|listen|wake\s+up)?\s*(?:aura|auras|aurora|auroras|ora|oro|oral|ahura|ayra|eyra|ara|arra|laura|lora|our\s+a|hour\s+a|or\s+a|eco\s*quest|echo\s*quest|aqua\s*quest|equal\s*quest)[,!?:.]*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private initSpeechRecognition() {
    if (typeof window === 'undefined') return;

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[Voice Assistant] Web Speech API not supported in this browser; will use MediaRecorder audio transcription.');
      return;
    }

    try {
      if (this.recognition) {
        try {
          this.recognition.abort();
        } catch (_) {}
      }

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.lang = 'en-US';

      rec.onstart = () => {
        this.isRecognitionActive = true;
        this.state.isMicListening = true;
        this.state.hasMicPermission = true;
        this.notify();
      };

      rec.onresult = (event: any) => {
        let latestSegment = '';
        let detectedWakeWord = false;
        let wakeWordCommand = '';

        // Iterate through all recent results and all speech alternatives
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (!res) continue;

          for (let j = 0; j < res.length; j++) {
            const hypothesis = (res[j]?.transcript || '').trim();
            if (!hypothesis) continue;
            latestSegment = hypothesis;

            if (this.matchesWakeWord(hypothesis)) {
              detectedWakeWord = true;
              wakeWordCommand = this.stripWakeWord(hypothesis);
              break;
            }
          }
          if (detectedWakeWord) break;
        }

        const lastRes = event.results[event.results.length - 1];
        const isFinal = Boolean(lastRes?.isFinal);
        if (!latestSegment && lastRes && lastRes[0]) {
          latestSegment = (lastRes[0].transcript || '').trim();
        }

        if (!latestSegment) return;

        // 1. If in standby mode (not yet clicked mic or listening)
        if (!this.isAwakeListening) {
          const lower = latestSegment.toLowerCase();
          const isDirectQuestion =
            lower.includes('where') ||
            lower.includes('what') ||
            lower.includes('how') ||
            lower.includes('found') ||
            lower.includes('leaf') ||
            lower.includes('twig') ||
            lower.includes('pebble') ||
            lower.includes('dragon') ||
            lower.includes('camera') ||
            lower.includes('hello') ||
            lower.includes('hi aura') ||
            lower.includes('hey');

          if (detectedWakeWord || this.matchesWakeWord(latestSegment) || isDirectQuestion) {
            console.log('[Voice Assistant] Speech / Wake Word detected:', latestSegment);
            this.handleWakeWordTriggered(wakeWordCommand || latestSegment);
            return;
          }
        }

        // 2. If in active listening mode and user is speaking
        if (this.isAwakeListening) {
          this.currentTranscript = latestSegment;
          this.state.currentTranscript = latestSegment;
          this.state.inputAudioLevel = Math.max(this.state.inputAudioLevel, 45);
          this.notify();

          // Reset silence timer: give 1.8 seconds after speech stops before finalizing
          this.resetSilenceCountdown(2);

          if (isFinal) {
            const cleanedText = this.stripWakeWord(latestSegment) || latestSegment;
            if (cleanedText.length >= 2) {
              console.log('[Voice Assistant] Final user speech captured:', cleanedText);
              this.clearSilenceTimer();
              this.currentTranscript = '';
              this.state.currentTranscript = '';
              soundEffects.playProcessingChime();
              this.isAwakeListening = false;
              this.stopMicAudioCapture();
              this.interact(cleanedText);
            }
          }
        }
      };

      rec.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          return;
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.state.errorMessage = 'Mic permission needed. Please allow microphone access!';
          this.state.hasMicPermission = false;
          this.notify();
        }
      };

      rec.onend = () => {
        this.isRecognitionActive = false;
        if (this.state.isWakeWordEnabled && this.state.status !== 'speaking' && !this.isAwakeListening) {
          setTimeout(() => {
            this.restartStandbySafely();
          }, 350);
        }
      };

      this.recognition = rec;
    } catch (e) {
      console.warn('[Voice Assistant] Speech recognition init notice:', e);
    }
  }

  private restartStandbySafely() {
    if (this.isRecognitionActive || this.state.status === 'speaking' || this.isAwakeListening) return;
    try {
      if (!this.recognition) {
        this.initSpeechRecognition();
      }
      this.recognition?.start();
    } catch (_) {}
  }

  public startWakeWordStandby() {
    this.isAwakeListening = false;
    this.state.status = 'idle';
    this.state.isMicListening = false;
    this.state.currentTranscript = '';
    this.state.silenceSecondsRemaining = 5;
    this.notify();
    this.restartStandbySafely();
  }

  // Called when user speaks wake word or query
  private handleWakeWordTriggered(rawTranscript: string) {
    soundEffects.playWakeChime();
    hapticFeedback.radarPulse();

    const commandPart = this.stripWakeWord(rawTranscript) || rawTranscript;

    if (commandPart.length >= 3 && !/^(?:aura|ora|eco\s*quest)$/i.test(commandPart.trim())) {
      console.log('[Voice Assistant] Direct speech command:', commandPart);
      this.clearSilenceTimer();
      soundEffects.playProcessingChime();
      this.isAwakeListening = false;
      this.state.currentTranscript = '';
      this.interact(commandPart);
      return;
    }

    // Keep active recognition stream running seamlessly!
    this.activateListeningWithTimeout();
  }

  // Activate active listening (either via wake word or mic button tap)
  public async activateListeningWithTimeout() {
    this.stopSpeaking();
    this.isAwakeListening = true;
    this.currentTranscript = '';
    this.state.currentTranscript = '';
    this.state.status = 'listening';
    this.state.isMicListening = true;
    this.state.silenceSecondsRemaining = 4;
    this.state.errorMessage = null;
    this.notify();

    // Duck background music immediately so user voice is clear
    ambientAudioService.duckAudioForSpeech(0.12);

    // Play active wake chime
    soundEffects.playWakeChime();

    // Start mic capture & visualizer
    await this.startMicAudioCapture();

    // Safely ensure speech recognition is actively capturing
    try {
      if (!this.recognition) {
        this.initSpeechRecognition();
      }
      if (this.recognition && !this.isRecognitionActive) {
        this.recognition.start();
      }
    } catch (_) {
      try {
        this.initSpeechRecognition();
        this.recognition?.start();
      } catch (_) {}
    }

    // Start silence countdown
    this.startSilenceCountdown(4);
  }

  private resetSilenceCountdown(seconds: number = 3) {
    this.state.silenceSecondsRemaining = seconds;
    this.notify();
  }

  private startSilenceCountdown(initialSeconds: number = 4) {
    this.clearSilenceTimer();
    let secondsLeft = initialSeconds;
    this.state.silenceSecondsRemaining = secondsLeft;
    this.notify();

    this.countdownInterval = setInterval(() => {
      secondsLeft -= 1;
      this.state.silenceSecondsRemaining = Math.max(0, secondsLeft);
      this.notify();

      if (secondsLeft <= 0) {
        this.handleSilenceTimeout();
      }
    }, 1000);
  }

  public async processCapturedSpeech(): Promise<void> {
    if (this.isProcessingAudio) return;
    this.isProcessingAudio = true;
    this.clearSilenceTimer();
    this.isAwakeListening = false;
    this.state.isMicListening = false;

    // Grab transcript captured by Web Speech API (if any)
    const fastTranscript = (this.currentTranscript || this.state.currentTranscript || '').trim();
    this.currentTranscript = '';
    this.state.currentTranscript = '';
    this.notify();

    // Stop speech recognition instance
    if (this.recognition && this.isRecognitionActive) {
      try {
        this.recognition.stop();
      } catch (_) {}
    }

    // Stop MediaRecorder and wait for final audio slice flush
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        await new Promise<void>((resolve) => {
          if (!this.mediaRecorder) return resolve();
          this.mediaRecorder.onstop = () => resolve();
          try {
            this.mediaRecorder.requestData();
          } catch (_) {}
          this.mediaRecorder.stop();
          setTimeout(resolve, 150);
        });
      } catch (_) {}
    }
    const recordedChunks = [...this.recordedAudioChunks];
    this.recordedAudioChunks = [];
    this.stopMicAudioCapture();

    // 1. If Web Speech API captured recognized text, process immediately
    if (fastTranscript.length >= 2) {
      console.log('[Voice Assistant] Captured speech via Web Speech API:', fastTranscript);
      soundEffects.playProcessingChime();
      this.isProcessingAudio = false;
      await this.interact(fastTranscript);
      return;
    }

    // 2. If Web Speech API yielded no text (blocked or silent in iframe/browser), use recorded audio directly with Voice Assistant backend!
    if (recordedChunks.length > 0) {
      const mimeType = recordedChunks[0]?.type || 'audio/webm';
      const audioBlob = new Blob(recordedChunks, { type: mimeType });

      if (audioBlob.size > 500) {
        console.log(`[Voice Assistant] Sending ${audioBlob.size} bytes audio to Voice Assistant Backend Engine...`);
        this.state.status = 'thinking';
        this.state.lastThought = 'Aura Voice Backend is processing your speech...';
        this.notify();

        try {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
          reader.readAsDataURL(audioBlob);
          const base64Audio = await base64Promise;

          const res = await fetch('/api/voice-assistant/process-speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64Audio,
              mimeType,
              state: {
                playerName: this.latestContext?.explorerName || 'Explorer',
                currentQuest: this.latestContext?.mission?.title || 'The Forest Leaf Dragon',
                questPhase: this.latestContext?.mission?.craftInstructions || 'Phase 1: Gathering Nature Ingredients',
                scavengerItems: this.latestContext?.mission?.scavengerItems,
                foundItems: this.foundItems,
                playerInventory: this.latestContext?.playerInventory,
                playerScore: this.latestContext?.playerScore ?? 850,
                location: this.latestContext?.telemetry,
                mission: this.latestContext?.mission,
              },
              history: this.conversationHistory.slice(-6),
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.transcript) {
              console.log('[Voice Assistant] Voice Backend transcribed speech:', data.transcript);
              this.conversationHistory.push({ role: 'user', text: data.transcript, timestamp: Date.now() });
            }
            soundEffects.playProcessingChime();
            this.isProcessingAudio = false;
            await this.handleAuraWebSocketResponse(data);
            return;
          }
        } catch (procErr) {
          console.warn('[Voice Assistant] Voice Backend process-speech error:', procErr);
        }
      }
    }

    // 3. No clear speech detected
    console.log('[Voice Assistant] No speech detected in audio stream.');
    soundEffects.playSleepChime();
    ambientAudioService.restoreAudioAfterSpeech();

    this.state.status = 'idle';
    this.state.silenceSecondsRemaining = 5;
    this.state.lastThought = "No clear words detected. Speak closer to the mic or tap a question below!";
    this.notify();
    this.isProcessingAudio = false;
    this.restartStandbySafely();
  }

  private handleSilenceTimeout() {
    this.processCapturedSpeech();
  }

  private clearSilenceTimer() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  public toggleListening(context?: any) {
    if (context) this.updateContext(context);

    if (this.state.status === 'listening') {
      this.processCapturedSpeech();
    } else {
      this.activateListeningWithTimeout();
    }
  }

  public stopListening() {
    this.clearSilenceTimer();
    this.isAwakeListening = false;
    this.stopMicAudioCapture();
    if (this.recognition && this.isRecognitionActive) {
      try {
        this.recognition.stop();
      } catch (_) {}
    }
    this.state.status = 'idle';
    this.notify();
  }

  public async testMicrophone(): Promise<{ success: boolean; level: number; error?: string }> {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { success: false, level: 0, error: 'MediaDevices API not available in this environment' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.state.hasMicPermission = true;
      this.notify();

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        stream.getTracks().forEach((t) => t.stop());
        return { success: true, level: 50 };
      }

      const ctx = new AudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      let maxLevel = 0;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 60));
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let j = 0; j < data.length; j++) sum += data[j];
        const lvl = Math.round(sum / data.length);
        if (lvl > maxLevel) maxLevel = lvl;
      }

      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      return { success: true, level: maxLevel };
    } catch (err: any) {
      this.state.hasMicPermission = false;
      this.state.errorMessage = err?.name === 'NotAllowedError' ? 'Microphone permission denied by user' : err?.message;
      this.notify();
      return { success: false, level: 0, error: err?.message };
    }
  }

  public async testVoiceSpeaker(): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      this.state.status = 'thinking';
      this.state.lastThought = 'Testing Voice Assistant Neural Speaker...';
      this.notify();

      const res = await fetch('/api/voice-assistant/test-voice', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.audioBase64) {
          const byteCharacters = atob(data.audioBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const audioBlob = new Blob([byteArray], { type: data.mimeType || 'audio/wav' });
          const audioUrl = URL.createObjectURL(audioBlob);
          this.state.status = 'speaking';
          this.state.lastSpokenText = data.message;
          this.notify();
          await this.playAudioUrl(audioUrl);
          return { success: true, message: data.message };
        }
      }
      return { success: false, message: 'No audio returned from server' };
    } catch (e: any) {
      return { success: false, message: 'Failed to test voice', error: e.message };
    }
  }

  public async askWhatIsMyTask(): Promise<string> {
    return this.interact('What is my task?');
  }

  // ---------------------------------------------------------------------------
  // AI INTERACTION (ChatGPT / Gemini Brain + Action Hooks)
  // Background processing: No giant transcript or thought boxes needed!
  // ---------------------------------------------------------------------------
  public async interact(
    query: string,
    contextOverride?: {
      telemetry?: MovementTelemetry;
      mission?: GeneratedMission;
      activeWaypoint?: LocalityWaypoint | null;
      explorerName?: string;
      playerScore?: number;
      playerInventory?: string[];
    }
  ): Promise<string> {
    if (!query.trim()) return '';

    const ctx = { ...this.latestContext, ...contextOverride };
    this.stopSpeaking();
    this.clearSilenceTimer();

    this.state.status = 'thinking';
    this.state.errorMessage = null;
    this.notify();

    // 1. Record user turn in local conversation memory
    this.conversationHistory.push({ role: 'user', text: query.trim(), timestamp: Date.now() });
    if (this.conversationHistory.length > 24) {
      this.conversationHistory = this.conversationHistory.slice(-24);
    }
    this.savePersistedMemory();

    const scavengerItems = ctx.mission?.scavengerItems || ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'];

    // 2. Send via dedicated WebSocket Voice Relay (/ws/aura-voice) if connected
    if (this.auraSocket && this.auraSocket.readyState === WebSocket.OPEN) {
      try {
        const payload = {
          type: 'user_speech',
          transcript: query.trim(),
          history: this.conversationHistory.slice(-8),
          state: {
            playerName: ctx.explorerName || 'Explorer',
            inventory: ctx.playerInventory || scavengerItems,
            scavengerItems,
            foundItems: this.foundItems,
            score: ctx.playerScore ?? 850,
            currentQuest: ctx.mission?.title || 'The Forest Leaf Dragon',
            questPhase: ctx.mission?.craftInstructions || ctx.mission?.objective || 'Phase 1: Gathering Nature Ingredients',
            location: {
              ...(ctx.telemetry || {}),
              area: ctx.telemetry?.localityArea || '',
              city: ctx.telemetry?.localityCity || '',
              state: ctx.telemetry?.localityState || '',
              country: ctx.telemetry?.localityCountry || '',
              localityName: ctx.telemetry?.localityName || '',
            },
            activeWaypoint: ctx.activeWaypoint || null,
            currentTime: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            currentDay: new Date().toLocaleDateString([], { weekday: 'long' }),
          },
        };
        this.auraSocket.send(JSON.stringify(payload));
        return '';
      } catch (err) {
        console.warn('[Aura Voice Relay] Socket send error, falling back to HTTP:', err);
      }
    }

    // 3. HTTP Call via Dedicated Voice Assistant Backend (/api/voice-assistant/interact)
    try {
      const response = await fetch('/api/voice-assistant/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          playerName: ctx.explorerName || 'Explorer',
          currentQuest: ctx.mission?.title || 'The Forest Leaf Dragon',
          questPhase: ctx.mission?.craftInstructions || ctx.mission?.objective || 'Phase 1: Gathering Nature Ingredients',
          playerInventory: ctx.playerInventory || scavengerItems,
          scavengerItems,
          foundItems: this.foundItems,
          playerScore: ctx.playerScore ?? 850,
          telemetry: {
            ...(ctx.telemetry || {}),
            area: ctx.telemetry?.localityArea || '',
            city: ctx.telemetry?.localityCity || '',
            state: ctx.telemetry?.localityState || '',
            country: ctx.telemetry?.localityCountry || '',
            localityName: ctx.telemetry?.localityName || '',
          },
          mission: ctx.mission || {},
          activeWaypoint: ctx.activeWaypoint || null,
          history: this.conversationHistory.slice(-8),
          currentTime: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          currentDay: new Date().toLocaleDateString([], { weekday: 'long' }),
        }),
      });

      const data = await response.json();
      await this.handleAuraWebSocketResponse(data);
      return data.spokenText || '';
    } catch (err: any) {
      console.warn('[Voice Assistant] Interaction error:', err);
      const fallbackText = "Oh wow, I'm right here with you! Let's check the trail ahead and find that next treasure.";
      this.state.lastThought = 'Graceful conversational fallback.';
      this.state.lastSpokenText = fallbackText;
      if (!this.state.isMuted) {
        await this.speak(fallbackText);
      } else {
        this.state.status = 'idle';
        this.notify();
        this.startWakeWordStandby();
      }
      return fallbackText;
    }
  }

  // ---------------------------------------------------------------------------
  // SPEECH SYNTHESIS (LOCKED SINGLE VOICE: ELEVENLABS / NATURAL BROWSER SYNTHESIS)
  // Strictly single playback: zero audio overlap guaranteed
  // ---------------------------------------------------------------------------
  public async speak(text: string): Promise<void> {
    if (!text.trim() || this.state.isMuted) return;

    this.stopSpeaking();
    const currentGen = ++this.playbackGeneration;

    this.state.status = 'speaking';
    this.state.lastSpokenText = text.trim();
    this.lastSpokenTimestamp = Date.now();
    this.notify();

    // Duck background music smoothly for speech playback
    ambientAudioService.duckAudioForSpeech(0.08);

    try {
      const response = await fetch('/api/voice-assistant/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          voiceName: 'Zephyr',
        }),
      });

      // Abort if superseded by newer speech while fetching
      if (this.playbackGeneration !== currentGen) return;

      const contentType = response.headers.get('content-type') || '';
      const sourceHeader = response.headers.get('x-voice-engine') || 'elevenlabs-sarah';
      this.state.audioSourceUsed = sourceHeader;

      if (response.ok && (contentType.includes('audio') || contentType.includes('application/octet-stream'))) {
        const audioBlob = await response.blob();
        if (this.playbackGeneration !== currentGen) return;
        const audioUrl = URL.createObjectURL(audioBlob);
        await this.playAudioUrl(audioUrl, currentGen);
        return;
      }

      // Fallback to high-definition human browser speech
      await this.speakWithNaturalBrowserSynth(text, currentGen);
    } catch (err: any) {
      if (this.playbackGeneration !== currentGen) return;
      console.warn('[Voice Assistant] Speech fetch notice, falling back to natural speech:', err);
      await this.speakWithNaturalBrowserSynth(text, currentGen);
    }
  }

  private async playAudioUrl(url: string, expectedGen?: number): Promise<void> {
    const currentGen = expectedGen !== undefined ? expectedGen : ++this.playbackGeneration;

    // Cleanly cancel any browser speech synthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    // Cleanly stop any existing HTML audio element
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
        this.currentAudio.load();
      } catch (_) {}
      this.currentAudio = null;
    }

    // Cleanly stop any existing Web Audio source node
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch (_) {}
      this.currentSourceNode = null;
    }

    if (this.playbackGeneration !== currentGen) {
      if (url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch (_) {}
      }
      return;
    }

    // 1. Primary path: Web Audio API decoded buffer playback
    // Immune to mobile iOS Safari & Android Chrome HTMLAudioElement autoplay blocking once context unlocked!
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
          this.audioCtx = new AudioCtx();
        }
        if (this.audioCtx.state === 'suspended') {
          await this.audioCtx.resume().catch(() => {});
        }

        if (this.audioCtx.state === 'running') {
          const res = await fetch(url);
          const arrayBuf = await res.arrayBuffer();

          if (this.playbackGeneration !== currentGen) {
            if (url.startsWith('blob:')) try { URL.revokeObjectURL(url); } catch (_) {}
            return;
          }

          const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuf);
          if (this.playbackGeneration !== currentGen) {
            if (url.startsWith('blob:')) try { URL.revokeObjectURL(url); } catch (_) {}
            return;
          }

          const sourceNode = this.audioCtx.createBufferSource();
          sourceNode.buffer = audioBuffer;
          sourceNode.connect(this.audioCtx.destination);
          this.currentSourceNode = sourceNode;

          this.startOutputVisualizerLoop();

          return new Promise<void>((resolve) => {
            sourceNode.onended = () => {
              if (this.currentSourceNode === sourceNode) {
                this.currentSourceNode = null;
              }
              this.stopOutputVisualizerLoop();
              if (url.startsWith('blob:')) {
                try { URL.revokeObjectURL(url); } catch (_) {}
              }
              if (this.playbackGeneration === currentGen) {
                this.state.status = 'idle';
                this.state.outputAudioLevel = 0;
                this.notify();
                ambientAudioService.restoreAudioAfterSpeech();
                this.startWakeWordStandby();
              }
              resolve();
            };
            sourceNode.start(0);
          });
        }
      }
    } catch (webAudioErr) {
      console.warn('[Voice Assistant] WebAudio playback fallback to HTMLAudio:', webAudioErr);
    }

    // 2. Fallback to HTMLAudioElement
    return new Promise((resolve) => {
      try {
        if (this.playbackGeneration !== currentGen) {
          if (url.startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch (_) {}
          }
          return resolve();
        }

        const audio = new Audio(url);
        audio.crossOrigin = 'anonymous';
        this.currentAudio = audio;

        // Visualizer wave loop
        this.startOutputVisualizerLoop();

        const handleAudioDone = () => {
          if (this.playbackGeneration !== currentGen && this.currentAudio !== audio) {
            return resolve();
          }
          this.stopOutputVisualizerLoop();
          if (url.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(url);
            } catch (_) {}
          }
          if (this.currentAudio === audio) {
            this.currentAudio = null;
          }
          this.state.status = 'idle';
          this.state.outputAudioLevel = 0;
          this.notify();

          ambientAudioService.restoreAudioAfterSpeech();
          this.startWakeWordStandby();
          resolve();
        };

        audio.onended = handleAudioDone;
        audio.onerror = handleAudioDone;

        audio.play().catch(() => {
          handleAudioDone();
        });
      } catch (_) {
        this.state.status = 'idle';
        this.notify();
        ambientAudioService.restoreAudioAfterSpeech();
        this.startWakeWordStandby();
        resolve();
      }
    });
  }

  // Ultra-natural human speech synthesis engine
  // STRICTLY tuned for soothing, warm conversational cadence (relaxing and pleasant to hear)
  private speakWithNaturalBrowserSynth(text: string, expectedGen?: number): Promise<void> {
    return new Promise((resolve) => {
      const currentGen = expectedGen !== undefined ? expectedGen : ++this.playbackGeneration;

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        this.state.status = 'idle';
        this.notify();
        this.startWakeWordStandby();
        resolve();
        return;
      }

      try {
        window.speechSynthesis.cancel();
        if (this.activeSynthInterval) {
          clearInterval(this.activeSynthInterval);
          this.activeSynthInterval = null;
        }

        if (this.playbackGeneration !== currentGen) {
          return resolve();
        }

        // Clean and humanize text of rigid abbreviations/symbols for warm human delivery
        const cleanSpoken = text
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

        const utterance = new SpeechSynthesisUtterance(cleanSpoken);
        utterance.rate = 0.94; // Calm, unhurried, natural human cadence (pleasing to hear)
        utterance.pitch = 0.98; // Grounded, warm, pleasing vocal frequency (zero shrillness)
        utterance.volume = 1.0;

        const allVoices = window.speechSynthesis.getVoices();
        const chosenVoice = this.cachedBrowserVoice || this.pickBestFemaleVoice(allVoices);
        if (chosenVoice) {
          utterance.voice = chosenVoice;
          this.cachedBrowserVoice = chosenVoice;
        }

        this.state.audioSourceUsed = 'browser-speech';

        // Pulse for visualizer while speaking
        this.activeSynthInterval = setInterval(() => {
          if (this.playbackGeneration !== currentGen) {
            clearInterval(this.activeSynthInterval);
            this.activeSynthInterval = null;
            return;
          }
          this.state.outputAudioLevel = Math.floor(35 + Math.random() * 55);
          this.notify();
        }, 120);

        utterance.onstart = () => {
          if (this.playbackGeneration !== currentGen) {
            try { window.speechSynthesis.cancel(); } catch (_) {}
            return;
          }
          this.state.status = 'speaking';
          this.notify();
        };

        const handleSynthDone = () => {
          if (this.activeSynthInterval) {
            clearInterval(this.activeSynthInterval);
            this.activeSynthInterval = null;
          }
          if (this.playbackGeneration !== currentGen) {
            return resolve();
          }
          this.state.outputAudioLevel = 0;
          this.state.status = 'idle';
          this.notify();
          ambientAudioService.restoreAudioAfterSpeech();
          this.startWakeWordStandby();
          resolve();
        };

        utterance.onend = handleSynthDone;
        utterance.onerror = handleSynthDone;

        window.speechSynthesis.speak(utterance);
      } catch (_) {
        this.state.status = 'idle';
        this.notify();
        ambientAudioService.restoreAudioAfterSpeech();
        this.startWakeWordStandby();
        resolve();
      }
    });
  }

  public stopSpeaking() {
    this.playbackGeneration++;
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch (_) {}
      this.currentSourceNode = null;
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
        this.currentAudio.load();
      } catch (_) {}
      this.currentAudio = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    if (this.activeSynthInterval) {
      clearInterval(this.activeSynthInterval);
      this.activeSynthInterval = null;
    }

    this.stopOutputVisualizerLoop();
    this.state.outputAudioLevel = 0;
    if (this.state.status === 'speaking') {
      this.state.status = 'idle';
    }
    ambientAudioService.restoreAudioAfterSpeech();
    this.notify();
  }

  public replayLastMessage() {
    if (this.state.lastSpokenText) {
      this.speak(this.state.lastSpokenText);
    }
  }

  // ---------------------------------------------------------------------------
  // VISUALIZERS & LIVE MICROPHONE MEDIARECORDER CAPTURE
  // ---------------------------------------------------------------------------
  private async startMicAudioCapture(): Promise<boolean> {
    try {
      this.state.errorMessage = null;

      // Acquire microphone stream with optimized voice parameters
      if (!this.micStream || !this.micStream.active) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.micStream = stream;
      }

      // Initialize Web Audio API Analyser for real-time visualizer waveform & decibel meter
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && this.micStream) {
        if (!this.micAudioCtx || this.micAudioCtx.state === 'closed') {
          this.micAudioCtx = new AudioCtx();
        }
        if (this.micAudioCtx.state === 'suspended') {
          this.micAudioCtx.resume().catch(() => {});
        }

        try {
          const src = this.micAudioCtx.createMediaStreamSource(this.micStream);
          const analyser = this.micAudioCtx.createAnalyser();
          analyser.fftSize = 64;
          src.connect(analyser);
          this.micAnalyser = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const loop = () => {
            if (!this.micAnalyser || this.state.status !== 'listening') return;
            this.micAnalyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            this.state.inputAudioLevel = Math.min(100, Math.round(avg * 2.5));
            this.notify();
            this.micAnimFrameId = requestAnimationFrame(loop);
          };
          loop();
        } catch (ctxErr) {
          console.warn('[Voice Assistant] AudioContext connect notice:', ctxErr);
        }
      }

      // Initialize MediaRecorder for guaranteed audio backup across all browsers & iframes
      this.recordedAudioChunks = [];
      if (typeof MediaRecorder !== 'undefined' && this.micStream) {
        try {
          let chosenMime = '';
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            chosenMime = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            chosenMime = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            chosenMime = 'audio/mp4';
          } else if (MediaRecorder.isTypeSupported('audio/aac')) {
            chosenMime = 'audio/aac';
          }

          const mr = chosenMime
            ? new MediaRecorder(this.micStream, { mimeType: chosenMime })
            : new MediaRecorder(this.micStream);

          this.mediaRecorder = mr;
          mr.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) {
              this.recordedAudioChunks.push(e.data);
            }
          };
          mr.start(200);
        } catch (mrErr) {
          console.warn('[Voice Assistant] MediaRecorder start notice:', mrErr);
        }
      }

      return true;
    } catch (err: any) {
      console.warn('[Voice Assistant] Microphone access error:', err);
      this.state.errorMessage =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'Microphone permission blocked. Please allow mic access in your browser or type below!'
          : 'Microphone not detected. Please check mic permissions or type your question below.';
      this.notify();
      return false;
    }
  }

  private stopMicAudioCapture() {
    if (this.micAnimFrameId) {
      cancelAnimationFrame(this.micAnimFrameId);
      this.micAnimFrameId = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (_) {}
    }
    if (this.micStream) {
      try {
        this.micStream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      this.micStream = null;
    }
    if (this.micAudioCtx && this.micAudioCtx.state !== 'closed') {
      try {
        this.micAudioCtx.close();
      } catch (_) {}
      this.micAudioCtx = null;
    }
    this.micAnalyser = null;
    this.state.inputAudioLevel = 0;
  }

  private startOutputVisualizerLoop() {
    // Generate pulse loop
    const loop = () => {
      if (this.state.status !== 'speaking') return;
      this.state.outputAudioLevel = Math.floor(40 + Math.random() * 55);
      this.notify();
      this.animFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  private stopOutputVisualizerLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.state.outputAudioLevel = 0;
  }

  // ---------------------------------------------------------------------------
  // AURA EXPEDITION & QUEST METHODS
  // ---------------------------------------------------------------------------
  public async startMissionWithAura(mission: GeneratedMission, explorerName: string = 'Explorer') {
    this.stopSpeaking();
    this.updateContext({ mission, explorerName });
    soundEffects.playWakeChime();
    const text = `Hello ${explorerName}! I am Aura, your nature companion. Our quest has begun: let's walk the trail together and search for natural treasures to craft ${mission.title}. Whenever you spot something, just let me know!`;
    this.state.lastThought = `Active quest: ${mission.title}. Aura standing by.`;
    this.state.lastSpokenText = text;
    this.notify();
    await this.speak(text);
  }

  public announceExpeditionStart(mission: GeneratedMission, explorerName: string = 'Explorer') {
    this.stopSpeaking();
    const text = `Hello ${explorerName}! I am Aura. Today our quest is ${mission.title}. Enjoy the fresh air, take your time along the path, and tell me what you discover!`;
    this.state.lastThought = `Quest briefing: ${mission.title}.`;
    this.state.lastSpokenText = text;
    this.notify();
    this.speak(text);
  }

  public announceCraftVerified(craftName: string, xp: number) {
    this.stopSpeaking();
    const text = `What a wonderful creation! Your ${craftName} looks beautiful on the earth. You earned ${xp} points on your quest!`;
    this.state.lastThought = 'Celebrating verified quest craft with points.';
    this.state.lastSpokenText = text;
    this.notify();
    this.speak(text);
  }

  public onMovementTelemetry(telemetry: MovementTelemetry, mission: GeneratedMission) {
    this.updateContext({ telemetry, mission });
    if (!this.state.isAutoLeadEnabled || this.state.isMuted) return;
    const now = Date.now();
    if (now - this.lastSpokenTimestamp < 50000) return;

    const distance = telemetry.distanceCoveredMeters || 0;
    if (distance >= 60 && this.lastMilestoneDistance < 60) {
      this.lastMilestoneDistance = 60;
      this.interact('I have walked 60 meters forward');
    }
  }
}

export const voiceAssistantService = new VoiceAssistantService();
