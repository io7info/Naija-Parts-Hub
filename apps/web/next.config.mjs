/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The prototype shipped `typescript.ignoreBuildErrors: true` and
  // `images.unoptimized: true`. Both are deliberately absent:
  //
  //  - ignoreBuildErrors would let type errors reach production. A build that
  //    cannot fail is not a check.
  //  - unoptimized disables resizing and modern formats. The approved assets
  //    total ~11 MB, including a 1 MB logo on every page, which is untenable
  //    on the Nigerian mobile networks this marketplace targets.

  // @nph/contracts ships compiled CJS from the workspace; Next must transpile
  // it rather than treat it as an external package.
  transpilePackages: ['@nph/contracts'],

  images: {
    formats: ['image/avif', 'image/webp'],

    // Next 16 refuses to fetch an upstream image that resolves to a private
    // IP, as SSRF protection — a public URL that resolves to 127.0.0.1 is a
    // classic way to make a server fetch its own internal services.
    //
    // The Storage emulator lives on 127.0.0.1:9199, so every listing photo
    // returned 400 ("url" parameter is not allowed) in local development while
    // the URLs themselves were perfectly valid. Allowed only when running
    // against the emulators; production keeps the protection.
    dangerouslyAllowLocalIP: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true',

    // Listing images come from Firebase Storage; the emulator host is included
    // so local development renders real uploads.
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'http', hostname: 'localhost', port: '9199' },
      { protocol: 'http', hostname: '127.0.0.1', port: '9199' },
      { protocol: 'http', hostname: '10.0.2.2', port: '9199' },
    ],
  },
};

export default nextConfig;
