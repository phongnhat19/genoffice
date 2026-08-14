// Manual Genspark E2E is disabled for ORIO.
// import { gskGenerateImage } from '../src/gsk'
import { webSearch, imageSearch } from '../src/index'

const w = await webSearch('PowerPoint design trends 2026', 3)
console.log(
  'webSearch method:',
  w.method,
  '| results:',
  w.results.length,
  '| first:',
  w.results[0]?.title?.slice(0, 60),
)

const im = await imageSearch('minimalist gradient background', 3)
console.log(
  'imageSearch method:',
  im.method,
  '| images:',
  im.images.length,
  '| first:',
  im.images[0]?.imageUrl?.slice(0, 70),
)

// const g = await gskGenerateImage({ ... })
// const resp = await fetch(g.url)
