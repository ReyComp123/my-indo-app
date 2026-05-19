export async function POST(req: Request) {
  try {
    const { text, targetLang } = await req.json();
    console.log('[DeepL API] Request:', { text, targetLang });

    const deeplApiKey = process.env.NEXT_PUBLIC_DEEPL_API_KEY;
    console.log('[DeepL API] Key exists:', !!deeplApiKey, 'Key length:', deeplApiKey?.length);
    
    if (!deeplApiKey || deeplApiKey === 'your-deepl-api-key-here') {
      console.error('[DeepL API] Key not configured');
      return Response.json({ error: 'DeepL API key not configured' }, { status: 500 });
    }

    // source_lang を省略 → 自動言語検出
    const body = new URLSearchParams({ text, target_lang: targetLang });
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
      console.error('[DeepL API] HTTP error:', res.status, err);
      return Response.json({ error: 'DeepL API error', status: res.status, details: err }, { status: 502 });
    }

    const data = await res.json();
    console.log('[DeepL API] Response:', data);
    const t = data.translations?.[0];
    return Response.json({ 
      text: t?.text || null, 
      detectedSourceLanguage: t?.detected_source_language || null 
    });
  } catch (e) {
    console.error('[DeepL API] Exception:', e);
    return Response.json({ error: 'Internal server error', details: String(e) }, { status: 500 });
  }
}
