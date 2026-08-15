// src/pages/PackagesAndMenus/constants.js
export const DEFAULT_COLORS = [
  'Burgundy', 'Navy Blue', 'Emerald Green', 'Gold', 'Silver', 'White',
  'Cream', 'Blush Pink', 'Lavender', 'Champagne', 'Mint Green', 'Peach',
];

// Approximate hex swatches so color names actually look like colors in the
// UI instead of just plain text. Purely visual — the stored value is still
// just the color's name string.
const COLOR_SWATCHES = {
  'burgundy': '#800020',
  'navy blue': '#000080',
  'emerald green': '#50C878',
  'gold': '#D4AF37',
  'silver': '#C0C0C0',
  'white': '#FFFFFF',
  'cream': '#FFFDD0',
  'blush pink': '#FEC5E5',
  'lavender': '#E6E6FA',
  'champagne': '#F7E7CE',
  'mint green': '#98FF98',
  'peach': '#FFE5B4',
  'black': '#000000',
  'red': '#C41E3A',
  'blue': '#2563EB',
  'green': '#16A34A',
  'purple': '#7C3AED',
  'pink': '#EC4899',
  'orange': '#F97316',
  'yellow': '#EAB308',
  'brown': '#78350F',
  'teal': '#0D9488',
  'maroon': '#7F1D1D',
  'ivory': '#FFFFF0',
};

// Falls back to a neutral gray dot for any custom name that isn't in the
// known list, rather than guessing or leaving it blank.
export function getSwatchColor(name) {
  return COLOR_SWATCHES[(name || '').trim().toLowerCase()] || '#94A3B8';
}

export const EMPTY_FORM_DATA = {
  title: '',
  price: '',
  minPax: '',
  categoryId: '',
  description: '',
  imageFile: null,
  selectedCategories: [],
  selectedEquipment: [],
  equipmentQuantities: {},
  equipmentPerPax: {},
  pricing_type: 'per_pax',
  max_pax: '',
  extra_pax_price: '',
  colors: [],
  existingImageUrl: null,
};
