import { AUTOMOTIVE_CATEGORIES, LISTING_CATEGORIES } from '@nph/contracts'

/**
 * The complete set of words a search term may contribute to GA4.
 *
 * This is an allowlist, and that is the entire point. Redacting what *looks*
 * like personal data is a denylist, and a denylist cannot catch a name or a
 * street address — "call chidi at ladipo" survives any pattern-based filter.
 * Inverting it makes the guarantee provable rather than probabilistic: the
 * only strings that can ever leave this application are the ones written down
 * here, so no combination of user input can produce anything else.
 *
 * The cost is coverage. A search for a part nobody anticipated reports as
 * dropped tokens rather than as text, which is why `sanitizeSearchTerm`
 * returns a count of what it discarded — a rising count is the signal to
 * extend this list, and it carries no user text with it.
 *
 * Deliberately omitted: anything that reads as a given name. "John Deere" is
 * a real brand here, but "john" is also the most common way a name enters a
 * search box, so only "deere" is listed.
 */

/** Vehicle and equipment manufacturers sold through Nigerian parts dealers. */
const MAKES = [
  'toyota', 'honda', 'nissan', 'mazda', 'mitsubishi', 'suzuki', 'isuzu', 'lexus',
  'hyundai', 'kia', 'daewoo', 'ssangyong',
  'ford', 'chevrolet', 'gmc', 'jeep', 'dodge', 'chrysler',
  'volkswagen', 'vw', 'audi', 'bmw', 'mercedes', 'benz', 'opel', 'skoda',
  'peugeot', 'renault', 'citroen', 'fiat', 'land', 'rover', 'range', 'jaguar',
  'volvo', 'scania', 'iveco', 'daf', 'sinotruk', 'howo', 'shacman', 'foton',
  'jac', 'higer', 'yutong', 'tata', 'ashok', 'leyland',
  'bajaj', 'tvs', 'yamaha', 'jincheng', 'haojue', 'qlink', 'sinoki', 'kymco',
  'caterpillar', 'cat', 'komatsu', 'jcb', 'hitachi', 'doosan', 'hyster',
  'massey', 'ferguson', 'deere', 'kubota', 'newholland', 'holland', 'claas',
]

/** Models that reach the market in volume. */
const MODELS = [
  'corolla', 'camry', 'hilux', 'hiace', 'highlander', 'sienna', 'rav4', 'venza',
  'avensis', 'yaris', 'matrix', 'prado', 'cruiser', 'coaster', 'dyna', 'avalon',
  'civic', 'accord', 'crv', 'pilot', 'odyssey', 'element', 'city',
  'almera', 'micra', 'sentra', 'primera', 'patrol', 'xterra', 'murano', 'sunny',
  'sonata', 'elantra', 'accent', 'tucson', 'santafe', 'santa', 'starex',
  'rio', 'sportage', 'cerato', 'optima', 'picanto', 'sorento',
  'golf', 'passat', 'jetta', 'polo', 'touareg', 'sharan', 'transporter',
  'focus', 'fiesta', 'escape', 'explorer', 'ranger', 'transit', 'edge',
  'sprinter', 'actros', 'atego', 'axor', 'vito',
  'boxer', 'pulsar', 'discover', 'platina', 'ct100', 'apache',
]

/** Part nouns and the adjectives that qualify them. */
const PART_TERMS = [
  'brake', 'brakes', 'pad', 'pads', 'disc', 'discs', 'rotor', 'rotors', 'caliper',
  'drum', 'shoe', 'shoes', 'abs', 'handbrake',
  'engine', 'block', 'head', 'gasket', 'piston', 'rings', 'ring', 'valve', 'valves',
  'camshaft', 'crankshaft', 'flywheel', 'timing', 'belt', 'chain', 'tensioner',
  'pulley', 'mount', 'mounts', 'seal', 'sump', 'turbo', 'turbocharger', 'manifold',
  'injector', 'injectors', 'carburetor', 'throttle', 'body', 'intake',
  'clutch', 'plate', 'pressure', 'release', 'bearing', 'bearings', 'gearbox',
  'transmission', 'gear', 'gears', 'axle', 'differential', 'driveshaft', 'cv',
  'joint', 'joints', 'propeller', 'synchro',
  'suspension', 'shock', 'shocks', 'absorber', 'absorbers', 'strut', 'struts',
  'spring', 'springs', 'coil', 'bush', 'bushing', 'arm', 'control', 'link',
  'stabilizer', 'tie', 'rod', 'ball', 'knuckle', 'hub',
  'steering', 'rack', 'pinion', 'column', 'power', 'wheel',
  'alternator', 'starter', 'battery', 'dynamo', 'solenoid', 'regulator',
  'spark', 'plug', 'plugs', 'ignition', 'distributor', 'wiring', 'harness',
  'fuse', 'relay', 'sensor', 'sensors', 'ecu', 'module', 'switch', 'horn',
  'filter', 'filters', 'oil', 'air', 'fuel', 'cabin', 'diesel', 'petrol',
  'radiator', 'thermostat', 'pump', 'water', 'hydraulic', 'hose', 'pipe',
  'cooling', 'fan', 'condenser', 'compressor', 'evaporator', 'blower',
  'exhaust', 'muffler', 'silencer', 'catalytic', 'converter',
  'bumper', 'fender', 'bonnet', 'hood', 'boot', 'door', 'mirror', 'glass',
  'windscreen', 'windshield', 'wiper', 'blade', 'grille', 'headlight',
  'headlamp', 'taillight', 'indicator', 'bulb', 'lamp', 'light', 'lights',
  'seat', 'belt', 'dashboard', 'panel', 'handle', 'lock', 'latch', 'hinge',
  'tyre', 'tyres', 'tire', 'tires', 'rim', 'rims', 'nut', 'nuts', 'bolt', 'bolts',
  'bracket', 'clip', 'cover', 'kit', 'set', 'assembly', 'complete',
  'roller', 'bucket', 'track', 'undercarriage', 'blade', 'boom', 'ram',
]

/**
 * Condition and provenance words, including the Nigerian market's own.
 *
 * "Tokunbo" (foreign-used) and "Belgium" (used European stock) are how buyers
 * here actually describe grade, and losing them would hide the single most
 * commercially interesting split in the data.
 */
const CONDITION_TERMS = [
  'new', 'used', 'original', 'oem', 'aftermarket', 'genuine', 'quality',
  'tokunbo', 'belgium', 'grade', 'fairly', 'second', 'hand', 'refurbished',
  'front', 'rear', 'left', 'right', 'upper', 'lower', 'inner', 'outer',
  'automatic', 'manual', 'petrol', 'diesel', 'electric', 'hybrid',
]

/** Lubricant grades — a closed, standardised set. */
const GRADES = [
  '0w20', '0w30', '5w20', '5w30', '5w40', '10w30', '10w40', '15w40', '20w50',
  '75w90', '80w90', '85w140', 'atf', 'dot3', 'dot4', 'dot5',
]

/** Model years. A bare year identifies nobody and is how buyers narrow fitment. */
const YEARS = Array.from({ length: 2035 - 1980 + 1 }, (_, i) => String(1980 + i))

export const SEARCH_VOCABULARY: ReadonlySet<string> = new Set([
  ...MAKES,
  ...MODELS,
  ...PART_TERMS,
  ...CONDITION_TERMS,
  ...GRADES,
  ...YEARS,
  // Sourced from the contracts so a new category is searchable the moment it
  // is added, rather than silently dropping out of reporting.
  ...LISTING_CATEGORIES.flatMap((c) => [c.id, c.name.toLowerCase()]),
  ...AUTOMOTIVE_CATEGORIES.flatMap((c) => c.toLowerCase().split(/[^a-z]+/)).filter(Boolean),
])
