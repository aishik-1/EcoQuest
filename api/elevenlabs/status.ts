export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    configured: true,
    hasElevenLabsKey: true,
    activeEngine: 'elevenlabs-primary',
    defaultVoiceId: 'EXAVITQu4vr4xnSDxMaL',
    defaultVoiceName: 'Aura (Sarah - Natural Human Voice)',
    models: [
      { id: 'eleven_turbo_v2_5', name: 'ElevenLabs Turbo v2.5', badge: 'Active' },
      { id: 'eleven_flash_v2_5', name: 'ElevenLabs Flash v2.5', badge: 'Fast' },
    ],
  });
}
