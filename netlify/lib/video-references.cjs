// App limits, not a claim about Omni 1.1's undocumented reference-image maximum.
const MAX_REFERENCE_IMAGES = 3;
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const REFERENCE_INSTRUCTION = "Gebruik de foto('s) alleen als referentie voor het product. Maak een nieuwe scène; begin de video niet met de geüploade foto.";
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/;

function matchesImageType(bytes, mimeType) {
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
}

function parseReferenceImages(input) {
  // Keep older clients and the existing single-image test page compatible.
  const sources = input?.images === undefined ? (input?.image === undefined ? [] : [input.image]) : input.images;
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_REFERENCE_IMAGES) {
    return {error:`Kies 1 tot ${MAX_REFERENCE_IMAGES} referentiefoto's.`};
  }
  const images = [];
  let totalBytes = 0;
  for (const source of sources) {
    if (typeof source !== 'string' || source.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 + 64) {
      return {error:'De referentiefoto’s mogen samen maximaal 4 MiB zijn.'};
    }
    const match = source.match(DATA_URL);
    if (!match || !match[2] || match[2].length % 4 !== 0) {
      return {error:'Gebruik geldige JPEG-, PNG- of WebP-foto’s.'};
    }
    const bytes = Buffer.from(match[2], 'base64');
    totalBytes += bytes.length;
    if (totalBytes > MAX_REFERENCE_BYTES) return {error:'De referentiefoto’s mogen samen maximaal 4 MiB zijn.'};
    if (bytes.toString('base64') !== match[2] || !matchesImageType(bytes, match[1])) {
      return {error:'Het bestand is geen geldige JPEG-, PNG- of WebP-foto.'};
    }
    images.push({mimeType:match[1],data:match[2]});
  }
  return {images};
}

module.exports = {MAX_REFERENCE_IMAGES, MAX_REFERENCE_BYTES, REFERENCE_INSTRUCTION, parseReferenceImages};
