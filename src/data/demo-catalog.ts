// DEMO CONTENT — placeholder products for testing only. Replace before launch.
// Descriptions are neutral placeholders; no ingredient, benefit, or medical claims are made.
export const DEMO_CATALOG = {
  label: "DEMO CONTENT",
  store: { currency: "CAD", region: "CA" },
  products: [
    {
      slug: "demo-velvet-lip-tint",
      brand: "Demo Brand A",
      category: "makeup",
      nameEn: "Demo Velvet Lip Tint",
      descriptionEn: "Placeholder description. Replace with approved product copy.",
      status: "ACTIVE",
      isNew: true,
      variants: [
        { sku: "DEMO-LT-ROSE", shadeName: "Rose Petal", priceCents: 2800, compareAtCents: null, stock: 24 },
        { sku: "DEMO-LT-BERRY", shadeName: "Wild Berry", priceCents: 2800, compareAtCents: 3200, stock: 3 },
        { sku: "DEMO-LT-NUDE", shadeName: "Soft Nude", priceCents: 2800, compareAtCents: null, stock: 0 },
      ],
    },
    {
      slug: "demo-gentle-cleanser",
      brand: "Demo Brand B",
      category: "skincare",
      nameEn: "Demo Gentle Cleanser",
      descriptionEn: "Placeholder description. Replace with approved product copy.",
      status: "ACTIVE",
      skinTypes: [],
      variants: [
        { sku: "DEMO-CL-150", sizeLabel: "150 ml", priceCents: 2200, stock: 40 },
        { sku: "DEMO-CL-300", sizeLabel: "300 ml", priceCents: 3400, stock: 12 },
      ],
    },
  ],
} as const;