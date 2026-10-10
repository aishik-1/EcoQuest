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
    const query = (body.query || '').trim();
    const playerName = body.playerName || body.explorerName || 'Explorer';
    const currentQuest = body.currentQuest || 'The Forest Leaf Dragon';
    const scavengerItems = body.scavengerItems || ['2x Broad Leaves (Wings)', '1x Curved Twig (Spine)', '2x River Pebbles (Eyes)'];
    const foundItems = body.foundItems || [];
    const remaining = scavengerItems.filter((i: string) => !foundItems.includes(i));

    const q = query.toLowerCase();
    let spokenText = `I am right beside you on the path, ${playerName}! Let's find what we need for ${currentQuest}.`;

    if (
      q.includes('task') ||
      q.includes('mission') ||
      q.includes('objective') ||
      q.includes('what should i do') ||
      q.includes('what do i need') ||
      q.includes('what are we doing')
    ) {
      if (remaining.length === 0 && scavengerItems.length > 0) {
        spokenText = `Splendid work, ${playerName}! You found all the items for ${currentQuest}. Place your specimens on the ground and capture your creation!`;
      } else if (remaining.length > 0) {
        const friendlyRemaining = remaining
          .join(', ')
          .replace(/2x\s*/gi, 'two ')
          .replace(/1x\s*/gi, 'one ')
          .replace(/3x\s*/gi, 'three ');
        spokenText = `We are crafting the ${currentQuest} today, ${playerName}! Right now we are searching for ${friendlyRemaining}. Keep your eyes open along the trail!`;
      } else {
        spokenText = `Our quest today is the ${currentQuest}, ${playerName}. Enjoy your walk, gather natural treasures, and tell me what you find!`;
      }
    } else if (q.includes('leaf') || q.includes('twig') || q.includes('pebble') || q.includes('rock') || q.includes('found')) {
      spokenText = `Splendid discovery, ${playerName}! Nature is full of treasures. Let's record that specimen in your field book!`;
    } else if (q.includes('hello') || q.includes('hi') || q.includes('hey')) {
      spokenText = `Hello ${playerName}! The air is so fresh out here today. I am ready to guide you on our nature quest!`;
    }

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
      spokenText,
      thought: `Aura processed your voice with quest state: ${currentQuest}.`,
      action: 'NONE',
      audioBase64,
      audioMimeType: 'audio/mpeg',
      source: 'vercel-serverless-elevenlabs',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
