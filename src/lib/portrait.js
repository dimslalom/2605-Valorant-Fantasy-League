// Portrait facts shared by the components that render player art.
//
// Lives outside PlayerPortrait.jsx because a component module that also
// exports plain helpers breaks React Fast Refresh.

export const PORTRAIT_PLACEHOLDER = '/assets/players/placeholder.png';

/**
 * Does this card have a face worth showing, or only the grey silhouette the
 * data pipeline assigns when no cutout exists? 296 of 922 cards are the
 * latter, and at roster-row size a grey head reads as a broken image - so
 * callers rendering small portraits substitute something legible instead.
 */
export function hasRealPortrait(card) {
  if (!card) return false;
  if (card.photo && card.photo !== PORTRAIT_PLACEHOLDER) return true;
  return Boolean(card.head) && !card.head.includes('/grey-');
}
