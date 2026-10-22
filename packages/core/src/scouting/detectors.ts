/** Detección determinista de qué dice una descripción (chips de la pantalla Describe). Sin dependencias de Node: se usa también en el navegador. */
export const DETECTORS: Array<[string, RegExp]> = [
  ["Platform", /tiktok|instagram|youtube|twitch|reels|shorts/i],
  ["Location", /bogot|medell|mexico|méxico|colombia|spain|españa|madrid|lima|per[uú]|chile|argentina|latam|brazil|brasil|usa|united states|ciudad/i],
  ["Size", /\d+\s?k\b|followers|seguidores|subscribers|suscriptores|micro|macro/i],
  ["Topic", /talk about|hablen de|about |niche|nicho|coffee|caf[eé]|finance|finanzas|running|skincare|fashion|moda|gaming|cooking|cocina|travel|viaj|maternidad|mam[aá]s|fitness/i],
  ["Audience", /years old|aged|audience|audiencia|gen z|\bage\b|edad|años/i],
  ["Budget", /budget|presupuesto|\$|€|usd|eur\b|cop\b|mxn/i],
  ["Timing", /january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|week|semana|month|mes\b|date|fecha|launch|lanzamiento/i],
];

export function detectChips(text: string): Array<{ label: string; on: boolean }> {
  return DETECTORS.map(([label, re]) => ({ label, on: re.test(text) }));
}
