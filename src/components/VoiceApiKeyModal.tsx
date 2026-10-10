import React, { useState, useEffect } from 'react';
import {
  Key,
  X,
  Sparkles,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Radio,
  ExternalLink,
  ShieldAlert,
  Mic,
} from 'lucide-react';
import { hapticFeedback } from '../utils/haptics';
import { voiceAssistantService } from '../services/voiceAssistantService';

interface VoiceApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoiceApiKeyModal: React.FC<VoiceApiKeyModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [serverStatus, setServerStatus] = useState<{
    hasKey: boolean;
    activeEngine: string;
    activeVoice: string;
  }>({
    hasKey: false,
    activeEngine: 'Gemini Neural Speech / Web Speech',
    activeVoice: 'Aura (Sarah - EXAVITQu4vr4xnSDxMaL)',
  });

  // Load existing key from localStorage or check server status
  useEffect(() => {
    if (!isOpen) return;

    const saved = localStorage.getItem('ecoquest_voice_api_key') || 'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2';
    if (saved) {
      setApiKey(saved);
    }

    checkStatus();
  }, [isOpen]);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/elevenlabs/status');
      if (res.ok) {
        const data = await res.json();
        setServerStatus({
          hasKey: Boolean(data.hasElevenLabsKey),
          activeEngine: data.hasElevenLabsKey
            ? 'ElevenLabs Neural Engine (Active)'
            : 'Gemini Neural Speech Engine (Active)',
          activeVoice: 'Aura (Sarah - EXAVITQu4vr4xnSDxMaL)',
        });
      }
    } catch (_) {}
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'Please enter a valid API key string.',
      });
      return;
    }

    const trimmed = apiKey.trim();
    setIsSaving(true);
    setStatusMessage(null);
    hapticFeedback.tactileClick();

    try {
      const res = await fetch('/api/elevenlabs/set-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = await res.json();

      if (data.success) {
        localStorage.setItem('ecoquest_voice_api_key', trimmed);
        setStatusMessage({
          type: 'success',
          text: 'Voice API Key saved and active on server!',
        });
        hapticFeedback.challengeCompleted();
        await checkStatus();
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || 'Failed to apply voice API key',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Network error saving key',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestVoice = async () => {
    setIsTesting(true);
    hapticFeedback.buttonPress();
    setStatusMessage({
      type: 'info',
      text: 'Synthesizing voice test with Aura...',
    });

    try {
      await voiceAssistantService.speak(
        "Aura voice system calibrated and operational! I'm ready for our nature quest, Explorer!"
      );
      setStatusMessage({
        type: 'success',
        text: 'Audio played successfully through your speaker/headphones!',
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: 'Could not play voice audio: ' + (err.message || 'Error'),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState<number | null>(null);

  const handleTestMic = async () => {
    setIsTestingMic(true);
    setMicTestLevel(null);
    hapticFeedback.buttonPress();
    setStatusMessage({
      type: 'info',
      text: 'Listening to your microphone for 2 seconds... Please say hello into your microphone!',
    });

    const res = await voiceAssistantService.testMicrophone();
    setIsTestingMic(false);

    if (res.success) {
      setMicTestLevel(res.level);
      setStatusMessage({
        type: 'success',
        text: `Microphone active! Audio input detected (Peak level: ${res.level}%). Your browser can hear your voice!`,
      });
      hapticFeedback.challengeCompleted();
    } else {
      setStatusMessage({
        type: 'error',
        text: res.error || 'Microphone access denied. Please click the camera/mic icon in your browser address bar to allow.',
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-stone-900 border border-stone-700/80 text-stone-100 p-5 sm:p-6 shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col">
        {/* Ambient Top Glow */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-950/80 border border-emerald-600/60 flex items-center justify-center text-emerald-400 shadow-xs">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-extrabold text-base sm:text-lg text-white">
                Voice Integration & Key
              </h2>
              <p className="text-[11px] font-mono text-stone-400">
                Aura Companion Studio Speech Engine
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              hapticFeedback.tactileClick();
              onClose();
            }}
            className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="py-4 space-y-4 overflow-y-auto flex-1 font-mono text-xs pr-1">
          {/* Active Architecture Pill Card */}
          <div className="p-3.5 rounded-2xl bg-stone-850 border border-stone-750 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-stone-400 uppercase tracking-wider font-bold">
                CURRENT VOICE ENGINE
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  serverStatus.hasKey
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/80'
                    : 'bg-teal-950 text-teal-300 border border-teal-700/80'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {serverStatus.hasKey ? 'ELEVENLABS ACTIVE' : 'GEMINI SPEECH ACTIVE'}
              </span>
            </div>
            <div className="text-stone-200 text-xs font-semibold flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Voice: {serverStatus.activeVoice}</span>
            </div>
            <p className="text-[11px] font-sans text-stone-400 leading-relaxed">
              <strong>Aura's Brain:</strong> Powered by Gemini 3.8 Flash running on the server, tracking live quest items, GPS coordinates, and real local time.
              <br />
              <strong>Voice Audio:</strong> Generates lifelike human speech through ElevenLabs Turbo or Gemini Neural Speech.
            </p>
          </div>

          {/* API Key Input Section */}
          <div className="space-y-1.5">
            <label className="block text-stone-200 font-bold text-xs">
              ElevenLabs Voice API Key:
            </label>
            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste sk_... API key"
                className="w-full pl-3 pr-20 py-2.5 rounded-xl bg-stone-950 border border-stone-700 text-white placeholder-stone-500 font-mono text-xs outline-none focus:border-emerald-500 transition-colors"
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="p-1 rounded-lg text-stone-400 hover:text-stone-200 cursor-pointer"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const clip = await navigator.clipboard.readText();
                      if (clip) setApiKey(clip.trim());
                    } catch (_) {}
                  }}
                  className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-[10px] text-stone-300 font-bold cursor-pointer"
                >
                  Paste
                </button>
              </div>
            </div>
            <p className="text-[10px] text-stone-500">
              Valid ElevenLabs Secret API keys start with <code>sk_</code> and are 51 characters long.
            </p>
          </div>

          {/* Status Message Alert */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-700/80 text-emerald-300'
                  : statusMessage.type === 'error'
                  ? 'bg-rose-950/60 border-rose-700/80 text-rose-300'
                  : 'bg-sky-950/60 border-sky-700/80 text-sky-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : statusMessage.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-sky-400 animate-spin" />
              )}
              <span className="flex-1 font-sans">{statusMessage.text}</span>
            </div>
          )}

          {/* Quick Actions Row */}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-stone-950 font-display font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
            >
              <Key className="w-4 h-4" />
              <span>{isSaving ? 'Saving to Server...' : 'Save & Activate Voice Key'}</span>
            </button>

            <button
              onClick={handleTestVoice}
              disabled={isTesting}
              className="py-2.5 px-3.5 rounded-xl bg-stone-800 hover:bg-stone-750 text-stone-200 border border-stone-700 font-mono text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              title="Test speaker output by having Aura speak a calibration line"
            >
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span>{isTesting ? 'Playing...' : 'Test Speaker'}</span>
            </button>

            <button
              onClick={handleTestMic}
              disabled={isTestingMic}
              className={`py-2.5 px-3.5 rounded-xl border font-mono text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                isTestingMic
                  ? 'bg-rose-950 text-rose-300 border-rose-700 animate-pulse'
                  : 'bg-stone-800 hover:bg-stone-750 text-stone-200 border border-stone-700'
              }`}
              title="Test microphone input to verify your browser hears your voice"
            >
              <Mic className={`w-4 h-4 ${isTestingMic ? 'text-rose-400 animate-bounce' : 'text-emerald-400'}`} />
              <span>{isTestingMic ? 'Listening...' : 'Test Mic'}</span>
            </button>
          </div>

          {/* Chat reminder box */}
          <div className="p-3 rounded-2xl bg-stone-950/80 border border-stone-800 text-[11px] font-sans text-stone-400 space-y-1">
            <div className="font-bold text-stone-300 flex items-center gap-1.5 font-mono text-[10px] uppercase">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              API Key Sharing in Chat
            </div>
            <p>
              You can also share your API key directly with the AI in chat! When you paste it, it will be automatically wired up to power Aura's companion voice while keeping the intelligent brain intact.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>BRAIN: GEMINI 3.8 FLASH</span>
          </div>
          <button
            onClick={() => {
              hapticFeedback.tactileClick();
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-mono text-xs font-bold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
