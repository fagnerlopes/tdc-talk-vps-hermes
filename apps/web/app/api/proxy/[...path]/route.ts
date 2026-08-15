import { NextResponse, type NextRequest } from 'next/server';

// Proxy de RUNTIME para a API. O browser so fala same-origin com /api/proxy/*,
// entao nao ha CORS, nao ha URL cravada no bundle e o Coolify so precisa expor
// um dominio. A API continua publicada na 3001 para o Hermes e para os curl do
// checklist, e continua logando endpoint "/v2/checkout" — a narrativa nao muda.
export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const target = `${API_INTERNAL_URL}/${path.join('/')}${request.nextUrl.search}`;

  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const raw = await request.text();
    if (raw.length > 0) {
      body = raw;
      headers['content-type'] = request.headers.get('content-type') ?? 'application/json';
    }
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
    });

    const payload = await response.text();

    return new NextResponse(payload, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'proxy_unreachable', target, detail: String(error) },
      { status: 502 },
    );
  }
}

export { handler as GET, handler as POST };
