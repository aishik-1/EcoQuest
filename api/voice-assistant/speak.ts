export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, xi-api-key');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const text = (body.text || '').trim();

    if (!text) {
      return res.status(400).json({ error: 'Text prompt required' });
    }

    const elevenKey = (
      process.env.ELEVENLABS_API_KEY ||
      'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2'
    ).trim();

    const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - Locked authentic human companion voice
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

    const elevenRes = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 1500),
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.38,
          similarity_boost: 0.85,
          style: 0.20,
          use_speaker_boost: true,
        },
      }),
    });

    if (elevenRes.ok) {
      const arrayBuffer = await elevenRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', buffer.byteLength);
      res.setHeader('X-Voice-Engine', 'elevenlabs-sarah');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(buffer);
    } else {
      const errText = await elevenRes.text().catch(() => '');
      console.warn('[Vercel TTS] ElevenLabs error:', elevenRes.status, errText);
      return res.status(elevenRes.status).json({
        error: 'ElevenLabs synthesis failed',
        details: errText,
      });
    }
  } catch (err: any) {
    console.error('[Vercel TTS] Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
