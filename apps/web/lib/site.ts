/** Links that depend on where the project is published. Unset links are left out. */
export const site = {
  sourceUrl: process.env.NEXT_PUBLIC_SOURCE_URL || null,
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL || null,
};
