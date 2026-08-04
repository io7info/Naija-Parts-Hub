import { after, before, describe, it } from 'node:test';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

import { assertFails, assertSucceeds, makeTestEnv } from './helpers.mjs';

/**
 * Cloud Storage security rules (SOW section 11, "Secure Firebase Storage rules").
 *
 * Listing images are the one place a dealer uploads arbitrary binary data, so
 * the rules are a genuine attack surface: bucket-filling, cross-tenant writes,
 * and script-bearing file types served from our own origin.
 *
 * Path layout: stores/{storeId}/listings/{listingId}/{imageId}
 * storeId is the dealer's uid, so the path itself carries ownership.
 */

const DEALER = 'dealer-1';
const OTHER = 'dealer-2';
const IMAGE_PATH = `stores/${DEALER}/listings/listing-1/img-1.jpg`;
const PROFILE_PATH = `stores/${DEALER}/profile/logo.jpg`;

const SIZE_LIMIT = 512 * 1024;

const jpeg = (bytes = 1024) => new Uint8Array(bytes).fill(0xff);
const meta = (contentType) => ({ contentType });

let env;

before(async () => {
  env = await makeTestEnv();
});

after(async () => {
  await env?.cleanup();
});

const asDealer = (uid = DEALER) => env.authenticatedContext(uid).storage();
const asAdmin = () => env.authenticatedContext('admin-1', { role: 'super_admin' }).storage();
const asVisitor = () => env.unauthenticatedContext().storage();

describe('listing images — uploads', () => {
  it('lets the owning dealer upload a valid JPEG', async () => {
    await assertSucceeds(
      uploadBytes(ref(asDealer(), IMAGE_PATH), jpeg(), meta('image/jpeg')),
    );
  });

  it('accepts PNG and WebP too', async () => {
    await assertSucceeds(
      uploadBytes(ref(asDealer(), `stores/${DEALER}/listings/l1/a.png`), jpeg(), meta('image/png')),
    );
    await assertSucceeds(
      uploadBytes(ref(asDealer(), `stores/${DEALER}/listings/l1/b.webp`), jpeg(), meta('image/webp')),
    );
  });

  it('REJECTS a dealer uploading into another dealer\'s path', async () => {
    // Cross-tenant write — SOW section 11, "Prevention of cross-store data access".
    await assertFails(
      uploadBytes(ref(asDealer(OTHER), IMAGE_PATH), jpeg(), meta('image/jpeg')),
    );
  });

  it('rejects an unauthenticated upload', async () => {
    await assertFails(
      uploadBytes(ref(asVisitor(), IMAGE_PATH), jpeg(), meta('image/jpeg')),
    );
  });
});

describe('listing images — content type allowlist', () => {
  // The rules use an explicit allowlist rather than `image/*`. SVG is an image
  // type that can carry script, and it would be served from our own origin.
  it('REJECTS SVG even though it is an image type', async () => {
    await assertFails(
      uploadBytes(ref(asDealer(), IMAGE_PATH), jpeg(), meta('image/svg+xml')),
    );
  });

  it('rejects a PDF', async () => {
    await assertFails(
      uploadBytes(ref(asDealer(), IMAGE_PATH), jpeg(), meta('application/pdf')),
    );
  });

  it('rejects an HTML file disguised by extension', async () => {
    await assertFails(
      uploadBytes(
        ref(asDealer(), `stores/${DEALER}/listings/l1/evil.jpg`),
        jpeg(),
        meta('text/html'),
      ),
    );
  });

  it('rejects an upload with no content type at all', async () => {
    await assertFails(uploadBytes(ref(asDealer(), IMAGE_PATH), jpeg()));
  });
});

describe('listing images — size ceiling', () => {
  it('accepts a file just under the limit', async () => {
    await assertSucceeds(
      uploadBytes(ref(asDealer(), IMAGE_PATH), jpeg(SIZE_LIMIT - 1024), meta('image/jpeg')),
    );
  });

  it('REJECTS a file over the limit', async () => {
    // The client compresses before upload; this is the backstop that stops an
    // unmodified client from filling the bucket.
    await assertFails(
      uploadBytes(ref(asDealer(), IMAGE_PATH), jpeg(SIZE_LIMIT + 1024), meta('image/jpeg')),
    );
  });
});

describe('listing images — reads', () => {
  it('lets anyone read an uploaded image', async () => {
    // Public read is required: the marketplace and storefront pages render
    // these for signed-out visitors (SOW sections 6 and 7).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), IMAGE_PATH), jpeg(), meta('image/jpeg'));
    });
    await assertSucceeds(getBytes(ref(asVisitor(), IMAGE_PATH)));
  });
});

describe('listing images — deletes', () => {
  it('lets the owner delete their own image', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), IMAGE_PATH), jpeg(), meta('image/jpeg'));
    });
    await assertSucceeds(deleteObject(ref(asDealer(), IMAGE_PATH)));
  });

  it('lets an admin delete any image (SOW section 9 moderation)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), IMAGE_PATH), jpeg(), meta('image/jpeg'));
    });
    await assertSucceeds(deleteObject(ref(asAdmin(), IMAGE_PATH)));
  });

  it('stops one dealer deleting another dealer\'s image', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), IMAGE_PATH), jpeg(), meta('image/jpeg'));
    });
    await assertFails(deleteObject(ref(asDealer(OTHER), IMAGE_PATH)));
  });
});

describe('store profile images', () => {
  it('lets the owner upload a logo', async () => {
    await assertSucceeds(
      uploadBytes(ref(asDealer(), PROFILE_PATH), jpeg(), meta('image/jpeg')),
    );
  });

  it('rejects another dealer writing to it', async () => {
    await assertFails(
      uploadBytes(ref(asDealer(OTHER), PROFILE_PATH), jpeg(), meta('image/jpeg')),
    );
  });
});

describe('paths outside the allowed layout are denied by default', () => {
  const forbidden = [
    'random.jpg',
    'stores/dealer-1/secret.jpg',
    'stores/dealer-1/listings/listing-1/nested/deep.jpg',
    'admin/backup.jpg',
    'listings/listing-1/img.jpg',
  ];

  for (const path of forbidden) {
    it(`rejects writing to "${path}"`, async () => {
      await assertFails(
        uploadBytes(ref(asDealer(), path), jpeg(), meta('image/jpeg')),
      );
    });
  }

  it('rejects reading an arbitrary path', async () => {
    await assertFails(getBytes(ref(asVisitor(), 'admin/backup.jpg')));
  });
});
