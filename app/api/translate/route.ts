export async function POST(req: Request) {
  try {
    const { text, targetLang } = await req.json();

    const deeplApiKey = process.env.NEXT_PUBLIC_DEEPL_API_KEY;
    if (!deeplApiKey || deeplApiKey === 'your-deepl-api-key-here') {
      return Response.json({ error: 'DeepL API key not configured' }, { status: 500 });
    }

    const body = new URLSearchParams({ text, target_lang: targetLang, source_lang: 'JA' });
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${deeplApiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      console.error('DeepL API error:', res.status, err);
      return Response.json({ error: 'DeepL API error', status: res.status }, { status: 502 });
    }

    const data = await res.json();
    const translatedText = data.translations?.[0]?.text || null;
    return Response.json({ text: translatedText });
  } catch (e) {
    console.error('Translate API error:', e);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
