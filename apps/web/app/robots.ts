import type { MetadataRoute } from 'next';

// Segunda camada do noindex: cobre os crawlers que consultam robots.txt antes
// de buscar qualquer pagina. As outras duas estao em app/layout.tsx (metadata,
// para respostas HTML) e em next.config.mjs (header, para respostas nao-HTML).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
