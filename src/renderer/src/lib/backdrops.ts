import highland from '../assets/backdrop.webp'
import highlandBlur from '../assets/backdrop-blur.webp'
import alps from '../assets/bg/alps.webp'
import alpsBlur from '../assets/bg/alps-blur.webp'
import coast from '../assets/bg/coast.webp'
import coastBlur from '../assets/bg/coast-blur.webp'
import dusk from '../assets/bg/dusk.webp'
import duskBlur from '../assets/bg/dusk-blur.webp'
import falls from '../assets/bg/falls.webp'
import fallsBlur from '../assets/bg/falls-blur.webp'
import golden from '../assets/bg/golden.webp'
import goldenBlur from '../assets/bg/golden-blur.webp'
import mist from '../assets/bg/mist.webp'
import mistBlur from '../assets/bg/mist-blur.webp'

export interface Backdrop {
  id: string
  name: string
  /** Full photo behind the panels and in the overview. */
  photo: string
  /** Tiny pre-blurred copy; the frosted panels paint it, so there is no live backdrop-filter cost. */
  blur: string
  alt: string
  credit: string
  source: string
  /** Base color shown until the photo has loaded. */
  base: string
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'highland',
    name: 'Highland',
    photo: highland,
    blur: highlandBlur,
    alt: 'Green highland ridge under low cloud, with a narrow road winding below',
    credit: 'Andrew Ridley',
    source: 'https://unsplash.com/photos/Kt5hRENuotI',
    base: '#33433a'
  },
  {
    id: 'mist',
    name: 'Mist',
    photo: mist,
    blur: mistBlur,
    alt: 'Misty valley with a river below pine-covered hills',
    credit: 'Paul Jarvis',
    source: 'https://unsplash.com/photos/Cm7oKel-X2Q',
    base: '#51655d'
  },
  {
    id: 'coast',
    name: 'Coast',
    photo: coast,
    blur: coastBlur,
    alt: 'Dark pine forest above a calm blue sea',
    credit: 'Paul Jarvis',
    source: 'https://unsplash.com/photos/6J--NXulQCs',
    base: '#3a5a66'
  },
  {
    id: 'falls',
    name: 'Falls',
    photo: falls,
    blur: fallsBlur,
    alt: 'Waterfall running through a rocky forest stream',
    credit: 'Paul Jarvis',
    source: 'https://unsplash.com/photos/NYDo21ssGao',
    base: '#46544a'
  },
  {
    id: 'alps',
    name: 'Alps',
    photo: alps,
    blur: alpsBlur,
    alt: 'Snow-covered mountain valley seen from a rocky ridge',
    credit: 'Go Wild',
    source: 'https://unsplash.com/photos/V0yAek6BgGk',
    base: '#4b5663'
  },
  {
    id: 'golden',
    name: 'Golden hour',
    photo: golden,
    blur: goldenBlur,
    alt: 'Hills and forest in warm evening light',
    credit: 'Daniel Genser',
    source: 'https://unsplash.com/photos/PzPbh-faPgU',
    base: '#5a5136'
  },
  {
    id: 'dusk',
    name: 'Dusk',
    photo: dusk,
    blur: duskBlur,
    alt: 'Dark pine forest against a fading evening sky',
    credit: 'Julie Geiger',
    source: 'https://unsplash.com/photos/dYshDcTI1Js',
    base: '#24313a'
  }
]

export const DEFAULT_BACKDROP = BACKDROPS[0]

export function backdropById(id: string | undefined): Backdrop {
  return BACKDROPS.find((b) => b.id === id) ?? DEFAULT_BACKDROP
}
