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
    const state = body.state || {};
    const playerName = state.playerName || 'Explorer';
    const currentQuest = state.currentQuest || 'The Forest Leaf Dragon';

    const spokenText = `I hear you loud and clear on the trail, ${playerName}! Let's keep exploring for ${currentQuest}.`;

    const elevenKey = (
      process.env.ELEVENLABS_API_KEY ||
      'sk_c7e4055e524972719127dde61105da5411bf1570e693e5d2'
    ).trim();
    const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - Authentic human companion voice

    let audioBase64: string | null = null;
    try {
      const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: spokenText.slice(0, 1500),
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
        const arrayBuf = await elevenRes.arrayBuffer();
        audioBase64 = Buffer.from(arrayBuf).toString('base64');
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      transcript: 'Hello Aura',
      spokenText,
      thought: 'Audio processed via Vercel serverless voice engine.',
      action: 'NONE',
      audioBase64,
      audioMimeType: 'audio/mpeg',
      source: 'vercel-serverless-elevenlabs',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
